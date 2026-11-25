// Инструменты внутри образов, нужные для сборки: pip install, apt-get, useradd, python -m venv,
// manage.py collectstatic. Сети в тренажёре нет — пакеты не скачиваются по-настоящему:
// pip и apt-get пишут свой обычный вывод и кладут в ФС файлы нужного размера (слой растёт).

import { USERS, GROUPS, normalize } from '../linux/fs.js';

const SITE = 'lib/python3.12/site-packages';

/** Пакеты PyPI: версия, размер после установки, зависимости. */
const PYPI = {
  gunicorn: { version: '23.0.0', size: 11_200_000, wheel: '85 kB', meta: '4.4 kB', deps: ['packaging'], bin: ['gunicorn'] },
  packaging: { version: '26.4', size: 500_000, wheel: '129 kB', meta: '3.5 kB' },
  django: { version: '5.2.8', size: 33_800_000, wheel: '8.3 MB', meta: '4.1 kB', deps: ['asgiref', 'sqlparse'], bin: ['django-admin'], name: 'Django' },
  asgiref: { version: '3.10.0', size: 310_000, wheel: '24 kB', meta: '9.3 kB' },
  sqlparse: { version: '0.5.3', size: 420_000, wheel: '44 kB', meta: '3.9 kB' },
  psycopg: { version: '3.2.12', size: 1_100_000, wheel: '206 kB', meta: '4.5 kB', deps: ['typing-extensions'] },
  'psycopg-binary': { version: '3.2.12', size: 12_400_000, wheel: '4.4 MB', meta: '2.7 kB', name: 'psycopg-binary' },
  'psycopg2-binary': { version: '2.9.11', size: 9_100_000, wheel: '3.0 MB', meta: '4.9 kB', name: 'psycopg2-binary' },
  psycopg2: { version: '2.9.11', size: 1_600_000, wheel: '379 kB', meta: '4.9 kB', source: true },
  'typing-extensions': { version: '4.15.0', size: 270_000, wheel: '44 kB', meta: '3.3 kB', name: 'typing_extensions' },
  pillow: { version: '12.0.0', size: 13_600_000, wheel: '7.0 MB', meta: '8.8 kB', name: 'pillow' },
  whitenoise: { version: '6.11.0', size: 240_000, wheel: '20 kB', meta: '3.7 kB' },
  requests: { version: '2.32.5', size: 440_000, wheel: '64 kB', meta: '4.9 kB', deps: ['charset-normalizer', 'idna', 'urllib3', 'certifi'] },
  'charset-normalizer': { version: '3.4.4', size: 780_000, wheel: '153 kB', meta: '37 kB', name: 'charset_normalizer' },
  idna: { version: '3.11', size: 380_000, wheel: '71 kB', meta: '8.4 kB' },
  urllib3: { version: '2.5.0', size: 720_000, wheel: '129 kB', meta: '6.5 kB' },
  certifi: { version: '2025.11.12', size: 310_000, wheel: '159 kB', meta: '2.5 kB' },
  'python-dotenv': { version: '1.2.1', size: 150_000, wheel: '21 kB', meta: '25 kB', name: 'python_dotenv', bin: ['dotenv'] },
  redis: { version: '7.0.1', size: 2_900_000, wheel: '339 kB', meta: '12 kB' },
  uvicorn: { version: '0.38.0', size: 620_000, wheel: '68 kB', meta: '6.6 kB', deps: ['click', 'h11'], bin: ['uvicorn'] },
  click: { version: '8.3.1', size: 560_000, wheel: '108 kB', meta: '2.6 kB' },
  h11: { version: '0.16.0', size: 290_000, wheel: '37 kB', meta: '8.3 kB' },
};

