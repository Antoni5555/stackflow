// Сети и тома учебного Docker: docker network …, docker volume …, имена контейнеров в
// пользовательских сетях (встроенный DNS), localhost внутри контейнера, ping, pg_isready и curl
// между контейнерами. Тексты — как у Docker 29 (уроки 2.01 и 2.03, пробы на Docker 29.10).

import { now } from '../linux/clock.js';
import { humanSize, localIso, table } from './format.js';
import { forgetVolume } from './psql.js';
import { nginxAnswer } from './programs.js';
import { appAnswer } from './apps.js';
import { registryAnswer } from './registry.js';
import { dockerState, findContainer, newId, shortId } from './state.js';
import { hexHash } from './catalog.js';

const out = (text) => ({ text, err: false });
const err = (text) => ({ text, err: true });
const result = (chunks, code = 0) => ({ chunks, code });

// --- адреса: кто есть кто ---

const LOCALHOST = new Set(['localhost', '127.0.0.1', '::1']);

/** Сети с встроенным DNS — все, кроме bridge по умолчанию (и host/none). */
const hasDns = (state, name) => !state.networks[name]?.builtin;

/**
 * Найти адрес host из контейнера self (или с сервера, self = null):
 * {container, ip} — нашли; {self: true} — localhost; null — имя не разрешается.
 */
export function resolve(state, self, host) {
  if (self && LOCALHOST.has(host)) return { container: self, ip: '127.0.0.1', self: true };
  const running = state.containers.filter((c) => c.status === 'running');
  // IP — доступен из любой общей сети (с сервера — любой контейнер на мосту)
  for (const c of running) {
    for (const [name, info] of Object.entries(c.networks)) {
      if (info.ip !== host) continue;
      if (!self || name in self.networks) return { container: c, ip: info.ip };
    }
  }
  if (!self) return null;
  for (const [name] of Object.entries(self.networks).filter(([net]) => hasDns(state, net))) {
    const found = running.find((c) => name in c.networks
      && (c.name === host || c.id.startsWith(host) && host.length >= 12 || (c.networks[name].aliases ?? []).includes(host)));
    if (found) return { container: found, ip: found.networks[name].ip };
  }
  return null;
}

/** HTTP к процессу контейнера (не через опубликованный порт): ответ или ошибка curl. */
export function containerAnswer(hostFs, container, port, request, host, { self = false } = {}) {
  const refused = { error: [7, `Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server`] };
  if (container.status !== 'running' || !(container.listen ?? []).includes(Number(port))) return refused;
  // приложение слушает 127.0.0.1 — снаружи контейнера до него не достучаться
  if (!self && container.bind?.[port] === '127.0.0.1') return refused;
  if (container.app) return appAnswer(hostFs, container, request);
  const program = container.procs[0]?.comm;
  if (program === 'nginx') return nginxAnswer(hostFs, container, { ...request, client: request.client });
  if (program === 'registry') return registryAnswer(hostFs, container, request);
  if (program === 'postgres') return { error: [52, 'Empty reply from server'] };
  return { error: [1, 'Received HTTP/0.9 when not allowed'] };
}

/** Хук curl (engines/linux/network.js): контейнеры по имени, IP, localhost. */
export function connectHook(ctx, request) {
  const hostFs = ctx.sh.machine?.hostFs ?? ctx.fs;
  if (!hostFs.root.docker) return null;
  const state = dockerState(hostFs);
  const self = ctx.sh.machine?.container ? state.containers.find((c) => c.id === ctx.sh.machine.container) : null;
  const found = resolve(state, self, request.host);
  if (!found) return self ? { unresolved: true } : null;
  const client = self ? Object.values(self.networks)[0]?.ip : '172.17.0.1';
  return { ip: found.ip, answer: () => containerAnswer(hostFs, found.container, request.port, { ...request, client }, request.host, { self: Boolean(found.self) }) };
}

