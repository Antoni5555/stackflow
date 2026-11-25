// Своё приложение в контейнере: gunicorn и manage.py runserver из собранного образа.
// Код Python не выполняется: модуль WSGI находится по пути, ответ берётся из него —
// Django (get_wsgi_application) отвечает как Django-приложение сервера, простой WSGI —
// текстом из return [...]. Логи gunicorn и runserver — как у настоящих (образцы «Контента»).

import { now } from '../linux/clock.js';
import { FsError, normalize } from '../linux/fs.js';
import { appResponse } from '../linux/network.js';
import { utcParts } from './format.js';
import { withContainerFs } from './state.js';
import { dbConnect, dbParams, migrated } from './db.js';

const stamp = (ms) => {
  const p = utcParts(ms);
  return `[${p.year}-${p.month}-${p.day} ${p.time} +0000]`;
};

/** Что за приложение запускают слова команды: gunicorn | runserver | null. */
export function appKind(words) {
  const name = words[0]?.split('/').pop();
  if (words.includes('--version') || words.includes('-v') || words.includes('--help') || words.includes('-h')) return null;
  if (name === 'gunicorn' || (/^python3?$/.test(name ?? '') && words[1] === '-m' && words[2] === 'gunicorn')) return 'gunicorn';
  if (words.some((word) => word.endsWith('manage.py')) && words.includes('runserver')) return 'runserver';
  return null;
}

/** Есть ли программа в PATH контейнера (pip поставил gunicorn в /usr/local/bin или в venv). */
export function inPath(fs, env, name) {
  if (name.includes('/')) return fs.exists(normalize(name));
  const path = env.find((item) => item.startsWith('PATH='))?.slice(5) ?? '/usr/local/bin:/usr/bin:/bin';
  return path.split(':').some((dir) => fs.as('root', () => fs.exists(`${dir}/${name}`)));
}

function parseGunicorn(words) {
  const args = words[0].endsWith('gunicorn') ? words.slice(1) : words.slice(3);
  let bind = '127.0.0.1:8000';
  let workers = 1;
  let chdir = null;
  let module = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-b' || arg === '--bind') bind = args[(i += 1)];
    else if (arg.startsWith('--bind=')) bind = arg.slice(7);
    else if (arg === '-w' || arg === '--workers') workers = Number(args[(i += 1)]) || 1;
    else if (arg.startsWith('--workers=')) workers = Number(arg.slice(10)) || 1;
    else if (arg === '--chdir') chdir = args[(i += 1)];
    else if (arg.startsWith('-')) {
      if (!arg.includes('=') && args[i + 1] && !args[i + 1].startsWith('-') && i + 1 < args.length - 1) i += 1;
    } else module = arg;
  }
  return { bind, workers, chdir, module };
}

const hostPort = (bind) => {
  const match = /^(?:(.*):)?(\d+)$/.exec(bind);
  return { host: match?.[1] || '0.0.0.0', port: Number(match?.[2] ?? 8000) };
};

/** Файл модуля «shop.wsgi» в папке cwd → путь или null. */
function moduleFile(fs, cwd, module) {
  const path = normalize(`${module.split(':')[0].replace(/\./g, '/')}.py`, cwd);
  return fs.as('root', () => (fs.exists(path) ? path : null));
}

