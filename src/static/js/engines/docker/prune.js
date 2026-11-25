// Обслуживание учебного Docker: docker system df и очистка — container/image/volume/network/
// builder/system prune с -a, -f, --volumes и --filter label=…, until=…. Вопросы и тексты —
// как у Docker 29 (сверено с docker CLI; ответ в тренажёре — -f или echo y |).

import { now } from '../linux/clock.js';
import { hexHash } from './catalog.js';
import { humanSize as human, table } from './format.js';

// prune и system df печатают 4 значащие цифры: 4.096kB, 606.2kB
const humanSize = (bytes) => human(bytes, 4);
import { forgetVolume } from './psql.js';
import { dockerState, shortId } from './state.js';

const out = (text) => ({ text, err: false });
const err = (text) => ({ text, err: true });

const QUESTIONS = {
  container: 'WARNING! This will remove all stopped containers.\nAre you sure you want to continue? [y/N] ',
  image: 'WARNING! This will remove all dangling images.\nAre you sure you want to continue? [y/N] ',
  imageAll: 'WARNING! This will remove all images without at least one container associated to them.\nAre you sure you want to continue? [y/N] ',
  volume: 'WARNING! This will remove anonymous local volumes not used by at least one container.\nAre you sure you want to continue? [y/N] ',
  volumeAll: 'WARNING! This will remove all local volumes not used by at least one container.\nAre you sure you want to continue? [y/N] ',
  network: 'WARNING! This will remove all custom networks not used by at least one container.\nAre you sure you want to continue? [y/N] ',
  builder: 'WARNING! This will remove all dangling build cache. Are you sure you want to continue? [y/N] ',
  builderAll: 'WARNING! This will remove all build cache. Are you sure you want to continue? [y/N] ',
};

function systemQuestion(all, volumes) {
  const items = ['all stopped containers', 'all networks not used by at least one container'];
  if (volumes) items.push('all anonymous volumes not used by at least one container');
  items.push(all ? 'all images without at least one container associated to them' : 'all dangling images');
  items.push(all ? 'all build cache' : 'unused build cache');
  return `WARNING! This will remove:\n${items.map((item) => `  - ${item}`).join('\n')}\n\nAre you sure you want to continue? [y/N] `;
}

/** Вопрос без ответа: в настоящем терминале ждёт y; здесь — пометка, как ответить. */
const asked = (question, command) => ({
  chunks: [out(`${question}\n`), err(`(в тренажёре на вопрос не ответить: добавьте -f или echo y | docker ${command})\n`)],
  code: 0,
});

// --- фильтры ---

const UNITS = { s: 1000, m: 60000, h: 3600000 };

/** --filter label=k=v | label=k | label!=k | until=24h → функция(labels, created). */
function filterOf(filters) {
  const checks = filters.map((filter) => {
    const eq = filter.indexOf('=');
    const key = filter.slice(0, eq);
    const value = filter.slice(eq + 1);
    if (key === 'label' || key === 'label!') {
      const [name, ...rest] = value.split('=');
      const want = rest.length ? rest.join('=') : null;
      const match = (labels) => labels && name in labels && (want === null || labels[name] === want);
      return key === 'label' ? (labels) => match(labels) : (labels) => !match(labels);
    }
    if (key === 'until') {
      const m = /^(\d+)([smh])$/.exec(value);
      const limit = m ? now() - Number(m[1]) * UNITS[m[2]] : Date.parse(value);
      return (labels, created) => created < limit;
    }
    return () => true;
  });
  return (labels, created) => checks.every((check) => check(labels, created));
}

function parse(args) {
  const opts = { all: false, force: false, volumes: false, filters: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--filter') opts.filters.push(args[(i += 1)]);
    else if (arg.startsWith('--filter=')) opts.filters.push(arg.slice(9));
    else if (arg === '--volumes') opts.volumes = true;
    else if (arg === '-a' || arg === '--all') opts.all = true;
    else if (arg === '-f' || arg === '--force') opts.force = true;
    else if (/^-[af]+$/.test(arg)) {
      opts.all ||= arg.includes('a');
      opts.force ||= arg.includes('f');
    }
  }
  return opts;
}

// --- размеры ---

/** Слой изменений контейнера: 4 КБ + файлы, которые он записал поверх образа. */
const containerSize = (container) => 4096 + (container.writes ?? 0);

const imageUsed = (state, image) => state.containers.some((c) => c.imageId === image.id);

const imageReclaim = (image) => (image.built
  ? (image.layers ?? []).filter((layer) => !layer.base).reduce((sum, layer) => sum + layer.size, 0) || 12_670
  : image.disk);

// --- prune ---

function pruneContainers(state, opts, hostFs, removeContainer) {
  const match = filterOf(opts.filters);
  const removed = state.containers.filter((c) => c.status !== 'running' && match(c.labels ?? {}, c.created));
  for (const container of removed) removeContainer(hostFs, container);
  return { ids: removed.map((c) => c.id), size: removed.reduce((sum, c) => sum + containerSize(c), 0) };
}

