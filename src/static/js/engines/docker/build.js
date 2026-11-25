// docker build: Dockerfile → образ. Слои и кэш как у BuildKit (шаг повторяется, если изменились
// его инструкция или скопированные файлы, — и все шаги после него), вывод — как
// docker build --progress=plain у Docker 29 (сверено с образцами «Контента»).
// RUN выполняется оболочкой контейнера сборки; pip, apt-get, useradd — имитация (engines/docker/tools.js).

import { now } from '../linux/clock.js';
import { FsError, VirtualFS, normalize } from '../linux/fs.js';
import { catalogImage, hexHash, imageId, normalizeRef } from './catalog.js';
import { humanSize } from './format.js';
import { addCatalogImage, dockerState, findImage, imageFs, packNode, unpackNode } from './state.js';
import { Shell } from '../linux/shell.js';
import { containerMachine } from './containers.js';

const STEP = new Set(['FROM', 'RUN', 'COPY', 'ADD', 'WORKDIR']);
const KNOWN = new Set(['FROM', 'RUN', 'COPY', 'ADD', 'WORKDIR', 'ENV', 'ARG', 'CMD', 'ENTRYPOINT', 'EXPOSE',
  'USER', 'LABEL', 'VOLUME', 'HEALTHCHECK', 'STOPSIGNAL', 'SHELL', 'ONBUILD', 'MAINTAINER']);

class BuildError extends Error {
  constructor(message, line = null, log = []) {
    super(message);
    this.line = line;
    this.log = log;
  }
}

// --- разбор Dockerfile ---

/** Текст → инструкции [{cmd, args, line, text}]: продолжение строки «\», комментарии #. */
export function parseDockerfile(text) {
  const result = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    let raw = lines[i];
    const start = i;
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    while (/\\\s*$/.test(raw) && i + 1 < lines.length) {
      i += 1;
      if (lines[i].trim().startsWith('#')) continue;
      raw = `${raw.replace(/\\\s*$/, '')}\n${lines[i]}`;
    }
    const match = /^\s*(\S+)\s*([\s\S]*)$/.exec(raw);
    const cmd = match[1].toUpperCase();
    if (!KNOWN.has(cmd)) {
      throw new BuildError(`dockerfile parse error on line ${start + 1}: unknown instruction: ${match[1]}`, start + 1);
    }
    result.push({ cmd, args: match[2].trim(), line: start + 1, text: raw.replace(/\\\n\s*/g, '').replace(/\s+/g, ' ').trim() });
  }
  return result;
}

/** JSON-форма ["a", "b"] или null. */
function jsonForm(args) {
  if (!args.startsWith('[')) return null;
  try {
    const value = JSON.parse(args);
    return Array.isArray(value) ? value.map(String) : null;
  } catch (e) {
    return null;
  }
}

/** ${VAR}, $VAR, ${VAR:-по умолчанию} из ARG и ENV. */
function substitute(text, vars) {
  return text.replace(/\$\{(\w+)(?::-([^}]*))?\}|\$(\w+)/g, (_, a, def, b) => {
    const name = a ?? b;
    return vars[name] ?? def ?? '';
  });
}

