// Жизнь контейнера: создать, запустить, остановить, удалить; оболочка внутри (docker exec).

import { now } from '../linux/clock.js';
import { COMMANDS } from '../linux/commands.js';
import { FsError, normalize } from '../linux/fs.js';
import { Shell } from '../linux/shell.js';
import { catalogImage } from './catalog.js';
import { programOf, startProgram, stopProgram } from './programs.js';
import {
  dockerState, emptyVolumeData, freeIp, imageFs, newId, openContainerFs, shortId, syncProxies,
  withContainerFs,
} from './state.js';

/** Создать контейнер (docker create / первая половина docker run). */
export function createContainer(hostFs, image, options) {
  const state = dockerState(hostFs);
  const id = newId(state, 'container');
  const config = image.config;
  const info = catalogImage(image.base);
  const network = state.networks[options.network ?? 'bridge'];
  const env = [
    ...config.Env.filter((item) => item.startsWith('PATH=')),
    `HOSTNAME=${options.hostname ?? shortId(id)}`,
    ...options.env,
    ...config.Env.filter((item) => !item.startsWith('PATH=') && !options.env.some((own) => own.split('=')[0] === item.split('=')[0])),
    'HOME=/root',
  ];
  const mounts = [...options.mounts];
  // VOLUME из образа (данные postgres) без своего тома — анонимный том
  for (const path of config.Volumes ?? []) {
    if (mounts.some((mount) => mount.destination === path)) continue;
    const name = newId(state, 'volume');
    state.volumes[name] = { name, created: now(), anonymous: true, data: emptyVolumeData(), labels: { 'com.docker.volume.anonymous': '' } };
    mounts.push({ type: 'volume', name, destination: path, anonymous: true });
  }
  for (const mount of mounts.filter((item) => item.type === 'volume')) {
    state.volumes[mount.name] ??= { name: mount.name, created: now(), data: emptyVolumeData(), labels: null };
  }
  const container = {
    id,
    name: options.name,
    image: options.imageRef,
    imageId: image.id,
    base: image.base,
    created: now(),
    status: 'created',
    exitCode: 0,
    entrypoint: options.entrypoint ?? config.Entrypoint ?? [],
    cmd: options.cmd.length ? options.cmd : (options.entrypoint ? [] : config.Cmd ?? []),
    env,
    ports: options.ports,
    mounts,
    networks: network ? { [network.name]: { ip: network.driver === 'bridge' ? freeIp(state, network) : '' } } : {},
    wantedNetwork: options.network ?? 'bridge',
    workdir: options.workdir ?? config.WorkingDir ?? '',
    user: options.user ?? config.User ?? '',
    tty: options.tty,
    interactive: options.interactive,
    autoRemove: options.autoRemove,
    restart: options.restart ?? 'no',
    logs: [],
    procs: [],
    fs: imageFs(image, id),
  };
  if (!info) container.program = null;
  state.containers.push(container);
  return container;
}

/** Слова главного процесса: entrypoint образа (docker-entrypoint.sh) передаёт команду дальше. */
export function mainWords(container) {
  const own = container.entrypoint.filter((word) => !/docker-entrypoint\.sh$/.test(word));
  return [...own, ...container.cmd];
}

/** Строка COMMAND в docker ps: entrypoint + cmd. */
export const commandLine = (container) => [...container.entrypoint, ...container.cmd].join(' ');

const SHELLS = new Set(['bash', 'sh', 'ash', '/bin/bash', '/bin/sh', '/bin/ash', '/usr/bin/bash']);
export const isShell = (word) => SHELLS.has(word);

/** Есть ли программа в контейнере: команда образа или файл по пути. */
export function hasExecutable(hostFs, container, word) {
  if (!word) return false;
  const info = catalogImage(container.base);
  const name = word.split('/').pop();
  if (word.includes('/')) {
    return withContainerFs(hostFs, container, (fs) => fs.exists(normalize(word)))
      || (isShell(word) && (info?.commands ?? []).includes(name));
  }
  return (info?.commands ?? []).includes(name) || name in containerCommands;
}

/** Команды, которых нет на сервере, но есть в образах (psql, redis-cli…) — регистрирует index.js. */
export const containerCommands = {};

