// docker inspect: JSON контейнера и образа (основные поля, как у Docker 29) и шаблоны -f.

import { catalogImage, hexHash } from './catalog.js';
import { isoNano } from './format.js';

const ports = (list) => Object.fromEntries((list ?? []).map((spec) => [spec, {}]));

/** JSON контейнера для docker inspect. */
export function inspectContainer(hostFs, state, c) {
  const image = state.images[c.imageId];
  const config = image?.config ?? catalogImage(c.base)?.config ?? {};
  const running = c.status === 'running';
  const [path, ...args] = [...c.entrypoint, ...c.cmd];
  const networks = Object.fromEntries(Object.entries(c.networks).map(([name, info]) => {
    const network = state.networks[name];
    return [name, {
      IPAMConfig: null, Links: null, Aliases: null, DriverOpts: null, GwPriority: 0,
      NetworkID: network?.id ?? '',
      EndpointID: running ? hexHash(`endpoint:${c.id}:${name}`) : '',
      Gateway: running && network?.subnet ? `${network.subnet}.0.1` : '',
      IPAddress: running ? info.ip : '',
      MacAddress: running ? `02:42:ac:${info.ip.split('.').slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join(':')}` : '',
      IPPrefixLen: running ? 16 : 0,
      IPv6Gateway: '', GlobalIPv6Address: '', GlobalIPv6PrefixLen: 0,
      DNSNames: name === 'bridge' ? null : [c.name, c.id.slice(0, 12)],
    }];
  }));
  const bindings = {};
  for (const port of c.ports) {
    (bindings[`${port.port}/tcp`] ??= []).push({ HostIp: port.hostIp, HostPort: port.hostPort });
  }
  const published = {};
  if (running) {
    for (const port of c.ports) {
      (published[`${port.port}/tcp`] ??= []).push(
        ...(port.hostIp ? [{ HostIp: port.hostIp, HostPort: port.hostPort }]
          : [{ HostIp: '0.0.0.0', HostPort: port.hostPort }, { HostIp: '::', HostPort: port.hostPort }]),
      );
    }
    for (const spec of config.ExposedPorts ?? []) published[spec] ??= null;
  }
  return {
    Id: c.id,
    Created: isoNano(c.created),
    Path: path ?? '',
    Args: args,
    State: {
      Status: c.status,
      Running: running,
      Paused: false,
      Restarting: false,
      OOMKilled: false,
      Dead: false,
      Pid: running ? 2400 + (parseInt(c.id.slice(0, 4), 16) % 3000) : 0,
      ExitCode: c.exitCode,
      Error: '',
      StartedAt: c.startedAt ? isoNano(c.startedAt) : '0001-01-01T00:00:00Z',
      FinishedAt: c.finishedAt ? isoNano(c.finishedAt) : '0001-01-01T00:00:00Z',
    },
    Image: `sha256:${c.imageId}`,
    LogPath: `/var/lib/docker/containers/${c.id}/${c.id}-json.log`,
    Name: `/${c.name}`,
    RestartCount: 0,
    Driver: 'overlayfs',
    Platform: 'linux',
    HostConfig: {
      Binds: c.mounts.filter((m) => !m.anonymous && (m.type === 'bind' || m.name)).length
        ? c.mounts.filter((m) => !m.anonymous).map((m) => `${m.type === 'bind' ? m.source : m.name}:${m.destination}${m.readOnly ? ':ro' : ''}`)
        : null,
      NetworkMode: c.wantedNetwork,
      PortBindings: bindings,
      RestartPolicy: { Name: c.restart.split(':')[0], MaximumRetryCount: Number(c.restart.split(':')[1] ?? 0) },
      AutoRemove: c.autoRemove,
    },
    Mounts: c.mounts.map((m) => (m.type === 'bind'
      ? { Type: 'bind', Source: m.source, Destination: m.destination, Mode: m.readOnly ? 'ro' : '', RW: !m.readOnly, Propagation: 'rprivate' }
      : { Type: 'volume', Name: m.name, Source: `/var/lib/docker/volumes/${m.name}/_data`, Destination: m.destination, Driver: 'local', Mode: m.readOnly ? 'ro' : '', RW: !m.readOnly, Propagation: '' })),
    Config: {
      Hostname: c.env.find((item) => item.startsWith('HOSTNAME='))?.slice(9) ?? c.id.slice(0, 12),
      Domainname: '',
      User: c.user,
      AttachStdin: c.interactive,
      AttachStdout: true,
      AttachStderr: true,
      ExposedPorts: Object.keys({ ...ports(config.ExposedPorts), ...Object.fromEntries(c.ports.map((p) => [`${p.port}/tcp`, {}])) }).length
        ? { ...ports(config.ExposedPorts), ...Object.fromEntries(c.ports.map((p) => [`${p.port}/tcp`, {}])) } : undefined,
      Tty: c.tty,
      OpenStdin: c.interactive,
      StdinOnce: false,
      Env: c.env.filter((item) => !item.startsWith('HOSTNAME=') && item !== 'HOME=/root'),
      Cmd: c.cmd.length ? c.cmd : null,
      Image: c.image,
      Volumes: config.Volumes?.length ? ports(config.Volumes) : null,
      WorkingDir: c.workdir,
      Entrypoint: c.entrypoint.length ? c.entrypoint : null,
      Labels: config.Labels ?? {},
      ...(config.StopSignal ? { StopSignal: config.StopSignal } : {}),
    },
    NetworkSettings: {
      SandboxID: running ? hexHash(`sandbox:${c.id}`) : '',
      SandboxKey: running ? `/var/run/docker/netns/${hexHash(`sandbox:${c.id}`).slice(0, 12)}` : '',
      Ports: published,
      Networks: networks,
    },
  };
}