function pruneImages(state, opts) {
  const match = filterOf(opts.filters);
  const removed = Object.values(state.images).filter((image) => !imageUsed(state, image)
    && (opts.all || !image.tags.length) && match(image.config?.Labels ?? {}, image.created));
  const lines = [];
  let size = 0;
  for (const image of removed) {
    for (const tag of image.tags) lines.push(`untagged: ${tag}`);
    lines.push(`deleted: sha256:${image.id}`);
    for (let k = 0; k < 2; k += 1) lines.push(`deleted: sha256:${hexHash(`layer-deleted:${image.id}:${k}`)}`);
    size += imageReclaim(image);
    delete state.images[image.id];
  }
  return { lines, size };
}

function pruneVolumes(state, opts, sizeOf) {
  const match = filterOf(opts.filters);
  const users = (name) => state.containers.some((c) => c.mounts.some((m) => m.type === 'volume' && m.name === name));
  const removed = Object.values(state.volumes).filter((volume) => (opts.all || volume.labels?.['com.docker.volume.anonymous'] !== undefined)
    && !users(volume.name) && match(volume.labels ?? {}, volume.created));
  let size = 0;
  for (const volume of removed) {
    size += sizeOf(volume);
    delete state.volumes[volume.name];
    forgetVolume(volume.name);
  }
  return { names: removed.map((volume) => volume.name), size };
}

function pruneNetworks(state, opts) {
  const match = filterOf(opts.filters);
  const removed = Object.values(state.networks).filter((net) => !net.builtin
    && !state.containers.some((c) => net.name in c.networks) && match(net.labels ?? {}, net.created));
  for (const net of removed) delete state.networks[net.name];
  return removed.map((net) => net.name);
}

function pruneBuilder(state, opts) {
  const entries = Object.entries(state.buildCache ?? {});
  // без -a — «висящий» кэш: шаги, которых нет ни в одном образе; в тренажёре — весь, кроме последней сборки
  const removed = opts.all ? entries : entries.filter(([, entry]) => !entry.inUse);
  for (const [key] of removed) delete state.buildCache[key];
  return { ids: removed.map(([key]) => key.slice(0, 25)), sizes: removed.map(([, entry]) => entry.size), size: removed.reduce((sum, [, entry]) => sum + entry.size, 0) };
}

const total = (size) => `Total reclaimed space: ${size ? humanSize(size) : '0B'}\n`;

/** docker container|image|volume|network|builder|system prune … */
export function prune(ctx, kind, args, { removeContainer, volumeSize }) {
  const state = dockerState(ctx.fs);
  const opts = parse(args);
  const yes = opts.force || /^y/i.test(ctx.stdin ?? '');
  if (kind === 'container') {
    if (!yes) return asked(QUESTIONS.container, 'container prune');
    const done = pruneContainers(state, opts, ctx.fs, removeContainer);
    return { chunks: [out(`${done.ids.length ? `Deleted Containers:\n${done.ids.join('\n')}\n` : ''}${total(done.size)}`)], code: 0 };
  }
  if (kind === 'image') {
    if (!yes) return asked(opts.all ? QUESTIONS.imageAll : QUESTIONS.image, `image prune${opts.all ? ' -a' : ''}`);
    const done = pruneImages(state, opts);
    return { chunks: [out(`${done.lines.length ? `Deleted Images:\n${done.lines.join('\n')}\n` : ''}${total(done.size)}`)], code: 0 };
  }
  if (kind === 'volume') {
    if (!yes) return asked(opts.all ? QUESTIONS.volumeAll : QUESTIONS.volume, `volume prune${opts.all ? ' -a' : ''}`);
    const done = pruneVolumes(state, opts, volumeSize);
    return { chunks: [out(`${done.names.length ? `Deleted Volumes:\n${done.names.join('\n')}\n` : ''}${total(done.size)}`)], code: 0 };
  }
  if (kind === 'network') {
    if (!yes) return asked(QUESTIONS.network, 'network prune');
    const names = pruneNetworks(state, opts);
    return { chunks: names.length ? [out(`Deleted Networks:\n${names.join('\n')}\n`)] : [], code: 0 };
  }
  if (kind === 'builder') {
    if (!yes) return asked(opts.all ? QUESTIONS.builderAll : QUESTIONS.builder, `builder prune${opts.all ? ' -a' : ''}`);
    const done = pruneBuilder(state, opts);
    return { chunks: [out(`${done.ids.length ? `ID\t\t\t\t\t\tRECLAIMABLE\tSIZE\t\tLAST ACCESSED\n${done.ids.map((id, k) => `${id}\ttrue\t\t${humanSize(done.sizes[k])}\t\tLess than a second ago`).join('\n')}\n` : ''}Total:\t${done.size ? humanSize(done.size) : '0B'}\n`)], code: 0 };
  }
  // system prune: контейнеры, сети, образы, (тома), кэш
  if (!yes) return asked(systemQuestion(opts.all, opts.volumes), `system prune${opts.all ? ' -a' : ''}${opts.volumes ? ' --volumes' : ''}`);
  const containers = pruneContainers(state, opts, ctx.fs, removeContainer);
  const networks = pruneNetworks(state, opts);
  const volumes = opts.volumes ? pruneVolumes(state, { ...opts, all: false }, volumeSize) : { names: [], size: 0 };
  const images = pruneImages(state, opts);
  const cache = pruneBuilder(state, { ...opts, all: opts.all });
  let text = '';
  if (containers.ids.length) text += `Deleted Containers:\n${containers.ids.join('\n')}\n\n`;
  if (networks.length) text += `Deleted Networks:\n${networks.join('\n')}\n\n`;
  if (volumes.names.length) text += `Deleted Volumes:\n${volumes.names.join('\n')}\n\n`;
  if (images.lines.length) text += `Deleted Images:\n${images.lines.join('\n')}\n\n`;
  if (cache.ids.length) text += `Deleted build cache objects:\n${cache.ids.join('\n')}\n\n`;
  return { chunks: [out(`${text}${total(containers.size + volumes.size + images.size + cache.size)}`)], code: 0 };
}