/** Запуск gunicorn/runserver: {listen, bind, procs} или {exit}. Логи — в container.logs. */
export function startApp(hostFs, container, words) {
  const kind = appKind(words);
  const log = (text, err = true) => container.logs.push({ t: now(), err, text });
  return withContainerFs(hostFs, container, (fs) => {
    const cwd = container.workdir || '/';
    if (kind === 'gunicorn') {
      const opts = parseGunicorn(words);
      const { host, port } = hostPort(opts.bind);
      const t = stamp(now());
      log(`${t} [1] [INFO] Starting gunicorn 23.0.0`);
      log(`${t} [1] [INFO] Listening at: http://${host}:${port} (1)`);
      log(`${t} [1] [INFO] Using worker: sync`);
      log(`${t} [7] [INFO] Booting worker with pid: 7`);
      const file = opts.module ? moduleFile(fs, opts.chdir ?? cwd, opts.module) : null;
      if (!file) {
        const name = (opts.module ?? '').split(/[.:]/)[0];
        log(`${t} [7] [ERROR] Exception in worker process`);
        for (const line of ['Traceback (most recent call last):',
          '  File "/usr/local/lib/python3.12/site-packages/gunicorn/arbiter.py", line 608, in spawn_worker',
          '    worker.init_process()',
          '  File "/usr/local/lib/python3.12/site-packages/gunicorn/util.py", line 370, in import_app',
          '    mod = importlib.import_module(module)',
          '          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
          `ModuleNotFoundError: No module named '${name}'`]) log(line);
        log(`${t} [7] [INFO] Worker exiting (pid: 7)`);
        log(`${t} [1] [ERROR] Worker (pid:7) exited with code 3`);
        log(`${t} [1] [ERROR] Shutting down: Master`);
        log(`${t} [1] [ERROR] Reason: Worker failed to boot.`);
        return { exit: 3 };
      }
      for (let n = 1; n < opts.workers; n += 1) log(`${t} [${7 + n}] [INFO] Booting worker with pid: ${7 + n}`);
      return {
        listen: [port],
        bind: { [port]: host },
        app: { kind, file, reload: words.includes('--reload'), loaded: now(), worker: 7 },
        procs: [
          { pid: 1, user: container.user || 'root', comm: 'gunicorn', cmd: `/usr/local/bin/python3.12 ${words.join(' ')}` },
          ...Array.from({ length: opts.workers }, (_, n) => ({ pid: 7 + n, user: container.user || 'root', comm: 'gunicorn', cmd: `/usr/local/bin/python3.12 ${words.join(' ')}` })),
        ],
      };
    }
    // manage.py runserver [адрес]
    const manage = words.find((word) => word.endsWith('manage.py'));
    const path = normalize(manage, cwd);
    if (!fs.as('root', () => fs.exists(path))) {
      log(`python: can't open file '${path}': [Errno 2] No such file or directory`);
      return { exit: 2 };
    }
    if (!fs.root.pipInstalled?.django) {
      for (const line of ['Traceback (most recent call last):', `  File "${path}", line 11, in main`,
        '    from django.core.management import execute_from_command_line',
        "ModuleNotFoundError: No module named 'django'"]) log(line);
      return { exit: 1 };
    }
    let text = '';
    try {
      text = fs.as('root', () => fs.readFile(path));
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
    }
    const settings = /DJANGO_SETTINGS_MODULE['"],\s*['"]([\w.]+)['"]/.exec(text)?.[1] ?? 'shop.settings';
    const address = words[words.indexOf('runserver') + 1] ?? '127.0.0.1:8000';
    const { host, port } = hostPort(address);
    const p = utcParts(now());
    const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(p.month) - 1];
    log('Watching for file changes with StatReloader', false);
    for (const line of ['Performing system checks...', '', 'System check identified no issues (0 silenced).',
      `${month} ${p.day}, ${p.year} - ${p.time}`, `Django version 5.2.8, using settings '${settings}'`,
      `Starting development server at http://${host}:${port}/`, 'Quit the server with CONTROL-C.', '',
      'WARNING: This is a development server. Do not use it in a production setting. Use a production WSGI or ASGI server instead.',
      'For more information on production servers see: https://docs.djangoproject.com/en/5.2/howto/deployment/']) log(line, false);
    return {
      listen: [port],
      bind: { [port]: host },
      app: { kind, django: true },
      procs: [
        { pid: 1, user: container.user || 'root', comm: 'python', cmd: `python ${words.slice(words.indexOf(manage)).join(' ')}` },
        { pid: 7, user: container.user || 'root', comm: 'python', cmd: `/usr/local/bin/python ${words.slice(words.indexOf(manage)).join(' ')}` },
      ],
    };
  });
}

/** Остановка: логи и код выхода. */
export function stopApp(container) {
  const t = stamp(now());
  const log = (text) => container.logs.push({ t: now(), err: true, text });
  // главный процесс — sh: SIGTERM до gunicorn не доходит, через 10 с Docker убивает (SIGKILL)
  if (container.shellForm) return 137;
  if (container.app?.kind === 'gunicorn') {
    log(`${t} [1] [INFO] Handling signal: term`);
    log(`${t} [7] [INFO] Worker exiting (pid: 7)`);
    log(`${t} [1] [INFO] Shutting down: Master`);
  }
  return 0;
}

/** gunicorn --reload: файл модуля изменился (bind mount) — воркер перезапускается. */
function reloadIfChanged(hostFs, container) {
  const app = container.app;
  if (!app?.reload || !app.file) return;
  const mtime = withContainerFs(hostFs, container, (fs) => fs.as('root', () => {
    try {
      return fs.lookup(app.file).mtime;
    } catch (e) {
      return null;
    }
  }));
  if (mtime && mtime > (app.loaded ?? 0)) {
    const t = stamp(now());
    const old = app.worker ?? 7;
    app.worker = old + 2;
    for (const line of [`${t} [${old}] [INFO] Worker reloading: ${app.file} modified`, `${t} [${old}] [INFO] Worker exiting (pid: ${old})`,
      `${t} [${app.worker}] [INFO] Booting worker with pid: ${app.worker}`]) container.logs.push({ t: now(), err: true, text: line });
    app.loaded = mtime;
  }
}

const SERVER_ERROR = '\n<!doctype html>\n<html lang="en">\n<head>\n  <title>Server Error (500)</title>\n</head>\n<body>\n  <h1>Server Error (500)</h1><p></p>\n</body>\n</html>\n';

/**
 * Django-приложение: страница из views.py (HttpResponse(f"…")). Если view работает с базой —
 * подключение по настройкам (DATABASES из окружения) и таблицы после migrate; иначе 500.
 * null — своей страницы нет (ответ как у учебного Django сервера).
 */
