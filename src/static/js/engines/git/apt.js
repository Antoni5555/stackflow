// apt — пакеты Ubuntu (учебный справочник): ставить можно только через sudo, без него —
// настоящая ошибка блокировки dpkg. Установленное хранится в корне ФС (fs.root.apt)
// и видно файлами: /usr/sbin/nginx, /etc/nginx/… .

const ok = (out = '') => ({ out, err: '', code: 0 });
const fail = (err, code = 100) => ({ out: '', err, code });

/** Справочник: пакет → версия, файлы, которые появятся (путь → текст или null — программа). */
export const APT = {
  nginx: {
    version: '1.24.0-2ubuntu7.1',
    files: {
      '/usr/sbin/nginx': null,
      '/etc/nginx/nginx.conf': 'user www-data;\nworker_processes auto;\n\nhttp {\n    include /etc/nginx/sites-enabled/*;\n}\n',
      '/etc/nginx/sites-available/default': 'server {\n    listen 80 default_server;\n    root /var/www/html;\n}\n',
      '/var/www/html/index.nginx-debian.html': '<h1>Welcome to nginx!</h1>\n',
    },
    links: { '/etc/nginx/sites-enabled/default': '/etc/nginx/sites-available/default' },
  },
  git: { version: '1:2.43.0-1ubuntu7.1', files: { '/usr/bin/git': null } },
  curl: { version: '8.5.0-2ubuntu10.5', files: { '/usr/bin/curl': null } },
  tree: { version: '2.1.1-2ubuntu3', files: { '/usr/bin/tree': null } },
  htop: { version: '3.3.0-4build1', files: { '/usr/bin/htop': null } },
  'python3-venv': { version: '3.12.3-0ubuntu2', files: {} },
  'python3-pip': { version: '24.0+dfsg-1ubuntu1.1', files: { '/usr/bin/pip3': null } },
  postgresql: { version: '16+257build1.1', files: { '/usr/lib/postgresql/16/bin/postgres': null, '/etc/postgresql/16/main/postgresql.conf': "listen_addresses = 'localhost'\n" } },
  'redis-server': { version: '5:7.0.15-1build2', files: { '/usr/bin/redis-server': null, '/etc/redis/redis.conf': 'bind 127.0.0.1\nport 6379\n' } },
};

/** Пакеты, которые уже стоят на сервере. */
const PREINSTALLED = ['git', 'curl', 'python3-venv', 'python3-pip'];

function installedSet(fs) {
  fs.root.apt ??= [...PREINSTALLED];
  return fs.root.apt;
}

const LOCK = `E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)
E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?
`;

export const apt = {
  help: `apt — пакеты Ubuntu (нужен sudo).
  sudo apt update           обновить списки пакетов
  sudo apt install nginx    поставить пакет
  sudo apt remove nginx     удалить
В тренажёре — учебный набор: nginx, postgresql, redis-server, tree, htop, curl, git.`,
  run(ctx) {
    const [sub, ...args] = ctx.args;
    const names = args.filter((arg) => !arg.startsWith('-'));
    if (!sub) return ok(`${apt.help}\n`);
    if (sub === 'list' && args.includes('--installed')) {
      return ok(`Listing... Done\n${installedSet(ctx.fs).sort().map((name) => `${name}/noble,now ${APT[name].version} amd64 [installed]\n`).join('')}`);
    }
    if (!['update', 'install', 'remove', 'upgrade'].includes(sub)) return fail(`E: Invalid operation ${sub}\n`);
    if (ctx.fs.user !== 'root') return fail(LOCK);
    if (sub === 'update' || sub === 'upgrade') {
      return ok('Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease\nHit:2 http://security.ubuntu.com/ubuntu noble-security InRelease\nReading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\nAll packages are up to date.\n');
    }
    const list = installedSet(ctx.fs);
    let out = 'Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n';
    for (const name of names) {
      if (!APT[name]) return fail(`${out}E: Unable to locate package ${name}\n`);
    }
    if (sub === 'remove') {
      for (const name of names) {
        if (!list.includes(name)) {
          out += `Package '${name}' is not installed, so not removed\n`;
          continue;
        }
        for (const path of Object.keys(APT[name].files)) if (ctx.fs.exists(path)) ctx.fs.remove(path);
        list.splice(list.indexOf(name), 1);
        out += `Removing ${name} (${APT[name].version}) ...\n`;
      }
      return ok(out);
    }
    const fresh = names.filter((name) => !list.includes(name));
    for (const name of names.filter((item) => list.includes(item))) {
      out += `${name} is already the newest version (${APT[name].version}).\n`;
    }
    if (!fresh.length) return ok(`${out}0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n`);
    out += `The following NEW packages will be installed:\n  ${fresh.join(' ')}\n0 upgraded, ${fresh.length} newly installed, 0 to remove and 0 not upgraded.\n`;
    for (const name of fresh) {
      const pkg = APT[name];
      for (const [path, text] of Object.entries(pkg.files)) {
        ctx.fs.mkdir(path.slice(0, path.lastIndexOf('/')), { parents: true });
        if (text === null) {
          const file = ctx.fs.createFile(path, { content: '', size: 1205632 });
          file.mode = 0o755;
        } else if (!ctx.fs.exists(path)) {
          ctx.fs.writeFile(path, text);
        }
      }
      for (const [path, target] of Object.entries(pkg.links ?? {})) {
        ctx.fs.mkdir(path.slice(0, path.lastIndexOf('/')), { parents: true });
        if (!ctx.fs.exists(path, { follow: false })) ctx.fs.symlink(target, path);
      }
      list.push(name);
      out += `Setting up ${name} (${pkg.version}) ...\n`;
    }
    return ok(out);
  },
};
