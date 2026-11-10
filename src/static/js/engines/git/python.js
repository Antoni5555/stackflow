// Окружение Python без настоящего Python: python3 -m venv, source …/activate, deactivate,
// pip install / freeze / uninstall / list. Пакеты — из учебного справочника (версии и
// зависимости как у настоящих), ставятся папками в venv/lib/python3.12/site-packages —
// это видно в дереве файлов. Без активного venv pip отвечает как Ubuntu 24.04.

import { FsError, basename, normalize } from '../linux/fs.js';

const PY = 'python3.12';
const PIP_VERSION = '24.0';

/** Учебный справочник: имя → {name (как в freeze), versions (последняя — по умолчанию), deps, size}. */
export const PACKAGES = {
  django: { name: 'Django', versions: ['4.2.17', '5.0.10', '5.1.4'], deps: ['asgiref', 'sqlparse'], size: '8.3 MB' },
  asgiref: { name: 'asgiref', versions: ['3.8.1'], deps: [], size: '23 kB' },
  sqlparse: { name: 'sqlparse', versions: ['0.5.3'], deps: [], size: '44 kB' },
  djangorestframework: { name: 'djangorestframework', versions: ['3.15.2'], deps: ['django'], size: '1.1 MB' },
  requests: { name: 'requests', versions: ['2.31.0', '2.32.3'], deps: ['certifi', 'charset-normalizer', 'idna', 'urllib3'], size: '64 kB' },
  certifi: { name: 'certifi', versions: ['2024.8.30'], deps: [], size: '167 kB' },
  'charset-normalizer': { name: 'charset-normalizer', versions: ['3.4.0'], deps: [], size: '49 kB' },
  idna: { name: 'idna', versions: ['3.10'], deps: [], size: '70 kB' },
  urllib3: { name: 'urllib3', versions: ['2.2.3'], deps: [], size: '126 kB' },
  httpx: { name: 'httpx', versions: ['0.27.2', '0.28.1'], deps: ['anyio', 'certifi', 'httpcore', 'idna'], size: '73 kB' },
  anyio: { name: 'anyio', versions: ['4.7.0'], deps: ['idna', 'sniffio'], size: '93 kB' },
  sniffio: { name: 'sniffio', versions: ['1.3.1'], deps: [], size: '10 kB' },
  httpcore: { name: 'httpcore', versions: ['1.0.7'], deps: ['certifi', 'h11'], size: '78 kB' },
  h11: { name: 'h11', versions: ['0.14.0'], deps: [], size: '58 kB' },
  pytest: { name: 'pytest', versions: ['8.3.4'], deps: ['iniconfig', 'packaging', 'pluggy'], size: '343 kB' },
  'pytest-django': { name: 'pytest-django', versions: ['4.9.0'], deps: ['pytest'], size: '23 kB' },
  iniconfig: { name: 'iniconfig', versions: ['2.0.0'], deps: [], size: '5.9 kB' },
  packaging: { name: 'packaging', versions: ['24.2'], deps: [], size: '65 kB' },
  pluggy: { name: 'pluggy', versions: ['1.5.0'], deps: [], size: '20 kB' },
  gunicorn: { name: 'gunicorn', versions: ['23.0.0'], deps: ['packaging'], size: '85 kB' },
  psycopg: { name: 'psycopg', versions: ['3.1.19', '3.2.3'], deps: ['typing-extensions'], size: '197 kB' },
  'typing-extensions': { name: 'typing_extensions', versions: ['4.12.2'], deps: [], size: '37 kB' },
  'python-dotenv': { name: 'python-dotenv', versions: ['1.0.1'], deps: [], size: '19 kB' },
  pillow: { name: 'pillow', versions: ['11.0.0'], deps: [], size: '4.4 MB' },
  redis: { name: 'redis', versions: ['5.2.1'], deps: [], size: '261 kB' },
  flake8: { name: 'flake8', versions: ['7.1.1'], deps: ['mccabe', 'pycodestyle', 'pyflakes'], size: '57 kB' },
  mccabe: { name: 'mccabe', versions: ['0.7.0'], deps: [], size: '7.3 kB' },
  pycodestyle: { name: 'pycodestyle', versions: ['2.12.1'], deps: [], size: '31 kB' },
  pyflakes: { name: 'pyflakes', versions: ['3.2.0'], deps: [], size: '62 kB' },
};

/** Имя пакета как ключ справочника: Django, django, typing_extensions → django, typing-extensions. */
export const canonical = (name) => name.toLowerCase().replace(/[_.]+/g, '-');

const sitePackages = (venv) => `${venv}/lib/${PY}/site-packages`;
const distInfo = (key, version) => `${canonical(PACKAGES[key]?.name ?? key).replace(/-/g, '_')}-${version}.dist-info`;