/** Команды внутри контейнера, которым нужна сеть. */
export function networkCommands() {
  return {
    ping: {
      help: 'ping -c N адрес — доступен ли контейнер (по имени — только в своей сети).',
      run({ sh, args }) {
        const hostFs = sh.machine?.hostFs;
        const state = dockerState(hostFs);
        const self = state.containers.find((c) => c.id === sh.machine.container);
        let count = 4;
        const positional = [];
        for (let i = 0; i < args.length; i += 1) {
          if (args[i] === '-c') count = Number(args[(i += 1)]) || 1;
          else if (args[i] === '-W' || args[i] === '-w') i += 1;
          else if (!args[i].startsWith('-')) positional.push(args[i]);
        }
        const [host] = positional;
        if (!host) return { err: 'BusyBox v1.36.1 (2024-06-12 22:47:07 UTC) multi-call binary.\n\nUsage: ping [OPTIONS] HOST\n', code: 1 };
        const found = resolve(state, self, host);
        if (!found) return { err: `ping: bad address '${host}'\n`, code: 1 };
        const lines = [`PING ${host} (${found.ip}): 56 data bytes`];
        for (let n = 0; n < count; n += 1) lines.push(`64 bytes from ${found.ip}: seq=${n} ttl=64 time=0.0${65 + n * 3} ms`);
        lines.push('', `--- ${host} ping statistics ---`, `${count} packets transmitted, ${count} packets received, 0% packet loss`,
          `round-trip min/avg/max = 0.065/0.0${65 + (count - 1)}/0.0${65 + (count - 1) * 3} ms`);
        return { out: `${lines.join('\n')}\n` };
      },
    },
    pg_isready: {
      help: 'pg_isready [-h хост] [-p порт] — принимает ли PostgreSQL подключения.',
      run({ sh, args }) {
        let host = null;
        let port = 5432;
        for (let i = 0; i < args.length; i += 1) {
          if (args[i] === '-h' || args[i] === '--host') host = args[(i += 1)];
          else if (args[i].startsWith('-h')) host = args[i].slice(2);
          else if (args[i] === '-p' || args[i] === '--port') port = Number(args[(i += 1)]);
        }
        const state = dockerState(sh.machine.hostFs);
        const self = state.containers.find((c) => c.id === sh.machine.container);
        const where = `${host ?? '/var/run/postgresql'}:${port}`;
        const target = host ? resolve(state, self, host)?.container : self;
        const ready = target?.status === 'running' && target.procs[0]?.comm === 'postgres'
          && (target.listen ?? []).includes(port);
        return ready ? { out: `${where} - accepting connections\n` } : { out: `${where} - no response\n`, code: 2 };
      },
    },
  };
}

// --- docker network ---

const NETWORK_USAGE = {
  create: 'docker network create [OPTIONS] NETWORK',
  connect: 'docker network connect [OPTIONS] NETWORK CONTAINER',
  disconnect: 'docker network disconnect [OPTIONS] NETWORK CONTAINER',
  rm: 'docker network rm NETWORK [NETWORK...]',
  inspect: 'docker network inspect [OPTIONS] NETWORK [NETWORK...]',
};

function usage(group, name, need, verb = 'See') {
  const text = `docker: 'docker ${group} ${name}' requires ${need}\n\nUsage:  ${(group === 'network' ? NETWORK_USAGE : VOLUME_USAGE)[name]}\n\n${verb} 'docker ${group} ${name} --help' for more information\n`;
  return result([err(text)], 1);
}

/** Сеть по имени, ID или началу ID. */
export function findNetwork(state, ref) {
  return state.networks[ref] ?? Object.values(state.networks).find((net) => net.id.startsWith(ref) && ref.length >= 3) ?? null;
}

/** Свободная подсеть 172.18…172.31, затем 192.168.x — как выдаёт Docker. */
function freeSubnet(state) {
  const taken = new Set(Object.values(state.networks).map((net) => net.subnet));
  for (let n = 18; n <= 31; n += 1) if (!taken.has(`172.${n}`)) return `172.${n}`;
  for (let n = 0; n < 256; n += 16) if (!taken.has(`192.168.${n}`)) return `192.168.${n}`;
  return '10.10';
}

/** Контейнеры сети, у которых есть «живая» точка подключения (запущены). */
const endpoints = (state, net) => state.containers.filter((c) => c.status === 'running' && net.name in c.networks);