function djangoAnswer(hostFs, container, request) {
  const path = request.path.split('?')[0];
  if (path.startsWith('/admin') || path.startsWith('/static/')) return null;
  const files = withContainerFs(hostFs, container, (fs) => fs.as('root', () => {
    const found = {};
    const root = container.workdir || '/app';
    try {
      for (const [file, node] of fs.walk(root)) {
        if (node.type === 'file' && file.endsWith('.py') && !file.includes('/site-packages/')) found[file] = fs.readFile(file);
      }
    } catch (e) {
      // нет папки проекта
    }
    return found;
  }));
  const view = Object.values(files).find((code) => /HttpResponse\(\s*f?["']/.test(code));
  if (!view) return null;
  const literal = /HttpResponse\(\s*f?(["'])((?:\\.|(?!\1).)*)\1/.exec(view);
  const usesDb = /\.objects\b|connection\.cursor|from django\.db/.test(view);
  const headers = (type, length) => [['Server', 'gunicorn'], ['Date', new Date(now()).toUTCString()], ['Connection', 'close'],
    ['Content-Type', type], ['Content-Length', String(length)], ['X-Frame-Options', 'DENY'], ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'same-origin'], ['Cross-Origin-Opener-Policy', 'same-origin']];
  if (usesDb) {
    const settings = Object.entries(files).find(([file, code]) => file.endsWith('settings.py') && /DATABASES/.test(code))?.[1] ?? '';
    const env = Object.fromEntries(container.env.map((item) => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]));
    const connection = /sqlite3/.test(settings) ? { sqlite: true } : dbConnect(hostFs, container, dbParams(settings, env));
    const problem = connection.error ? `django.db.utils.OperationalError: ${connection.error}`
      : !connection.sqlite && !migrated(connection) ? 'django.db.utils.ProgrammingError: relation "auth_user" does not exist\nLINE 1: SELECT COUNT(*) AS "__count" FROM "auth_user"\n                                             ^' : null;
    if (problem) {
      const t = stamp(now());
      container.logs.push({ t: now(), err: true, text: `Internal Server Error: ${path}` });
      for (const line of ['Traceback (most recent call last):', '  File "/usr/local/lib/python3.12/site-packages/django/db/backends/utils.py", line 105, in _execute',
        '    return self.cursor.execute(sql, params)', ...problem.split('\n')]) container.logs.push({ t: now(), err: true, text: line });
      void t;
      return { code: 500, headers: headers('text/html; charset=utf-8', SERVER_ERROR.length), body: SERVER_ERROR };
    }
  }
  // {…count()…} — пользователей нет (createsuperuser в тренажёре не делаем): 0
  const body = literal[2].replace(/\\n/g, '\n').replace(/\{([^}]*)\}/g, (_, expr) => (/count\(/.test(expr) ? '0' : ''));
  const bytes = new TextEncoder().encode(body).length;
  return { code: 200, headers: headers('text/html; charset=utf-8', bytes), body };
}

/** HTTP-ответ своего приложения. */
export function appAnswer(hostFs, container, request) {
  const app = container.app ?? {};
  const text = app.file ? withContainerFs(hostFs, container, (fs) => {
    try {
      return fs.as('root', () => fs.readFile(app.file));
    } catch (e) {
      return '';
    }
  }) : '';
  let answer;
  reloadIfChanged(hostFs, container);
  if (app.django || /get_wsgi_application|get_asgi_application/.test(text)) {
    answer = djangoAnswer(hostFs, container, request)
      ?? appResponse({ comm: app.kind === 'gunicorn' ? 'gunicorn' : 'python', cmd: app.kind === 'runserver' ? 'runserver' : 'gunicorn' }, request.path);
  } else {
    // простой WSGI: return [b"…"] или ["…".encode()]
    const literal = /return\s*\[\s*b?(["'])((?:\\.|(?!\1).)*)\1/.exec(text)?.[2] ?? '';
    const body = literal.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(["'\\])/g, '$1');
    const status = /start_response\(\s*["'](\d{3})/.exec(text)?.[1] ?? '200';
    const type = /["']Content-Type["']\s*,\s*["']([^"']+)["']/i.exec(text)?.[1] ?? 'text/html';
    const length = new TextEncoder().encode(body).length;
    answer = {
      code: Number(status),
      headers: [['Server', 'gunicorn'], ['Date', new Date(now()).toUTCString()], ['Connection', 'close'],
        ['Content-Type', type], ['Content-Length', String(length)]],
      body,
    };
  }
  if (app.kind === 'runserver') {
    const p = utcParts(now());
    container.logs.push({ t: now(), err: true, text: `[${p.day}/${p.monthName}/${p.year} ${p.time}] "${request.method} ${request.path} HTTP/1.1" ${answer.code} ${new TextEncoder().encode(answer.body).length}` });
  }
  return answer;
}