// --- venv ---

/** Создать окружение: bin/activate, python, pip; site-packages с самим pip. */
export function createVenv(fs, path) {
  const bin = `${path}/bin`;
  fs.mkdir(bin, { parents: true });
  fs.mkdir(sitePackages(path), { parents: true });
  fs.mkdir(`${path}/include`, { parents: true });
  fs.writeFile(`${path}/pyvenv.cfg`, `home = /usr/bin\ninclude-system-site-packages = false\nversion = 3.12.3\nexecutable = /usr/bin/${PY}\ncommand = /usr/bin/python3 -m venv ${path}\n`);
  // activate — в тренажёре понятный нашей оболочке минимум; права 644, как у настоящего
  fs.writeFile(`${bin}/activate`, `# This file must be used with "source bin/activate" *from bash*
# You cannot run it directly
export VIRTUAL_ENV=${path}
export PATH=${bin}:$PATH
`);
  for (const [name, program] of [['python', 'python'], ['python3', 'python'], [PY, 'python'], ['pip', 'pip'], ['pip3', 'pip']]) {
    const file = fs.createFile(`${bin}/${name}`, { content: '', size: 14336 });
    file.mode = 0o755;
    file.program = program;            // запуск файла — эта команда симулятора внутри venv
    file.venv = path;
  }
  fs.mkdir(`${sitePackages(path)}/pip`);
  fs.mkdir(`${sitePackages(path)}/pip-${PIP_VERSION}.dist-info`);
}

/** Установленные пакеты окружения: {ключ: версия}. */
export function installed(fs, venv) {
  const result = {};
  let entries = [];
  try {
    entries = fs.list(sitePackages(venv));
  } catch (e) {
    return result;
  }
  for (const [name] of entries) {
    const match = /^(.+)-([\w.]+)\.dist-info$/.exec(name);
    if (match && canonical(match[1]) !== 'pip') result[canonical(match[1])] = match[2];
  }
  return result;
}

/** Поставить пакет (без вывода) — для setup.venv.packages. */
export function placePackage(fs, venv, key, version) {
  const site = sitePackages(venv);
  const module = (PACKAGES[key]?.name ?? key).toLowerCase().replace(/-/g, '_');
  if (!fs.exists(`${site}/${module}`)) fs.mkdir(`${site}/${module}`);
  for (const [name] of fs.list(site)) {
    if (name.endsWith('.dist-info') && canonical(name.replace(/-[\w.]+\.dist-info$/, '')) === key) fs.remove(`${site}/${name}`, { recursive: true });
  }
  fs.mkdir(`${site}/${distInfo(key, version)}`);
  fs.writeFile(`${site}/${distInfo(key, version)}/METADATA`, `Metadata-Version: 2.1\nName: ${PACKAGES[key]?.name ?? key}\nVersion: ${version}\n`);
}

function removePackage(fs, venv, key, version) {
  const site = sitePackages(venv);
  const module = (PACKAGES[key]?.name ?? key).toLowerCase().replace(/-/g, '_');
  if (fs.exists(`${site}/${module}`)) fs.remove(`${site}/${module}`, { recursive: true });
  if (fs.exists(`${site}/${distInfo(key, version)}`)) fs.remove(`${site}/${distInfo(key, version)}`, { recursive: true });
}

// --- команды ---

const ok = (out = '') => ({ out, err: '', code: 0 });
const fail = (err, code = 1) => ({ out: '', err, code });

const EXTERNALLY_MANAGED = `error: externally-managed-environment

× This environment is externally managed
╰─> To install Python packages system-wide, try apt install
    python3-xyz, where xyz is the package you are trying to
    install.

    If you wish to install a non-Debian-packaged Python package,
    create a virtual environment using python3 -m venv path/to/venv.
    Then use path/to/venv/bin/python and path/to/venv/bin/pip. Make
    sure you have python3-full installed.

    If you wish to install a non-Debian packaged Python application,
    it may be easiest to use pipx install xyz, which will manage a
    virtual environment for you. Make sure you have pipx installed.

    See /usr/share/doc/python3.12/README.venv for more information.

note: If you believe this is a mistake, please contact your Python installation or OS distribution provider. You can override this, at the risk of breaking your Python installation or OS, by passing --break-system-packages.
hint: See PEP 668 for the detailed specification.
`;

/** Активное окружение: из запуска venv/bin/pip или из VIRTUAL_ENV (source activate). */
const activeVenv = (ctx) => ctx.venv ?? ctx.sh.env.VIRTUAL_ENV ?? null;

