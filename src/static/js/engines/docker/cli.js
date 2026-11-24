// Команда docker: разбор флагов и подкоманды. Тексты и коды выхода — как у Docker 29.10
// (сверено с настоящим docker CLI): ошибки демона — «Error response from daemon: …»,
// у docker run — с префиксом «docker: » и подсказкой «Run 'docker run --help'».

import { now } from '../linux/clock.js';
import { FsError, normalize } from '../linux/fs.js';
import { catalogImage, hexHash, knownRepo, normalizeRef } from './catalog.js';
import {
  commandLine, containerShell, createContainer, isShell, removeContainer, runInContainer,
  startContainer, stopContainer,
} from './containers.js';
import { humanDuration, humanSize, isoNano, table } from './format.js';
import { inspectContainer, inspectImage, renderTemplate } from './inspect.js';
import {
  addCatalogImage, dockerState, findContainer, findImage, randomName, shortId,
} from './state.js';

const out = (text) => ({ text, err: false });
const err = (text) => ({ text, err: true });
const result = (chunks, code = 0, action = undefined) => ({ chunks, code, action });

// --- справка и ошибки разбора ---

const USAGE = {
  run: ['docker run [OPTIONS] IMAGE [COMMAND] [ARG...]', 'min', 1],
  create: ['docker create [OPTIONS] IMAGE [COMMAND] [ARG...]', 'min', 1],
  exec: ['docker exec [OPTIONS] CONTAINER COMMAND [ARG...]', 'min', 2],
  logs: ['docker logs [OPTIONS] CONTAINER', 'exact', 1],
  stop: ['docker stop [OPTIONS] CONTAINER [CONTAINER...]', 'min', 1],
  start: ['docker start [OPTIONS] CONTAINER [CONTAINER...]', 'min', 1],
  restart: ['docker restart [OPTIONS] CONTAINER [CONTAINER...]', 'min', 1],
  rm: ['docker rm [OPTIONS] CONTAINER [CONTAINER...]', 'min', 1],
  rmi: ['docker rmi [OPTIONS] IMAGE [IMAGE...]', 'min', 1],
  pull: ['docker pull [OPTIONS] NAME[:TAG|@DIGEST]', 'exact', 1],
  tag: ['docker tag SOURCE_IMAGE[:TAG] TARGET_IMAGE[:TAG]', 'exact', 2],
  inspect: ['docker inspect [OPTIONS] NAME|ID [NAME|ID...]', 'min', 1],
  ps: ['docker ps [OPTIONS]', 'none', 0],
  images: ['docker images [OPTIONS] [REPOSITORY[:TAG]]', 'max', 1],
};

/** «'docker logs' requires 1 argument» — как cobra в docker CLI. */
function usageError(name, count) {
  const [usage, kind, n] = USAGE[name];
  const need = { min: `at least ${n} argument${n > 1 ? 's' : ''}`, exact: `${n} argument${n > 1 ? 's' : ''}`, max: `at most ${n} argument` }[kind];
  const verb = kind === 'exact' ? 'Run' : 'See';
  const text = kind === 'none'
    ? `docker: 'docker ${name}' accepts no arguments\n\nUsage:  ${usage}\n\nRun 'docker ${name} --help' for more information\n`
    : `docker: 'docker ${name}' requires ${need}\n\nUsage:  ${usage}\n\n${verb} 'docker ${name} --help' for more information\n`;
  void count;
  return result([err(text)], 1);
}

function unknownFlag(name, flag) {
  const [usage] = USAGE[name] ?? [`docker ${name}`];
  return result([err(`unknown flag: ${flag}\n\nUsage:  ${usage}\n\nRun 'docker ${name} --help' for more information\n`)], 125);
}

/**
 * Флаги подкоманды. spec: {bool: {'-d': 'detach', '--detach': 'detach'}, value: {'-p': 'publish'}};
 * value-флаги повторяются (массив). stopAtPositional — после первого не-флага всё остальное
 * — аргументы (docker run IMAGE CMD…). Возвращает {opts, args} или {error}.
 */
function parseFlags(name, args, spec, { stopAtPositional = false } = {}) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (stopAtPositional && positional.length) {
      positional.push(arg);
      continue;
    }
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      positional.push(arg);
      continue;
    }
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (spec.value?.[flag]) {
      const key = spec.value[flag];
      let value;
      if (eq !== -1) value = arg.slice(eq + 1);
      else {
        if (i + 1 >= args.length) {
          return { error: result([err(`flag needs an argument: ${flag.startsWith('--') ? `--${flag.slice(2)}` : `'${flag.slice(1)}' in ${flag}`}\n\nUsage:  ${(USAGE[name] ?? [`docker ${name}`])[0]}\n\nRun 'docker ${name} --help' for more information\n`)], 125) };
        }
        value = args[(i += 1)];
      }
      (opts[key] ??= []).push(value);
      continue;
    }
    if (spec.bool?.[flag]) {
      opts[spec.bool[flag]] = true;
      continue;
    }
    // -it, -dit, -p8080:80
    if (!arg.startsWith('--') && arg.length > 2) {
      const letters = arg.slice(1);
      let ok = true;
      for (let k = 0; k < letters.length; k += 1) {
        const short = `-${letters[k]}`;
        if (spec.bool?.[short]) opts[spec.bool[short]] = true;
        else if (spec.value?.[short]) {
          const rest = letters.slice(k + 1);
          const value = rest || args[(i += 1)];
          (opts[spec.value[short]] ??= []).push(value);
          break;
        } else {
          ok = false;
          return { error: result([err(`unknown shorthand flag: '${letters[k]}' in ${arg}\n\nUsage:  ${(USAGE[name] ?? [`docker ${name}`])[0]}\n\nRun 'docker ${name} --help' for more information\n`)], 125) };
        }
      }
      if (ok) continue;
    }
    if (!arg.startsWith('--') && arg.length === 2) {
      return { error: result([err(`unknown shorthand flag: '${arg[1]}' in ${arg}\n\nUsage:  ${(USAGE[name] ?? [`docker ${name}`])[0]}\n\nRun 'docker ${name} --help' for more information\n`)], 125) };
    }
    return { error: unknownFlag(name, flag) };
  }
  return { opts, args: positional };
}