/** Машина для оболочки контейнера (см. Shell.machine). */
export function containerMachine(container, { nested = false } = {}) {
  const info = catalogImage(container.base);
  const alpine = info?.os?.startsWith('alpine');
  const commands = (info?.commands ?? []).filter((name) => name in COMMANDS || name in containerCommands);
  const ip = Object.values(container.networks)[0]?.ip ?? '';
  return {
    host: shortId(container.id),
    ip,
    container: container.id,
    commands,
    extra: Object.fromEntries(Object.entries(containerCommands).filter(([name]) => (info?.commands ?? []).includes(name))),
    env: true,
    nested,
    notFound: (sh, name) => (alpine ? `sh: ${name}: not found\n` : `bash: ${sh.scriptName ? `line ${sh.line}: ` : ''}${name}: command not found\n`),
    prompt: (sh) => {
      let where = sh.cwd;
      if (where === '/root') where = '~';
      else if (where.startsWith('/root/')) where = `~${where.slice(5)}`;
      return alpine ? `${where} # ` : `${sh.user}@${shortId(container.id)}:${where}# `;
    },
  };
}

/** Оболочка внутри контейнера: своя ФС (с томами), окружение контейнера, процессы контейнера. */
export function containerShell(hostFs, container, { env = [], workdir = null, nested = false, tty = false } = {}) {
  const { fs, sync } = openContainerFs(hostFs, container);
  fs.root.system = {
    nextPid: 40 + (container.execs ?? 0) * 7, boot: container.startedAt ?? now(), services: {}, journal: [],
    procs: container.procs.map((proc) => ({ ...proc, started: container.startedAt })),
  };
  container.execs = (container.execs ?? 0) + 1;
  const vars = Object.fromEntries([...container.env, ...env].map((item) => {
    const eq = item.indexOf('=');
    return [item.slice(0, eq), item.slice(eq + 1)];
  }));
  let cwd = normalize(workdir || container.workdir || '/');
  if (!fs.exists(cwd)) cwd = '/';
  const shell = new Shell(fs, { cwd, env: vars, machine: containerMachine(container, { nested }), tty });
  return {
    shell,
    sync: () => {
      const { system } = fs.root;
      delete fs.root.system;
      sync();
      fs.root.system = system;
    },
  };
}

/** Выполнить слова команды в контейнере (не интерактивно) → {chunks, code}. */
export function runInContainer(hostFs, container, words, options = {}) {
  const { shell, sync } = containerShell(hostFs, container, options);
  try {
    const result = shell.exec(words, '', { tty: options.tty });
    const chunks = result.chunks ?? [
      ...(result.out ? [{ text: result.out, err: false }] : []),
      ...(result.err ? [{ text: result.err, err: true }] : []),
    ];
    return { chunks, code: result.code };
  } finally {
    sync();
  }
}

const IDLE = (words) => (words[0] === 'sleep' && words.length > 1)
  || (words[0] === 'tail' && words.includes('-f'));

/**
 * Запустить контейнер. Возвращает:
 * {error} — не запустился (порт занят и т.п., остаётся Created);
 * {running: true} — работает; {exitCode} — главный процесс сразу завершился;
 * {interactive: 'shell' | 'python'} — нужен терминал (docker run -it).
 */