/** pip install: список «пакет[==версия]» → установка с зависимостями. */
function install(ctx, venv, specs) {
  const current = installed(ctx.fs, venv);
  const wanted = [];
  for (const spec of specs) {
    const match = /^([A-Za-z0-9_.-]+)\s*(?:(==|>=|~=)\s*([\w.]+))?$/.exec(spec.trim());
    if (!match) return fail(`ERROR: Invalid requirement: '${spec}'\n`);
    const key = canonical(match[1]);
    const info = PACKAGES[key];
    if (!info) {
      return fail(`ERROR: Could not find a version that satisfies the requirement ${spec} (from versions: none)\nERROR: No matching distribution found for ${spec}\n`);
    }
    const version = match[2] === '==' ? match[3] : info.versions[info.versions.length - 1];
    if (!info.versions.includes(version)) {
      return fail(`ERROR: Could not find a version that satisfies the requirement ${spec} (from versions: ${info.versions.join(', ')})\nERROR: No matching distribution found for ${spec}\n`);
    }
    wanted.push([key, version, null, spec.trim()]);
  }
  // зависимости — в ширину, как pip их перечисляет
  const plan = new Map();
  let out = '';
  const queue = [...wanted];
  while (queue.length) {
    const [key, version, parent, written] = queue.shift();
    if (plan.has(key)) continue;
    const info = PACKAGES[key];
    const from = parent ? ` (from ${PACKAGES[parent].name})` : '';
    if (current[key] === version || (parent && current[key])) {
      out += `Requirement already satisfied: ${info.name.toLowerCase()} in ./${sitePackages(basename(venv))} (${current[key]})${from}\n`;
      plan.set(key, null);
    } else {
      out += `Collecting ${parent ? `${info.name.toLowerCase()}${from}` : written}\n  Downloading ${info.name.replace(/-/g, '_')}-${version}-py3-none-any.whl (${info.size})\n`;
      plan.set(key, version);
    }
    for (const dep of info.deps) queue.push([dep, PACKAGES[dep].versions.at(-1), key]);
  }
  const toInstall = [...plan].filter(([, version]) => version).reverse();
  if (!toInstall.length) return ok(out);
  for (const [key, version] of toInstall) {
    if (current[key]) removePackage(ctx.fs, venv, key, current[key]);
    placePackage(ctx.fs, venv, key, version);
  }
  const names = toInstall.map(([key]) => PACKAGES[key].name.toLowerCase());
  const replaced = toInstall.filter(([key]) => current[key]);
  for (const [key] of replaced) {
    out += `  Attempting uninstall: ${PACKAGES[key].name}\n    Found existing installation: ${PACKAGES[key].name} ${current[key]}\n    Uninstalling ${PACKAGES[key].name}-${current[key]}:\n      Successfully uninstalled ${PACKAGES[key].name}-${current[key]}\n`;
  }
  out = `${out}Installing collected packages: ${names.join(', ')}\n`;
  const done = toInstall.map(([key, version]) => `${PACKAGES[key].name}-${version}`).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  return ok(`${out}Successfully installed ${done.join(' ')}\n`);
}