// --- docker pull ---

function pullLines(state, ref, { quietTag = false } = {}) {
  const full = normalizeRef(ref);
  const [repo, tag] = [full.slice(0, full.lastIndexOf(':')), full.slice(full.lastIndexOf(':') + 1)];
  const path = repo.includes('/') ? repo : `library/${repo}`;
  const lines = [];
  if (!quietTag && !/:[^/]+$/.test(ref)) lines.push('Using default tag: latest');
  const image = catalogImage(ref);
  if (!image) {
    const error = knownRepo(ref)
      ? `manifest for ${full} not found: manifest unknown: manifest unknown`
      : `pull access denied for ${repo}, repository does not exist or may require 'docker login'`;
    return { lines, error };
  }
  const digest = `sha256:${hexHash(`digest:${image.ref}`)}`;
  const present = findImage(state, full);
  lines.push(`${tag}: Pulling from ${path}`);
  if (!present) {
    // как containerd в Docker 29: все слои «Pulling fs layer», затем по каждому «Download complete»
    // и «Pull complete»
    const layers = Array.from({ length: image.layers }, (_, k) => hexHash(`layer:${image.ref}:${k}`, 12));
    if (layers.length > 1) for (const layer of layers) lines.push(`${layer}: Pulling fs layer`);
    for (const layer of layers) lines.push(`${layer}: Download complete`, `${layer}: Pull complete`);
  }
  lines.push(`Digest: ${digest}`);
  lines.push(present ? `Status: Image is up to date for ${full}` : `Status: Downloaded newer image for ${full}`);
  addCatalogImage(state, full);
  return { lines, path: `docker.io/${path}:${tag}` };
}

function pull({ fs, args }) {
  const parsed = parseFlags('pull', args, { bool: { '-q': 'quiet', '--quiet': 'quiet', '-a': 'all' } });
  if (parsed.error) return parsed.error;
  if (parsed.args.length !== 1) return usageError('pull', parsed.args.length);
  const state = dockerState(fs);
  const pulled = pullLines(state, parsed.args[0]);
  if (pulled.error) {
    return result([...(pulled.lines.length ? [out(`${pulled.lines.join('\n')}\n`)] : []), err(`Error response from daemon: ${pulled.error}\n`)], 1);
  }
  if (parsed.opts.quiet) return result([out(`${pulled.path}\n`)]);
  return result([out(`${[...pulled.lines, pulled.path].join('\n')}\n`)]);
}

// --- docker images, rmi, tag ---

function images({ fs, args }) {
  const parsed = parseFlags('images', args, { bool: { '-q': 'quiet', '--quiet': 'quiet', '-a': 'all', '--all': 'all', '--no-trunc': 'notrunc' } });
  if (parsed.error) return parsed.error;
  if (parsed.args.length > 1) return usageError('images', parsed.args.length);
  const state = dockerState(fs);
  const [filter] = parsed.args;
  const used = new Set(state.containers.map((c) => c.imageId));
  let rows = Object.values(state.images).flatMap((image) => (image.tags.length ? image.tags : ['<none>:<none>'])
    .map((tag) => ({ tag, image })));
  if (filter) {
    const repoOnly = !filter.includes(':');
    const wanted = repoOnly ? filter : normalizeRef(filter);
    rows = rows.filter(({ tag }) => (repoOnly ? tag.slice(0, tag.lastIndexOf(':')) === wanted : tag === wanted));
  }
  rows.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  if (parsed.opts.quiet) {
    const ids = [...new Set(rows.map(({ image }) => shortId(image.id)))];
    return result(ids.length ? [out(`${ids.join('\n')}\n`)] : []);
  }
  const text = table(['IMAGE', 'ID', 'DISK USAGE', 'CONTENT SIZE', 'EXTRA'], rows.map(({ tag, image }) => [
    tag, shortId(image.id), humanSize(image.disk), humanSize(image.content), used.has(image.id) ? 'U' : '',
  ]), { right: [2, 3], minWidth: 0, widths: { 1: 12, 4: 5 }, padLast: true });
  return result([out(text)]);
}

