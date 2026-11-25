// Состояние учебного Docker: образы, контейнеры, тома, сети — в корне ФС сервера
// (fs.root.docker), поэтому сохраняются вместе с файлами. ФС контейнера и данные тома
// хранятся упакованными (как VirtualFS.toJSON), при работе внутри контейнера — распаковываются.

import { now } from '../linux/clock.js';
import { FsError, VirtualFS, basename, dirname, normalize } from '../linux/fs.js';
import { systemState } from '../linux/system.js';
import { OS, catalogImage, hexHash, imageId, normalizeRef } from './catalog.js';
import { parseHumanSize } from './format.js';

export const BRIDGE_SUBNET = '172.17';

/** Состояние Docker (создаётся при первом обращении). */
export function dockerState(fs) {
  fs.root.docker ??= {
    images: {},
    containers: [],
    volumes: {},
    networks: {
      bridge: { id: hexHash('network:bridge'), name: 'bridge', driver: 'bridge', subnet: BRIDGE_SUBNET, created: now() - 3 * 24 * 3600 * 1000, builtin: true },
      host: { id: hexHash('network:host'), name: 'host', driver: 'host', created: now() - 3 * 24 * 3600 * 1000, builtin: true },
      none: { id: hexHash('network:none'), name: 'none', driver: 'null', created: now() - 3 * 24 * 3600 * 1000, builtin: true },
    },
    counter: 0,
  };
  return fs.root.docker;
}

/** Новый 64-символьный ID (контейнер, том): разный у каждого объекта. */
export function newId(state, kind) {
  state.counter += 1;
  return hexHash(`${kind}:${state.counter}:${now()}`);
}

// --- образы ---

/** Образ из каталога → запись состояния (как после docker pull). */
export function addCatalogImage(state, ref) {
  const image = catalogImage(ref);
  if (!image) return null;
  const id = imageId(image);
  const tag = normalizeRef(ref);
  state.images[id] ??= {
    id, tags: [], base: image.ref, created: Date.parse(image.created),
    disk: parseHumanSize(image.disk), content: parseHumanSize(image.content), config: image.config,
  };
  // тег переезжает с другого образа на этот (как docker pull / docker tag)
  for (const other of Object.values(state.images)) other.tags = other.tags.filter((item) => item !== tag);
  state.images[id].tags.push(tag);
  return state.images[id];
}

/** Образ по ссылке (nginx:1.27), по ID или его началу (65645c7bb6a0) — или null. */
export function findImage(state, ref) {
  const tag = normalizeRef(ref);
  const images = Object.values(state.images);
  return images.find((image) => image.tags.includes(tag))
    ?? (/^(sha256:)?[0-9a-f]{4,64}$/.test(ref)
      ? images.find((image) => image.id.startsWith(ref.replace(/^sha256:/, ''))) : null)
    ?? null;
}

/** Каталожный образ, от которого сделан этот (для собственных — база FROM). */
export const imageInfo = (image) => catalogImage(image.base);

// --- контейнеры ---

