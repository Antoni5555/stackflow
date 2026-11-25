// Реестры образов: свой registry:2 в контейнере (localhost:ПОРТ, данные — в его томе) и
// «внешние» ghcr.io и Docker Hub (без сети: хранятся в состоянии Docker). docker login, push,
// pull из реестра, HTTP API реестра (/v2/_catalog, /v2/ИМЯ/tags/list) для curl.
// Тексты — как у Docker 29 (урок «Публикация образа»).

import { now } from '../linux/clock.js';
import { hexHash, normalizeRef } from './catalog.js';
import { utcParts } from './format.js';
import { dockerState, findImage } from './state.js';

/** «localhost:55000/shop/web:1.4.2» → {host, repo: 'shop/web', tag}; без адреса — docker.io. */
export function splitRef(ref) {
  const full = normalizeRef(ref);
  const colon = full.lastIndexOf(':');
  const name = full.slice(0, colon);
  const tag = full.slice(colon + 1);
  const [first, ...rest] = name.split('/');
  if (rest.length && (first.includes('.') || first.includes(':') || first === 'localhost')) {
    return { host: first, repo: rest.join('/'), tag, name };
  }
  return { host: 'docker.io', repo: rest.length ? name : `library/${name}`, tag, name };
}

/** Хранилище реестра: {repos: {repo: {tag: imageId}}, images: {id: запись образа}, layers: [id]}. */
function storage(hostFs, host) {
  const state = dockerState(hostFs);
  const port = /^localhost:(\d+)$|^127\.0\.0\.1:(\d+)$/.exec(host);
  if (port) {
    const hostPort = port[1] ?? port[2];
    const container = state.containers.find((c) => c.status === 'running' && c.procs[0]?.comm === 'registry'
      && c.ports.some((item) => item.hostPort === hostPort));
    if (!container) return { refused: hostPort };
    const mount = container.mounts.find((item) => item.destination === '/var/lib/registry' && item.type === 'volume');
    const volume = mount && state.volumes[mount.name];
    if (!volume) return { refused: hostPort };
    volume.registry ??= { repos: {}, images: {}, layers: [] };
    return { data: volume.registry, container };
  }
  state.remote ??= {};
  state.remote[host] ??= { repos: {}, images: {}, layers: [] };
  return { data: state.remote[host] };
}

/** Есть ли права на запись в репозиторий внешнего реестра. */
function denied(state, host, repo) {
  const login = state.logins?.[host];
  if (host === 'docker.io') {
    if (!login || !repo.startsWith(`${login}/`)) return 'denied: requested access to the resource is denied';
    return null;
  }
  if (!login) return 'unauthorized: unauthenticated: User cannot be authenticated with the token provided.';
  return null;
}

const layerIds = (image) => (image.layers ?? []).filter((layer) => layer.size > 0)
  .map((layer, k) => hexHash(`blob:${image.base}:${layer.createdBy}:${layer.size}:${k}`, 12)).reverse();

// --- docker push ---

export function push({ fs, args }) {
  const refs = args.filter((arg) => !arg.startsWith('-'));
  if (refs.length !== 1) {
    return { chunks: [{ text: "docker: 'docker push' requires 1 argument\n\nUsage:  docker push [OPTIONS] NAME[:TAG]\n\nRun 'docker push --help' for more information\n", err: true }], code: 1 };
  }
  const state = dockerState(fs);
  const [ref] = refs;
  const image = findImage(state, ref);
  const { host, repo, tag, name } = splitRef(ref);
  const shown = host === 'docker.io' ? `docker.io/${repo}` : name;
  if (!image) return { chunks: [{ text: `An image does not exist locally with the tag: ${name}\n`, err: true }], code: 1 };
  const lines = [`The push refers to repository [${shown}]`];
  const store = storage(fs, host);
  if (store.refused) {
    return { chunks: [{ text: `${lines[0]}\n`, err: false }, { text: `Get "http://${host}/v2/": dial tcp 127.0.0.1:${store.refused}: connect: connection refused\n`, err: true }], code: 1 };
  }
  const problem = store.container ? null : denied(state, host, repo);
  const layers = layerIds(image);
  if (problem) {
    return { chunks: [{ text: `${[...lines, ...layers.map((id) => `${id}: Preparing`)].join('\n')}\n`, err: false }, { text: `${problem}\n`, err: true }], code: 1 };
  }
  for (const id of layers) lines.push(`${id}: ${store.data.layers.includes(id) ? 'Layer already exists' : 'Pushed'}`);
  store.data.layers = [...new Set([...store.data.layers, ...layers])];
  const { tags: unusedTags, ...record } = image;
  void unusedTags;
  store.data.images[image.id] = record;
  (store.data.repos[repo] ??= {})[tag] = image.id;
  lines.push(`${tag}: digest: sha256:${image.id} size: 856`);
  if (store.container) {
    const p = utcParts(now());
    store.container.logs.push({ t: now(), err: false, text: `172.17.0.1 - - [${p.day}/${p.monthName}/${p.year}:${p.time} +0000] "PUT /v2/${repo}/manifests/${tag} HTTP/1.1" 201 0 "" "docker/29.10.0 go/go1.25.3 git-commit/a8c1f2e kernel/6.8.0-87-generic os/linux arch/amd64 UpstreamClient(Docker-Client/29.10.0 \\(linux\\))"` });
  }
  return { chunks: [{ text: `${lines.join('\n')}\n`, err: false }], code: 0 };
}