/** ENV/LABEL/ARG: «K=V K2="V 2"» или старая форма «K V». */
function pairs(args) {
  if (!/^\S+=/.test(args)) {
    const [key, ...rest] = args.split(/\s+/);
    return [[key, rest.join(' ')]];
  }
  const result = [];
  const re = /(\S+?)=("(?:[^"\\]|\\.)*"|'[^']*'|\S*)/g;
  for (const m of args.matchAll(re)) result.push([m[1], m[2].replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1')]);
  return result;
}

// --- .dockerignore ---

function globRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i += 1;
      if (pattern[i + 1] === '/') i += 1;
    } else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}(/.*)?$`);
}

/** Шаблоны .dockerignore → функция «исключён ли путь» (последнее совпадение решает, ! — вернуть). */
export function ignoreMatcher(text) {
  const rules = text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const negate = line.startsWith('!');
      const pattern = normalize(negate ? line.slice(1) : line).slice(1).replace(/\/$/, '');
      return { negate, re: globRegex(pattern) };
    });
  return (path) => {
    let excluded = false;
    for (const rule of rules) if (rule.re.test(path)) excluded = !rule.negate;
    return excluded;
  };
}

// --- контекст ---

/** Файлы контекста: {путь относительно контекста: узел}, без исключённых .dockerignore. */
function readContext(hostFs, dir) {
  let ignoreText = '';
  try {
    ignoreText = hostFs.readFile(`${dir}/.dockerignore`);
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
  }
  const ignored = ignoreMatcher(ignoreText);
  const files = {};
  for (const [path, node] of hostFs.walk(dir)) {
    if (path === dir) continue;
    const rel = path.slice(dir.length + 1);
    if (rel !== 'Dockerfile' && rel !== '.dockerignore' && ignored(rel)) continue;
    // исключённая папка — и всё внутри
    if (rel.split('/').some((_, k, parts) => k < parts.length - 1 && ignored(parts.slice(0, k + 1).join('/')))) continue;
    files[rel] = node;
  }
  return { files, ignoreSize: new TextEncoder().encode(ignoreText).length || 2 };
}

const fileHash = (files) => hexHash(Object.entries(files).filter(([, node]) => node.type === 'file')
  .map(([path, node]) => `${path}:${node.size}:${hexHash(node.content ?? '', 16)}:${node.mode}`).sort().join('|'));

/** Размер слоя как у containerd: 8 КБ служебных + 4 КБ на каждый файл (до 4 КБ). */
const copySize = (nodes) => 8192 + nodes.filter((node) => node.type === 'file')
  .reduce((sum, node) => sum + Math.max(4096, Math.ceil((node.size ?? 0) / 4096) * 4096), 0);

// --- сборка ---

const t = (n) => n.toFixed(3);

/** Инструкция для истории: COPY . . # buildkit, RUN /bin/sh -c …, CMD ["…"]. */
function historyText(step) {
  if (step.cmd === 'RUN') return `RUN /bin/sh -c ${step.expanded}`;
  if (step.cmd === 'COPY' || step.cmd === 'ADD') return `${step.cmd} ${step.args} # buildkit`;
  if (['CMD', 'ENTRYPOINT'].includes(step.cmd)) {
    const words = jsonForm(step.args) ?? ['/bin/sh', '-c', step.args];
    return `${step.cmd} [${words.map((word) => JSON.stringify(word)).join(' ')}]`;
  }
  return `${step.cmd} ${step.expanded ?? step.args}`;
}

/** Этапы: [{name, base, steps}]; FROM … AS name. */
function stages(instructions, buildArgs) {
  const list = [];
  const globalArgs = {};
  for (const step of instructions) {
    if (step.cmd === 'FROM') {
      const [ref, as, name] = substitute(step.args, { ...globalArgs, ...buildArgs }).split(/\s+/);
      list.push({ name: as?.toUpperCase() === 'AS' ? name : null, base: ref, from: step, steps: [], index: list.length });
    } else if (!list.length) {
      if (step.cmd === 'ARG') {
        for (const [key, value] of pairs(step.args)) globalArgs[key] = buildArgs[key] ?? value;
        continue;
      }
      throw new BuildError('no build stage in current context', step.line);
    } else list.at(-1).steps.push(step);
  }
  if (!list.length) throw new BuildError('the Dockerfile (Dockerfile) cannot be empty');
  return list;
}

/**
 * Собрать. opts: {dir, file, tags, noCache, buildArgs, target, quiet}.
 * Возвращает {log: [строки вывода], image} или бросает BuildError.
 */
export function buildImage(hostFs, sh, opts) {
  const out = [];
  try {
    return buildSteps(hostFs, sh, opts, out);
  } catch (e) {
    if (e instanceof BuildError) e.before = out.slice();
    throw e;
  }
}

