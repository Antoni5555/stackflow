// Учебный Docker для Linux-симулятора. Подключается лениво (engines/linux/docker-loader.js):
// при первой команде docker или на задаче с docker в setup и правилах. Регистрирует
// команду docker, программы образов, ответы контейнеров на curl, setup и правила проверки.

import { now } from '../linux/clock.js';
import { COMMANDS } from '../linux/commands.js';
import { GROUPS, USERS, VirtualFS } from '../linux/fs.js';
import { connectHooks, requestHooks } from '../linux/network.js';
import { ruleHooks } from '../linux/checker.js';
import { docker } from './cli.js';
import { containerCommands, containerOfProc, startContainer, createContainer } from './containers.js';
import { nginxAnswer } from './programs.js';
import { addCatalogImage, dockerState, findImage, randomName } from './state.js';
import { failedDockerRule } from './rules.js';
import { python } from './python.js';
import { psql } from './psql.js';
import { connectHook, networkCommands } from './networks.js';

COMMANDS.docker = docker;

// shop в группе docker — docker без sudo
GROUPS.docker ??= 988;
if (!USERS.shop.groups.includes('docker')) USERS.shop.groups.push('docker');

// --- программы, которые есть только внутри образов ---

Object.assign(containerCommands, {
  python,
  python3: python,
  psql,
  ...networkCommands(),
  sleep: {
    help: 'sleep N — подождать N секунд (в тренажёре не ждёт).',
    run: ({ args }) => (args.length ? {} : { err: "sleep: missing operand\nTry 'sleep --help' for more information.\n", code: 1 }),
  },
  'redis-cli': {
    help: 'redis-cli — клиент Redis: redis-cli ping, redis-cli set ключ значение, redis-cli get ключ.',
    run({ sh, args }) {
      const store = (sh.fs.root.redis ??= {});
      const [cmd = '', ...rest] = args.filter((arg) => !arg.startsWith('-'));
      const name = cmd.toLowerCase();
      if (!cmd) return { out: '(интерактивный redis-cli в тренажёре не запускается — пишите команду сразу: redis-cli ping)\n' };
      if (name === 'ping') return { out: 'PONG\n' };
      if (name === 'set' && rest.length >= 2) {
        store[rest[0]] = rest[1];
        return { out: 'OK\n' };
      }
      if (name === 'get' && rest.length === 1) return { out: rest[0] in store ? `"${store[rest[0]]}"\n` : '(nil)\n' };
      if (name === 'keys') return { out: Object.keys(store).length ? `${Object.keys(store).map((key, k) => `${k + 1}) "${key}"`).join('\n')}\n` : '(empty array)\n' };
      return { out: `(error) ERR unknown command '${cmd}', with args beginning with: ${rest.map((arg) => `'${arg}' `).join('')}\n` };
    },
  },
});

// --- curl к опубликованным портам и к процессам контейнера ---

requestHooks.push((fs, proc, request) => {
  const container = containerOfProc(fs, proc);
  if (!container) return null;
  const port = Number(proc.containerPort ?? request.port);
  if (!(container.listen ?? []).includes(port)) return { error: [56, 'Recv failure: Connection reset by peer'] };
  const program = container.procs[0]?.comm;
  if (program === 'nginx') return nginxAnswer(fs, container, request);
  if (program === 'postgres') return { error: [52, 'Empty reply from server'] };
  return { error: [1, 'Received HTTP/0.9 when not allowed'] };
});

connectHooks.push(connectHook);

// --- setup задачи ---

/**
 * setup.docker: {images: ['postgres:16'], volumes: ['pgdata'], containers: [{name, image,
 * ports: ['8080:80'], env: {K: v} | ['K=v'], volumes: ['pgdata:/var/lib/postgresql/data'],
 * running: true, command: ['sleep', '300']}]}. Образы контейнеров скачиваются сами.
 */
VirtualFS.setupHooks.push((fs, setup) => {
  const spec = setup.docker;
  if (!spec) return;
  const state = dockerState(fs);
  for (const ref of spec.images ?? []) addCatalogImage(state, ref);
  for (const name of spec.volumes ?? []) {
    state.volumes[name] ??= { name, created: now(), data: { type: 'dir', owner: 'root', group: 'root', mode: 0o755, mtime: now(), nlink: 1, children: {} }, labels: null };
  }
  for (const item of spec.containers ?? []) {
    const image = findImage(state, item.image) ?? addCatalogImage(state, item.image);
    const env = Array.isArray(item.env) ? item.env : Object.entries(item.env ?? {}).map(([k, v]) => `${k}=${v}`);
    const ports = (item.ports ?? []).map((text) => {
      const parts = String(text).split(':');
      const [hostIp, hostPort, port] = parts.length === 3 ? parts : ['', parts[0], parts[1] ?? parts[0]];
      return { hostIp, hostPort: String(hostPort), port: String(port) };
    });
    const mounts = (item.volumes ?? []).map((text) => {
      const [source, destination] = text.split(':');
      return source.startsWith('/') || source.startsWith('.')
        ? { type: 'bind', source: source.startsWith('.') ? `${setup.cwd ?? '/home/shop'}/${source}` : source, destination }
        : { type: 'volume', name: source, destination };
    });
    const container = createContainer(fs, image, {
      name: item.name ?? null, imageRef: item.image, cmd: item.command ?? [], entrypoint: null, env, ports, mounts,
      network: item.network ?? null, workdir: null, user: null, hostname: null, tty: false, interactive: false,
      autoRemove: false, restart: item.restart ?? 'no',
    });
    container.name ??= randomName(state, container.id);
    if (item.running !== false) startContainer(fs, container);
  }
});

// --- правила проверки ---

ruleHooks.push(failedDockerRule);

export { docker };
