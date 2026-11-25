// Каталог учебного реестра (Docker Hub без сети): образы, их настройки и что внутри.
// Размеры — как у настоящих образов в Docker 29 (containerd: DISK USAGE и CONTENT SIZE).

/** ID образа (в containerd — digest списка манифестов): настоящий, если известен. */
export const imageId = (image) => image.id ?? hexHash(`image:${image.ref}`);

/** Детерминированный «хэш» в hex: одинаковый образ — одинаковый ID в любом браузере. */
export function hexHash(text, length = 64) {
  let out = '';
  for (let round = 0; out.length < length; round += 1) {
    let h = 0x811c9dc5;
    for (const ch of `${round}:${text}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    // перемешивание (fmix32 из MurmurHash3): похожие строки дают непохожие ID
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out.slice(0, length);
}

// Команды, которые есть в любом образе на Debian (coreutils, bash) и на Alpine (busybox)
const BASE = [
  'pwd', 'cd', 'ls', 'cat', 'echo', 'mkdir', 'touch', 'rm', 'rmdir', 'cp', 'mv', 'ln',
  'head', 'tail', 'wc', 'grep', 'sort', 'uniq', 'cut', 'sed', 'tee', 'find', 'du', 'df',
  'chmod', 'chown', 'chgrp', 'whoami', 'id', 'groups', 'kill', 'date', 'dirname', 'basename',
  'env', 'sh', 'export', 'unset', 'source', '.', 'true', 'false', 'test', '[', 'hostname',
  'tar', 'gzip', 'gunzip', 'clear', 'history', 'help', 'sleep', 'printenv',
];
const DEBIAN = [...BASE, 'bash', 'which', 'apt-get', 'apt', 'useradd'];
const ALPINE = [...BASE, 'which', 'ps', 'pgrep', 'pkill', 'top', 'ping'];

const OS = {
  trixie: `PRETTY_NAME="Debian GNU/Linux 13 (trixie)"
NAME="Debian GNU/Linux"
VERSION_ID="13"
VERSION="13 (trixie)"
VERSION_CODENAME=trixie
DEBIAN_VERSION_FULL=13.7
ID=debian
HOME_URL="https://www.debian.org/"
SUPPORT_URL="https://www.debian.org/support"
BUG_REPORT_URL="https://bugs.debian.org/"
`,
  bookworm: `PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
NAME="Debian GNU/Linux"
VERSION_ID="12"
VERSION="12 (bookworm)"
VERSION_CODENAME=bookworm
ID=debian
HOME_URL="https://www.debian.org/"
SUPPORT_URL="https://www.debian.org/support"
BUG_REPORT_URL="https://bugs.debian.org/"
`,
  alpine: `NAME="Alpine Linux"
ID=alpine
VERSION_ID=3.21.3
PRETTY_NAME="Alpine Linux v3.21"
HOME_URL="https://alpinelinux.org/"
BUG_REPORT_URL="https://gitlab.alpinelinux.org/alpine/aports/-/issues"
`,
  'alpine3.20': `NAME="Alpine Linux"
ID=alpine
VERSION_ID=3.20.6
PRETTY_NAME="Alpine Linux v3.20"
HOME_URL="https://alpinelinux.org/"
BUG_REPORT_URL="https://gitlab.alpinelinux.org/alpine/aports/-/issues"
`,
  noble: `PRETTY_NAME="Ubuntu 24.04.3 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.3 LTS (Noble Numbat)"
VERSION_CODENAME=noble
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
SUPPORT_URL="https://help.ubuntu.com/"
BUG_REPORT_URL="https://bugs.launchpad.net/ubuntu/"
PRIVACY_POLICY_URL="https://www.ubuntu.com/legal/terms-and-policies/privacy-policy"
UBUNTU_CODENAME=noble
LOGO=ubuntu-logo
`,
};

const PATH = 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const PY_ENV = [
  'PATH=/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LANG=C.UTF-8',
  'GPG_KEY=7169605F62C751356D054A26A821E680E5FA6305', 'PYTHON_VERSION=3.12.16',
  'PYTHON_SHA256=b5796915dc45ff745cfb4e990a7e7c93d6f546328a102ce31448d69ebc37575c',
];
const NGINX_FILES = {
  '/usr/share/nginx/html/index.html': `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>
`,
  '/usr/share/nginx/html/50x.html': `<!DOCTYPE html>
<html>
<head>
<title>Error</title>
</head>
<body>
<h1>An error occurred.</h1>
<p>Sorry, the page you are looking for is currently unavailable.<br/>
Please try again later.</p>
</body>
</html>
`,
  '/etc/nginx/conf.d/default.conf': `server {
    listen       80;
    listen  [::]:80;
    server_name  localhost;

    location / {
        root   /usr/share/nginx/html;
        index  index.html index.htm;
    }

    error_page   500 502 503 504  /50x.html;
    location = /50x.html {
        root   /usr/share/nginx/html;
    }
}
`,
  '/etc/nginx/nginx.conf': `
user  nginx;
worker_processes  auto;

error_log  /var/log/nginx/error.log notice;
pid        /run/nginx.pid;


events {
    worker_connections  1024;
}


http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  /var/log/nginx/access.log  main;

    sendfile        on;
    #tcp_nopush     on;

    keepalive_timeout  65;

    #gzip  on;

    include /etc/nginx/conf.d/*.conf;
}
`,
};

const NGINX_ENV = (debian) => [
  PATH, 'NGINX_VERSION=1.27.5', `PKG_RELEASE=1${debian ? '~bookworm' : ''}`,
  `DYNPKG_RELEASE=1${debian ? '~bookworm' : ''}`, 'NJS_VERSION=0.8.10', `NJS_RELEASE=1${debian ? '~bookworm' : ''}`,
];

/**
 * Образы. program — что делает главный процесс (логи, порты, ответы curl): postgres, nginx,
 * redis, python (REPL), shell. commands — команды внутри контейнера.
 */
const IMAGES = [
  {
    ref: 'postgres:16', id: '9e2cf6287f25c3151f4c9421ccce2b17f3e60061c111a29165e0d2cdd9ff0a97', disk: '642MB', content: '166MB', layers: 14, created: '2026-10-21T00:38:09Z',
    os: 'trixie', program: 'postgres', commands: [...DEBIAN, 'ps', 'psql', 'pg_isready'],
    config: {
      Entrypoint: ['docker-entrypoint.sh'], Cmd: ['postgres'],
      Env: [`${PATH}:/usr/lib/postgresql/16/bin`, 'GOSU_VERSION=1.19', 'LANG=en_US.utf8', 'PG_MAJOR=16',
        'PG_VERSION=16.15-1.pgdg13+2', 'PGDATA=/var/lib/postgresql/data'],
      ExposedPorts: ['5432/tcp'], Volumes: ['/var/lib/postgresql/data'], StopSignal: 'SIGINT',
    },
    files: { '/docker-entrypoint-initdb.d': null, '/usr/local/bin/docker-entrypoint.sh': '#!/usr/bin/env bash\n' },
  },
  {
    ref: 'nginx:1.27', disk: '279MB', content: '72.2MB', layers: 7, created: '2025-04-16T17:07:33Z',
    os: 'bookworm', program: 'nginx', commands: [...DEBIAN, 'curl'],
    config: {
      Entrypoint: ['/docker-entrypoint.sh'], Cmd: ['nginx', '-g', 'daemon off;'], Env: NGINX_ENV(true),
      ExposedPorts: ['80/tcp'], StopSignal: 'SIGQUIT', WorkingDir: '/',
      Labels: { maintainer: 'NGINX Docker Maintainers <docker-maint@nginx.com>' },
    },
    files: { ...NGINX_FILES, '/docker-entrypoint.d': null, '/docker-entrypoint.sh': '#!/bin/sh\n' },
  },
  {
    ref: 'nginx:1.27-alpine', id: '65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10', disk: '74.5MB', content: '21.9MB', layers: 8, created: '2025-04-16T14:50:31Z',
    os: 'alpine', program: 'nginx', commands: [...ALPINE, 'curl'],
    config: {
      Entrypoint: ['/docker-entrypoint.sh'], Cmd: ['nginx', '-g', 'daemon off;'], Env: NGINX_ENV(false),
      ExposedPorts: ['80/tcp'], StopSignal: 'SIGQUIT', WorkingDir: '/',
      Labels: { maintainer: 'NGINX Docker Maintainers <docker-maint@nginx.com>' },
    },
    files: { ...NGINX_FILES, '/docker-entrypoint.d': null, '/docker-entrypoint.sh': '#!/bin/sh\n' },
  },
  {
    ref: 'python:3.12', id: '5411fa1b302c43f510324381162b5f5d0d93b9ee2af538f09d944f0d290ee3cb', disk: '1.62GB', content: '430MB', layers: 7, created: '2026-11-05T09:40:41Z',
    os: 'trixie', program: 'python', commands: [...DEBIAN, 'ps', 'curl', 'python', 'python3', 'pip', 'pip3'],
    config: { Cmd: ['python3'], Env: PY_ENV },
  },
  {
    ref: 'python:3.12-slim', id: '5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b', disk: '179MB', content: '45.5MB', layers: 4, created: '2026-11-05T08:00:30Z',
    os: 'trixie', program: 'python', commands: [...DEBIAN, 'python', 'python3', 'pip', 'pip3'],
    config: { Cmd: ['python3'], Env: PY_ENV },
  },
  {
    ref: 'redis:7', disk: '158MB', content: '41.6MB', layers: 8, created: '2026-09-17T21:32:46Z',
    os: 'bookworm', program: 'redis', commands: [...DEBIAN, 'redis-cli'],
    config: {
      Entrypoint: ['docker-entrypoint.sh'], Cmd: ['redis-server'], Env: [PATH, 'REDIS_VERSION=7.4.11'],
      ExposedPorts: ['6379/tcp'], Volumes: ['/data'], WorkingDir: '/data',
    },
  },
  {
    ref: 'alpine:3.20', id: 'd9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc', disk: '12.2MB', content: '3.71MB', layers: 1, created: '2025-02-14T03:00:00Z',
    os: 'alpine3.20', program: 'shell', commands: ALPINE,
    config: { Cmd: ['/bin/sh'], Env: [PATH] },
  },
  {
    ref: 'registry:2', disk: '25.4MB', content: '9.37MB', layers: 5, created: '2025-09-30T10:20:00Z',
    os: 'alpine', program: 'registry', commands: ALPINE,
    config: {
      Entrypoint: ['/entrypoint.sh'], Cmd: ['/etc/docker/registry/config.yml'], Env: [PATH, 'OTEL_TRACES_EXPORTER=none'],
      ExposedPorts: ['5000/tcp'], Volumes: ['/var/lib/registry'],
    },
    files: { '/etc/docker/registry/config.yml': 'version: 0.1\nlog:\n  fields:\n    service: registry\nstorage:\n  cache:\n    blobdescriptor: inmemory\n  filesystem:\n    rootdirectory: /var/lib/registry\nhttp:\n  addr: :5000\n', '/entrypoint.sh': '#!/bin/sh\n' },
  },
  {
    ref: 'ubuntu:24.04', disk: '117MB', content: '29.7MB', layers: 1, created: '2026-10-01T06:12:00Z',
    os: 'noble', program: 'shell', commands: [...DEBIAN, 'ps'],
    config: { Cmd: ['/bin/bash'], Env: [PATH] },
  },
];

/** Короткое имя → полное: nginx → nginx:latest; library/ и docker.io/ убираются. */
export function normalizeRef(ref) {
  let name = ref.replace(/^docker\.io\//, '').replace(/^library\//, '');
  if (name.includes('@')) return name;
  const slash = name.lastIndexOf('/');
  if (!name.slice(slash + 1).includes(':')) name += ':latest';
  return name;
}

const CATALOG = new Map(IMAGES.map((image) => [image.ref, image]));
// latest — та же версия, что и основной тег (учебному реестру хватает одной)
for (const [alias, ref] of [['nginx:latest', 'nginx:1.27'], ['postgres:latest', 'postgres:16'],
  ['python:latest', 'python:3.12'], ['redis:latest', 'redis:7'], ['alpine:latest', 'alpine:3.20'],
  ['ubuntu:latest', 'ubuntu:24.04'], ['nginx:alpine', 'nginx:1.27-alpine'], ['python:3.12-alpine', null]]) {
  if (ref) CATALOG.set(alias, CATALOG.get(ref));
}

/** Образ учебного реестра по ссылке или null. */
export function catalogImage(ref) {
  return CATALOG.get(normalizeRef(ref)) ?? null;
}

/** Известен ли реестру репозиторий (есть другие теги) — для текста ошибки pull. */
export function knownRepo(ref) {
  const repo = normalizeRef(ref).replace(/:[^:/]+$/, '');
  return IMAGES.some((image) => image.ref.startsWith(`${repo}:`));
}

export { OS };