const DEBIAN_PACKAGES = {
  libpq5: { version: '17.6-0+deb13u1', size: 950_000, download: '228 kB' },
  'libpq-dev': { version: '17.6-0+deb13u1', size: 2_300_000, download: '151 kB', deps: ['libpq5'], files: ['/usr/bin/pg_config'] },
  gcc: { version: '4:14.2.0-1', size: 178_000_000, download: '42.6 MB', files: ['/usr/bin/gcc'] },
  'libc6-dev': { version: '2.41-12', size: 12_300_000, download: '1904 kB' },
  'build-essential': { version: '12.12', size: 240_000_000, download: '60.1 MB', files: ['/usr/bin/gcc', '/usr/bin/make'] },
  curl: { version: '8.14.1-2', size: 1_500_000, download: '269 kB', files: ['/usr/bin/curl'] },
  'netcat-openbsd': { version: '1.229-1', size: 120_000, download: '44.1 kB', files: ['/usr/bin/nc'] },
  gettext: { version: '0.23.1-2', size: 7_100_000, download: '1612 kB' },
};

const record = (sh, path, size) => {
  sh.fs.as('root', () => {
    sh.fs.mkdirAs(path.split('/').slice(0, -1).join('/'), 'root');
    try {
      sh.fs.remove(path);
    } catch (e) {
      // нового файла ещё нет
    }
    const node = sh.fs.createFile(path, { size, heavy: true });
    node.mode = 0o755;
  });
};

// --- pip ---

/** Куда ставит pip: виртуальное окружение из PATH (там есть pip) или /usr/local. */
function prefix(sh) {
  for (const dir of (sh.env.PATH ?? '').split(':')) {
    if (/venv\/bin$|\/\.venv\/bin$/.test(dir) && sh.fs.exists(`${dir}/pip`)) return dir.replace(/\/bin$/, '');
  }
  return '/usr/local';
}