function buildSteps(hostFs, sh, opts, out) {
  const state = dockerState(hostFs);
  state.buildCache ??= {};
  const dockerfilePath = normalize(opts.file ?? 'Dockerfile', opts.file ? sh.cwd : opts.dir);
  const dockerfileName = opts.fileName ?? opts.file ?? 'Dockerfile';
  let text;
  try {
    text = hostFs.readFile(dockerfilePath);
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    throw new BuildError(`failed to read dockerfile: open ${dockerfileName}: no such file or directory`);
  }
  out.push('#0 building with "default" instance using docker driver', '');
  out.push(`#1 [internal] load build definition from ${dockerfileName}`,
    `#1 transferring dockerfile: ${new TextEncoder().encode(text).length}B done`, '#1 DONE 0.0s', '');
  const instructions = parseDockerfile(text);
  const all = stages(instructions, opts.buildArgs);
  // этап-цель и те, от кого он зависит (COPY --from, FROM этап)
  const targetIndex = opts.target ? all.findIndex((stage) => stage.name === opts.target) : all.length - 1;
  if (targetIndex === -1) throw new BuildError(`target stage "${opts.target}" could not be found`);
  const needed = new Set();
  const need = (index) => {
    if (needed.has(index)) return;
    needed.add(index);
    const stage = all[index];
    const fromStage = all.findIndex((other) => other.name && other.name === stage.base);
    if (fromStage !== -1 && fromStage < index) need(fromStage);
    for (const step of stage.steps) {
      const from = /--from=(\S+)/.exec(step.args)?.[1];
      if (!from) continue;
      const k = /^\d+$/.test(from) ? Number(from) : all.findIndex((other) => other.name === from);
      if (k !== -1 && k < index) need(k);
    }
  };
  need(targetIndex);
  const order = [...needed].sort((a, b) => a - b);

  let vertex = 2;
  const externals = [...new Set(order.map((k) => all[k].base).filter((base) => !all.some((stage) => stage.name === base)))];
  for (const base of externals) {
    const full = normalizeRef(base);
    const known = catalogImage(base) || findImage(state, base);
    if (!known) {
      throw new BuildError(`${full}: failed to resolve source metadata for docker.io/library/${full}: pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed`);
    }
    out.push(`#${vertex} [internal] load metadata for docker.io/library/${full}`, `#${vertex} DONE 0.0s`, '');
    vertex += 1;
  }
  const { files: context, ignoreSize } = readContext(hostFs, opts.dir);
  out.push(`#${vertex} [internal] load .dockerignore`, `#${vertex} transferring context: ${ignoreSize}B done`, `#${vertex} DONE 0.0s`, '');
  vertex += 1;
  const contextSize = Object.values(context).filter((node) => node.type === 'file').reduce((sum, node) => sum + (node.size ?? 0), 0);
  out.push(`#${vertex} [internal] load build context`, `#${vertex} transferring context: ${contextSize}B done`, `#${vertex} DONE 0.0s`, '');
  vertex += 1;

  const built = {};       // номер этапа → {fs, config, layers, key, base}
  let anyRun = false;
  for (const index of order) {
    const stage = all[index];
    const label = (k, n) => `[${stage.name ?? (all.length > 1 ? `stage-${index}` : '')}${stage.name || all.length > 1 ? ' ' : ''}${k}/${n}]`;
    const stepCount = 1 + stage.steps.filter((step) => STEP.has(step.cmd)).length;
    let fs;
    let config;
    let layers;
    let key;
    let baseRef;
    const parent = all.findIndex((other) => other.name && other.name === stage.base);
    if (parent !== -1 && built[parent]) {
      ({ config, layers, key, baseRef } = structuredClone({ config: built[parent].config, layers: built[parent].layers, key: built[parent].key, baseRef: built[parent].baseRef }));
      fs = new VirtualFS();
      fs.root = unpackNode(packNode(built[parent].fs.root));
      out.push(`#${vertex} ${label(1, stepCount)} FROM ${stage.base}`, `#${vertex} DONE 0.0s`, '');
    } else {
      const image = findImage(state, stage.base) ?? addCatalogImage({ images: {} }, stage.base);
      const info = catalogImage(image.base);
      baseRef = image.base;
      config = structuredClone(image.config);
      layers = structuredClone(image.layers ?? baseHistory(info, image));
      key = `image:${image.id}`;
      fs = new VirtualFS();
      fs.root = unpackNode(imageFs(image, '000000000000'));
      fs.user = 'root';
      const digest = `sha256:${image.built ? image.id : imageId(catalogImage(image.base))}`;
      const full = normalizeRef(stage.base);
      out.push(`#${vertex} ${label(1, stepCount)} FROM docker.io/library/${full}@${digest}`,
        `#${vertex} resolve docker.io/library/${full}@${digest} 0.0s done`, `#${vertex} DONE 0.0s`, '');
    }
    vertex += 1;
    const args = { ...opts.buildArgs };
    const declared = {};
    let k = 1;
    for (const step of stage.steps) {
      const env = Object.fromEntries((config.Env ?? []).map((item) => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]));
      const vars = { ...declared, ...env };
      step.expanded = substitute(step.args, vars);
      switch (step.cmd) {
        case 'ARG':
          for (const [name, value] of pairs(step.args)) declared[name] = args[name] ?? value;
          continue;
        case 'ENV': {
          const list = [...(config.Env ?? [])];
          for (const [name, value] of pairs(step.args)) {
            const expanded = substitute(value, vars);
            vars[name] = expanded;
            const at = list.findIndex((item) => item.startsWith(`${name}=`));
            if (at === -1) list.push(`${name}=${expanded}`);
            else list[at] = `${name}=${expanded}`;
          }
          config.Env = list;
          layers.push({ createdBy: `ENV ${step.expanded}`, size: 0, created: now() });
          key = hexHash(`${key}|${step.text}|${step.expanded}`);
          continue;
        }
        case 'CMD':
        case 'ENTRYPOINT': {
          const words = jsonForm(step.args) ?? ['/bin/sh', '-c', step.args];
          if (step.cmd === 'CMD') config.Cmd = words;
          else {
            config.Entrypoint = words;
            delete config.Cmd;     // ENTRYPOINT сбрасывает CMD базового образа
          }
          layers.push({ createdBy: historyText(step), size: 0, created: now() });
          continue;
        }
        case 'EXPOSE':
          config.ExposedPorts = [...new Set([...(config.ExposedPorts ?? []), ...step.expanded.split(/\s+/).map((port) => (port.includes('/') ? port : `${port}/tcp`))])];
          layers.push({ createdBy: `EXPOSE map[${config.ExposedPorts.map((port) => `${port}:{}`).join(' ')}]`, size: 0, created: now() });
          continue;
        case 'USER':
          config.User = step.expanded;
          layers.push({ createdBy: `USER ${step.expanded}`, size: 0, created: now() });
          continue;
        case 'LABEL':
          config.Labels = { ...(config.Labels ?? {}), ...Object.fromEntries(pairs(step.expanded)) };
          layers.push({ createdBy: `LABEL ${step.expanded}`, size: 0, created: now() });
          continue;
        case 'VOLUME':
          config.Volumes = [...new Set([...(config.Volumes ?? []), ...(jsonForm(step.expanded) ?? step.expanded.split(/\s+/))])];
          layers.push({ createdBy: `VOLUME [${config.Volumes.join(' ')}]`, size: 0, created: now() });
          continue;
        case 'STOPSIGNAL':
          config.StopSignal = step.expanded;
          continue;
        case 'HEALTHCHECK':
          config.Healthcheck = step.expanded;
          layers.push({ createdBy: `HEALTHCHECK ${step.expanded}`, size: 0, created: now() });
          continue;
        default:
          break;
      }
      // шаги со слоями: WORKDIR, COPY, ADD, RUN
      k += 1;
      const title = `#${vertex} ${label(k, stepCount)} ${step.cmd} ${step.args}`.replace(/\s+/g, ' ');
      let size = 0;
      let stepKey;
      let apply;
      if (step.cmd === 'WORKDIR') {
        const dir = normalize(step.expanded, config.WorkingDir || '/');
        stepKey = hexHash(`${key}|WORKDIR ${dir}`);
        size = 8192;
        apply = () => fs.mkdirAs(dir, 'root');
        config.WorkingDir = dir;
      } else if (step.cmd === 'COPY' || step.cmd === 'ADD') {
        const words = step.expanded.split(/\s+/);
        const flags = words.filter((word) => word.startsWith('--'));
        const plain = words.filter((word) => !word.startsWith('--'));
        const from = flags.find((flag) => flag.startsWith('--from='))?.slice(7);
        const chown = flags.find((flag) => flag.startsWith('--chown='))?.slice(8).split(':')[0];
        const dest = plain.at(-1);
        const sources = plain.slice(0, -1);
        const fromStage = from === undefined ? null : (/^\d+$/.test(from) ? Number(from) : all.findIndex((other) => other.name === from));
        const picked = {};
        if (from !== undefined) {
          const source = built[fromStage];
          if (!source) throw new BuildError(`failed to compute cache key: stage "${from}" not found`, step.line);
          for (const src of sources) {
            const abs = normalize(src, source.config.WorkingDir || '/');
            try {
              picked[src] = source.fs.as('root', () => source.fs.lookup(abs));
            } catch (e) {
              throw copyError(`"${abs}": not found`, src, step, title, vertex);
            }
          }
        } else {
          for (const src of sources) {
            const rel = normalize(src, '/').slice(1);
            const matches = rel === '' ? Object.keys(context).filter((path) => !path.includes('/'))
              : Object.keys(context).filter((path) => path === rel || globRegex(rel).test(path) && !path.slice(rel.length).includes('/') || path === rel);
            if (!matches.length || (rel && !context[rel] && !matches.some((path) => globRegex(rel).test(path)))) {
              throw copyError(`"/${rel}": not found`, src, step, title, vertex);
            }
            if (rel === '') for (const path of Object.keys(context)) picked[path] = context[path];
            else for (const path of matches) picked[path] = context[path];
          }
        }
        const nodes = Object.values(picked);
        stepKey = hexHash(`${key}|${step.text}|${from === undefined ? fileHash(picked) : `${fromStage}:${built[fromStage].key}`}`);
        size = from !== undefined ? nodes.reduce((sum, node) => sum + treeSize(node), 0) : copySize(nodes);
        apply = () => copyInto(fs, picked, sources, dest, config.WorkingDir || '/', chown, from !== undefined);
      } else {
        // RUN: ключ — инструкция и переменные сборки (ARG/ENV влияют на результат)
        stepKey = hexHash(`${key}|${step.text}|${JSON.stringify(vars)}`);
        const stageBase = baseRef;
        apply = (options) => runStep(fs, step, config, vars, stageBase, options);
      }
      const cached = !opts.noCache && state.buildCache[stepKey];
      if (cached) {
        out.push(title, `#${vertex} CACHED`, '');
        size = cached.size;
        apply({ replay: true });
        layers.push({ createdBy: historyText(step), size, created: cached.created });
      } else {
        const done = apply() ?? {};
        if (step.cmd === 'RUN') anyRun = true;
        if (done.code) {
          const lines = done.lines ?? [];
          throw new BuildError(`process "/bin/sh -c ${step.expanded}" did not complete successfully: exit code: ${done.code}`, step.line,
            [title, ...lines.map((line) => `#${vertex} ${line}`), `#${vertex} ERROR: process "/bin/sh -c ${step.expanded}" did not complete successfully: exit code: ${done.code}`],
            step);
        }
        size = done.size ?? size;
        out.push(title, ...(done.lines ?? []).map((line) => `#${vertex} ${line}`), `#${vertex} DONE ${step.cmd === 'RUN' ? (done.time ?? 0.3).toFixed(1) : step.cmd === 'WORKDIR' ? '0.0' : '0.1'}s`, '');
        state.buildCache[stepKey] = { size, created: now() };
        layers.push({ createdBy: historyText(step), size, created: now() });
      }
      key = stepKey;
      vertex += 1;
    }
    built[index] = { fs, config, layers, key, baseRef };
  }
  const final = built[targetIndex];
  const manifest = hexHash(`manifest-list:${final.key}:${JSON.stringify(final.config)}`);
  const exporting = vertex;
  const tags = opts.tags.map(normalizeRef);
  out.push(`#${exporting} exporting to image`, `#${exporting} exporting layers ${anyRun ? '0.4s ' : ''}done`,
    `#${exporting} exporting manifest sha256:${hexHash(`manifest:${final.key}`)} done`,
    `#${exporting} exporting config sha256:${hexHash(`config:${final.key}`)} done`,
    `#${exporting} exporting attestation manifest sha256:${hexHash(`attest:${final.key}:${now()}`)} 0.0s done`,
    `#${exporting} exporting manifest list sha256:${manifest} done`,
    ...tags.map((tag) => `#${exporting} naming to docker.io/library/${tag} done`),
    ...tags.map((tag) => `#${exporting} unpacking to docker.io/library/${tag} 0.0s done`),
    `#${exporting} DONE ${anyRun ? '0.5' : '0.1'}s`);
  // образ
  const base = catalogImage(final.baseRef);
  const added = final.layers.filter((layer) => !layer.base).reduce((sum, layer) => sum + layer.size, 0);
  const baseImage = Object.values(state.images).find((image) => image.base === final.baseRef && !image.built)
    ?? addCatalogImage({ images: {} }, final.baseRef);
  const image = {
    id: manifest,
    tags: [],
    base: final.baseRef,
    built: true,
    created: now(),
    disk: baseImage.disk + Math.round(added * 1.19),
    content: baseImage.content + Math.round(added * 0.145),
    config: final.config,
    layers: final.layers,
    fs: packNode(final.fs.root),
  };
  void base;
  for (const other of Object.values(state.images)) other.tags = other.tags.filter((tag) => !tags.includes(tag));
  state.images[image.id] = { ...(state.images[image.id] ?? {}), ...image, tags: [...new Set([...(state.images[image.id]?.tags ?? []), ...tags])] };
  for (const [id, other] of Object.entries(state.images)) {
    // старый образ без имён и без контейнеров — «висячий» (<none>), как после пересборки
    if (id !== image.id && !other.tags.length && other.built && !state.containers.some((c) => c.imageId === id)) other.dangling = true;
  }
  return { log: out, image: state.images[image.id] };
}

