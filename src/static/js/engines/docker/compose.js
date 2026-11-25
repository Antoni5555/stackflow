// docker compose: compose.yaml (+ compose.override.yaml), .env и env_file, профили; up, down, ps,
// logs, exec, run, build, config, stop/start/restart. Проект — имя папки; контейнеры
// ПРОЕКТ-СЕРВИС-1, сеть ПРОЕКТ_default (имя сервиса — DNS-имя), тома ПРОЕКТ_ИМЯ.
// Вывод — как у Docker Compose v2 в Docker 29 (сверено с образцами «Контента»).

import { now } from '../linux/clock.js';
import { FsError, normalize } from '../linux/fs.js';
import { hexHash, normalizeRef } from './catalog.js';
import {
  afterMainKilled, commandLine, containerShell, createContainer, healthStatus, removeContainer, runInContainer,
  startContainer, stopContainer,
} from './containers.js';
import { BuildError, buildImage } from './build.js';
import { humanDuration, table } from './format.js';
import { addCatalogImage, dockerState, findImage, newId, shortId } from './state.js';
import { forgetVolume } from './psql.js';
import { YamlError, dumpYaml, parseYaml } from './yaml.js';
import { renderTemplate } from './inspect.js';

const out = (text) => ({ text, err: false });
const err = (text) => ({ text, err: true });
const line = (text) => err(` ${text} \n`);          // строки хода работы compose — в stderr

class ComposeError extends Error {}

const FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
const OVERRIDES = ['compose.override.yaml', 'compose.override.yml', 'docker-compose.override.yaml', 'docker-compose.override.yml'];
const SERVICE_KEYS = new Set(['image', 'build', 'command', 'entrypoint', 'environment', 'env_file', 'ports', 'expose', 'volumes',
  'depends_on', 'healthcheck', 'restart', 'profiles', 'networks', 'container_name', 'working_dir', 'user', 'logging',
  'labels', 'stop_grace_period', 'init', 'tty', 'stdin_open', 'hostname', 'deploy', 'extra_hosts', 'develop', 'secrets', 'configs']);

// --- .env и подстановка ${VAR} ---

/** Строки .env/env_file → {ИМЯ: значение}; кавычки снимаются (так делает compose, не docker run). */
function readDotenv(text) {
  const env = {};
  for (const raw of text.split('\n')) {
    const lineText = raw.trim();
    if (!lineText || lineText.startsWith('#')) continue;
    const match = /^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(lineText);
    if (!match) continue;
    let value = match[2];
    if (/^"(.*)"$/.test(value)) value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    else if (/^'(.*)'$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    env[match[1]] = value;
  }
  return env;
}

/** ${VAR}, ${VAR:-по умолчанию}, ${VAR:?ошибка}, $VAR, $$ → $. warnings — незаданные. */
function interpolate(value, vars, warnings) {
  if (typeof value !== 'string') {
    if (Array.isArray(value)) return value.map((item) => interpolate(item, vars, warnings));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, vars, warnings)]));
    }
    return value;
  }
  return value.replace(/\$\$|\$\{([A-Za-z_]\w*)(?:(:?[-?])([^}]*))?\}|\$([A-Za-z_]\w*)/g, (match, name, op, arg, bare) => {
    if (match === '$$') return '$';
    const key = name ?? bare;
    const set = vars[key] !== undefined;
    const empty = !set || vars[key] === '';
    if (op === ':-' && empty) return arg;
    if (op === '-' && !set) return arg;
    if ((op === ':?' && empty) || (op === '?' && !set)) throw new ComposeError(`required variable ${key} is missing a value: ${arg}`);
    if (!set) {
      if (!warnings.includes(key)) warnings.push(key);
      return '';
    }
    return vars[key];
  });
}

// --- загрузка проекта ---

function mergeService(base, extra) {
  const result = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (key === 'environment' && base.environment) result.environment = { ...toMap(base.environment), ...toMap(value) };
    else if (['ports', 'expose', 'env_file'].includes(key) && Array.isArray(base[key])) result[key] = [...base[key], ...[].concat(value)];
    else if (key === 'volumes' && Array.isArray(base.volumes)) {
      const target = (item) => (typeof item === 'string' ? item.split(':')[1] : item.target);
      result.volumes = [...base.volumes.filter((item) => !value.some((own) => target(own) === target(item))), ...value];
    } else if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      result[key] = { ...base[key], ...value };
    } else result[key] = value;
  }
  return result;
}

const toMap = (value) => (Array.isArray(value)
  ? Object.fromEntries(value.map((item) => {
    const eq = String(item).indexOf('=');
    return eq === -1 ? [item, null] : [item.slice(0, eq), item.slice(eq + 1)];
  }))
  : { ...(value ?? {}) });

/**
 * Проект: {name, dir, files, services: {имя: сервис}, volumes, warnings}.
 * opts: {files: [-f], project: -p, envFile, profiles}.
 */