function rmi({ fs, args }) {
  const parsed = parseFlags('rmi', args, { bool: { '-f': 'force', '--force': 'force', '--no-prune': 'noprune' } });
  if (parsed.error) return parsed.error;
  if (!parsed.args.length) return usageError('rmi', 0);
  const state = dockerState(fs);
  const chunks = [];
  let code = 0;
  for (const ref of parsed.args) {
    const image = findImage(state, ref);
    if (!image) {
      chunks.push(err(`Error response from daemon: No such image: ${/^[0-9a-f]{12,64}$/.test(ref) ? ref : normalizeRef(ref)}\n`));
      code = 1;
      continue;
    }
    const byId = !image.tags.includes(normalizeRef(ref));
    const users = state.containers.filter((c) => c.imageId === image.id);
    const running = users.find((c) => c.status === 'running');
    if (byId && image.tags.length > 1 && !parsed.opts.force) {
      chunks.push(err(`Error response from daemon: conflict: unable to delete ${ref} (must be forced) - image is referenced in multiple repositories\n`));
      code = 1;
      continue;
    }
    if (!byId && image.tags.length > 1) {
      image.tags = image.tags.filter((tag) => tag !== normalizeRef(ref));
      chunks.push(out(`Untagged: ${normalizeRef(ref)}\n`));
      continue;
    }
    if (running || (users.length && !parsed.opts.force)) {
      const holder = running ?? users[0];
      const why = running ? '(cannot be forced) - image is being used by running container' : '(must be forced) - container';
      chunks.push(err(running
        ? `Error response from daemon: conflict: unable to delete ${byId ? ref : normalizeRef(ref)} ${why} ${shortId(holder.id)}\n`
        : `Error response from daemon: conflict: unable to delete ${byId ? ref : normalizeRef(ref)} ${why} ${shortId(holder.id)} is using its referenced image ${shortId(image.id)}\n`));
      code = 1;
      continue;
    }
    const lines = image.tags.map((tag) => `Untagged: ${tag}`);
    delete state.images[image.id];
    lines.push(`Deleted: sha256:${image.id}`);
    chunks.push(out(`${lines.join('\n')}\n`));
  }
  return result(chunks, code);
}