/** COPY: нет файла в контексте или этапе — ошибка с заголовком шага, как у BuildKit. */
function copyError(what, src, step, title, vertex) {
  const ref = `${hexHash(`ref:${src}`, 36)}::${hexHash(`ref2:${src}`, 25)}`;
  return new BuildError(`failed to compute cache key: failed to calculate checksum of ref ${ref}: ${what}`, step.line,
    [title, `#${vertex} ERROR: failed to calculate checksum of ref ${ref}: ${what}`]);
}

function treeSize(node) {
  if (node.type !== 'dir') return Math.max(4096, Math.ceil((node.size ?? 0) / 4096) * 4096);
  return [...node.children.values()].reduce((sum, child) => sum + treeSize(child), 4096);
}

/** История базового образа (верхние шаги) — для docker history. */
export function baseHistory(info, image) {
  const created = Date.parse(info?.created ?? '2026-11-05T08:00:30Z');
  const cmd = image.config.Cmd ? [{ createdBy: `CMD [${image.config.Cmd.map((word) => JSON.stringify(word)).join(' ')}]`, size: 0, created, base: true }] : [];
  return [
    { createdBy: `# debian.sh --arch 'amd64' out/ '${info?.os ?? 'trixie'}' '@1763337600'`, size: Math.round(image.content * 0.6), created: created - 14 * 86400000, base: true },
    { createdBy: `ENV PATH=${(image.config.Env ?? []).find((item) => item.startsWith('PATH='))?.slice(5) ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}`, size: 0, created, base: true },
    { createdBy: 'RUN /bin/sh -c set -eux; \tapt-get update; \tapt-get install -y --no-install-recommends \t\tca-certificates \t\tnetbase \t\ttzdata \t; \trm -rf /var/lib/apt/lists/* # buildkit', size: Math.round(image.content * 0.3), created, base: true },
    ...cmd,
  ];
}