function inspectNetwork(state, net) {
  const containers = Object.fromEntries(endpoints(state, net).map((c) => [c.id, {
    Name: c.name,
    EndpointID: hexHash(`endpoint:${c.id}:${net.name}`),
    MacAddress: `02:42:ac:${c.networks[net.name].ip.split('.').slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join(':')}`,
    IPv4Address: `${c.networks[net.name].ip}/16`,
    IPv6Address: '',
  }]));
  const bridge = net.driver === 'bridge';
  return {
    Name: net.name,
    Id: net.id,
    Created: new Date(net.created).toISOString().replace('Z', '000000+03:00').replace(/T(\d\d)/, (_, h) => `T${String((Number(h) + 3) % 24).padStart(2, '0')}`),
    Scope: 'local',
    Driver: net.driver,
    EnableIPv4: bridge,
    EnableIPv6: false,
    IPAM: { Driver: 'default', Options: net.builtin ? null : {}, Config: bridge ? [{ Subnet: `${net.subnet}.0.0/16`, Gateway: `${net.subnet}.0.1` }] : [] },
    Internal: false,
    Attachable: false,
    Ingress: false,
    ConfigFrom: { Network: '' },
    ConfigOnly: false,
    Containers: containers,
    Options: net.name === 'bridge' ? {
      'com.docker.network.bridge.default_bridge': 'true',
      'com.docker.network.bridge.enable_icc': 'true',
      'com.docker.network.bridge.enable_ip_masquerade': 'true',
      'com.docker.network.bridge.host_binding_ipv4': '0.0.0.0',
      'com.docker.network.bridge.name': 'docker0',
      'com.docker.network.driver.mtu': '1500',
    } : {},
    Labels: net.labels ?? {},
  };
}

function networkCommand(ctx, sub, args, { renderTemplate, jsonText }) {
  const state = dockerState(ctx.fs);
  const flags = args.filter((arg) => arg.startsWith('-'));
  const rest = [];
  let format = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-f' || args[i] === '--format') format = args[(i += 1)];
    else if (args[i].startsWith('--format=')) format = args[i].slice(9);
    else if ((args[i] === '-d' || args[i] === '--driver' || args[i] === '--filter' || args[i] === '--subnet' || args[i] === '--alias') && args[i + 1]) {
      if (args[i] === '--filter') rest.push({ filter: args[i + 1] });
      if (args[i] === '--alias') rest.push({ alias: args[i + 1] });
      i += 1;
    } else if (!args[i].startsWith('-')) rest.push(args[i]);
  }
  const names = rest.filter((item) => typeof item === 'string');
  switch (sub) {
    case 'ls':
    case 'list': {
      let list = Object.values(state.networks).sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const { filter } of rest.filter((item) => item.filter)) {
        const [key, value = ''] = filter.split('=');
        if (key === 'name') list = list.filter((net) => net.name.includes(value));
      }
      if (flags.includes('-q') || flags.includes('--quiet')) return result(list.length ? [out(`${list.map((net) => shortId(net.id)).join('\n')}\n`)] : []);
      return result([out(table(['NETWORK ID', 'NAME', 'DRIVER', 'SCOPE'], list.map((net) => [shortId(net.id), net.name, net.driver, 'local'])))]);
    }
    case 'create': {
      if (names.length !== 1) return usage('network', 'create', '1 argument', 'Run');
      const [name] = names;
      if (state.networks[name]) return result([err(`Error response from daemon: network with name ${name} already exists\n`)], 1);
      const net = { id: newId(state, 'network'), name, driver: 'bridge', subnet: freeSubnet(state), created: now() };
      state.networks[name] = net;
      return result([out(`${net.id}\n`)]);
    }
    case 'rm':
    case 'remove': {
      if (!names.length) return usage('network', 'rm', 'at least 1 argument');
      const chunks = [];
      let code = 0;
      for (const ref of names) {
        const net = findNetwork(state, ref);
        if (!net) {
          chunks.push(err(`Error response from daemon: network ${ref} not found\n`));
          code = 1;
        } else if (net.builtin) {
          chunks.push(err(`Error response from daemon: ${net.name} is a pre-defined network and cannot be removed\n`));
          code = 1;
        } else if (endpoints(state, net).length) {
          const [first] = endpoints(state, net);
          chunks.push(err(`Error response from daemon: error while removing network: network ${net.name} has active endpoints (name:"${first.name}" id:"${shortId(hexHash(`endpoint:${first.id}:${net.name}`))}")\n`));
          code = 1;
        } else {
          delete state.networks[net.name];
          chunks.push(out(`${ref}\n`));
        }
      }
      if (code) chunks.push(err('exit status 1\n'));
      return result(chunks, code);
    }
    case 'connect':
    case 'disconnect': {
      if (names.length !== 2) return usage('network', sub, '2 arguments', 'Run');
      const [netRef, containerRef] = names;
      const net = findNetwork(state, netRef);
      if (!net) return result([err(`Error response from daemon: network ${netRef} not found\n`)], 1);
      const container = findContainer(state, containerRef);
      if (!container) return result([err(`Error response from daemon: No such container: ${containerRef}\n`)], 1);
      if (sub === 'connect') {
        if (net.name in container.networks) {
          return result([err(`Error response from daemon: endpoint with name ${container.name} already exists in network ${net.name}\n`)], 1);
        }
        const used = new Set(state.containers.filter((c) => c.status === 'running').map((c) => c.networks[net.name]?.ip).filter(Boolean));
        let n = 2;
        while (used.has(`${net.subnet}.0.${n}`)) n += 1;
        const aliases = rest.filter((item) => item.alias).map((item) => item.alias);
        container.networks[net.name] = { ip: `${net.subnet}.0.${n}`, ...(aliases.length ? { aliases } : {}) };
        return result([]);
      }
      if (!(net.name in container.networks)) {
        return result([err(`Error response from daemon: container ${container.id} is not connected to network ${net.name}\n`)], 1);
      }
      delete container.networks[net.name];
      return result([]);
    }
    case 'inspect': {
      if (!names.length) return usage('network', 'inspect', 'at least 1 argument');
      const found = [];
      const chunks = [];
      let code = 0;
      for (const ref of names) {
        const net = findNetwork(state, ref);
        if (net) found.push(inspectNetwork(state, net));
        else {
          chunks.push(err(`Error response from daemon: network ${ref} not found\n`));
          code = 1;
        }
      }
      if (format) return result([...found.map((item) => out(`${renderTemplate(format, item)}\n`)), ...chunks], code);
      return result([out(`${jsonText(found)}\n`), ...chunks], code);
    }
    case 'prune': {
      const unused = Object.values(state.networks).filter((net) => !net.builtin
        && !state.containers.some((c) => net.name in c.networks));
      if (!flags.includes('-f') && !flags.includes('--force') && !/^y/i.test(ctx.stdin)) {
        return result([out('WARNING! This will remove all custom networks not used by at least one container.\nAre you sure you want to continue? [y/N] \n'),
          err('(в тренажёре на вопрос не ответить: добавьте -f или echo y | docker network prune)\n')]);
      }
      for (const net of unused) delete state.networks[net.name];
      return result(unused.length ? [out(`Deleted Networks:\n${unused.map((net) => net.name).join('\n')}\n\n`)] : []);
    }
    default:
      return result([err(`docker: unknown command: docker network ${sub ?? ''}\n\nRun 'docker network --help' for more information\n`.replace(' \n', '\n'))], 1);
  }
}