function tag({ fs, args }) {
  const parsed = parseFlags('tag', args, {});
  if (parsed.error) return parsed.error;
  if (parsed.args.length !== 2) return usageError('tag', parsed.args.length);
  const state = dockerState(fs);
  const [source, target] = parsed.args;
  const image = findImage(state, source);
  if (!image) return result([err(`Error response from daemon: No such image: ${normalizeRef(source)}\n`)], 1);
  const full = normalizeRef(target);
  if (!/^[a-z0-9]+([._/-][a-z0-9]+)*(:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$/.test(full.replace(/^[a-z0-9.-]+(:\d+)?\//, (m) => m.replace(/:\d+/, '')))) {
    return result([err(`Error parsing reference: "${target}" is not a valid repository/tag: invalid reference format\n`)], 1);
  }
  for (const other of Object.values(state.images)) other.tags = other.tags.filter((item) => item !== full);
  image.tags.push(full);
  return result([]);
}

// --- docker run / create ---

const RUN_FLAGS = {
  bool: {
    '-d': 'detach', '--detach': 'detach', '-i': 'interactive', '--interactive': 'interactive',
    '-t': 'tty', '--tty': 'tty', '--rm': 'rm', '-P': 'publishAll', '--publish-all': 'publishAll',
    '--init': 'init', '--privileged': 'privileged', '--read-only': 'readonly',
  },
  value: {
    '--name': 'name', '-p': 'publish', '--publish': 'publish', '-e': 'env', '--env': 'env',
    '--env-file': 'envFile', '-v': 'volume', '--volume': 'volume', '--network': 'network', '--net': 'network',
    '-w': 'workdir', '--workdir': 'workdir', '-u': 'user', '--user': 'user', '--restart': 'restart',
    '--entrypoint': 'entrypoint', '-h': 'hostname', '--hostname': 'hostname', '--memory': 'memory', '-m': 'memory',
    '--label': 'label', '-l': 'label', '--health-cmd': 'healthCmd', '--health-interval': 'healthInterval',
    '--expose': 'expose', '--cpus': 'cpus',
  },
};

// docker create пишет ошибку демона без «docker: » и подсказки
const runError = (text, code = 125, name = 'run') => result([err(name === 'create' && text.startsWith('Error response')
  ? `${text}\n` : `docker: ${text}\n\nRun 'docker ${name} --help' for more information\n`)], code);

/** «8080:80», «127.0.0.1:8080:80», «80», «8080:80/tcp» → {hostIp, hostPort, port}. */
function parsePort(spec, state, own = []) {
  const [main] = spec.split('/');
  const parts = main.split(':');
  let hostIp = '';
  let hostPort;
  let port;
  if (parts.length === 1) [port] = parts;
  else if (parts.length === 2) [hostPort, port] = parts;
  else [hostIp, hostPort, port] = [parts.slice(0, -2).join(':'), parts.at(-2), parts.at(-1)];
  if (!/^\d+$/.test(port ?? '') || Number(port) > 65535) return { error: `invalid containerPort: ${port}` };
  if (hostPort === undefined || hostPort === '') {
    // порт хоста не указан — свободный из 32768+
    const taken = new Set([...state.containers, { ports: own }].flatMap((c) => c.ports.map((item) => String(item.hostPort))));
    let free = 32768;
    while (taken.has(String(free))) free += 1;
    hostPort = String(free);
  }
  if (!/^\d+$/.test(hostPort) || Number(hostPort) > 65535) return { error: `invalid hostPort: ${hostPort}` };
  return { hostIp, hostPort: String(Number(hostPort)), port: String(Number(port)) };
}

/** -v: «том:/путь», «/хост:/путь», «./папка:/путь», «/путь» (анонимный). */
function parseVolume(spec, sh) {
  const parts = spec.split(':');
  const [source, destination, mode] = parts.length === 1 ? [null, parts[0], ''] : parts;
  if (!destination?.startsWith('/')) {
    return { error: `Error response from daemon: invalid mount config for type "${source?.startsWith('/') || source?.startsWith('.') ? 'bind' : 'volume'}": invalid mount path: '${destination ?? ''}' mount path must be absolute` };
  }
  const readOnly = (mode ?? '').split(',').includes('ro');
  if (source === null) return { mount: { type: 'volume', anonymous: true, destination: normalize(destination), readOnly } };
  if (source.startsWith('/') || source.startsWith('.') || source.startsWith('~')) {
    const path = source.startsWith('~') ? source.replace(/^~/, sh.env.HOME) : source;
    return { mount: { type: 'bind', source: sh.resolve(path), destination: normalize(destination), readOnly } };
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(source)) {
    return { error: `Error response from daemon: create ${source}: "${source}" includes invalid characters for a local volume name, only "[a-zA-Z0-9][a-zA-Z0-9_.-]" are allowed. If you intended to pass a host directory, use absolute path` };
  }
  return { mount: { type: 'volume', name: source, destination: normalize(destination), readOnly } };
}

/** Строки --env-file: ИМЯ=значение, комментарии и пустые пропускаются; ИМЯ без = — из окружения. */
function readEnvFile(sh, path) {
  const text = sh.fs.readFile(sh.resolve(path));
  return text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
    .flatMap((line) => (line.includes('=') ? [line] : (sh.env[line] !== undefined ? [`${line}=${sh.env[line]}`] : [])));
}

/** Общая часть run и create: проверки, образ (с pull), создание контейнера. */
function prepare(ctx, name) {
  const { sh, fs } = ctx;
  const parsed = parseFlags(name, ctx.args, RUN_FLAGS, { stopAtPositional: true });
  if (parsed.error) return { done: parsed.error };
  const { opts } = parsed;
  if (!parsed.args.length) return { done: usageError(name, 0) };
  const [imageRef, ...cmd] = parsed.args;
  const state = dockerState(fs);
  const containerName = opts.name?.at(-1);
  if (containerName !== undefined && !/^\/?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)) {
    return { done: runError(`Error response from daemon: invalid container name (${containerName}): only [a-zA-Z0-9][a-zA-Z0-9_.-] are allowed`, 125, name) };
  }
  if (containerName !== undefined && containerName.replace(/^\//, '').length < 2) {
    return { done: runError(`Error response from daemon: invalid container name (${containerName}): name must be at least 2 characters`, 125, name) };
  }
  const ports = [];
  for (const spec of opts.publish ?? []) {
    const port = parsePort(spec, state, ports);
    if (port.error) return { done: runError(port.error, 125, name) };
    ports.push(port);
  }
  const env = [];
  for (const file of opts.envFile ?? []) {
    try {
      env.push(...readEnvFile(sh, file));
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      return { done: runError(`open ${file}: ${e.code === 'ENOENT' ? 'no such file or directory' : e.message.toLowerCase()}`, 125, name) };
    }
  }
  for (const item of opts.env ?? []) {
    if (item.includes('=')) env.push(item);
    else if (sh.env[item] !== undefined) env.push(`${item}=${sh.env[item]}`);
  }
  const mounts = [];
  for (const spec of opts.volume ?? []) {
    const parsedMount = parseVolume(spec, sh);
    if (parsedMount.error) return { done: runError(parsedMount.error, 125, name) };
    mounts.push(parsedMount.mount);
  }
  if (opts.restart && !/^(no|always|unless-stopped|on-failure(:\d+)?)$/.test(opts.restart.at(-1))) {
    return { done: runError(`invalid restart policy: ${opts.restart.at(-1)}`, 125, name) };
  }
  if (opts.rm && opts.restart && opts.restart.at(-1) !== 'no') {
    return { done: runError('Conflicting options: --restart and --rm', 125, name) };
  }

  const chunks = [];
  let image = findImage(state, imageRef);
  if (!image) {
    chunks.push(err(`Unable to find image '${normalizeRef(imageRef)}' locally\n`));
    const pulled = pullLines(state, imageRef, { quietTag: true });
    if (pulled.error) {
      return { done: result([...chunks, err(`docker: Error response from daemon: ${pulled.error}\n\nRun 'docker ${name} --help' for more information\n`)], 125) };
    }
    chunks.push(err(`${pulled.lines.join('\n')}\n`));   // у docker run загрузка — в stderr
    image = findImage(state, imageRef);
  }
  if (containerName) {
    const taken = state.containers.find((c) => c.name === containerName.replace(/^\//, ''));
    if (taken) {
      chunks.push(err(`docker: Error response from daemon: Conflict. The container name "/${taken.name}" is already in use by container "${taken.id}". You have to remove (or rename) that container to be able to reuse that name.\n\nRun 'docker ${name} --help' for more information\n`));
      return { done: result(chunks, 125) };
    }
  }
  // -P: все порты EXPOSE образа — на свободные порты хоста 32768+
  if (opts.publishAll) {
    for (const spec of image.config.ExposedPorts ?? []) {
      const port = String(parseInt(spec, 10));
      if (!ports.some((item) => item.port === port)) ports.push(parsePort(port, state, ports));
    }
  }
  for (const mount of mounts.filter((item) => item.anonymous)) {
    mount.name = hexHash(`volume:${now()}:${mount.destination}:${state.counter}`);
    state.volumes[mount.name] = { name: mount.name, created: now(), anonymous: true, data: { type: 'dir', owner: 'root', group: 'root', mode: 0o755, mtime: now(), nlink: 1, children: {} }, labels: { 'com.docker.volume.anonymous': '' } };
  }
  const container = createContainer(fs, image, {
    name: containerName?.replace(/^\//, '') ?? null,
    imageRef: imageRef.replace(/^docker\.io\/(library\/)?/, ''),
    cmd,
    entrypoint: opts.entrypoint ? [opts.entrypoint.at(-1)].filter(Boolean) : null,
    env,
    ports,
    mounts,
    network: opts.network?.at(-1) ?? null,
    workdir: opts.workdir?.at(-1) ?? null,
    user: opts.user?.at(-1) ?? null,
    hostname: opts.hostname?.at(-1) ?? null,
    tty: Boolean(opts.tty),
    interactive: Boolean(opts.interactive),
    autoRemove: Boolean(opts.rm),
    restart: opts.restart?.at(-1) ?? 'no',
  });
  container.name ??= randomName(state, container.id);
  return { container, chunks, opts };
}

function create(ctx) {
  const prepared = prepare(ctx, 'create');
  if (prepared.done) return prepared.done;
  return result([...prepared.chunks, out(`${prepared.container.id}\n`)]);
}

/** Вложенная оболочка в контейнере (docker run -it / docker exec -it): терминал переключается. */
function enterShell(fs, container, { env = [], workdir = null, onLeave = () => {} } = {}) {
  const { shell, sync } = containerShell(fs, container, { env, workdir, nested: true, tty: true });
  shell.machine.afterCommand = sync;
  return {
    type: 'enter',
    shell,
    onLeave: (code) => {
      sync();
      onLeave(code);
    },
  };
}

const PYTHON_NOTE = '(интерактивный Python в тренажёре не запускается — для кода есть тренажёр Python)\n';

function run(ctx) {
  const { fs } = ctx;
  const prepared = prepare(ctx, 'run');
  if (prepared.done) return prepared.done;
  const { container, chunks, opts } = prepared;
  const detach = Boolean(opts.detach);
  const started = startContainer(fs, container);
  if (started.error) {
    if (detach) chunks.push(out(`${container.id}\n`));
    chunks.push(err(`docker: Error response from daemon: ${started.error}\n\nRun 'docker run --help' for more information\n`));
    if (container.autoRemove) removeContainer(fs, container, { volumes: true });
    return result(chunks, started.code === 127 ? 127 : 125);
  }
  if (detach) {
    chunks.push(out(`${container.id}\n`));
    if (container.autoRemove && container.status === 'exited') removeContainer(fs, container, { volumes: true });
    return result(chunks);
  }
  if (started.interactive === 'shell') {
    return result(chunks, 0, enterShell(fs, container, {
      onLeave: (code) => {
        finishShell(fs, container, code);
      },
    }));
  }
  // вывод контейнера в терминал (как без -d): логи, которые он успел написать
  for (const line of container.logs) chunks.push(line.err ? err(`${line.text}\n`) : out(`${line.text}\n`));
  if (started.interactive === 'python') chunks.push(out(PYTHON_NOTE));
  if (container.status === 'running') {
    chunks.push(out(`(в тренажёре терминал не ждёт: контейнер ${container.name} работает дальше — остановить: docker stop ${container.name}; в настоящем терминале вы бы запускали его с -d)\n`));
  }
  const code = container.status === 'exited' ? container.exitCode : 0;
  if (container.autoRemove && container.status === 'exited') removeContainer(fs, container, { volumes: true });
  return result(chunks, code);
}

function finishShell(fs, container, code) {
  const state = dockerState(fs);
  if (!state.containers.includes(container)) return;
  container.status = 'exited';
  container.exitCode = code ?? 0;
  container.finishedAt = now();
  container.procs = [];
  if (container.autoRemove) removeContainer(fs, container, { volumes: true });
}

// --- docker ps ---

function portsText(container) {
  if (container.status !== 'running') return '';
  const published = container.ports.flatMap((port) => (port.hostIp
    ? [[Number(port.port), `${port.hostIp}:${port.hostPort}->${port.port}/tcp`]]
    : [[Number(port.port), `0.0.0.0:${port.hostPort}->${port.port}/tcp`], [Number(port.port), `[::]:${port.hostPort}->${port.port}/tcp`]]));
  const exposed = (findImageById(container)?.config.ExposedPorts ?? [])
    .filter((spec) => !container.ports.some((port) => `${port.port}/tcp` === spec))
    .map((spec) => [parseInt(spec, 10), spec]);
  return [...exposed, ...published].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join(', ');
}

let currentState = null;
const findImageById = (container) => currentState?.images[container.imageId] ?? catalogImageRecord(container);
const catalogImageRecord = (container) => ({ config: catalogImage(container.base)?.config ?? {} });

export function statusText(container) {
  if (container.status === 'running') return `Up ${humanDuration(now() - container.startedAt)}`;
  if (container.status === 'exited') return `Exited (${container.exitCode}) ${humanDuration(now() - container.finishedAt)} ago`;
  return 'Created';
}

function ps({ fs, args }) {
  const parsed = parseFlags('ps', args, {
    bool: { '-a': 'all', '--all': 'all', '-q': 'quiet', '--quiet': 'quiet', '--no-trunc': 'notrunc', '-l': 'latest', '--latest': 'latest', '-s': 'size' },
    value: { '-f': 'filter', '--filter': 'filter', '--format': 'format', '-n': 'last' },
  });
  if (parsed.error) return parsed.error;
  if (parsed.args.length) return usageError('ps', parsed.args.length);
  const state = dockerState(fs);
  currentState = state;
  let list = [...state.containers].reverse();
  if (!parsed.opts.all && !parsed.opts.latest) list = list.filter((c) => c.status === 'running');
  if (parsed.opts.latest) list = list.slice(0, 1);
  for (const filter of parsed.opts.filter ?? []) {
    const [key, value = ''] = filter.split('=');
    if (key === 'name') list = list.filter((c) => c.name.includes(value.replace(/^\^|\$$/g, '')));
    else if (key === 'status') list = list.filter((c) => c.status === value);
    else if (key === 'ancestor') list = list.filter((c) => c.image === value || normalizeRef(c.image) === normalizeRef(value));
    else return result([err(`Error response from daemon: invalid filter '${key}'\n`)], 1);
  }
  if (parsed.opts.quiet) return result(list.length ? [out(`${list.map((c) => (parsed.opts.notrunc ? c.id : shortId(c.id))).join('\n')}\n`)] : []);
  if (parsed.opts.format) {
    const format = parsed.opts.format.at(-1);
    return result(list.length ? [out(`${list.map((c) => renderTemplate(format.replace(/^table /, ''), psRow(c))).join('\n')}\n`)] : []);
  }
  const rows = list.map((c) => {
    const command = commandLine(c);
    const shown = parsed.opts.notrunc || command.length <= 20 ? command : `${command.slice(0, 19)}…`;
    return [parsed.opts.notrunc ? c.id : shortId(c.id), c.image, `"${shown}"`, `${humanDuration(now() - c.created)} ago`, statusText(c), portsText(c), c.name];
  });
  return result([out(table(['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES'], rows))]);
}

const psRow = (c) => ({
  ID: shortId(c.id), Image: c.image, Command: `"${commandLine(c)}"`, CreatedAt: new Date(c.created).toISOString(),
  RunningFor: `${humanDuration(now() - c.created)} ago`, Status: statusText(c), Ports: portsText(c), Names: c.name,
  State: c.status,
});

// --- start, stop, restart, rm ---

function eachContainer({ fs, args }, name, spec, fn) {
  const parsed = parseFlags(name, args, spec);
  if (parsed.error) return parsed.error;
  if (!parsed.args.length) return usageError(name, 0);
  const state = dockerState(fs);
  const chunks = [];
  const failed = [];
  for (const ref of parsed.args) {
    const container = findContainer(state, ref);
    if (!container) {
      chunks.push(err(`Error response from daemon: No such container: ${ref}\n`));
      failed.push(ref);
      continue;
    }
    const error = fn(container, ref, parsed.opts);
    if (error) {
      chunks.push(err(`Error response from daemon: ${error}\n`));
      failed.push(ref);
    } else chunks.push(out(`${ref}\n`));
  }
  return { chunks, failed };
}

function start(ctx) {
  const done = eachContainer(ctx, 'start', { bool: { '-a': 'attach', '--attach': 'attach', '-i': 'interactive' } }, (container) => {
    const started = startContainer(ctx.fs, container);
    return started.error ?? null;
  });
  if (!done.chunks) return done;
  if (done.failed.length) done.chunks.push(err(`failed to start containers: ${done.failed.join(', ')}\n`));
  return result(done.chunks, done.failed.length ? 1 : 0);
}

function stop(ctx) {
  const done = eachContainer(ctx, 'stop', { value: { '-t': 'time', '--time': 'time', '-s': 'signal', '--signal': 'signal' } }, (container) => {
    stopContainer(ctx.fs, container);
    if (container.autoRemove) removeContainer(ctx.fs, container, { volumes: true });
    return null;
  });
  if (!done.chunks) return done;
  return result(done.chunks, done.failed.length ? 1 : 0);
}

function restart(ctx) {
  const done = eachContainer(ctx, 'restart', { value: { '-t': 'time', '--time': 'time', '-s': 'signal' } }, (container) => {
    stopContainer(ctx.fs, container);
    const started = startContainer(ctx.fs, container);
    return started.error ?? null;
  });
  if (!done.chunks) return done;
  return result(done.chunks, done.failed.length ? 1 : 0);
}

function rm(ctx) {
  const done = eachContainer(ctx, 'rm', { bool: { '-f': 'force', '--force': 'force', '-v': 'volumes', '--volumes': 'volumes', '-l': 'link' } }, (container, ref, opts) => {
    if (container.status === 'running' && !opts.force) {
      return `cannot remove container "${ref}": container is running: stop the container before removing or force remove`;
    }
    if (container.status === 'running') stopContainer(ctx.fs, container);
    removeContainer(ctx.fs, container, { volumes: opts.volumes });
    return null;
  });
  if (!done.chunks) return done;
  return result(done.chunks, done.failed.length ? 1 : 0);
}

// --- logs ---

function logs({ fs, args }) {
  const parsed = parseFlags('logs', args, {
    bool: { '-f': 'follow', '--follow': 'follow', '-t': 'timestamps', '--timestamps': 'timestamps', '--details': 'details' },
    value: { '-n': 'tail', '--tail': 'tail', '--since': 'since', '--until': 'until' },
  });
  if (parsed.error) return parsed.error;
  if (parsed.args.length !== 1) return usageError('logs', parsed.args.length);
  const container = findContainer(dockerState(fs), parsed.args[0]);
  if (!container) return result([err(`Error response from daemon: No such container: ${parsed.args[0]}\n`)], 1);
  let lines = container.logs;
  const tail = parsed.opts.tail?.at(-1);
  if (tail !== undefined && tail !== 'all') {
    if (!/^\d+$/.test(tail)) return result([err(`invalid value for "tail": ${tail}\n`)], 1);
    lines = Number(tail) === 0 ? [] : lines.slice(-Number(tail));
  }
  const chunks = lines.map((line) => {
    const text = `${parsed.opts.timestamps ? `${isoNano(line.t)} ` : ''}${line.text}\n`;
    return line.err ? err(text) : out(text);
  });
  if (parsed.opts.follow && container.status === 'running') {
    chunks.push(out('(в тренажёре logs -f не ждёт новых строк — команда сразу завершается)\n'));
  }
  return result(chunks);
}

// --- exec ---

function exec(ctx) {
  const { fs } = ctx;
  const parsed = parseFlags('exec', ctx.args, {
    bool: { '-i': 'interactive', '--interactive': 'interactive', '-t': 'tty', '--tty': 'tty', '-d': 'detach', '--detach': 'detach', '--privileged': 'privileged' },
    value: { '-e': 'env', '--env': 'env', '-w': 'workdir', '--workdir': 'workdir', '-u': 'user', '--user': 'user', '--env-file': 'envFile' },
  }, { stopAtPositional: true });
  if (parsed.error) return parsed.error;
  if (parsed.args.length < 2) return usageError('exec', parsed.args.length);
  const [ref, ...words] = parsed.args;
  const container = findContainer(dockerState(fs), ref);
  if (!container) return result([err(`Error response from daemon: No such container: ${ref}\n`)], 1);
  if (container.status !== 'running') return result([err(`Error response from daemon: container ${container.id} is not running\n`)], 1);
  const env = (parsed.opts.env ?? []).flatMap((item) => (item.includes('=') ? [item]
    : (ctx.sh.env[item] !== undefined ? [`${item}=${ctx.sh.env[item]}`] : [])));
  const workdir = parsed.opts.workdir?.at(-1) ?? null;
  const { shell, sync } = containerShell(fs, container, { env, workdir });
  const available = shell.hasCommand(words[0].split('/').pop()) || (words[0].includes('/') && shell.fs.exists(words[0]));
  sync();
  if (!available) {
    return result([out(`OCI runtime exec failed: exec failed: unable to start container process: exec: "${words[0]}": executable file not found in $PATH\n`)], 127);
  }
  const interactive = parsed.opts.interactive && parsed.opts.tty;
  if (interactive && isShell(words[0]) && words.length === 1) {
    return result([], 0, enterShell(fs, container, { env, workdir }));
  }
  if (interactive && ['python', 'python3'].includes(words[0]) && words.length === 1) {
    return result([out(PYTHON_NOTE)]);
  }
  if (isShell(words[0]) && words.length === 1) return result([]);   // без -it оболочка читает пустой ввод
  if (parsed.opts.detach) {
    runInContainer(fs, container, words, { env, workdir });
    return result([]);
  }
  const done = runInContainer(fs, container, words, { env, workdir, tty: Boolean(parsed.opts.tty), interactive });
  return { ...result(done.chunks, done.code, done.action), pending: done.pending };
}

// --- inspect ---

function inspect({ fs, args }) {
  const parsed = parseFlags('inspect', args, {
    bool: { '-s': 'size', '--size': 'size' },
    value: { '-f': 'format', '--format': 'format', '--type': 'type' },
  });
  if (parsed.error) return parsed.error;
  if (!parsed.args.length) return usageError('inspect', 0);
  const state = dockerState(fs);
  currentState = state;
  const type = parsed.opts.type?.at(-1);
  const found = [];
  const chunks = [];
  let code = 0;
  for (const ref of parsed.args) {
    const container = (!type || type === 'container') ? findContainer(state, ref) : null;
    const image = !container && (!type || type === 'image') ? findImage(state, ref) : null;
    if (container) found.push(inspectContainer(fs, state, container));
    else if (image) found.push(inspectImage(image));
    else {
      chunks.push(err(`error: no such object: ${ref}\n`));
      code = 1;
    }
  }
  const format = parsed.opts.format?.at(-1);
  if (format) {
    return result([...found.map((item) => out(`${renderTemplate(format, item)}\n`)), ...chunks], code);
  }
  const json = JSON.stringify(found, null, 4)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return result([out(`${found.length ? json : '[]'}\n`), ...chunks], code);
}

// --- version, help ---

function version() {
  return result([out(`Client: Docker Engine - Community
 Version:           29.10.0
 API version:       1.52
 Go version:        go1.25.3
 Git commit:        fdd4b8e
 Built:             Mon Nov 10 14:20:42 2026
 OS/Arch:           linux/amd64
 Context:           default

Server: Docker Engine - Community
 Engine:
  Version:          29.10.0
  API version:      1.52 (minimum version 1.44)
  Go version:       go1.25.3
  Git commit:       a8c1f2e
  Built:            Mon Nov 10 14:20:42 2026
  OS/Arch:          linux/amd64
  Experimental:     false
 containerd:
  Version:          v2.1.5
 runc:
  Version:          1.3.3
`)]);
}

export const HELP = `docker — контейнеры (учебный Docker Engine 29 в браузере, реестр без сети).
  docker pull ОБРАЗ            скачать образ: postgres:16, nginx:1.27, nginx:1.27-alpine,
                               python:3.12, python:3.12-slim, redis:7, alpine:3.20, ubuntu:24.04
  docker images                образы;  docker rmi ОБРАЗ — удалить;  docker tag ОБРАЗ НОВОЕ_ИМЯ
  docker run [флаги] ОБРАЗ [команда]   создать и запустить контейнер
      -d  в фоне   --name ИМЯ   -p 8080:80  порт хоста:порт контейнера
      -e ИМЯ=значение   --env-file .env   -v том:/путь  или  -v ./папка:/путь
      --rm  удалить после выхода   -it  интерактивно (docker run -it ubuntu:24.04 bash)
      --network СЕТЬ
  docker ps [-a] [-q]          запущенные контейнеры (-a — все)
  docker stop | start | restart КОНТЕЙНЕР     docker rm [-f] КОНТЕЙНЕР
  docker logs [--tail N] КОНТЕЙНЕР            вывод контейнера
  docker exec [-it] КОНТЕЙНЕР КОМАНДА         команда внутри: docker exec -it web bash
  docker inspect [-f '{{.State.Status}}'] ИМЯ  подробности в JSON`;

const SUBCOMMANDS = {
  run, create, ps, start, stop, restart, rm, logs, exec, inspect, pull, images, rmi, tag,
  version: () => version(),
};

// docker container …, docker image … — то же самое
const GROUPS = {
  container: { ls: ps, list: ps, ps, run, create, start, stop, restart, rm, remove: rm, logs, exec, inspect },
  image: { ls: images, list: images, pull, rm: rmi, remove: rmi, tag, inspect },
};

const LATER = new Set(['volume', 'network', 'build', 'compose', 'system', 'login', 'logout', 'push', 'builder', 'buildx', 'cp', 'top', 'stats', 'kill', 'rename', 'commit', 'save', 'load', 'info', 'search', 'context', 'swarm', 'port', 'diff', 'events', 'history', 'attach', 'wait', 'pause', 'unpause', 'update', 'export', 'import']);

export const docker = {
  help: HELP,
  noHelp: true,
  run(ctx) {
    const args = [...ctx.args];
    if (!args.length || (args.length === 1 && ['--help', '-h', 'help'].includes(args[0]))) return { out: `${HELP}\n`, code: args.length ? 0 : 0 };
    if (args[0] === '--version' || args[0] === '-v') return { out: 'Docker version 29.10.0, build fdd4b8e\n' };
    let [name, ...rest] = args;
    let handler = SUBCOMMANDS[name];
    let label = name;
    if (GROUPS[name]) {
      const [sub, ...more] = rest;
      handler = GROUPS[name][sub];
      if (!handler) {
        return { err: `docker: unknown command: docker ${name} ${sub ?? ''}\n\nRun 'docker ${name} --help' for more information\n`.replace('  ', ' '), code: 1 };
      }
      label = sub;
      rest = more;
    }
    if (!handler) {
      if (LATER.has(name)) return { err: `docker ${name}: в учебном Docker пока нет — появится в следующих шагах курса\n`, code: 1 };
      return { err: `docker: unknown command: docker ${name}\n\nRun 'docker --help' for more information\n`, code: 1 };
    }
    if (rest[0] === '--help' || (rest.includes('--help') && !['run', 'exec', 'create'].includes(label))) {
      return { out: `${HELP}\n` };
    }
    const done = handler({ ...ctx, args: rest });
    return { chunks: done.chunks, code: done.code, action: done.action, pending: done.pending, out: '', err: '' };
  },
};