/** JSON образа для docker inspect. */
export function inspectImage(image) {
  const repos = [...new Set(image.tags.map((tag) => tag.slice(0, tag.lastIndexOf(':'))))];
  const config = image.config;
  return {
    Id: `sha256:${image.id}`,
    RepoTags: image.tags,
    RepoDigests: repos.map((repo) => `${repo}@sha256:${hexHash(`digest:${image.base ?? image.id}`)}`),
    Created: new Date(image.created).toISOString().replace('.000Z', 'Z'),
    Config: {
      ...(config.User ? { User: config.User } : {}),
      ...(config.ExposedPorts?.length ? { ExposedPorts: ports(config.ExposedPorts) } : {}),
      Env: config.Env,
      ...(config.Entrypoint ? { Entrypoint: config.Entrypoint } : {}),
      Cmd: config.Cmd ?? null,
      ...(config.Volumes?.length ? { Volumes: ports(config.Volumes) } : {}),
      ...(config.WorkingDir ? { WorkingDir: config.WorkingDir } : {}),
      ...(config.Labels ? { Labels: config.Labels } : {}),
      ...(config.StopSignal ? { StopSignal: config.StopSignal } : {}),
    },
    Architecture: 'amd64',
    Os: 'linux',
    Size: image.content,
    RootFS: {
      Type: 'layers',
      Layers: Array.from({ length: catalogImage(image.base)?.layers ?? image.layers ?? 1 }, (_, k) => `sha256:${hexHash(`rootfs:${image.base ?? image.id}:${k}`)}`),
    },
  };
}

// --- шаблоны Go: {{.State.Status}}, {{json .Mounts}}, {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}} ---

function lookup(data, path) {
  if (path === '.') return data;
  let value = data;
  for (const key of path.replace(/^\./, '').split('.')) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }
  return value;
}

function show(value) {
  if (value === undefined) return '<no value>';
  if (value === null) return '<nil>';
  // элемент списка — структура Go: {0.0.0.0 55432}, а не map[…]
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item && typeof item === 'object' && !Array.isArray(item)
      ? `{${Object.values(item).map(show).join(' ')}}` : show(item))).join(' ')}]`;
  }
  if (typeof value === 'object') return `map[${Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}:${show(v)}`).join(' ')}]`;
  return String(value);
}

/** Шаблон docker -f: поля, json, range … end, index. */
export function renderTemplate(template, data) {
  const parts = template.split(/(\{\{.*?\}\})/s);
  let i = 0;
  const render = (scope, stopAtEnd) => {
    let text = '';
    while (i < parts.length) {
      const part = parts[i];
      i += 1;
      const action = /^\{\{-?\s*(.*?)\s*-?\}\}$/s.exec(part);
      if (!action) {
        text += part.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        continue;
      }
      const expr = action[1];
      if (expr === 'end') {
        if (stopAtEnd) return text;
        continue;
      }
      const range = /^range\s+(\S+)$/.exec(expr);
      if (range) {
        const value = lookup(scope, range[1]);
        const items = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.keys(value).sort().map((k) => value[k]) : [];
        const start = i;
        if (!items.length) {
          render(scope, true);
        }
        for (const item of items) {
          i = start;
          text += render(item, true);
        }
        continue;
      }
      const json = /^json\s+(\S+)$/.exec(expr);
      if (json) {
        const value = lookup(scope, json[1]);
        text += JSON.stringify(value === undefined ? null : value);
        continue;
      }
      const index = /^index\s+(\S+)\s+"([^"]*)"$/.exec(expr);
      if (index) {
        text += show(lookup(scope, index[1])?.[index[2]]);
        continue;
      }
      if (expr.startsWith('.')) text += show(lookup(scope, expr));
      else text += `{{${expr}}}`;
    }
    return text;
  };
  return render(data, false);
}