// --- docker volume ---

const VOLUME_USAGE = {
  rm: 'docker volume rm [OPTIONS] VOLUME [VOLUME...]',
  inspect: 'docker volume inspect [OPTIONS] VOLUME [VOLUME...]',
  create: 'docker volume create [OPTIONS] [VOLUME]',
};

/** Размер данных тома: файлы + у кластера postgres — начальные ~39 МБ initdb. */
function volumeSize(volume) {
  let size = 0;
  const walk = (node) => {
    if (node.type === 'file') size += node.size ?? 0;
    for (const child of Object.values(node.children ?? {})) walk(child);
  };
  walk(volume.data);
  return size + (volume.pg ? 39_400_000 : 0);
}

const users = (state, name) => state.containers.filter((c) => c.mounts.some((m) => m.type === 'volume' && m.name === name));

function inspectVolume(volume) {
  return {
    CreatedAt: localIso(volume.created),
    Driver: 'local',
    Labels: volume.labels ?? null,
    Mountpoint: `/var/lib/docker/volumes/${volume.name}/_data`,
    Name: volume.name,
    Options: null,
    Scope: 'local',
  };
}

function volumeCommand(ctx, sub, args, { renderTemplate, jsonText }) {
  const state = dockerState(ctx.fs);
  const flags = args.filter((arg) => arg.startsWith('-') && !arg.startsWith('--format') && !arg.startsWith('--filter'));
  const names = [];
  const filters = [];
  let format = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-f' && sub !== 'rm' && sub !== 'prune') format = args[(i += 1)];
    else if (args[i] === '--format') format = args[(i += 1)];
    else if (args[i] === '--filter') filters.push(args[(i += 1)]);
    else if (args[i] === '--driver' || args[i] === '-d' || args[i] === '--label') i += 1;
    else if (!args[i].startsWith('-')) names.push(args[i]);
  }
  switch (sub) {
    case 'ls':
    case 'list': {
      let list = Object.values(state.volumes).sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const filter of filters) {
        const [key, value = ''] = filter.split('=');
        if (key === 'name') list = list.filter((volume) => volume.name.includes(value));
        else if (key === 'dangling') list = list.filter((volume) => (users(state, volume.name).length === 0) === (value === 'true'));
      }
      if (flags.includes('-q') || flags.includes('--quiet')) return result(list.length ? [out(`${list.map((v) => v.name).join('\n')}\n`)] : []);
      return result([out(table(['DRIVER', 'VOLUME NAME'], list.map((volume) => ['local', volume.name])))]);
    }
    case 'create': {
      if (names.length > 1) return result([err(`docker: 'docker volume create' requires at most 1 argument\n\nUsage:  ${VOLUME_USAGE.create}\n\nSee 'docker volume create --help' for more information\n`)], 1);
      const name = names[0] ?? newId(state, 'volume');
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(name)) {
        return result([err(`Error response from daemon: create ${name}: "${name}" includes invalid characters for a local volume name, only "[a-zA-Z0-9][a-zA-Z0-9_.-]" are allowed. If you intended to pass a host directory, use absolute path\n`)], 1);
      }
      state.volumes[name] ??= { name, created: now(), data: { type: 'dir', owner: 'root', group: 'root', mode: 0o755, mtime: now(), nlink: 1, children: {} }, labels: null };
      return result([out(`${name}\n`)]);
    }
    case 'inspect': {
      if (!names.length) return usage('volume', 'inspect', 'at least 1 argument');
      const found = [];
      const chunks = [];
      let code = 0;
      for (const name of names) {
        if (state.volumes[name]) found.push(inspectVolume(state.volumes[name]));
        else {
          chunks.push(err(`Error response from daemon: get ${name}: no such volume\n`));
          code = 1;
        }
      }
      if (format) return result([...found.map((item) => out(`${renderTemplate(format, item)}\n`)), ...chunks], code);
      return result([out(`${jsonText(found)}\n`), ...chunks], code);
    }
    case 'rm':
    case 'remove': {
      if (!names.length) return usage('volume', 'rm', 'at least 1 argument');
      const force = flags.includes('-f') || flags.includes('--force');
      const chunks = [];
      let code = 0;
      for (const name of names) {
        const volume = state.volumes[name];
        if (!volume) {
          if (!force) {
            chunks.push(err(`Error response from daemon: get ${name}: no such volume\n`));
            code = 1;
          }
          continue;
        }
        const using = users(state, name);
        if (using.length) {
          chunks.push(err(`Error response from daemon: remove ${name}: volume is in use - [${using.map((c) => c.id).join(', ')}]\n`));
          code = 1;
          continue;
        }
        delete state.volumes[name];
        forgetVolume(name);
        chunks.push(out(`${name}\n`));
      }
      return result(chunks, code);
    }
    case 'prune': {
      const all = flags.includes('-a') || flags.includes('--all');
      const force = flags.includes('-f') || flags.includes('--force');
      if (!force && !/^y/i.test(ctx.stdin)) {
        return result([out(`WARNING! This will remove ${all ? 'all local volumes' : 'anonymous local volumes'} not used by at least one container.\nAre you sure you want to continue? [y/N] \n`),
          err('(в тренажёре на вопрос не ответить: добавьте -f или echo y | docker volume prune)\n')]);
      }
      const removed = Object.values(state.volumes).filter((volume) => (all || volume.labels?.['com.docker.volume.anonymous'] !== undefined)
        && !users(state, volume.name).length);
      let size = 0;
      for (const volume of removed) {
        size += volumeSize(volume);
        delete state.volumes[volume.name];
        forgetVolume(volume.name);
      }
      const text = removed.length ? `Deleted Volumes:\n${removed.map((v) => v.name).join('\n')}\n\n` : '';
      return result([out(`${text}Total reclaimed space: ${size ? humanSize(size) : '0B'}\n`)]);
    }
    default:
      return result([err(`docker: unknown command: docker volume ${sub ?? ''}\n\nRun 'docker volume --help' for more information\n`.replace(' \n', '\n'))], 1);
  }
}

export { networkCommand, volumeCommand, volumeSize };