// --- system df ---

const percent = (part, whole) => (whole ? ` (${Math.round((part / whole) * 100)}%)` : '');

/** docker system df: образы, контейнеры, тома, кэш сборки. */
export function systemDf(ctx, args, { volumeSize }) {
  const state = dockerState(ctx.fs);
  const images = Object.values(state.images);
  const activeImages = images.filter((image) => imageUsed(state, image));
  const imageSize = images.reduce((sum, image) => sum + image.disk, 0);
  const imageFree = images.filter((image) => !imageUsed(state, image)).reduce((sum, image) => sum + image.disk, 0);
  const containers = state.containers;
  const running = containers.filter((c) => c.status === 'running');
  const containerTotal = containers.reduce((sum, c) => sum + containerSize(c), 0);
  const containerFree = containers.filter((c) => c.status !== 'running').reduce((sum, c) => sum + containerSize(c), 0);
  const volumes = Object.values(state.volumes);
  const mounted = (volume) => containers.some((c) => c.mounts.some((m) => m.type === 'volume' && m.name === volume.name));
  const volumeTotal = volumes.reduce((sum, volume) => sum + volumeSize(volume), 0);
  const volumeFree = volumes.filter((volume) => !mounted(volume)).reduce((sum, volume) => sum + volumeSize(volume), 0);
  const cache = Object.values(state.buildCache ?? {});
  const cacheSize = cache.reduce((sum, entry) => sum + entry.size, 0);
  const size = (bytes) => (bytes ? humanSize(bytes) : '0B');
  if (args.includes('-v') || args.includes('--verbose')) {
    const rows = images.flatMap((image) => (image.tags.length ? image.tags : ['<none>:<none>']).map((tag) => {
      const at = tag.lastIndexOf(':');
      return [tag.slice(0, at), tag.slice(at + 1), shortId(image.id), size(image.disk), String(containers.filter((c) => c.imageId === image.id).length)];
    }));
    const vrows = volumes.map((volume) => [volume.name, String(containers.filter((c) => c.mounts.some((m) => m.name === volume.name)).length), size(volumeSize(volume))]);
    return {
      chunks: [out(`Images space usage:\n\n${table(['REPOSITORY', 'TAG', 'IMAGE ID', 'SIZE', 'CONTAINERS'], rows)}\nContainers space usage:\n\n${table(['CONTAINER ID', 'IMAGE', 'NAMES', 'STATUS'], containers.map((c) => [shortId(c.id), c.image, c.name, c.status]))}\nLocal Volumes space usage:\n\n${table(['VOLUME NAME', 'LINKS', 'SIZE'], vrows)}`)],
      code: 0,
    };
  }
  const rows = [
    ['Images', String(images.length), String(activeImages.length), size(imageSize), `${size(imageFree)}${percent(imageFree, imageSize)}`],
    ['Containers', String(containers.length), String(running.length), size(containerTotal), `${size(containerFree)}${percent(containerFree, containerTotal)}`],
    ['Local Volumes', String(volumes.length), String(volumes.filter(mounted).length), size(volumeTotal), `${size(volumeFree)}${percent(volumeFree, volumeTotal)}`],
    ['Build Cache', String(cache.length), '0', size(cacheSize), size(cacheSize)],
  ];
  return { chunks: [out(table(['TYPE', 'TOTAL', 'ACTIVE', 'SIZE', 'RECLAIMABLE'], rows))], code: 0 };
}