/** pull из реестра (не из каталога): {lines, image} | {error} | null — не реестр. */
export function pullFromRegistry(hostFs, ref) {
  const { host, repo, tag, name } = splitRef(ref);
  if (host === 'docker.io' && !dockerState(hostFs).remote?.['docker.io']?.repos[repo]) return null;
  const state = dockerState(hostFs);
  const store = storage(hostFs, host);
  if (store.refused) return { error: `Get "http://${host}/v2/": dial tcp 127.0.0.1:${store.refused}: connect: connection refused` };
  const id = store.data.repos[repo]?.[tag];
  if (!id) {
    if (host !== 'docker.io' && !store.container && !state.logins?.[host]) {
      return { error: `Head "https://${host}/v2/${repo}/manifests/${tag}": unauthorized` };
    }
    return { error: `failed to resolve reference "${name}:${tag}": ${name}:${tag}: not found` };
  }
  const present = state.images[id];
  const lines = [`${tag}: Pulling from ${repo}`];
  if (!present) {
    const layers = layerIds(store.data.images[id]);
    for (const layer of layers) lines.push(`${layer}: Pulling fs layer`);
    for (const layer of layers) lines.push(`${layer}: Download complete`, `${layer}: Pull complete`);
    state.images[id] = { ...structuredClone(store.data.images[id]), tags: [] };
  }
  for (const other of Object.values(state.images)) other.tags = other.tags.filter((item) => item !== `${name}:${tag}`);
  state.images[id].tags.push(`${name}:${tag}`);
  lines.push(`Digest: sha256:${id}`, `Status: Downloaded newer image for ${name}:${tag}`);
  return { lines, path: `${name}:${tag}` };
}

// --- login / logout ---

export function login({ fs, sh, args, stdin }) {
  let user = null;
  let password = null;
  let fromStdin = false;
  const hosts = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-u' || args[i] === '--username') user = args[(i += 1)];
    else if (args[i] === '-p' || args[i] === '--password') password = args[(i += 1)];
    else if (args[i] === '--password-stdin') fromStdin = true;
    else if (!args[i].startsWith('-')) hosts.push(args[i]);
  }
  const host = hosts[0] ?? 'docker.io';
  const chunks = [];
  if (password !== null) chunks.push({ text: 'WARNING! Using --password via the CLI is insecure. Use --password-stdin.\n', err: true });
  if (fromStdin) {
    password = stdin.replace(/\n$/, '');
    if (!user) return { chunks: [{ text: 'Error: Must provide --username with --password-stdin\n', err: true }], code: 1 };
    if (!password) return { chunks: [{ text: 'Error: Password Required\n', err: true }], code: 1 };
  }
  if (!user || !password) {
    return { chunks: [{ text: '(в тренажёре логин и пароль не спрашиваются — укажите их сразу: echo "$TOKEN" | docker login ghcr.io -u логин --password-stdin)\n', err: true }], code: 1 };
  }
  const state = dockerState(fs);
  state.logins ??= {};
  state.logins[host] = user;
  // учётные данные — в ~/.docker/config.json, как у настоящего docker (base64, без шифрования)
  const key = host === 'docker.io' ? 'https://index.docker.io/v1/' : host;
  const path = `${sh.env.HOME}/.docker/config.json`;
  let config = { auths: {} };
  try {
    config = JSON.parse(fs.readFile(path));
  } catch (e) {
    // файла ещё нет
  }
  config.auths ??= {};
  config.auths[key] = { auth: btoa(unescape(encodeURIComponent(`${user}:${password}`))) };
  fs.mkdirAs(`${sh.env.HOME}/.docker`, fs.user).mode = 0o700;
  fs.writeFile(path, `${JSON.stringify(config, null, '\t')}\n`);
  chunks.push({ text: `\nWARNING! Your credentials are stored unencrypted in '${path}'.\nConfigure a credential helper to remove this warning. See\nhttps://docs.docker.com/go/credential-store/\n\n`, err: true });
  chunks.push({ text: 'Login Succeeded\n', err: false });
  return { chunks, code: 0 };
}