export function loadProject(sh, opts = {}) {
  const fs = sh.fs;
  const dir = opts.directory ? sh.resolve(opts.directory) : sh.cwd;
  let files = (opts.files ?? []).map((file) => sh.resolve(file));
  if (!files.length) {
    // compose ищет файл в текущей папке и выше
    let current = dir;
    for (;;) {
      const found = FILES.map((name) => `${current === '/' ? '' : current}/${name}`).find((path) => fs.exists(path));
      if (found) {
        files = [found];
        const override = OVERRIDES.map((name) => `${current === '/' ? '' : current}/${name}`).find((path) => fs.exists(path));
        if (override) files.push(override);
        break;
      }
      if (current === '/') throw new ComposeError('no configuration file provided: not found');
      current = normalize(`${current}/..`);
    }
  }
  const projectDir = files[0].replace(/\/[^/]*$/, '') || '/';
  let dotenv = {};
  const envFile = opts.envFile ? sh.resolve(opts.envFile) : `${projectDir}/.env`;
  try {
    dotenv = readDotenv(fs.readFile(envFile));
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    if (opts.envFile && opts.envFile !== '/dev/null') throw new ComposeError(`couldn't find env file: ${envFile}`);
  }
  const vars = { ...dotenv, ...sh.env };
  const warnings = [];
  let merged = null;
  for (const file of files) {
    let text;
    try {
      text = fs.readFile(file);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      throw new ComposeError(`open ${file}: no such file or directory`);
    }
    let data;
    try {
      data = parseYaml(text);
    } catch (e) {
      if (e instanceof YamlError) throw new ComposeError(e.message);
      throw e;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ComposeError(`validating ${file}: (root) must be a object`);
    data = interpolate(data, vars, warnings);
    validate(data, file);
    if (!merged) merged = data;
    else {
      merged.services ??= {};
      for (const [name, service] of Object.entries(data.services ?? {})) {
        merged.services[name] = merged.services[name] ? mergeService(merged.services[name], service ?? {}) : service;
      }
      merged.volumes = { ...(merged.volumes ?? {}), ...(data.volumes ?? {}) };
      if (data.name) merged.name = data.name;
    }
  }
  const name = (opts.project ?? merged.name ?? projectDir.split('/').pop() ?? 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const services = {};
  for (const [serviceName, raw] of Object.entries(merged.services ?? {})) {
    if (!raw?.image && !raw?.build) throw new ComposeError(`service "${serviceName}" has neither an image nor a build context specified: invalid compose project`);
    services[serviceName] = normalizeService(fs, serviceName, raw ?? {}, projectDir, name);
  }
  return {
    name, dir: projectDir, files, services, volumes: merged.volumes ?? {}, warnings,
    profiles: opts.profiles ?? (vars.COMPOSE_PROFILES ? vars.COMPOSE_PROFILES.split(',') : []),
  };
}

/** Проверка схемы (основное, что ловит compose). */
function validate(data, file) {
  for (const [name, service] of Object.entries(data.services ?? {})) {
    if (!service || typeof service !== 'object') continue;
    for (const key of Object.keys(service)) {
      if (!SERVICE_KEYS.has(key)) throw new ComposeError(`validating ${file}: services.${name} additional properties '${key}' not allowed`);
    }
    for (const key of ['ports', 'volumes', 'expose', 'profiles']) {
      if (service[key] !== undefined && !Array.isArray(service[key])) throw new ComposeError(`validating ${file}: services.${name}.${key} must be a array`);
    }
    if (service.environment !== undefined && (typeof service.environment !== 'object' || service.environment === null)) {
      throw new ComposeError(`validating ${file}: services.${name}.environment must be a mapping`);
    }
  }
}

function seconds(text) {
  return text ?? undefined;
}

function normalizeService(fs, name, raw, dir, project) {
  const build = raw.build === undefined ? null
    : typeof raw.build === 'string' ? { context: normalize(raw.build, dir), dockerfile: 'Dockerfile' }
      : { context: normalize(raw.build.context ?? '.', dir), dockerfile: raw.build.dockerfile ?? 'Dockerfile', args: raw.build.args ? toMap(raw.build.args) : undefined, target: raw.build.target };
  const environment = {};
  for (const file of [].concat(raw.env_file ?? [])) {
    const path = normalize(typeof file === 'string' ? file : file.path, dir);
    try {
      Object.assign(environment, readDotenv(fs.readFile(path)));
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      throw new ComposeError(`env file ${path} not found: stat ${path}: no such file or directory`);
    }
  }
  Object.assign(environment, toMap(raw.environment));
  const command = raw.command === undefined || raw.command === null ? null : Array.isArray(raw.command) ? raw.command : ['/bin/sh', '-c', raw.command].slice(raw.command.includes(' ') ? 0 : 2).concat(raw.command.includes(' ') ? [] : [raw.command]).filter((item, k, list) => !(list.length === 1 && false));
  const ports = (raw.ports ?? []).map((spec) => {
    if (typeof spec === 'object') return { hostIp: spec.host_ip ?? '', hostPort: String(spec.published ?? ''), port: String(spec.target) };
    const parts = String(spec).replace(/\/tcp$/, '').split(':');
    if (parts.length === 1) return { hostIp: '', hostPort: '', port: parts[0] };
    if (parts.length === 2) return { hostIp: '', hostPort: parts[0], port: parts[1] };
    return { hostIp: parts.slice(0, -2).join(':'), hostPort: parts.at(-2), port: parts.at(-1) };
  });
  const volumes = (raw.volumes ?? []).map((spec) => {
    if (typeof spec === 'object') {
      const type = spec.type ?? (spec.source?.startsWith('.') || spec.source?.startsWith('/') ? 'bind' : 'volume');
      return { type, source: type === 'bind' ? normalize(spec.source, dir) : spec.source, target: spec.target, readOnly: Boolean(spec.read_only) };
    }
    const [source, target, mode] = String(spec).split(':');
    if (target === undefined) return { type: 'volume', source: null, target: source, readOnly: false };
    const bind = source.startsWith('.') || source.startsWith('/') || source.startsWith('~');
    return { type: bind ? 'bind' : 'volume', source: bind ? normalize(source.replace(/^~/, '/home/shop'), dir) : source, target, readOnly: (mode ?? '').split(',').includes('ro') };
  });
  const dependsOn = {};
  if (Array.isArray(raw.depends_on)) for (const dep of raw.depends_on) dependsOn[dep] = { condition: 'service_started', required: true };
  else for (const [dep, spec] of Object.entries(raw.depends_on ?? {})) dependsOn[dep] = { condition: spec?.condition ?? 'service_started', required: spec?.required ?? true };
  const health = raw.healthcheck ? {
    test: Array.isArray(raw.healthcheck.test) ? raw.healthcheck.test : ['CMD-SHELL', raw.healthcheck.test],
    interval: seconds(raw.healthcheck.interval), timeout: seconds(raw.healthcheck.timeout), retries: raw.healthcheck.retries,
    startPeriod: raw.healthcheck.start_period,
  } : null;
  return {
    name,
    image: raw.image ?? null,
    builtImage: raw.image ?? `${project}-${name}`,
    build,
    command,
    entrypoint: raw.entrypoint === undefined ? null : [].concat(raw.entrypoint),
    environment,
    ports,
    volumes,
    dependsOn,
    health,
    restart: raw.restart ?? 'no',
    profiles: raw.profiles ?? [],
    containerName: raw.container_name ?? null,
    workdir: raw.working_dir ?? null,
    user: raw.user ?? null,
    logging: raw.logging ?? null,
    raw,
  };
}

/** Сервисы, которые включены профилями (без profiles — всегда). */
const active = (project, only = []) => Object.values(project.services).filter((service) => (only.length ? only.includes(service.name)
  : !service.profiles.length || service.profiles.some((profile) => project.profiles.includes(profile))));

/** Порядок запуска: зависимости раньше. */
function ordered(project, services) {
  const result = [];
  const visit = (service) => {
    if (result.includes(service)) return;
    for (const dep of Object.keys(service.dependsOn)) if (project.services[dep]) visit(project.services[dep]);
    result.push(service);
  };
  services.forEach(visit);
  return result;
}

const containerName = (project, service, n = 1) => service.containerName ?? `${project.name}-${service.name}-${n}`;
const networkName = (project) => `${project.name}_default`;
const volumeName = (project, name) => project.volumes[name]?.name ?? `${project.name}_${name}`;

const projectContainers = (state, project) => state.containers.filter((c) => c.labels?.['com.docker.compose.project'] === project.name);
const serviceContainer = (state, project, service) => projectContainers(state, project)
  .find((c) => c.labels['com.docker.compose.service'] === service.name && !c.labels['com.docker.compose.oneoff']);

// --- config ---

const ORDER = ['profiles', 'command', 'entrypoint', 'environment', 'image', 'networks', 'restart', 'user', 'volumes', 'working_dir',
  'healthcheck', 'build', 'container_name', 'depends_on', 'ports', 'logging'];

function configObject(project) {
  const services = {};
  const usedVolumes = new Set();
  for (const service of active(project).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const item = {};
    if (service.profiles.length) item.profiles = service.profiles;
    if (service.command) item.command = service.command;
    if (service.entrypoint) item.entrypoint = service.entrypoint;
    if (Object.keys(service.environment).length) {
      item.environment = Object.fromEntries(Object.entries(service.environment).sort(([a], [b]) => (a < b ? -1 : 1)));
    }
    if (service.image) item.image = service.image;
    item.networks = { default: null };
    if (service.restart !== 'no') item.restart = service.restart;
    if (service.user) item.user = service.user;
    if (service.volumes.length) {
      item.volumes = service.volumes.map((volume) => {
        if (volume.type === 'volume' && volume.source) usedVolumes.add(volume.source);
        return {
          type: volume.type,
          ...(volume.source ? { source: volume.source } : {}),
          target: volume.target,
          ...(volume.readOnly ? { read_only: true } : {}),
          ...(volume.type === 'bind' ? { bind: {} } : { volume: {} }),
        };
      });
    }
    if (service.workdir) item.working_dir = service.workdir;
    if (service.health) {
      item.healthcheck = {
        test: service.health.test,
        ...(service.health.timeout ? { timeout: service.health.timeout } : {}),
        ...(service.health.interval ? { interval: service.health.interval } : {}),
        ...(service.health.retries !== undefined ? { retries: Number(service.health.retries) } : {}),
      };
    }
    if (service.build) item.build = { context: service.build.context, dockerfile: service.build.dockerfile, ...(service.build.args ? { args: service.build.args } : {}) };
    if (service.containerName) item.container_name = service.containerName;
    if (Object.keys(service.dependsOn).length) item.depends_on = Object.fromEntries(Object.entries(service.dependsOn).map(([dep, spec]) => [dep, { condition: spec.condition, required: spec.required }]));
    if (service.ports.length) {
      item.ports = service.ports.map((port) => ({ mode: 'ingress', ...(port.hostIp ? { host_ip: port.hostIp } : {}), target: Number(port.port), ...(port.hostPort ? { published: port.hostPort } : {}), protocol: 'tcp' }));
    }
    if (service.logging) item.logging = service.logging;
    services[service.name] = Object.fromEntries(ORDER.filter((key) => key in item).map((key) => [key, item[key]]));
  }
  const result = { name: project.name, services, networks: { default: { name: networkName(project) } } };
  const volumes = Object.keys(project.volumes).filter((name) => usedVolumes.has(name));
  if (volumes.length) result.volumes = Object.fromEntries(volumes.map((name) => [name, { name: volumeName(project, name) }]));
  return result;
}

// --- действия ---

function ensureNetwork(state, project, chunks) {
  const name = networkName(project);
  if (state.networks[name]) return state.networks[name];
  chunks.push(line(`Network ${name} Creating`));
  const taken = new Set(Object.values(state.networks).map((net) => net.subnet));
  let subnet = '172.18';
  for (let n = 18; n <= 31; n += 1) {
    if (!taken.has(`172.${n}`)) {
      subnet = `172.${n}`;
      break;
    }
  }
  state.networks[name] = { id: newId(state, 'network'), name, driver: 'bridge', subnet, created: now(), labels: { 'com.docker.compose.network': 'default', 'com.docker.compose.project': project.name } };
  chunks.push(line(`Network ${name} Created`));
  return state.networks[name];
}

function ensureVolumes(state, project, services, chunks) {
  for (const name of Object.keys(project.volumes)) {
    if (!services.some((service) => service.volumes.some((volume) => volume.type === 'volume' && volume.source === name))) continue;
    const full = volumeName(project, name);
    if (state.volumes[full]) continue;
    chunks.push(line(`Volume ${full} Creating`));
    state.volumes[full] = { name: full, created: now(), data: { type: 'dir', owner: 'root', group: 'root', mode: 0o755, mtime: now(), nlink: 1, children: {} }, labels: { 'com.docker.compose.project': project.name, 'com.docker.compose.volume': name } };
    chunks.push(line(`Volume ${full} Created`));
  }
}

/** Образ сервиса: собрать (build) или скачать (image). → запись образа или бросает ComposeError. */
function serviceImage(sh, state, project, service, chunks, { rebuild = false } = {}) {
  if (service.build) {
    const tag = service.builtImage;
    const existing = findImage(state, tag);
    if (existing && !rebuild) return existing;
    chunks.push(line(`Image ${tag} Building`));
    try {
      const done = buildImage(sh.fs, sh, {
        dir: service.build.context, file: normalize(service.build.dockerfile, service.build.context), fileName: service.build.dockerfile, tags: [tag],
        noCache: false, buildArgs: service.build.args ?? {}, target: service.build.target,
      });
      // compose собирает через bake: свои шаги #1 и «resolving provenance» в конце
      const renumbered = done.log.filter((item) => !item.startsWith('#0 ')).map((item) => item.replace(/^#(\d+)/, (_, n) => `#${Number(n) + 1}`));
      while (renumbered[0] === '') renumbered.shift();
      const last = Number(/^#(\d+)/.exec(renumbered.at(-1))?.[1] ?? 1) + 1;
      chunks.push(err(`${['#1 [internal] load local bake definitions', `#1 reading from stdin ${500 + service.name.length * 37}B done`, '#1 DONE 0.0s', '',
        ...renumbered, '', `#${last} resolving provenance for metadata file`, `#${last} DONE 0.0s`].join('\n')}\n`));
      chunks.push(line(`Image ${tag} Built`));
      return done.image;
    } catch (e) {
      if (!(e instanceof BuildError)) throw e;
      chunks.push(err(`${[...(e.before ?? []), ...e.log].join('\n')}\n`));
      throw new ComposeError(`failed to solve: ${e.message}`);
    }
  }
  const existing = findImage(state, service.image);
  if (existing) return existing;
  const image = addCatalogImage(state, service.image);
  if (!image) throw new ComposeError(`pull access denied for ${normalizeRef(service.image).replace(/:[^:]*$/, '')}, repository does not exist or may require 'docker login'`);
  chunks.push(line(`Image ${service.image} Pulling`));
  chunks.push(line(`Image ${service.image} Pulled`));
  return image;
}

/** Создать контейнер сервиса (n — номер: run создаёт ПРОЕКТ-СЕРВИС-run-ID). */
function createServiceContainer(sh, state, project, service, image, { name, oneoff = false, command = null, env = {} } = {}) {
  const network = networkName(project);
  const mounts = service.volumes.map((volume) => (volume.type === 'bind'
    ? { type: 'bind', source: volume.source, destination: volume.target, readOnly: volume.readOnly }
    : volume.source ? { type: 'volume', name: volumeName(project, volume.source), destination: volume.target, readOnly: volume.readOnly }
      : { type: 'volume', anonymous: true, name: newId(state, 'volume'), destination: volume.target }));
  for (const mount of mounts.filter((item) => item.anonymous)) {
    state.volumes[mount.name] = { name: mount.name, created: now(), anonymous: true, data: { type: 'dir', owner: 'root', group: 'root', mode: 0o755, mtime: now(), nlink: 1, children: {} }, labels: { 'com.docker.volume.anonymous': '' } };
  }
  const container = createContainer(sh.fs, image, {
    name,
    imageRef: service.build ? service.builtImage : service.image,
    cmd: command ?? service.command ?? [],
    entrypoint: service.entrypoint,
    env: Object.entries({ ...service.environment, ...env }).map(([key, value]) => (value === null ? (sh.env[key] !== undefined ? `${key}=${sh.env[key]}` : null) : `${key}=${value}`)).filter(Boolean),
    ports: oneoff ? [] : service.ports.map((port) => ({ ...port, hostPort: port.hostPort || String(32768 + Math.floor(Math.random() * 1000)) })),
    mounts,
    network,
    aliases: [service.name, name],
    workdir: service.workdir,
    user: service.user,
    hostname: null,
    tty: oneoff,
    interactive: oneoff,
    autoRemove: false,
    restart: oneoff ? 'no' : service.restart,
    labels: {
      'com.docker.compose.project': project.name,
      'com.docker.compose.service': service.name,
      'com.docker.compose.container-number': '1',
      ...(oneoff ? { 'com.docker.compose.oneoff': 'True' } : {}),
      'com.docker.compose.config-hash': configHash(service),
    },
    health: service.health,
  });
  container.name = name;
  if (service.logging?.options) container.logConfig = { ...service.logging.options };
  return container;
}

const configHash = (service) => hexHash(JSON.stringify({ ...service, raw: undefined }));

/** Дождаться здоровья (в тренажёре — сразу): база готова принимать подключения. */
function waitHealthy(sh, container, chunks) {
  chunks.push(line(`Container ${container.name} Waiting`));
  container.readyAt = now();
  const status = healthStatus(sh.fs, container);
  if (container.status !== 'running') {
    chunks.push(line(`Container ${container.name} Error`));
    throw new ComposeError(`dependency failed to start: container ${container.name} exited (${container.exitCode})`);
  }
  if (status === 'unhealthy' || (container.health && status !== 'healthy')) {
    chunks.push(line(`Container ${container.name} Error`));
    throw new ComposeError(`dependency failed to start: container ${container.name} is unhealthy`);
  }
  chunks.push(line(`Container ${container.name} Healthy`));
}

/** Запустить контейнеры сервисов по порядку зависимостей. */
function startServices(sh, state, project, services, chunks) {
  const started = [];
  for (const service of services) {
    const container = serviceContainer(state, project, service);
    if (!container) continue;
    if (container.status === 'running') continue;
    for (const [dep, spec] of Object.entries(service.dependsOn)) {
      const depContainer = project.services[dep] && serviceContainer(state, project, project.services[dep]);
      if (!depContainer) continue;
      if (spec.condition === 'service_healthy') waitHealthy(sh, depContainer, chunks);
      else if (spec.condition === 'service_completed_successfully') {
        chunks.push(line(`Container ${depContainer.name} Waiting`));
        if (depContainer.status !== 'exited' || depContainer.exitCode !== 0) {
          throw new ComposeError(`service "${dep}" didn't complete successfully: exit ${depContainer.exitCode}`);
        }
        chunks.push(line(`Container ${depContainer.name} Exited`));
      }
    }
    chunks.push(line(`Container ${container.name} Starting`));
    const result = startContainer(sh.fs, container);
    if (result.error) {
      chunks.push(line(`Container ${container.name} Error`));
      throw new ComposeError(`Error response from daemon: ${result.error}`);
    }
    // зависимые сервисы, которые не ждут здоровья, стартуют, пока база ещё инициализируется
    if (container.procs[0]?.comm === 'postgres' && started.length === 0) container.readyAt = now() + 4000;
    started.push(container);
    chunks.push(line(`Container ${container.name} Started`));
  }
  return started;
}

/** Строки журнала с префиксом «web-1  | ». */
function prefixedLogs(containers, { tail = null, service = null } = {}) {
  const label = (c) => `${c.labels['com.docker.compose.service']}-1`;
  const width = Math.max(...containers.map((c) => label(c).length));
  const lines = containers.flatMap((c) => {
    const own = tail === null ? c.logs : c.logs.slice(-tail);
    return own.map((entry, k) => ({ ...entry, k, prefix: `${label(c).padEnd(width)}  | ` }));
  }).sort((a, b) => a.t - b.t || a.k - b.k);
  void service;
  return lines.map((entry) => ({ text: `${entry.prefix}${entry.text}\n`, err: entry.err }));
}

// --- команды ---

function up(ctx, project, args) {
  const { sh } = ctx;
  const state = dockerState(sh.fs);
  const detach = args.includes('-d') || args.includes('--detach');
  const rebuild = args.includes('--build');
  const only = args.filter((arg) => !arg.startsWith('-'));
  const chunks = [];
  const wanted = active(project, only);
  const services = ordered(project, wanted.length ? wanted : []);
  // образы
  const images = {};
  for (const service of services) images[service.name] = serviceImage(sh, state, project, service, chunks, { rebuild });
  ensureNetwork(state, project, chunks);
  ensureVolumes(state, project, services, chunks);
  for (const service of services) {
    const name = containerName(project, service);
    const existing = serviceContainer(state, project, service);
    const hash = configHash(service);
    if (existing && existing.labels['com.docker.compose.config-hash'] === hash && existing.imageId === images[service.name].id) {
      if (existing.status === 'running') chunks.push(line(`Container ${name} Running`));
      continue;
    }
    if (existing) {
      chunks.push(line(`Container ${name} Recreate`));
      stopContainer(sh.fs, existing);
      removeContainer(sh.fs, existing);
      createServiceContainer(sh, state, project, service, images[service.name], { name });
      chunks.push(line(`Container ${name} Recreated`));
      continue;
    }
    chunks.push(line(`Container ${name} Creating`));
    createServiceContainer(sh, state, project, service, images[service.name], { name });
    chunks.push(line(`Container ${name} Created`));
  }
  const started = startServices(sh, state, project, services, chunks);
  if (detach) return { chunks, code: 0 };
  // без -d: журналы сервисов (настоящий терминал остался бы прикреплён к ним)
  const attached = services.map((service) => serviceContainer(state, project, service)).filter(Boolean);
  chunks.push(out(`Attaching to ${attached.map((c) => `${c.labels['com.docker.compose.service']}-1`).join(', ')}\n`));
  for (const chunk of prefixedLogs(attached)) chunks.push({ ...chunk, err: false });
  for (const c of attached.filter((item) => item.status === 'exited')) chunks.push(out(`${c.labels['com.docker.compose.service']}-1 exited with code ${c.exitCode}\n`));
  if (attached.some((c) => c.status === 'running')) {
    chunks.push(out('(в тренажёре терминал не ждёт: сервисы работают дальше — остановить: docker compose stop или down; в настоящем терминале запускают с -d)\n'));
  }
  void started;
  return { chunks, code: 0 };
}

function down(ctx, project, args) {
  const { sh } = ctx;
  const state = dockerState(sh.fs);
  const chunks = [];
  const volumes = args.includes('-v') || args.includes('--volumes');
  // только включённые сервисы: tools с профилем без --profile tools остаётся работать
  const containers = ordered(project, active(project)).reverse()
    .map((service) => serviceContainer(state, project, service)).filter(Boolean);
  const oneoff = projectContainers(state, project).filter((c) => c.labels['com.docker.compose.oneoff']);
  const anonymous = [];
  for (const container of [...containers, ...oneoff]) {
    if (container.status === 'running') {
      chunks.push(line(`Container ${container.name} Stopping`));
      container.manualStop = true;
      stopContainer(sh.fs, container);
      chunks.push(line(`Container ${container.name} Stopped`));
    }
    chunks.push(line(`Container ${container.name} Removing`));
    anonymous.push(...container.mounts.filter((mount) => mount.anonymous).map((mount) => mount.name));
    removeContainer(sh.fs, container, { volumes });
    chunks.push(line(`Container ${container.name} Removed`));
  }
  if (volumes) {
    for (const name of Object.keys(project.volumes)) {
      const full = volumeName(project, name);
      if (!state.volumes[full] || state.containers.some((c) => c.mounts.some((mount) => mount.name === full))) continue;
      chunks.push(line(`Volume ${full} Removing`));
      delete state.volumes[full];
      forgetVolume(full);
      chunks.push(line(`Volume ${full} Removed`));
    }
  }
  const network = networkName(project);
  if (state.networks[network]) {
    chunks.push(line(`Network ${network} Removing`));
    if (state.containers.some((c) => network in c.networks && c.status === 'running')) {
      chunks.push(line(`Network ${network} Resource is still in use`));
    } else {
      delete state.networks[network];
      chunks.push(line(`Network ${network} Removed`));
    }
  }
  if (args.includes('--rmi')) {
    for (const service of Object.values(project.services).filter((item) => item.build)) {
      const image = findImage(state, service.builtImage);
      if (!image) continue;
      chunks.push(line(`Image ${service.builtImage} Removing`));
      delete state.images[image.id];
      chunks.push(line(`Image ${service.builtImage} Removed`));
    }
  }
  return { chunks, code: 0 };
}

function ps(ctx, project, argv) {
  const state = dockerState(ctx.fs);
  // значения флагов (--format X, --filter X, --status X) — не имена сервисов
  const args = argv.filter((arg, k) => !['--format', '--filter', '--status'].includes(argv[k - 1]));
  const all = args.includes('-a') || args.includes('--all');
  const only = args.filter((arg) => !arg.startsWith('-'));
  let list = projectContainers(state, project).filter((c) => !c.labels['com.docker.compose.oneoff'])
    .filter((c) => all || c.status === 'running')
    .filter((c) => !only.length || only.includes(c.labels['com.docker.compose.service']))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  if (args.includes('-q') || args.includes('--quiet')) return { chunks: list.length ? [out(`${list.map((c) => c.id).join('\n')}\n`)] : [], code: 0 };
  const format = argv[argv.indexOf('--format') + 1];
  if (argv.includes('--format') && format && format !== 'table') {
    const rowsData = list.map((c) => {
      const health = healthStatus(ctx.fs, c) ?? '';
      return {
        ID: shortId(c.id), Name: c.name, Names: c.name, Image: c.image, Command: `"${commandLine(c)}"`, Project: project.name,
        Service: c.labels['com.docker.compose.service'], CreatedAt: new Date(c.created).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' +0000 UTC'),
        RunningFor: `${humanDuration(now() - c.created)} ago`, State: c.status, Health: health, ExitCode: c.exitCode,
        Status: c.status === 'running' ? `Up ${humanDuration(now() - c.startedAt)}${health ? ` (${health === 'starting' ? 'health: starting' : health})` : ''}`
          : c.status === 'exited' ? `Exited (${c.exitCode}) ${humanDuration(now() - c.finishedAt)} ago` : 'Created',
        Ports: c.status === 'running' ? c.ports.flatMap((port) => [`0.0.0.0:${port.hostPort}->${port.port}/tcp`, `[::]:${port.hostPort}->${port.port}/tcp`]).join(', ') : '',
      };
    });
    if (format === 'json') return { chunks: rowsData.length ? [out(`${rowsData.map((item) => JSON.stringify(item)).join('\n')}\n`)] : [], code: 0 };
    return { chunks: rowsData.length ? [out(`${rowsData.map((item) => renderTemplate(format.replace(/^table /, ''), item)).join('\n')}\n`)] : [], code: 0 };
  }
  if (args.includes('--services')) return { chunks: list.length ? [out(`${list.map((c) => c.labels['com.docker.compose.service']).join('\n')}\n`)] : [], code: 0 };
  const rows = list.map((c) => {
    const command = commandLine(c);
    const health = healthStatus(ctx.fs, c);
    let status;
    if (c.status === 'running') status = `Up ${humanDuration(now() - c.startedAt)}${health ? ` (${health === 'starting' ? 'health: starting' : health})` : ''}`;
    else if (c.status === 'exited') status = `Exited (${c.exitCode}) ${humanDuration(now() - c.finishedAt)} ago`;
    else status = 'Created';
    const ports = c.status === 'running' ? c.ports.flatMap((port) => (port.hostIp ? [`${port.hostIp}:${port.hostPort}->${port.port}/tcp`]
      : [`0.0.0.0:${port.hostPort}->${port.port}/tcp`, `[::]:${port.hostPort}->${port.port}/tcp`])) : [];
    const exposed = c.status === 'running' ? (state.images[c.imageId]?.config.ExposedPorts ?? [])
      .filter((spec) => !c.ports.some((port) => `${port.port}/tcp` === spec)) : [];
    return [c.name, c.image, `"${command.length <= 20 ? command : `${command.slice(0, 19)}…`}"`, c.labels['com.docker.compose.service'],
      `${humanDuration(now() - c.created)} ago`, status, [...exposed, ...ports].join(', ')];
  });
  void list;
  list = null;
  return { chunks: [out(table(['NAME', 'IMAGE', 'COMMAND', 'SERVICE', 'CREATED', 'STATUS', 'PORTS'], rows))], code: 0 };
}

function logs(ctx, project, args) {
  const state = dockerState(ctx.fs);
  let tail = null;
  const only = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--tail' || args[i] === '-n') tail = args[(i += 1)] === 'all' ? null : Number(args[i]);
    else if (args[i].startsWith('--tail=')) tail = Number(args[i].slice(7));
    else if (!args[i].startsWith('-')) only.push(args[i]);
  }
  for (const name of only) if (!project.services[name]) return { chunks: [err(`no such service: ${name}\n`)], code: 1 };
  const containers = projectContainers(state, project).filter((c) => !c.labels['com.docker.compose.oneoff'])
    .filter((c) => !only.length || only.includes(c.labels['com.docker.compose.service']));
  if (!containers.length) return { chunks: [], code: 0 };
  const chunks = prefixedLogs(containers, { tail }).map((chunk) => ({ ...chunk, err: false }));
  if (args.includes('-f') || args.includes('--follow')) chunks.push(out('(в тренажёре logs -f не ждёт новых строк — команда сразу завершается)\n'));
  return { chunks, code: 0 };
}

function serviceArgs(args, valueFlags) {
  const opts = { env: [], flags: [] };
  let i = 0;
  for (; i < args.length; i += 1) {
    const arg = args[i];
    if (valueFlags.includes(arg)) (opts[arg] ??= []).push(args[(i += 1)]);
    else if (arg.startsWith('-')) opts.flags.push(arg);
    else break;
  }
  return { opts, service: args[i], words: args.slice(i + 1) };
}

function exec(ctx, project, args) {
  const state = dockerState(ctx.fs);
  const { opts, service, words } = serviceArgs(args, ['-e', '--env', '-w', '--workdir', '-u', '--user']);
  if (!service || !words.length) return { chunks: [err("docker: 'docker compose exec' requires at least 2 arguments\n\nUsage:  docker compose exec [OPTIONS] SERVICE COMMAND [ARGS...]\n\nSee 'docker compose exec --help' for more information\n")], code: 1 };
  if (!project.services[service]) return { chunks: [err(`service "${service}" is not running\n`)], code: 1 };
  const container = serviceContainer(state, project, project.services[service]);
  if (!container || container.status !== 'running') return { chunks: [err(`service "${service}" is not running\n`)], code: 1 };
  // compose exec по умолчанию с терминалом (-T — без): psql без -c откроет интерактивный режим
  const args2 = ['exec', ...(opts.flags.includes('-T') ? [] : ['-it']), ...(opts['-e'] ?? []).flatMap((item) => ['-e', item]),
    ...(opts['-w'] ?? []).flatMap((item) => ['-w', item]), container.name, ...words];
  return { delegate: args2 };
}

function run(ctx, project, args) {
  const { sh } = ctx;
  const state = dockerState(sh.fs);
  const { opts, service: name, words } = serviceArgs(args, ['-e', '--env', '-w', '--workdir', '-u', '--user', '--name', '--entrypoint']);
  if (!name) return { chunks: [err("docker: 'docker compose run' requires at least 1 argument\n\nUsage:  docker compose run [OPTIONS] SERVICE [COMMAND] [ARGS...]\n\nSee 'docker compose run --help' for more information\n")], code: 1 };
  const service = project.services[name];
  if (!service) return { chunks: [err(`no such service: ${name}\n`)], code: 1 };
  const chunks = [];
  const noDeps = opts.flags.includes('--no-deps');
  // зависимости поднимаются (или уже работают)
  if (!noDeps) {
    const deps = ordered(project, Object.keys(service.dependsOn).map((dep) => project.services[dep]).filter(Boolean));
    if (deps.length) {
      ensureNetwork(state, project, chunks);
      ensureVolumes(state, project, deps, chunks);
      for (const dep of deps) {
        const existing = serviceContainer(state, project, dep);
        if (existing?.status === 'running') chunks.push(line(`Container ${existing.name} Running`));
        else if (!existing) {
          const image = serviceImage(sh, state, project, dep, chunks);
          chunks.push(line(`Container ${containerName(project, dep)} Creating`));
          createServiceContainer(sh, state, project, dep, image, { name: containerName(project, dep) });
          chunks.push(line(`Container ${containerName(project, dep)} Created`));
        }
      }
      startServices(sh, state, project, deps, chunks);
      for (const [dep, spec] of Object.entries(service.dependsOn)) {
        const depContainer = project.services[dep] && serviceContainer(state, project, project.services[dep]);
        if (depContainer && spec.condition === 'service_healthy') waitHealthy(sh, depContainer, chunks);
      }
    }
  }
  ensureNetwork(state, project, chunks);
  ensureVolumes(state, project, [service], chunks);
  const image = serviceImage(sh, state, project, service, chunks);
  const runName = opts['--name']?.[0] ?? `${project.name}-${name}-run-${hexHash(`run:${now()}:${state.counter}`, 12)}`;
  chunks.push(line(`Container ${runName} Creating`));
  const env = Object.fromEntries((opts['-e'] ?? []).map((item) => [item.split('=')[0], item.split('=').slice(1).join('=')]));
  const container = createServiceContainer(sh, state, project, service, image, { name: runName, oneoff: true, command: words.length ? words : null, env });
  chunks.push(line(`Container ${runName} Created`));
  const started = startContainer(sh.fs, container);
  const remove = opts.flags.includes('--rm');
  if (started.error) {
    chunks.push(err(`Error response from daemon: ${started.error}\n`));
    if (remove) removeContainer(sh.fs, container, { volumes: true });
    return { chunks, code: started.code === 127 ? 127 : 1 };
  }
  for (const entry of container.logs) chunks.push(entry.err ? err(`${entry.text}\n`) : out(`${entry.text}\n`));
  const code = container.status === 'exited' ? container.exitCode : 0;
  if (container.status === 'running' && !started.interactive) {
    chunks.push(out(`(в тренажёре терминал не ждёт: ${runName} работает дальше — остановить: docker stop ${runName})\n`));
  }
  if (remove && container.status !== 'running') removeContainer(sh.fs, container, { volumes: true });
  return { chunks, code };
}

function build(ctx, project, args) {
  const { sh } = ctx;
  const state = dockerState(sh.fs);
  const only = args.filter((arg) => !arg.startsWith('-'));
  const chunks = [];
  for (const service of active(project, only).filter((item) => item.build)) {
    serviceImage(sh, state, project, service, chunks, { rebuild: true });
  }
  return { chunks, code: 0 };
}

function stopStart(ctx, project, args, action) {
  const { sh } = ctx;
  const state = dockerState(sh.fs);
  const only = args.filter((arg) => !arg.startsWith('-'));
  const chunks = [];
  // с именами — только эти сервисы (stop web не трогает db), без имён — все по порядку зависимостей
  let services = only.length ? active(project, only) : ordered(project, active(project));
  if (action === 'stop') services = services.reverse();
  for (const service of services) {
    const container = serviceContainer(state, project, service);
    if (!container) continue;
    if (action === 'stop' || action === 'restart') {
      if (container.status === 'running' || action === 'restart') {
        chunks.push(line(`Container ${container.name} ${action === 'stop' ? 'Stopping' : 'Restarting'}`));
        container.manualStop = action === 'stop';
        stopContainer(sh.fs, container);
        if (action === 'stop') chunks.push(line(`Container ${container.name} Stopped`));
      }
    }
    if (action === 'start' || action === 'restart') {
      if (action === 'start') chunks.push(line(`Container ${container.name} Starting`));
      const result = startContainer(sh.fs, container);
      if (result.error) throw new ComposeError(`Error response from daemon: ${result.error}`);
      chunks.push(line(`Container ${container.name} Started`));
    }
  }
  return { chunks, code: 0 };
}

const HELP = `docker compose — несколько контейнеров из compose.yaml (проект — имя папки).
  docker compose up -d [--build]   собрать/скачать образы, создать сеть, тома и контейнеры, запустить
  docker compose ps [-a]           контейнеры проекта
  docker compose logs [СЕРВИС]     журналы (строки помечены сервисом)
  docker compose exec СЕРВИС КОМАНДА       команда в работающем сервисе: exec db psql -U postgres
  docker compose run --rm СЕРВИС КОМАНДА   разовый контейнер: run --rm web python manage.py migrate
  docker compose stop | start | restart [СЕРВИС]
  docker compose down [-v]         удалить контейнеры и сеть (-v — и тома: данные базы!)
  docker compose config            итоговая конфигурация (override, .env, env_file подставлены)
  docker compose build             собрать образы сервисов с build
  -f файл  --profile имя  --env-file файл  -p проект`;

/** docker compose … */
export function compose(ctx) {
  const args = [...ctx.args];
  const global = { files: [], profiles: [] };
  while (args.length && args[0].startsWith('-')) {
    const flag = args.shift();
    if (flag === '-f' || flag === '--file') global.files.push(args.shift());
    else if (flag === '-p' || flag === '--project-name') global.project = args.shift();
    else if (flag === '--profile') global.profiles.push(args.shift());
    else if (flag === '--env-file') global.envFile = args.shift();
    else if (flag === '--project-directory') global.directory = args.shift();
    else if (flag === '--help' || flag === '-h') return { chunks: [out(`${HELP}\n`)], code: 0 };
    else if (flag === '--version' || flag === '-v') return { chunks: [out('Docker Compose version v2.40.3\n')], code: 0 };
    else return { chunks: [err(`unknown flag: ${flag}\n`)], code: 1 };
  }
  const [command, ...rest] = args;
  if (!command) return { chunks: [out(`${HELP}\n`)], code: 0 };
  if (command === 'version') return { chunks: [out('Docker Compose version v2.40.3\n')], code: 0 };
  const handlers = {
    up, down, ps, logs, exec, run, build, config: null,
    stop: (c, p, a) => stopStart(c, p, a, 'stop'), start: (c, p, a) => stopStart(c, p, a, 'start'),
    restart: (c, p, a) => stopStart(c, p, a, 'restart'),
  };
  if (!(command in handlers)) return { chunks: [err(`unknown docker command: "compose ${command}"\n`)], code: 1 };
  if (rest.includes('--help')) return { chunks: [out(`${HELP}\n`)], code: 0 };
  const chunks = [];
  try {
    const project = loadProject(ctx.sh, { ...global, profiles: global.profiles.length ? global.profiles : undefined });
    if (global.profiles.length) project.profiles = global.profiles;
    // незаданные переменные: в терминале — коротко WARN[0000]
    for (const name of project.warnings) chunks.push(err(`WARN[0000] The "${name}" variable is not set. Defaulting to a blank string. \n`));
    if (command === 'config') {
      if (rest.includes('--services')) return { chunks: [...chunks, out(`${active(project).map((s) => s.name).join('\n')}\n`)], code: 0 };
      if (rest.includes('-q') || rest.includes('--quiet')) return { chunks, code: 0 };
      return { chunks: [...chunks, out(dumpYaml(configObject(project)).replace(/^\n/, ''))], code: 0 };
    }
    const done = handlers[command](ctx, project, rest);
    if (done.delegate) return { delegate: done.delegate, chunks };
    return { chunks: [...chunks, ...done.chunks], code: done.code };
  } catch (e) {
    if (!(e instanceof ComposeError)) throw e;
    return { chunks: [...chunks, err(`${e.message}\n`)], code: 1 };
  }
}

export { afterMainKilled, containerShell, runInContainer, shortId };