function requirement(line) {
  const match = /^([A-Za-z0-9_.-]+)(\[[^\]]*\])?\s*(==|>=|~=|<=|>|<)?\s*([^;\s#]*)/.exec(line.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase().replace(/_/g, '-'), extras: match[2] ?? '', op: match[3], version: match[4], raw: line.trim() };
}

export const pip = {
  help: 'pip install -r requirements.txt — установить пакеты (в тренажёре — без сети, имитация).',
  run({ sh, args }) {
    if (args[0] === '--version' || args[0] === '-V') return { out: `pip 25.0.1 from ${prefix(sh)}/${SITE}/pip (python 3.12)\n` };
    if (args[0] === 'list' || args[0] === 'freeze') {
      const installed = sh.fs.root.pipInstalled ?? {};
      const names = Object.keys(installed).sort();
      if (args[0] === 'freeze') return { out: names.map((name) => `${PYPI[name]?.name ?? name}==${installed[name]}\n`).join('') };
      const width = Math.max(7, ...names.map((name) => name.length));
      return { out: `${'Package'.padEnd(width)} Version\n${'-'.repeat(width)} -------\n${[['pip', '25.0.1'], ...names.map((name) => [PYPI[name]?.name ?? name, installed[name]])].map(([n, v]) => `${n.padEnd(width)} ${v}\n`).join('')}` };
    }
    if (args[0] !== 'install') return { err: `ERROR: unknown command "${args[0] ?? ''}"\n`, code: 1 };
    const wanted = [];
    for (let i = 1; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '-r' || arg === '--requirement') {
        const file = args[(i += 1)];
        let text;
        try {
          text = sh.fs.readFile(sh.resolve(file));
        } catch (e) {
          return { err: `ERROR: Could not open requirements file: [Errno 2] No such file or directory: '${file}'\n`, code: 1 };
        }
        text.split('\n').forEach((line, n) => {
          const req = !line.trim().startsWith('#') && line.trim() ? requirement(line) : null;
          if (req) wanted.push({ ...req, from: `-r ${file} (line ${n + 1})` });
        });
      } else if (!arg.startsWith('-')) {
        const req = requirement(arg);
        if (req) wanted.push(req);
      }
    }
    if (!wanted.length) return { err: 'ERROR: You must give at least one requirement to install (see "pip help install")\n', code: 1 };
    const out = [];
    const installed = (sh.fs.root.pipInstalled ??= {});
    const toInstall = [];
    const visit = (req, parent = null) => {
      const info = PYPI[req.name] ?? { version: req.version || '1.0.0', size: 1_000_000, wheel: '120 kB', meta: '3.0 kB' };
      const name = info.name ?? req.name;
      const version = req.op === '==' && req.version ? req.version : info.version;
      if (toInstall.some((item) => item.key === req.name)) return;
      if (installed[req.name]) {
        out.push(`Requirement already satisfied: ${name}${req.op ? `${req.op}${req.version}` : ''} in ${prefix(sh)}/${SITE} (from ${parent ?? req.from ?? name}) (${installed[req.name]})`);
        return;
      }
      const spec = parent ? `${name}` : `${req.raw}`;
      out.push(`Collecting ${spec}${parent ? ` (from ${parent})` : req.from ? ` (from ${req.from})` : ''}`);
      out.push(`  Downloading ${name.replace(/-/g, '_')}-${version}-py3-none-any.whl.metadata (${info.meta})`);
      toInstall.push({ key: req.name, name, version, info });
      if (req.extras.includes('binary') && req.name === 'psycopg') visit({ name: 'psycopg-binary', raw: 'psycopg-binary', extras: '' }, `${req.raw}`);
      for (const dep of info.deps ?? []) visit({ name: dep, raw: dep, extras: '' }, `${name}==${version}->${req.from ?? req.raw}`);
    };
    for (const req of wanted) visit(req);
    // psycopg2 из исходников: нужен pg_config (apt-get install libpq-dev) и компилятор
    const source = toInstall.find((item) => item.info.source);
    if (source && !sh.fs.exists('/usr/bin/pg_config')) {
      out.push(`  Downloading ${source.name}-${source.version}.tar.gz (${source.info.wheel})`, '  Installing build dependencies: started',
        "  Installing build dependencies: finished with status 'done'", '  Getting requirements to build wheel: started',
        "  Getting requirements to build wheel: finished with status 'error'", '  error: subprocess-exited-with-error', '  ',
        '  × Getting requirements to build wheel did not run successfully.', '  │ exit code: 1', '  ╰─> [8 lines of output]',
        '      Error: pg_config executable not found.', '      ',
        '      pg_config is required to build psycopg2 from source.  Please add the directory',
        '      containing pg_config to the $PATH or specify the full executable path with the',
        '      option:', '      ', '          python setup.py build_ext --pg-config /path/to/pg_config build ...', '      [end of output]',
        '  ', '  note: This error originates from a subprocess, and is likely not a problem with pip.');
      return { out: `${out.join('\n')}\n`, err: 'error: subprocess-exited-with-error\n\n× Getting requirements to build wheel did not run successfully.\n│ exit code: 1\n╰─> See above for output.\n\nnote: This error originates from a subprocess, and is likely not a problem with pip.\n', code: 1 };
    }
    for (const item of toInstall) out.push(`Downloading ${item.name.replace(/-/g, '_')}-${item.version}-py3-none-any.whl (${item.info.wheel})`);
    if (toInstall.length) {
      const root = prefix(sh);
      for (const item of toInstall) {
        record(sh, `${root}/${SITE}/${item.name.replace(/-/g, '_').toLowerCase()}/__init__.py`, item.info.size);
        for (const bin of item.info.bin ?? []) record(sh, `${root}/bin/${bin}`, 230);
        installed[item.key] = item.version;
        sh.machine?.build?.sizes.push(item.info.size);
      }
      const names = [...toInstall].reverse();
      out.push(`Installing collected packages: ${names.map((item) => item.name).join(', ')}`);
      out.push(`Successfully installed ${names.map((item) => `${item.name}-${item.version}`).join(' ')}`);
    }
    const err = sh.fs.user === 'root' && prefix(sh) === '/usr/local'
      ? "WARNING: Running pip as the 'root' user can result in broken permissions and conflicting behaviour with the system package manager, possibly rendering your system unusable. It is recommended to use a virtual environment instead: https://pip.pypa.io/warnings/venv. Use the --root-user-action option if you know what you are doing and want to suppress this warning.\n\n[notice] A new release of pip is available: 25.0.1 -> 26.3\n[notice] To update, run: pip install --upgrade pip\n"
      : '\n[notice] A new release of pip is available: 25.0.1 -> 26.3\n[notice] To update, run: pip install --upgrade pip\n';
    // pip пишет сначала ход установки, потом предупреждения — порядок важен в выводе сборки
    return { chunks: [{ text: `${out.join('\n')}\n`, err: false }, { text: err, err: true }], code: 0 };
  },
};