export function startContainer(hostFs, container) {
  const state = dockerState(hostFs);
  if (container.status === 'running') return { running: true };
  const network = state.networks[container.wantedNetwork];
  if (!network) return { error: `failed to set up container networking: network ${container.wantedNetwork} not found`, code: 1 };
  for (const port of container.ports) {
    const busy = state.containers.find((other) => other !== container && other.status === 'running'
      && other.ports.some((item) => String(item.hostPort) === String(port.hostPort)
        && (!item.hostIp || !port.hostIp || item.hostIp === port.hostIp)));
    const endpoint = newId(state, 'endpoint');
    if (busy) {
      return { error: `failed to set up container networking: driver failed programming external connectivity on endpoint ${container.name} (${endpoint}): Bind for ${port.hostIp || '0.0.0.0'}:${port.hostPort} failed: port is already allocated` };
    }
    if (hostPortTaken(hostFs, port)) {
      return { error: `failed to set up container networking: driver failed programming external connectivity on endpoint ${container.name} (${endpoint}): failed to bind host port ${port.hostIp || '0.0.0.0'}:${port.hostPort}/tcp: address already in use` };
    }
  }
  // IP — на время работы: занят другим запущенным контейнером — новый
  for (const [name, info] of Object.entries(container.networks)) {
    const net = state.networks[name];
    const clash = state.containers.some((other) => other !== container && other.status === 'running'
      && other.networks[name]?.ip === info.ip);
    if (net?.subnet && (clash || !info.ip)) info.ip = freeIp(state, net);
  }
  const first = !container.startedAt;
  const words = mainWords(container);
  const program = programOf(container);
  if (!program && !hasExecutable(hostFs, container, words[0])) {
    container.exitCode = 127;
    return { error: `failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: exec: "${words[0]}": executable file not found in $PATH`, code: 127 };
  }
  container.startedAt = now();
  container.status = 'running';
  container.exitCode = 0;
  container.idle = false;
  if (program) {
    const result = startProgram(hostFs, container, { first });
    if (result.exit !== undefined) return finish(hostFs, container, result.exit);
    container.procs = result.procs;
    container.listen = result.listen;
    syncProxies(hostFs);
    return { running: true };
  }
  const name = words[0]?.split('/').pop();
  if (container.interactive && container.tty && isShell(words[0])) {
    container.procs = [{ pid: 1, user: 'root', comm: name, cmd: words.join(' '), tty: 'pts/0' }];
    syncProxies(hostFs);
    return { running: true, interactive: 'shell' };
  }
  if (name === 'python3' || name === 'python') {
    // python3 без терминала читает пустой ввод и сразу выходит; с -it — интерактивный Python
    if (words.length === 1) return { ...finish(hostFs, container, 0), interactive: container.tty ? 'python' : null };
  }
  if (IDLE(words) || (isShell(words[0]) && words.length === 1 && container.interactive)) {
    container.idle = true;
    container.procs = [{ pid: 1, user: 'root', comm: name, cmd: words.join(' ') }];
    syncProxies(hostFs);
    return { running: true };
  }
  // обычная команда: выполняется, вывод — в логи, контейнер завершается с её кодом
  const result = runInContainer(hostFs, container, words);
  let time = now();
  for (const chunk of result.chunks) {
    for (const line of chunk.text.replace(/\n$/, '').split('\n')) {
      time += 1;
      container.logs.push({ t: time, err: chunk.err, text: line });
    }
  }
  return finish(hostFs, container, result.code);
}

function hostPortTaken(hostFs, port) {
  const procs = hostFs.root.system?.procs ?? [];
  return procs.some((proc) => proc.comm !== 'docker-proxy' && (proc.listen ?? []).some((address) => {
    const match = /:(\d+)$/.exec(address);
    if (!match || match[1] !== String(port.hostPort)) return false;
    const host = address.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return !port.hostIp || ['0.0.0.0', '::', '*'].includes(host) || host === port.hostIp
      || (port.hostIp === '0.0.0.0');
  }));
}

/** Главный процесс завершился с кодом code. */
export function finish(hostFs, container, code) {
  container.status = 'exited';
  container.exitCode = code;
  container.finishedAt = now();
  container.procs = [];
  container.listen = [];
  syncProxies(hostFs);
  return { exitCode: code };
}

/** Остановить (docker stop): логи остановки, код выхода. */
export function stopContainer(hostFs, container) {
  if (container.status !== 'running') return;
  const code = stopProgram(container);
  finish(hostFs, container, code);
}

/** Удалить контейнер; volumes — и его анонимные тома (docker rm -v, --rm). */
export function removeContainer(hostFs, container, { volumes = false } = {}) {
  const state = dockerState(hostFs);
  state.containers = state.containers.filter((item) => item !== container);
  if (volumes) {
    for (const mount of container.mounts.filter((item) => item.anonymous)) delete state.volumes[mount.name];
  }
  syncProxies(hostFs);
}

/** Контейнер, который отвечает за процесс-слушатель (docker-proxy) — для curl. */
export function containerOfProc(hostFs, proc) {
  return dockerState(hostFs).containers.find((c) => c.id === proc.container) ?? null;
}

export { FsError };