/** Контейнер по имени, ID или началу ID — или null. */
export function findContainer(state, ref) {
  const name = ref.replace(/^\//, '');
  return state.containers.find((c) => c.name === name)
    ?? (/^[0-9a-f]+$/.test(ref) ? state.containers.find((c) => c.id.startsWith(ref)) : null)
    ?? null;
}

export const shortId = (id) => id.slice(0, 12);

const ADJECTIVES = ['admiring', 'affectionate', 'brave', 'clever', 'eager', 'elegant', 'festive', 'focused', 'gifted', 'happy', 'jolly', 'keen', 'loving', 'modest', 'nifty', 'quirky', 'serene', 'sharp', 'tender', 'vibrant'];
const SURNAMES = ['albattani', 'bell', 'curie', 'darwin', 'einstein', 'euler', 'feynman', 'galileo', 'hopper', 'kepler', 'lovelace', 'meitner', 'newton', 'noether', 'pascal', 'ritchie', 'shannon', 'tesla', 'torvalds', 'turing'];

/** Случайное имя, как у Docker: festive_hopper. */
export function randomName(state, id) {
  const n = parseInt(id.slice(0, 8), 16);
  for (let k = 0; ; k += 1) {
    const name = `${ADJECTIVES[(n + k) % ADJECTIVES.length]}_${SURNAMES[Math.floor((n + k * 7) / 20) % SURNAMES.length]}`;
    if (!state.containers.some((c) => c.name === name)) return name;
  }
}

/** Свободный IP в сети: 172.17.0.2, 172.17.0.3… */
export function freeIp(state, network) {
  const taken = new Set(state.containers.filter((c) => c.status === 'running').flatMap((c) => Object.entries(c.networks ?? {})
    .filter(([name]) => name === network.name).map(([, info]) => info.ip)));
  for (let n = 2; ; n += 1) {
    const ip = `${network.subnet}.0.${n}`;
    if (!taken.has(ip)) return ip;
  }
}

// --- ФС: упаковка узлов ---

/** Узел ФС → обычный объект (как VirtualFS.toJSON); skip — узлы-точки монтирования. */
export function packNode(node, skip = new Set()) {
  if (skip.has(node)) return { type: 'dir', owner: 'root', group: 'root', mode: 0o755, mtime: node.mtime, nlink: 1, children: {} };
  const { children, ...rest } = node;
  if (node.type !== 'dir') return { ...rest };
  return { ...rest, children: Object.fromEntries([...children].map(([name, child]) => [name, packNode(child, skip)])) };
}

export function unpackNode(raw) {
  const node = { ...raw, nlink: 1 };
  if (raw.type === 'dir') {
    node.children = new Map(Object.entries(raw.children ?? {}).map(([name, child]) => [name, unpackNode(child)]));
  }
  return node;
}

const emptyDir = (owner = 'root', mode = 0o755) => ({
  type: 'dir', owner, group: owner, mode, mtime: now(), nlink: 1, children: new Map(),
});

/** Пустая папка тома (упакованная). */
export const emptyVolumeData = () => packNode(emptyDir());

/** ФС нового контейнера: скелет дистрибутива образа + файлы образа. */
export function imageFs(image, id) {
  // собранный образ: его ФС уже готова, меняется только имя хоста
  if (image.fs) {
    const own = new VirtualFS();
    own.root = unpackNode(image.fs);
    own.user = 'root';
    own.writeFile('/etc/hostname', `${shortId(id)}\n`);
    return packNode(own.root);
  }
  const info = imageInfo(image);
  const fs = new VirtualFS();
  fs.root = emptyDir();
  fs.user = 'root';
  for (const dir of ['/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/media', '/mnt', '/opt', '/proc',
    '/run', '/sbin', '/srv', '/sys', '/usr/bin', '/usr/local/bin', '/usr/sbin', '/var/log', '/var/lib']) {
    fs.mkdirAs(dir, 'root');
  }
  fs.mkdirAs('/root', 'root').mode = 0o700;
  fs.mkdirAs('/tmp', 'root').mode = 0o1777;
  fs.lookup('/dev').children.set('null', { type: 'file', special: 'null', owner: 'root', group: 'root', mode: 0o666, mtime: now(), nlink: 1, content: '', size: 0 });
  const write = (path, text) => {
    fs.mkdirAs(dirname(path), 'root');
    fs.writeFile(path, text);
  };
  write('/etc/os-release', OS[info?.os] ?? OS.trixie);
  write('/etc/hostname', `${shortId(id)}\n`);
  for (const [path, text] of Object.entries(info?.files ?? {})) {
    if (text === null) fs.mkdirAs(path, 'root');
    else write(path, text);
  }
  if (info?.program === 'nginx') {
    // в образе логи nginx — ссылки на вывод контейнера (docker logs)
    fs.mkdirAs('/var/log/nginx', 'root');
    fs.symlink('/dev/stdout', '/var/log/nginx/access.log');
    fs.symlink('/dev/stderr', '/var/log/nginx/error.log');
    // IPv6-строку дописывает скрипт entrypoint при первом старте
    write('/etc/nginx/conf.d/default.conf', fs.readFile('/etc/nginx/conf.d/default.conf').replace('    listen  [::]:80;\n', ''));
  }
  for (const [path, text] of Object.entries(image.files ?? {})) write(path, text);
  const workdir = image.config.WorkingDir;
  if (workdir) fs.mkdirAs(workdir, 'root');
  return packNode(fs.root);
}

/**
 * Поработать с ФС контейнера: распаковать, подключить тома и папки хоста (bind), выполнить
 * fn(fs), упаковать обратно. Тома и bind — те же данные, что видят другие контейнеры и хост.
 * keep: true — не упаковывать (вложенная оболочка docker exec -it: упакует sync()).
 */
export function openContainerFs(hostFs, container) {
  const state = dockerState(hostFs);
  const fs = new VirtualFS();
  fs.root = unpackNode(container.fs);
  fs.user = 'root';
  const mounted = [];
  for (const mount of container.mounts ?? []) {
    let node;
    if (mount.type === 'volume') {
      const volume = state.volumes[mount.name];
      if (!volume) continue;
      node = unpackNode(volume.data);
    } else {
      // папки хоста нет — Docker создаёт её (владелец root)
      node = hostFs.as('root', () => hostFs.mkdirAs(mount.source, 'root'));
    }
    const parent = fs.mkdirAs(dirname(mount.destination), 'root');
    parent.children.set(basename(mount.destination), node);
    mounted.push({ mount, node });
  }
  const sync = () => {
    const skip = new Set(mounted.map(({ node }) => node));
    container.fs = packNode(fs.root, skip);
    for (const { mount, node } of mounted) {
      if (mount.type === 'volume' && state.volumes[mount.name]) state.volumes[mount.name].data = packNode(node);
    }
  };
  return { fs, sync };
}

/** Выполнить fn(fs контейнера) и сохранить изменения. */
export function withContainerFs(hostFs, container, fn) {
  const { fs, sync } = openContainerFs(hostFs, container);
  try {
    return fn(fs);
  } finally {
    sync();
  }
}

/** Файл в ФС контейнера (с учётом томов) — или null. */
export function readContainerFile(hostFs, container, path) {
  return withContainerFs(hostFs, container, (fs) => {
    try {
      return fs.readFile(normalize(path));
    } catch (e) {
      if (e instanceof FsError) return null;
      throw e;
    }
  });
}

// --- порты на хосте ---

/** Процессы docker-proxy на хосте — опубликованные порты запущенных контейнеров. */
export function syncProxies(hostFs) {
  const state = dockerState(hostFs);
  const system = systemState(hostFs);
  system.procs = system.procs.filter((proc) => proc.comm !== 'docker-proxy');
  for (const container of state.containers.filter((c) => c.status === 'running')) {
    for (const port of container.ports ?? []) {
      const ip = Object.values(container.networks)[0]?.ip ?? '';
      const listen = port.hostIp ? [`${port.hostIp}:${port.hostPort}`] : [`0.0.0.0:${port.hostPort}`, `[::]:${port.hostPort}`];
      for (const address of listen) {
        const v6 = address.startsWith('[');
        system.procs.push({
          pid: system.nextPid, user: 'root', comm: 'docker-proxy', started: container.startedAt,
          cmd: `/usr/bin/docker-proxy -proto tcp -host-ip ${v6 ? '::' : address.split(':')[0]} -host-port ${port.hostPort} -container-ip ${ip} -container-port ${port.port} -use-listen-fd`,
          listen: [address], container: container.id, containerPort: port.port,
        });
        system.nextPid += 2;
      }
    }
  }
}

/** Кто на хосте уже слушает порт (другие процессы, контейнеры) — для «port is already allocated». */
export function hostPortBusy(hostFs, hostIp, hostPort, exceptContainer = null) {
  const system = systemState(hostFs);
  return system.procs.some((proc) => proc.container !== exceptContainer && (proc.listen ?? []).some((address) => {
    const match = /^(?:\[([^\]]*)\]|([^:]*)):(\d+)$/.exec(address);
    if (!match || Number(match[3]) !== Number(hostPort)) return false;
    const host = match[1] !== undefined ? '::' : match[2];
    return !hostIp || host === '0.0.0.0' || host === '::' || host === hostIp;
  }));
}