// --- apt-get ---

export const aptGet = {
  help: 'apt-get update; apt-get install -y пакет — системные пакеты образа (имитация, без сети).',
  run({ sh, args }) {
    const [command, ...rest] = args.filter((arg) => !arg.startsWith('-'));
    const yes = args.includes('-y') || args.includes('--yes') || args.includes('-qq');
    if (sh.fs.user !== 'root') {
      return { err: 'E: List directory /var/lib/apt/lists/partial is missing. - Acquire (13: Permission denied)\n', code: 100 };
    }
    const lists = '/var/lib/apt/lists/deb.debian.org_debian_dists_trixie_main_binary-amd64_Packages.lz4';
    if (command === 'update') {
      record(sh, lists, 19_400_000);
      return { out: 'Get:1 http://deb.debian.org/debian trixie InRelease [140 kB]\nGet:2 http://deb.debian.org/debian trixie-updates InRelease [47.3 kB]\nGet:3 http://deb.debian.org/debian-security trixie-security InRelease [43.4 kB]\nGet:4 http://deb.debian.org/debian trixie/main amd64 Packages [9670 kB]\nGet:5 http://deb.debian.org/debian trixie-updates/main amd64 Packages [5412 B]\nGet:6 http://deb.debian.org/debian-security trixie-security/main amd64 Packages [64.2 kB]\nFetched 9970 kB in 1s (8642 kB/s)\nReading package lists...\n' };
    }
    if (command === 'install') {
      if (!sh.fs.exists(lists)) {
        return { out: 'Reading package lists...\nBuilding dependency tree...\nReading state information...\n', err: `E: Unable to locate package ${rest[0]}\n`, code: 100 };
      }
      const names = [];
      const add = (name) => {
        if (names.includes(name)) return;
        for (const dep of DEBIAN_PACKAGES[name]?.deps ?? []) add(dep);
        names.push(name);
      };
      rest.forEach(add);
      const packages = names.map((name) => ({ name, ...(DEBIAN_PACKAGES[name] ?? { version: '1.0-1', size: 1_000_000, download: '250 kB' }) }));
      const total = packages.reduce((sum, item) => sum + item.size, 0);
      const out = ['Reading package lists...', 'Building dependency tree...', 'Reading state information...',
        'The following NEW packages will be installed:', `  ${names.join(' ')}`,
        `0 upgraded, ${names.length} newly installed, 0 to remove and 0 not upgraded.`,
        `Need to get ${packages.length === 1 ? packages[0].download : `${(total / 4_200_000).toFixed(1)} MB`} of archives.`,
        `After this operation, ${total >= 1e6 ? `${(total / 1e6).toFixed(1)} MB` : `${Math.round(total / 1000)} kB`} of additional disk space will be used.`];
      if (!yes) return { out: `${out.join('\n')}\nDo you want to continue? [Y/n] Abort.\n`, code: 1 };
      packages.forEach((item, n) => out.push(`Get:${n + 1} http://deb.debian.org/debian trixie/main amd64 ${item.name} amd64 ${item.version} [${item.download}]`));
      out.push(`Fetched ${packages.length === 1 ? packages[0].download : `${(total / 4_200_000).toFixed(1)} MB`} in 0s (3105 kB/s)`);
      for (const item of packages) {
        out.push(`Selecting previously unselected package ${item.name}:amd64.`, `Preparing to unpack .../${item.name}_${item.version}_amd64.deb ...`,
          `Unpacking ${item.name}:amd64 (${item.version}) ...`);
      }
      for (const item of packages) {
        out.push(`Setting up ${item.name}:amd64 (${item.version}) ...`);
        record(sh, `/usr/share/doc/${item.name}/.installed`, item.size);
        for (const file of item.files ?? []) record(sh, file, 1024);
        sh.machine?.build?.sizes.push(item.size);
      }
      out.push('Processing triggers for libc-bin (2.41-12) ...');
      return { out: `${out.join('\n')}\n`, err: 'debconf: unable to initialize frontend: Dialog\ndebconf: (TERM is not set, so the dialog frontend is not usable.)\ndebconf: falling back to frontend: Readline\n' };
    }
    return { err: `E: Invalid operation ${command ?? ''}\n`, code: 100 };
  },
};