/** COPY: файлы из контекста (или этапа) в папку назначения. */
function copyInto(fs, picked, sources, dest, workdir, chown, fromStage) {
  const target = normalize(dest, workdir);
  const toDir = dest.endsWith('/') || dest === '.' || sources.length > 1 || sources.some((src) => src === '.' || src.endsWith('/'));
  const clone = (node) => {
    const copy = { ...node, owner: chown ?? (fromStage ? node.owner : 'root'), group: chown ?? (fromStage ? node.group : 'root'), nlink: 1 };
    if (node.type === 'dir') copy.children = new Map([...node.children].map(([name, child]) => [name, clone(child)]));
    return copy;
  };
  const place = (path, node) => {
    const parent = fs.mkdirAs(path.split('/').slice(0, -1).join('/') || '/', 'root');
    const name = path.split('/').pop();
    if (node.type === 'dir') {
      const existing = parent.children.get(name);
      if (existing?.type === 'dir') {
        for (const [child, value] of node.children) place(`${path}/${child}`, value);
        return;
      }
    }
    parent.children.set(name, clone(node));
  };
  for (const [rel, node] of Object.entries(picked)) {
    if (fromStage) {
      place(toDir ? normalize(rel.split('/').pop(), target) : target, node);
    } else if (sources.some((src) => normalize(src, '/') === '/')) {
      if (node.type === 'dir') fs.mkdirAs(normalize(rel, target), chown ?? 'root');
      else place(normalize(rel, target), node);
    } else {
      place(toDir ? normalize(rel.split('/').pop(), target) : target, node);
    }
  }
}