export const pip = {
  help: `pip — пакеты Python (в тренажёре — из учебного списка).
  pip install django            поставить пакет (с зависимостями)
  pip install django==5.0.10    конкретную версию
  pip install -r requirements.txt
  pip freeze > requirements.txt записать версии в файл
  pip list                      список пакетов
  pip uninstall -y django       удалить
Сначала создайте и активируйте окружение: python3 -m venv venv && source venv/bin/activate`,
  run(ctx) {
    const [sub, ...args] = ctx.args;
    const venv = activeVenv(ctx);
    if (sub === '--version' || sub === '-V') {
      const where = venv ? `${sitePackages(venv)}/pip` : '/usr/lib/python3/dist-packages/pip';
      return ok(`pip ${PIP_VERSION} from ${where} (python 3.12)\n`);
    }
    if (!sub) return ok(`${pip.help}\n`);
    if (['install', 'uninstall'].includes(sub) && !venv) return fail(EXTERNALLY_MANAGED);
    if (sub === 'install') {
      const specs = [];
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '-r' || args[i] === '--requirement') {
          const file = args[i + 1];
          i += 1;
          let text;
          try {
            text = ctx.fs.readFile(ctx.sh.resolve(file));
          } catch (e) {
            if (!(e instanceof FsError)) throw e;
            return fail(`ERROR: Could not open requirements file: [Errno 2] No such file or directory: '${file}'\n`);
          }
          specs.push(...text.split('\n').map((line) => line.replace(/#.*/, '').trim()).filter(Boolean));
        } else if (args[i] === '--upgrade' || args[i] === '-U') {
          continue;
        } else if (!args[i].startsWith('-')) {
          specs.push(args[i]);
        }
      }
      if (!specs.length) return fail('ERROR: You must give at least one requirement to install (see "pip help install")\n');
      return install(ctx, venv, specs);
    }
    if (sub === 'uninstall') {
      if (!args.includes('-y') && !args.includes('--yes')) {
        return fail('ERROR: в тренажёре pip не задаёт вопросов — добавьте -y: pip uninstall -y <пакет>\n');
      }
      const current = installed(ctx.fs, venv);
      let out = '';
      for (const name of args.filter((arg) => !arg.startsWith('-'))) {
        const key = canonical(name);
        if (!current[key]) {
          out += `WARNING: Skipping ${name} as it is not installed.\n`;
          continue;
        }
        const display = PACKAGES[key]?.name ?? name;
        removePackage(ctx.fs, venv, key, current[key]);
        out += `Found existing installation: ${display} ${current[key]}\nUninstalling ${display}-${current[key]}:\n  Successfully uninstalled ${display}-${current[key]}\n`;
      }
      return ok(out);
    }
    const all = venv ? installed(ctx.fs, venv) : {};
    const rows = Object.entries(all).map(([key, version]) => [PACKAGES[key]?.name ?? key, version])
      .sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    if (sub === 'freeze') return ok(rows.map(([name, version]) => `${name}==${version}\n`).join(''));
    if (sub === 'list') {
      const list = [...rows, ['pip', PIP_VERSION]].sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
      const width = Math.max(7, ...list.map(([name]) => name.length));
      const vwidth = Math.max(7, ...list.map(([, version]) => version.length));
      return ok(`${'Package'.padEnd(width)} Version\n${'-'.repeat(width)} ${'-'.repeat(vwidth)}\n${list.map(([name, version]) => `${name.padEnd(width)} ${version}\n`).join('')}`);
    }
    return fail(`ERROR: unknown command "${sub}"\n`);
  },
};

export const python = {
  noWhich: true,            // python3 — /usr/bin/python3, python — только в venv: which ищет файлы
  help: `python3 — интерпретатор Python. В этом тренажёре код не выполняется (для кода есть тренажёр Python):
  python3 -m venv venv   создать виртуальное окружение
  python3 -m pip …       то же, что pip
  python3 --version`,
  run(ctx) {
    const venv = activeVenv(ctx);
    // python без 3 есть только внутри venv — как в Ubuntu 24.04
    if (ctx.name === 'python' && !venv) {
      return fail("Command 'python' not found, did you mean:\n  command 'python3' from deb python3\n  command 'python' from deb python-is-python3\n", 127);
    }
    const [first, second, ...rest] = ctx.args;
    if (first === '--version' || first === '-V') return ok('Python 3.12.3\n');
    if (first === '-m' && second === 'venv') {
      const target = rest.find((arg) => !arg.startsWith('-'));
      if (!target) return fail('usage: venv [-h] [--system-site-packages] [--symlinks | --copies] [--clear]\n            ENV_DIR [ENV_DIR ...]\nvenv: error: the following arguments are required: ENV_DIR\n', 2);
      try {
        createVenv(ctx.fs, ctx.sh.resolve(target));
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        return fail(`Error: [Errno 13] ${e.message}: '${ctx.sh.resolve(target)}'\n`);
      }
      return ok();
    }
    if (first === '-m' && second === 'pip') return pip.run({ ...ctx, args: rest });
    if (!first) return fail('в тренажёре нет интерактивного Python — для кода есть тренажёр Python\n');
    return fail(`${ctx.name}: в этом тренажёре Python не выполняет код — для кода есть тренажёр Python\n`);
  },
};

export const deactivate = {
  help: 'deactivate — выйти из виртуального окружения (после source venv/bin/activate).',
  run(ctx) {
    const venv = ctx.sh.env.VIRTUAL_ENV;
    if (!venv) return fail('deactivate: command not found\n', 127);
    ctx.sh.env.PATH = ctx.sh.env.PATH.split(':').filter((dir) => dir !== `${venv}/bin`).join(':');
    delete ctx.sh.env.VIRTUAL_ENV;
    return ok();
  },
};

/** setup.venv: {path, packages: {django: '5.1.4'}} — готовое окружение с пакетами и зависимостями. */
export function buildVenv(fs, cwd, spec) {
  const path = normalize(spec.path ?? 'venv', cwd);
  fs.as('shop', () => {
    createVenv(fs, path);
    for (const [name, version] of Object.entries(spec.packages ?? {})) {
      const queue = [[canonical(name), String(version)]];
      while (queue.length) {
        const [key, ver] = queue.shift();
        if (installed(fs, path)[key]) continue;
        placePackage(fs, path, key, ver ?? PACKAGES[key]?.versions.at(-1));
        for (const dep of PACKAGES[key]?.deps ?? []) queue.push([dep, PACKAGES[dep].versions.at(-1)]);
      }
    }
  });
  return path;
}