// --- useradd ---

export const useradd = {
  help: 'useradd [-m] [-u UID] имя — добавить пользователя в образ.',
  run({ sh, args }) {
    const home = args.includes('-m') || args.includes('--create-home');
    let uid = 1000;
    const names = [];
    for (let i = 0; i < args.length; i += 1) {
      if (['-u', '--uid'].includes(args[i])) uid = Number(args[(i += 1)]);
      else if (['-g', '-s', '-d', '-G', '--shell', '--home-dir', '--gid'].includes(args[i])) i += 1;
      else if (!args[i].startsWith('-')) names.push(args[i]);
    }
    const [name] = names;
    if (!name) return { err: 'Usage: useradd [options] LOGIN\n', code: 2 };
    if (sh.fs.user !== 'root') return { err: 'useradd: Permission denied.\nuseradd: cannot lock /etc/passwd; try again later.\n', code: 1 };
    let passwd = '';
    try {
      passwd = sh.fs.readFile('/etc/passwd');
    } catch (e) {
      passwd = 'root:x:0:0:root:/root:/bin/bash\n';
    }
    if (passwd.split('\n').some((line) => line.startsWith(`${name}:`))) return { err: `useradd: user '${name}' already exists\n`, code: 9 };
    sh.fs.as('root', () => sh.fs.writeFile('/etc/passwd', `${passwd}${name}:x:${uid}:${uid}::/home/${name}:/bin/sh\n`));
    USERS[name] ??= { uid, groups: [name] };
    GROUPS[name] ??= uid;
    if (home) sh.fs.as('root', () => Object.assign(sh.fs.mkdirAs(`/home/${name}`, name), { mode: 0o755 }));
    return {};
  },
};

/** python -m venv ПАПКА: окружение с bin/python, bin/pip. */
export function makeVenv(sh, dir) {
  const root = normalize(dir, sh.cwd);
  sh.fs.as('root', () => {
    for (const name of ['python', 'python3', 'pip', 'activate']) {
      const path = `${root}/bin/${name}`;
      sh.fs.mkdirAs(`${root}/bin`, sh.fs.user);
      sh.fs.writeFile(path, name === 'activate' ? `# source ${root}/bin/activate\nexport VIRTUAL_ENV=${root}\nexport PATH="${root}/bin:$PATH"\n` : '');
      const node = sh.fs.lookup(path);
      node.mode = 0o755;
      if (name !== 'activate') node.program = name === 'pip' ? 'pip' : 'python';
    }
    sh.fs.mkdirAs(`${root}/${SITE}`, sh.fs.user);
    sh.fs.writeFile(`${root}/pyvenv.cfg`, 'home = /usr/local/bin\ninclude-system-site-packages = false\nversion = 3.12.16\n');
  });
  sh.machine?.build?.sizes.push(18_600_000);
}

export const TOOLS = { pip, pip3: pip, 'apt-get': aptGet, apt: aptGet, useradd };