export function logout({ fs, sh, args }) {
  const host = args.find((arg) => !arg.startsWith('-')) ?? 'docker.io';
  const state = dockerState(fs);
  const key = host === 'docker.io' ? 'https://index.docker.io/v1/' : host;
  if (!state.logins?.[host]) return { chunks: [{ text: `Not logged in to ${host === 'docker.io' ? 'https://index.docker.io/v1/' : host}\n`, err: false }], code: 0 };
  delete state.logins[host];
  try {
    const path = `${sh.env.HOME}/.docker/config.json`;
    const config = JSON.parse(fs.readFile(path));
    delete config.auths?.[key];
    fs.writeFile(path, `${JSON.stringify(config, null, '\t')}\n`);
  } catch (e) {
    // файла нет
  }
  return { chunks: [{ text: `Removing login credentials for ${key}\n`, err: false }], code: 0 };
}

// --- registry:2: логи и HTTP API ---

export function startRegistry(hostFs, container, log) {
  const ts = () => new Date(log.time).toISOString().replace('Z', '123456Z');
  const tail = `go.version=go1.20.8 instance.id=${hexHash(`instance:${container.id}`, 8)}-${hexHash(`i2:${container.id}`, 4)}-${hexHash(`i3:${container.id}`, 4)}-${hexHash(`i4:${container.id}`, 4)}-${hexHash(`i5:${container.id}`, 12)} service=registry version=2.8.3`;
  log.line(`time="${ts()}" level=warning msg="No HTTP secret provided - generated random secret. This may cause problems with uploads if multiple registries are behind a load-balancer. To provide a shared secret, fill in http.secret in the configuration file or set the REGISTRY_HTTP_SECRET environment variable." ${tail}`, true);
  log.line(`time="${ts()}" level=info msg="redis not configured" ${tail}`, true);
  log.line(`time="${ts()}" level=info msg="Starting upload purge in 41m0s" ${tail}`, true);
  log.line(`time="${ts()}" level=info msg="using inmemory blob descriptor cache" ${tail}`, true);
  log.line(`time="${ts()}" level=info msg="listening on [::]:5000" ${tail}`, true);
  return { listen: [5000], procs: [{ pid: 1, user: 'root', comm: 'registry', cmd: 'registry serve /etc/docker/registry/config.yml' }] };
}

/** Ответ API реестра на curl. */
export function registryAnswer(hostFs, container, request) {
  const state = dockerState(hostFs);
  const mount = container.mounts.find((item) => item.destination === '/var/lib/registry');
  const data = state.volumes[mount?.name]?.registry ?? { repos: {} };
  const json = (code, body) => ({
    code,
    headers: [['Content-Type', 'application/json; charset=utf-8'], ['Docker-Distribution-Api-Version', 'registry/2.0'],
      ['X-Content-Type-Options', 'nosniff'], ['Date', new Date(now()).toUTCString()], ['Content-Length', String(body.length + 1)]],
    body: `${body}\n`,
  });
  const path = request.path.split('?')[0];
  if (path === '/v2/' || path === '/v2') return json(200, '{}');
  if (path === '/v2/_catalog') return json(200, JSON.stringify({ repositories: Object.keys(data.repos).sort() }));
  const tags = /^\/v2\/(.+)\/tags\/list$/.exec(path);
  if (tags) {
    const repo = data.repos[tags[1]];
    if (!repo) return json(404, `{"errors":[{"code":"NAME_UNKNOWN","message":"repository name not known to registry","detail":{"name":"${tags[1]}"}}]}`);
    return json(200, JSON.stringify({ name: tags[1], tags: Object.keys(repo).reverse() }));
  }
  return { code: 404, headers: [['Content-Type', 'text/plain; charset=utf-8'], ['X-Content-Type-Options', 'nosniff'], ['Date', new Date(now()).toUTCString()], ['Content-Length', '19']], body: '404 page not found\n' };
}
