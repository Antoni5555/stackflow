import { makeVenv, pip } from './tools.js';
import { dbConnect, dbParams, migrate } from './db.js';
import { dockerState } from './state.js';

// python внутри образов python:3.12: --version и простые однострочники
// python -c "print(2490 * 2)". Настоящего Python в учебном Docker нет (для кода — тренажёр
// Python), поэтому -c понимает только print() с числами, строками и арифметикой.

const VERSION = 'Python 3.12.16\n';
const LIMIT = 'в учебном Docker python -c понимает только print() с числами и строками — код пишите в тренажёре Python\n';

/** Число Python → текст: 4980, 2490.0, 0.1. */
function repr(value) {
  if (typeof value === 'string') return value;
  if (Number.isInteger(value.n) && !value.float) return String(value.n);
  if (Number.isInteger(value.n)) return `${value.n}.0`;
  return String(value.n);
}

/** Арифметика Python над числами: + - * / // % ** и скобки. null — не понимаем. */
function evaluate(text) {
  const tokens = text.match(/\d+\.\d*|\d+|\*\*|\/\/|[-+*/%()]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const num = (n, float) => ({ n, float });
  function atom() {
    const token = next();
    if (token === '(') {
      const value = sum();
      if (next() !== ')') throw new Error('syntax');
      return value;
    }
    if (token === '-') {
      const value = power();
      return num(-value.n, value.float);
    }
    if (/^\d/.test(token ?? '')) return num(Number(token), token.includes('.'));
    throw new Error('syntax');
  }
  function power() {
    const base = atom();
    if (peek() === '**') {
      next();
      const exp = power();
      return num(base.n ** exp.n, base.float || exp.float || exp.n < 0);
    }
    return base;
  }
  function product() {
    let left = power();
    while (['*', '/', '//', '%'].includes(peek())) {
      const op = next();
      const right = power();
      if ((op !== '*') && right.n === 0) throw new Error('zero');
      const float = left.float || right.float;
      if (op === '*') left = num(left.n * right.n, float);
      else if (op === '/') left = num(left.n / right.n, true);
      else if (op === '//') left = num(Math.floor(left.n / right.n), float);
      else left = num(((left.n % right.n) + right.n) % right.n, float);
    }
    return left;
  }
  function sum() {
    let left = product();
    while (['+', '-'].includes(peek())) {
      const op = next();
      const right = product();
      left = num(op === '+' ? left.n + right.n : left.n - right.n, left.float || right.float);
    }
    return left;
  }
  const value = sum();
  if (i !== tokens.length) throw new Error('syntax');
  return value;
}

/** Аргумент print: 'текст', "текст" или выражение. */
function printArg(text) {
  const quoted = /^\s*(['"])(.*)\1\s*$/.exec(text);
  if (quoted) return quoted[2];
  return repr(evaluate(text));
}

/** manage.py: в образе — только то, что не нужно базе (collectstatic, check). */
/** Файл настроек Django: из DJANGO_SETTINGS_MODULE в manage.py (config.settings → config/settings.py). */
function settingsText(sh, managePath) {
  let manage = '';
  try {
    manage = sh.fs.readFile(managePath);
  } catch (e) {
    return '';
  }
  const module = /DJANGO_SETTINGS_MODULE['"],\s*['"]([\w.]+)['"]/.exec(manage)?.[1] ?? 'config.settings';
  const dir = managePath.replace(/\/[^/]*$/, '');
  try {
    return sh.fs.readFile(`${dir}/${module.replace(/\./g, '/')}.py`);
  } catch (e) {
    return '';
  }
}

/** Подключение приложения к базе (из контейнера, где выполняется команда). */
function connectFrom(sh, code) {
  const hostFs = sh.machine?.hostFs;
  if (!hostFs) return { error: 'connection failed: could not translate host name "db" to address: Temporary failure in name resolution' };
  const self = dockerState(hostFs).containers.find((c) => c.id === sh.machine.container);
  return dbConnect(hostFs, self, dbParams(code, sh.env));
}

const DJANGO_ERROR = (path, error) => `Traceback (most recent call last):
  File "/usr/local/lib/python3.12/site-packages/django/db/backends/base/base.py", line 279, in ensure_connection
    self.connect()
  File "/usr/local/lib/python3.12/site-packages/psycopg/connection.py", line 119, in connect
    raise last_ex.with_traceback(None)
psycopg.OperationalError: ${error}

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "${path}", line 22, in <module>
    main()
  File "/usr/local/lib/python3.12/site-packages/django/db/backends/base/base.py", line 279, in ensure_connection
    self.connect()
django.db.utils.OperationalError: ${error}
`;

/** manage.py: collectstatic и check — без базы; migrate — подключается к базе из настроек. */
function manage(sh, args) {
  const path = sh.resolve(args[0]);
  if (!sh.fs.exists(path)) {
    return { err: `python: can't open file '${path}': [Errno 2] No such file or directory\n`, code: 2 };
  }
  if (!sh.fs.root.pipInstalled?.django) {
    return { err: `Traceback (most recent call last):\n  File "${path}", line 11, in main\n    from django.core.management import execute_from_command_line\nModuleNotFoundError: No module named 'django'\n`, code: 1 };
  }
  if (args[1] === 'collectstatic') {
    sh.fs.as('root', () => {
      const root = sh.resolve('staticfiles');
      // статика админки Django: base.css и др. (размеры как у Django 5.2)
      for (const [file, size] of [['admin/css/base.css', 22120], ['admin/css/login.css', 951], ['admin/css/responsive.css', 16565], ['admin/js/core.js', 6208]]) {
        sh.fs.mkdirAs(`${root}/${file.replace(/\/[^/]*$/, '')}`, sh.fs.user);
        sh.fs.writeFile(`${root}/${file}`, 'x'.repeat(size));
      }
    });
    return { out: `\n127 static files copied to '${sh.resolve('staticfiles')}'.\n` };
  }
  if (args[1] === 'check') return { out: 'System check identified no issues (0 silenced).\n' };
  if (args[1] === 'migrate' || args[1] === 'showmigrations') {
    const settings = settingsText(sh, path);
    if (/sqlite3/.test(settings)) return { out: 'Operations to perform:\n  Apply all migrations: admin, auth, contenttypes, sessions\nRunning migrations:\n  No migrations to apply.\n' };
    const connection = connectFrom(sh, settings);
    if (connection.error) return { err: DJANGO_ERROR(path, connection.error), code: 1 };
    return { out: `${migrate(connection).join('\n')}\n` };
  }
  return { err: `в учебном Docker manage.py ${args[1] ?? ''} не запускается — есть migrate, collectstatic, check\n`, code: 1 };
}

/** python скрипт.py: print(...) и psycopg.connect(...) — остальной код не выполняется. */
function script(sh, file) {
  const path = sh.resolve(file);
  let code;
  try {
    code = sh.fs.readFile(path);
  } catch (e) {
    return { err: `python: can't open file '${path}': [Errno 2] No such file or directory\n`, code: 2 };
  }
  let out = '';
  const lines = code.split('\n');
  for (const [k, line] of lines.entries()) {
    const imported = /^\s*import\s+(psycopg2?|django|requests)\b|^\s*from\s+(psycopg2?|django|requests)\b/.exec(line);
    const module = imported?.[1] ?? imported?.[2];
    const installed = sh.fs.root.pipInstalled ?? {};
    if (module && !installed[module] && !(module === 'psycopg' && installed['psycopg-binary'])) {
      return { out, err: `Traceback (most recent call last):\n  File "${path}", line ${k + 1}, in <module>\n    ${line.trim()}\nModuleNotFoundError: No module named '${module}'\n`, code: 1 };
    }
    if (/psycopg2?\.connect\(/.test(line)) {
      const connection = connectFrom(sh, line);
      if (connection.error) {
        const shown = line.trim();
        return {
          out,
          err: `Traceback (most recent call last):\n  File "${path}", line ${k + 1}, in <module>\n    ${shown}\n    ${'^'.repeat(Math.max(1, shown.replace(/\.close\(\)$/, '').length))}\n  File "/usr/local/lib/python3.12/site-packages/psycopg/connection.py", line 119, in connect\n    raise last_ex.with_traceback(None)\npsycopg.OperationalError: ${connection.error}\n`,
          code: 1,
        };
      }
    }
    const printed = /^\s*print\(\s*f?(["'])(.*)\1\s*\)\s*$/.exec(line);
    if (printed) out += `${printed[2].replace(/\{([^}]*)\}/g, (_, expr) => sh.env[/["'](\w+)["']/.exec(expr)?.[1]] ?? '')}\n`;
  }
  return { out };
}

export const python = {
  help: 'python — Python 3.12 в контейнере: python --version, python -c "print(2 * 3)".',
  run({ sh, args }) {
    if (args[0] === '--version' || args[0] === '-V') return { out: VERSION };
    // python -m venv ПАПКА — виртуальное окружение (в Dockerfile при многоэтапной сборке)
    if (args[0] === '-m' && args[1] === 'venv' && args[2]) {
      makeVenv(sh, args.at(-1));
      return {};
    }
    if (args[0] === '-m' && args[1] === 'pip') return pip.run({ sh, args: args.slice(2) });
    if (args[0] === 'manage.py' || args[0]?.endsWith('/manage.py')) return manage(sh, args);
    if (args[0]?.endsWith('.py')) return script(sh, args[0]);
    if (args[0] !== '-c') {
      if (!args.length) return {};     // без терминала: читает пустой ввод и выходит
      return { err: LIMIT, code: 1 };
    }
    if (args.length < 2) return { err: 'Argument expected for the -c option\nusage: python3 [option] ... [-c cmd | -m mod | file | -] [arg] ...\nTry `python -h\' for more information.\n', code: 2 };
    const lines = [];
    for (const statement of args[1].split(/;|\n/).map((part) => part.trim()).filter(Boolean)) {
      const call = /^print\((.*)\)$/.exec(statement);
      if (!call) return { out: lines.join(''), err: LIMIT, code: 1 };
      try {
        const parts = call[1].trim() ? call[1].split(',').map(printArg) : [];
        lines.push(`${parts.join(' ')}\n`);
      } catch (e) {
        if (e.message === 'zero') {
          return { out: lines.join(''), err: 'Traceback (most recent call last):\n  File "<string>", line 1, in <module>\nZeroDivisionError: division by zero\n', code: 1 };
        }
        return { out: lines.join(''), err: LIMIT, code: 1 };
      }
    }
    return { out: lines.join('') };
  },
};