/** Размеры файлов ФС: путь → «размер:метка» — чтобы посчитать, сколько добавил шаг RUN. */
function sizes(fs) {
  const map = new Map();
  const visit = (path, node) => {
    if (node.type === 'file') map.set(path, [node.size ?? 0, node]);
    if (node.type === 'dir') for (const [name, child] of node.children) visit(`${path}/${name}`, child);
  };
  visit('', fs.root);
  return map;
}

/** RUN: команда в оболочке контейнера сборки (/bin/sh — dash). → {lines, code, size, time}. */
function runStep(fs, step, config, vars, baseRef, { replay = false } = {}) {
  const words = jsonForm(step.expanded);
  const line = words ? words.join(' ') : step.expanded;
  const before = sizes(fs);
  const machine = {
    ...containerMachine({ base: baseRef, id: '000000000000', networks: {}, env: [], procs: [], mounts: [] }),
    notFound: (sh, name) => `/bin/sh: 1: ${name}: not found\n`,
  };
  const shell = new Shell(fs, { cwd: config.WorkingDir || '/', env: { ...vars }, machine, tty: false });
  fs.user = config.User && config.User !== 'root' ? config.User : 'root';
  const result = shell.run(line);
  fs.user = 'root';
  let size = 8192;
  for (const [path, [bytes, node]] of sizes(fs)) {
    const old = before.get(path);
    if (!old || old[1] !== node || old[0] !== bytes) size += Math.max(4096, Math.ceil(bytes / 4096) * 4096);
  }
  if (replay) return {};
  const text = result.chunks.map((chunk) => chunk.text).join('');
  let clock = 0.08;
  const lines = text ? text.replace(/\n$/, '').split('\n').map((item) => {
    clock += 0.09;
    return `${t(clock)} ${item}`.trimEnd();
  }) : [];
  return { lines, code: shell.status, size, time: Math.max(0.1, clock + 0.2) };
}

export { BuildError, humanSize };
