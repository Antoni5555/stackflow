// Учебный systemd: процессы, сервисы и журнал Linux-симулятора.
// Состояние — в корне ФС (fs.root.system), поэтому сохраняется вместе с файлами в тренажёре.
// Сервисы: пакетные (nginx, postgresql, redis-server — из apt или setup) и свои unit-файлы
// в /etc/systemd/system/*.service (gunicorn и др.). Включён сервис — значит, есть ссылка
// в /etc/systemd/system/multi-user.target.wants, как в настоящем systemd.

import { APT, installHooks } from './apt.js';
import { FsError, USERS, VirtualFS, basename, dirname } from './fs.js';

const ok = (out = '') => ({ out, err: '', code: 0 });
const fail = (err, code = 1) => ({ out: '', err, code });

const UNIT_DIR = '/etc/systemd/system';
const WANTS = `${UNIT_DIR}/multi-user.target.wants`;
const HOST = 'server';
// пользователи сервисов, которых нет среди учётных записей входа
const serviceUser = (user) => user in USERS || ['postgres', 'redis'].includes(user);

/** Пакетные сервисы: имя → пакет apt, описание, процессы, порт, проверка запуска. */
const PACKAGED = {
  nginx: {
    pkg: 'nginx',
    unit: '/usr/lib/systemd/system/nginx.service',
    description: 'A high performance web server and a reverse proxy server',
    type: 'forking',
    reload: true,
    processes: () => [
      { user: 'root', comm: 'nginx', cmd: 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;', main: true },
      { user: 'www-data', comm: 'nginx', cmd: 'nginx: worker process', worker: true },
      { user: 'www-data', comm: 'nginx', cmd: 'nginx: worker process', worker: true },
    ],
    check: checkNginx,
  },
  postgresql: {
    pkg: 'postgresql',
    unit: '/usr/lib/systemd/system/postgresql@.service',
    description: 'PostgreSQL RDBMS',
    type: 'forking',
    reload: true,
    processes: () => [
      { user: 'postgres', comm: 'postgres', cmd: '/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main -c config_file=/etc/postgresql/16/main/postgresql.conf', main: true },
      { user: 'postgres', comm: 'postgres', cmd: 'postgres: 16/main: checkpointer', worker: true },
      { user: 'postgres', comm: 'postgres', cmd: 'postgres: 16/main: walwriter', worker: true },
    ],
  },
  'redis-server': {
    pkg: 'redis-server',
    unit: '/usr/lib/systemd/system/redis-server.service',
    description: 'Advanced key-value store',
    type: 'notify',
    reload: false,
    restart: 'always',
    processes: () => [{ user: 'redis', comm: 'redis-server', cmd: '/usr/bin/redis-server 127.0.0.1:6379', main: true }],
  },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const journalTime = (ms) => {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${pad(d.getDate())} ${clock(ms)}`;
};
const gunicornTime = (ms) => {
  const d = new Date(ms);
  return `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(ms)} +0300]`;
};

/** Состояние системы: процессы, сервисы, журнал. Базовые процессы есть всегда. */
export function systemState(fs) {
  fs.root.system ??= {
    nextPid: 1200,
    boot: Date.now() - 3 * 24 * 3600 * 1000,
    procs: [
      { pid: 1, user: 'root', comm: 'systemd', cmd: '/sbin/init' },
      { pid: 412, user: 'root', comm: 'cron', cmd: '/usr/sbin/cron -f -P' },
      { pid: 520, user: 'root', comm: 'sshd', cmd: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups' },
      { pid: 1001, user: 'root', comm: 'sshd', cmd: 'sshd: shop [priv]' },
      { pid: 1003, user: 'shop', comm: 'bash', cmd: '-bash', tty: 'pts/0' },
    ],
    services: {},
    journal: [],
  };
  return fs.root.system;
}

const spawn = (state, proc) => {
  const pid = state.nextPid;
  state.nextPid += 1 + (pid % 3);   // номера не подряд — как на живом сервере
  const created = { pid, started: Date.now(), ...proc };
  state.procs.push(created);
  return created;
};

function log(state, unit, text, { source = 'systemd[1]', time = Date.now() } = {}) {
  state.journal.push({ time, unit, source, text });
}

/** «gunicorn», «gunicorn.service» → «gunicorn». */
const unitName = (name) => name.replace(/\.service$/, '');

/** Текст unit-файла → {Unit: {Description}, Service: {ExecStart, User, …}}. */
export function parseUnit(text) {
  const sections = {};
  let current = null;
  const joined = text.replace(/\\\n\s*/g, ' ');
  for (const raw of joined.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[(\w+)\]$/.exec(line);
    if (section) {
      current = section[1];
      sections[current] ??= {};
      continue;
    }
    const eq = line.indexOf('=');
    if (current && eq > 0) sections[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
}

function readFile(fs, path) {
  try {
    return fs.as('root', () => fs.readFile(path));
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    return null;
  }
}

const exists = (fs, path) => fs.as('root', () => fs.exists(path));

/** Описание сервиса или null: свой unit-файл важнее пакетного. */
function findService(fs, name) {
  const short = unitName(name);
  const state = systemState(fs);
  const path = `${UNIT_DIR}/${short}.service`;
  const text = readFile(fs, path);
  if (text !== null) {
    const record = (state.services[short] ??= {});
    // systemd читает unit-файл при запуске системы и после daemon-reload
    record.loaded ??= text;
    return { name: short, path, custom: true, text, record };
  }
  const packaged = PACKAGED[short];
  const installed = fs.root.apt ?? [];
  // пакетный сервис есть, пока пакет установлен (apt или setup.services)
  if (packaged && installed.includes(packaged.pkg)) {
    return { name: short, path: packaged.unit, packaged, record: (state.services[short] ??= {}) };
  }
  return null;
}

const isEnabled = (fs, service) => fs.as('root', () => fs.exists(`${WANTS}/${service.name}.service`, { follow: false }));
const procsOf = (state, name) => state.procs.filter((proc) => proc.unit === name);

/** Свой unit: что запускать, от кого и где. */
function customSpec(service) {
  const units = parseUnit(service.record.loaded ?? service.text);
  const unit = units.Unit ?? {};
  const svc = units.Service ?? {};
  const exec = (svc.ExecStart ?? '').replace(/^[-@+!]+/, '');
  return {
    description: unit.Description ?? `${service.name}.service`,
    exec,
    program: exec.split(/\s+/)[0] ?? '',
    user: svc.User ?? 'root',
    group: svc.Group,
    workdir: svc.WorkingDirectory,
    type: svc.Type ?? 'simple',
    restart: svc.Restart ?? 'no',
    reload: Boolean(svc.ExecReload),
  };
}

const description = (service) => (service.packaged ? service.packaged.description : customSpec(service).description);

/** Проверка nginx: nginx.conf и подключённые сайты — есть и скобки сходятся. */
function checkNginx(fs) {
  const files = ['/etc/nginx/nginx.conf'];
  for (const dir of ['/etc/nginx/sites-enabled', '/etc/nginx/conf.d']) {
    try {
      for (const [entry] of fs.as('root', () => fs.list(dir))) files.push(`${dir}/${entry}`);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
    }
  }
  for (const path of files) {
    const text = readFile(fs, path);
    if (text === null) return `[emerg] open() "${path}" failed (2: No such file or directory)`;
    let depth = 0;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      for (const ch of lines[i].replace(/#.*/, '')) {
        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;
        if (depth < 0) return `[emerg] unexpected "}" in ${path}:${i + 1}`;
      }
    }
    if (depth > 0) return `[emerg] unexpected end of file, expecting "}" in ${path}:${lines.length}`;
  }
  return null;
}

/** Процессы своего unit: gunicorn — главный и рабочие (--workers N), остальное — один процесс. */
function customProcesses(spec) {
  const comm = basename(spec.program);
  if (comm === 'gunicorn') {
    const workers = Number(/(?:--workers|-w)[=\s]+(\d+)/.exec(spec.exec)?.[1] ?? 1);
    const python = `${dirname(spec.program)}/python3`;
    const cmd = `${python} ${spec.exec}`;
    return [
      { user: spec.user, comm: 'gunicorn', cmd, main: true },
      ...Array.from({ length: workers }, () => ({ user: spec.user, comm: 'gunicorn', cmd, worker: true })),
    ];
  }
  return [{ user: spec.user, comm, cmd: spec.exec, main: true }];
}

/** Почему свой сервис не запустится: [строки журнала, статус] или null. */
function customFailure(fs, service, spec) {
  const unit = `${service.name}.service`;
  if (!spec.exec) return [[`${unit}: Service has no ExecStart=, ExecStop=, or SuccessAction=. Refusing.`], null];
  if (!serviceUser(spec.user)) {
    return [[
      `${unit}: Failed to determine user credentials: No such process`,
      `${unit}: Failed at step USER spawning ${spec.program}: No such process`,
    ], '217/USER'];
  }
  if (spec.workdir && !exists(fs, spec.workdir)) {
    return [[
      `${unit}: Changing to the requested working directory failed: No such file or directory`,
      `${unit}: Failed at step CHDIR spawning ${spec.program}: No such file or directory`,
    ], '200/CHDIR'];
  }
  let program = null;
  try {
    program = fs.as('root', () => fs.lookup(spec.program));
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
  }
  if (!program || program.type !== 'file') {
    return [[
      `${unit}: Unable to locate executable '${spec.program}': No such file or directory`,
      `${unit}: Failed at step EXEC spawning ${spec.program}: No such file or directory`,
    ], '203/EXEC'];
  }
  if (!(program.mode & 0o111)) {
    return [[
      `${unit}: Unable to locate executable '${spec.program}': Permission denied`,
      `${unit}: Failed at step EXEC spawning ${spec.program}: Permission denied`,
    ], '203/EXEC'];
  }
  return null;
}

function killProcs(state, name) {
  state.procs = state.procs.filter((proc) => proc.unit !== name);
}

function gunicornBoot(state, unit, master, workers, time) {
  const source = `gunicorn[${master.pid}]`;
  const line = (pid, text) => log(state, unit, `${gunicornTime(time)} [${pid}] [INFO] ${text}`, { source: `gunicorn[${pid}]`, time });
  line(master.pid, 'Starting gunicorn 23.0.0');
  const bind = /--bind[=\s]+(\S+)/.exec(master.cmd)?.[1] ?? '127.0.0.1:8000';
  line(master.pid, `Listening at: http://${bind} (${master.pid})`);
  line(master.pid, 'Using worker: sync');
  for (const worker of workers) line(worker.pid, `Booting worker with pid: ${worker.pid}`);
  return source;
}

/** Запустить сервис → {ok: true} или {ok: false, status}. Пишет в журнал, как systemd. */
function startService(fs, service, time = Date.now()) {
  const state = systemState(fs);
  const unit = `${service.name}.service`;
  const desc = description(service);
  const record = service.record;
  if (procsOf(state, service.name).length) return { ok: true };
  log(state, unit, `Starting ${unit} - ${desc}...`, { time });
  let problem = null;
  let processes;
  if (service.packaged) {
    const error = service.packaged.check?.(fs);
    if (error) {
      log(state, unit, `nginx: ${error}`, { source: 'nginx[' + state.nextPid + ']', time });
      problem = [[`${unit}: Control process exited, code=exited, status=1/FAILURE`], '1/FAILURE'];
    }
    processes = service.packaged.processes();
  } else {
    const spec = customSpec(service);
    problem = customFailure(fs, service, spec);
    if (problem) {
      // процесс успел получить номер и сразу завершился — его видно в systemctl status
      record.failedPid = state.nextPid;
      state.nextPid += 1;
    }
    processes = customProcesses(spec);
  }
  if (problem) {
    const [lines, status] = problem;
    for (const text of lines) log(state, unit, text, { time });
    if (status && !service.packaged) log(state, unit, `${unit}: Main process exited, code=exited, status=${status}`, { time });
    log(state, unit, `${unit}: Failed with result 'exit-code'.`, { time });
    log(state, unit, `Failed to start ${unit} - ${desc}.`, { time });
    Object.assign(record, { active: false, failed: true, since: time, result: 'exit-code', status });
    return { ok: false };
  }
  const started = processes.map((proc) => spawn(state, { ...proc, unit: service.name, started: time }));
  const main = started.find((proc) => proc.main);
  for (const proc of started.filter((item) => item.worker)) proc.ppid = main.pid;
  if (main.comm === 'gunicorn') gunicornBoot(state, unit, main, started.filter((proc) => proc.worker), time);
  log(state, unit, `Started ${unit} - ${desc}.`, { time });
  Object.assign(record, { active: true, failed: false, since: time, mainPid: main.pid });
  delete record.result;
  return { ok: true };
}

function stopService(fs, service, { quiet = false } = {}) {
  const state = systemState(fs);
  const unit = `${service.name}.service`;
  const desc = description(service);
  const wasActive = procsOf(state, service.name).length > 0;
  killProcs(state, service.name);
  if (wasActive && !quiet) {
    log(state, unit, `Stopping ${unit} - ${desc}...`);
    log(state, unit, `${unit}: Deactivated successfully.`);
    log(state, unit, `Stopped ${unit} - ${desc}.`);
  }
  Object.assign(service.record, { active: false, failed: false, since: Date.now() });
  delete service.record.mainPid;
}

/** Рабочие процессы заново (HUP, reload): главный остаётся, номера рабочих — новые. */
function respawnWorkers(state, name) {
  const workers = procsOf(state, name).filter((proc) => proc.worker);
  state.procs = state.procs.filter((proc) => !workers.includes(proc));
  return workers.map(({ pid, started, ...rest }) => spawn(state, rest));
}

// --- systemctl ---

const AUTH = (verb, unit) => `Failed to ${verb} ${unit}: Interactive authentication required.\nSee system logs and 'systemctl status ${unit}' for details.\n`;

function ago(ms) {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}min ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

const longDate = (ms) => {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(ms)} MSK`;
};

function journalLines(state, unit, count) {
  const entries = state.journal.filter((entry) => entry.unit === unit);
  return entries.slice(-count).map((entry) => `${journalTime(entry.time)} ${HOST} ${entry.source}: ${entry.text}`);
}

function status(fs, service) {
  const state = systemState(fs);
  const unit = `${service.name}.service`;
  const record = service.record;
  const procs = procsOf(state, service.name);
  const enabled = isEnabled(fs, service) ? 'enabled' : 'disabled';
  const active = procs.length > 0;
  const dot = active ? '●' : record.failed ? '×' : '○';
  let line;
  if (active) line = `active (running) since ${longDate(record.since)}; ${ago(record.since)}`;
  else if (record.failed) line = `failed (Result: ${record.result ?? 'exit-code'}) since ${longDate(record.since)}; ${ago(record.since)}`;
  else line = 'inactive (dead)';
  const rows = [
    `${dot} ${unit} - ${description(service)}`,
    `     Loaded: loaded (${service.path}; ${enabled}; preset: enabled)`,
  ];
  if (service.custom && record.loaded !== undefined && record.loaded !== service.text) {
    rows.push(`    Warning: The unit file, source configuration file or drop-ins of ${unit} changed on disk. Run 'systemctl daemon-reload' to reload units.`);
  }
  rows.push(`     Active: ${line}`);
  if (!active && record.failed && record.status) {
    rows.push(`    Process: ${record.failedPid} ExecStart=${service.custom ? customSpec(service).exec : service.path} (code=exited, status=${record.status})`);
  }
  if (active) {
    const main = procs.find((proc) => proc.main) ?? procs[0];
    rows.push(`   Main PID: ${main.pid} (${main.comm})`);
    rows.push(`      Tasks: ${procs.length} (limit: 2307)`);
    rows.push(`     Memory: ${(12.4 + procs.length * 16.3).toFixed(1)}M (peak: ${(13.1 + procs.length * 16.3).toFixed(1)}M)`);
    rows.push(`     CGroup: /system.slice/${unit}`);
    procs.forEach((proc, index) => {
      rows.push(`             ${index === procs.length - 1 ? '└─' : '├─'}${proc.pid} "${proc.cmd}"`.replace(/"/g, ''));
    });
  }
  const journal = journalLines(state, unit, 10);
  if (journal.length) rows.push('', ...journal);
  return { out: `${rows.join('\n')}\n`, err: '', code: active ? 0 : 3 };
}

function enable(fs, service) {
  const link = `${WANTS}/${service.name}.service`;
  if (exists(fs, link) || fs.as('root', () => fs.exists(link, { follow: false }))) return '';
  fs.as('root', () => {
    fs.mkdirAs(WANTS, 'root');
    fs.symlink(service.path, link);
  });
  return `Created symlink ${link} → ${service.path}.\n`;
}

function disable(fs, service) {
  const link = `${WANTS}/${service.name}.service`;
  if (!fs.as('root', () => fs.exists(link, { follow: false }))) return '';
  fs.as('root', () => fs.remove(link));
  return `Removed "${link}".\n`;
}

const MANAGE = new Set(['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'daemon-reload']);

export const systemctl = {
  help: `systemctl — управление сервисами (учебный systemd).
  systemctl status gunicorn       состояние и последние строки журнала
  sudo systemctl start|stop|restart|reload gunicorn
  sudo systemctl enable|disable gunicorn    запускать ли при загрузке (--now — сразу)
  systemctl is-active | is-enabled gunicorn
  sudo systemctl daemon-reload    перечитать unit-файлы после правки`,
  run(ctx) {
    const args = ctx.args.filter((arg) => !['--no-pager', '-l', '--full', '-q', '--quiet'].includes(arg));
    const now = args.includes('--now');
    const [verb, ...names] = args.filter((arg) => arg !== '--now');
    const quiet = ctx.args.includes('-q') || ctx.args.includes('--quiet');
    const { fs } = ctx;
    if (!verb) return ok(`${systemctl.help}\n`);
    const state = systemState(fs);
    if (MANAGE.has(verb) && fs.user !== 'root') {
      if (verb === 'daemon-reload') return fail('Failed to reload daemon: Interactive authentication required.\n');
      return fail(AUTH(verb, `${unitName(names[0] ?? '')}.service`));
    }
    if (verb === 'daemon-reload') {
      for (const [name, record] of Object.entries(state.services)) {
        const text = readFile(fs, `${UNIT_DIR}/${name}.service`);
        if (text !== null) record.loaded = text;
      }
      return ok();
    }
    if (!['status', 'is-active', 'is-enabled', 'start', 'stop', 'restart', 'reload', 'enable', 'disable'].includes(verb)) {
      return fail(`Unknown command verb '${verb}'.\n`);
    }
    if (!names.length) return fail(`Too few arguments.\n`);
    let out = '';
    let err = '';
    let code = 0;
    for (const raw of names) {
      const service = findService(fs, raw);
      const unit = `${unitName(raw)}.service`;
      if (!service) {
        if (verb === 'status') {
          err += `Unit ${unit} could not be found.\n`;
          code = 4;
        } else if (verb === 'is-active') {
          if (!quiet) out += 'inactive\n';
          code = 3;
        } else if (verb === 'is-enabled') {
          err += `Failed to get unit file state for ${unit}: No such file or directory\n`;
          code = 1;
        } else {
          err += `Failed to ${verb} ${unit}: Unit ${unit} not found.\n`;
          code = verb === 'enable' || verb === 'disable' ? 1 : 5;
        }
        continue;
      }
      if (service.custom && service.record.loaded !== service.text && verb !== 'status') {
        err += `Warning: The unit file, source configuration file or drop-ins of ${unit} changed on disk. Run 'systemctl daemon-reload' to reload units.\n`;
      }
      const active = procsOf(state, service.name).length > 0;
      if (verb === 'status') {
        const result = status(fs, service);
        out += result.out;
        code = Math.max(code, result.code);
      } else if (verb === 'is-active') {
        if (!quiet) out += `${active ? 'active' : service.record.failed ? 'failed' : 'inactive'}\n`;
        if (!active) code = 3;
      } else if (verb === 'is-enabled') {
        const enabled = isEnabled(fs, service);
        if (!quiet) out += `${enabled ? 'enabled' : 'disabled'}\n`;
        if (!enabled) code = 1;
      } else if (verb === 'enable' || verb === 'disable') {
        err += verb === 'enable' ? enable(fs, service) : disable(fs, service);
        if (now && verb === 'enable') code = Math.max(code, startAndReport(fs, service, unit, (text) => { err += text; }));
        if (now && verb === 'disable') stopService(fs, service);
      } else if (verb === 'stop') {
        stopService(fs, service);
      } else if (verb === 'start' || verb === 'restart') {
        if (verb === 'restart') stopService(fs, service);
        code = Math.max(code, startAndReport(fs, service, unit, (text) => { err += text; }));
      } else if (verb === 'reload') {
        const reloadable = service.packaged ? service.packaged.reload : customSpec(service).reload;
        if (!reloadable) {
          err += `Failed to reload ${unit}: Job type reload is not applicable for unit ${unit}.\n`;
          code = 1;
        } else if (!active) {
          err += `${unit} is not active, cannot reload.\n`;
          code = 1;
        } else {
          const problem = service.packaged?.check?.(fs);
          log(state, unit, `Reloading ${unit} - ${description(service)}...`);
          if (problem) {
            log(state, unit, `nginx: ${problem}`, { source: `nginx[${state.nextPid}]` });
            log(state, unit, `${unit}: Control process exited, code=exited, status=1/FAILURE`);
            log(state, unit, `Reload failed for ${unit} - ${description(service)}.`);
            err += `Job for ${unit} failed.\nSee "systemctl status ${unit}" and "journalctl -xeu ${unit}" for details.\n`;
            code = 1;
          } else {
            respawnWorkers(state, service.name);
            log(state, unit, `Reloaded ${unit} - ${description(service)}.`);
          }
        }
      }
    }
    return { out, err, code };
  },
};

/** start из systemctl: simple не ждёт процесс — ошибку видно только в status. */
function startAndReport(fs, service, unit, write) {
  const result = startService(fs, service);
  if (result.ok) return 0;
  const type = service.packaged ? service.packaged.type : customSpec(service).type;
  if (type === 'simple') return 0;
  write(`Job for ${unit} failed because the control process exited with error code.\nSee "systemctl status ${unit}" and "journalctl -xeu ${unit}" for details.\n`);
  return 1;
}

// --- journalctl ---

export const journalctl = {
  help: `journalctl — журнал systemd.
  journalctl -u gunicorn          записи сервиса
  journalctl -u gunicorn -n 20    последние 20
  journalctl -xeu gunicorn        конец журнала с пояснениями (после ошибки запуска)`,
  run(ctx) {
    const args = [...ctx.args];
    let unit = null;
    let count = null;
    let end = false;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '--no-pager' || arg === '-x' || arg === '-q') continue;
      if (arg === '-f' || arg === '--follow') return fail('journalctl -f ждёт новые записи бесконечно — в тренажёре смотрите журнал без -f (journalctl -u сервис -n 20)\n');
      if (arg === '-u' || arg === '--unit') {
        unit = args[(i += 1)];
      } else if (arg.startsWith('--unit=')) {
        unit = arg.slice(7);
      } else if (arg === '-n' || arg === '--lines') {
        count = Number(args[(i += 1)]);
      } else if (/^-n\d+$/.test(arg)) {
        count = Number(arg.slice(2));
      } else if (/^-[xeu]+$/.test(arg)) {
        if (arg.includes('e')) end = true;
        if (arg.includes('u')) unit = args[(i += 1)];
      } else {
        return fail(`journalctl: unrecognized option '${arg}'\n`);
      }
    }
    const state = systemState(ctx.fs);
    let entries = state.journal;
    if (unit) entries = entries.filter((entry) => entry.unit === `${unitName(unit)}.service`);
    // -e — конец журнала (как пейджер, прокрученный вниз): последние 1000
    if (count !== null) entries = entries.slice(-count);
    else if (end) entries = entries.slice(-1000);
    if (!entries.length) return ok('-- No entries --\n');
    return ok(entries.map((entry) => `${journalTime(entry.time)} ${HOST} ${entry.source}: ${entry.text}\n`).join(''));
  },
};

// --- процессы ---

const sortedProcs = (state, extra = []) => [...state.procs, ...extra].sort((a, b) => a.pid - b.pid);

/** Сама команда ps и её соседи по конвейеру — тоже процессы (grep в «ps aux | grep x»). */
function selfProc(ctx, state) {
  const stages = ctx.sh.pipeline ?? [['ps', ...ctx.args]];
  return stages.map((words, index) => {
    // grep в Ubuntu — псевдоним grep --color=auto
    const cmd = words[0] === 'grep' ? ['grep', '--color=auto', ...words.slice(1)] : words;
    return {
      pid: state.nextPid + index, user: ctx.fs.user, comm: words[0], cmd: cmd.join(' '),
      tty: 'pts/0', self: index === ctx.sh.stageIndex, piped: true, started: Date.now(),
    };
  });
}

const memOf = (proc) => proc.mem ?? (proc.comm === 'gunicorn' ? 2.9 : proc.comm === 'postgres' ? 1.4 : 0.4);
const cpuOf = (proc) => proc.cpu ?? 0;
/** START в ps: сегодняшние — время, старше суток — дата (Nov18), как в procps. */
function startOf(state, proc) {
  const started = proc.started ?? state.boot;
  if (Date.now() - started < 24 * 3600 * 1000) return clock(started).slice(0, 5);
  const d = new Date(started);
  return `${MONTHS[d.getMonth()]}${pad(d.getDate())}`;
}

export const ps = {
  help: `ps — процессы.
  ps aux    все процессы: пользователь, PID, %CPU, %MEM, команда
  ps -ef    все процессы с PPID (родитель)
Обычно с grep: ps aux | grep gunicorn`,
  run(ctx) {
    const state = systemState(ctx.fs);
    const flags = ctx.args.join('');
    const procs = sortedProcs(state, selfProc(ctx, state));
    // ps -ef (UNIX-стиль, с PPID) и ps aux (BSD-стиль, с %CPU и %MEM)
    if (flags.startsWith('-') && flags.includes('e') && flags.includes('f')) {
      const rows = procs.map((proc) => [
        proc.user.length > 8 ? `${proc.user.slice(0, 7)}+` : proc.user, String(proc.pid), String(proc.ppid ?? (proc.pid === 1 ? 0 : 1)),
        String(Math.round(cpuOf(proc))), startOf(state, proc), proc.tty ?? '?', '00:00:01', proc.cmd,
      ]);
      const head = 'UID          PID    PPID  C STIME TTY          TIME CMD';
      return ok(`${head}\n${rows.map((r) => `${r[0].padEnd(8)} ${r[1].padStart(7)} ${r[2].padStart(7)} ${r[3].padStart(2)} ${r[4]} ${r[5].padEnd(8)} ${r[6]} ${r[7]}`).join('\n')}\n`);
    }
    if (/[axe]/.test(flags)) {
      const head = 'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND';
      const rows = procs.map((proc) => {
        const user = proc.user.length > 8 ? `${proc.user.slice(0, 7)}+` : proc.user;
        const mem = memOf(proc);
        const rss = Math.round(mem * 20100);
        return `${user.padEnd(8)} ${String(proc.pid).padStart(7)} ${cpuOf(proc).toFixed(1).padStart(4)} ${mem.toFixed(1).padStart(4)} ${String(rss * 3 + 8000).padStart(6)} ${String(rss).padStart(5)} ${(proc.tty ?? '?').padEnd(8)} ${proc.self ? 'R+  ' : proc.piped ? 'S+  ' : proc.tty ? 'Ss+ ' : 'Ss  '} ${startOf(state, proc)}   0:00 ${proc.cmd}`;
      });
      return ok(`${head}\n${rows.join('\n')}\n`);
    }
    // ps без флагов — процессы этого терминала
    const own = procs.filter((proc) => proc.tty === 'pts/0');
    return ok(`    PID TTY          TIME CMD\n${own.map((proc) => `${String(proc.pid).padStart(7)} pts/0    00:00:00 ${proc.comm}`).join('\n')}\n`);
  },
};

const SIGNALS = { HUP: 1, INT: 2, KILL: 9, TERM: 15 };
const SIGNAL_NAMES = Object.fromEntries(Object.entries(SIGNALS).map(([name, num]) => [num, name]));

/** «-9», «-KILL», «-SIGKILL», «-s KILL» → номер сигнала или null. */
function parseSignal(value) {
  if (/^\d+$/.test(value)) return SIGNAL_NAMES[Number(value)] ? Number(value) : null;
  const name = value.toUpperCase().replace(/^SIG/, '');
  return SIGNALS[name] ?? null;
}

/** Сигнал процессу: что станет с ним и с его сервисом. Возвращает текст ошибки или ''. */
function signalProcess(fs, proc, signal, prefix) {
  const state = systemState(fs);
  if (fs.user !== 'root' && proc.user !== fs.user) return `${prefix}(${proc.pid}) - Operation not permitted\n`;
  const service = proc.unit ? findService(fs, proc.unit) : null;
  const unit = proc.unit ? `${proc.unit}.service` : null;
  if (!service) {
    // обычный процесс: HUP, INT, TERM, KILL — завершают
    state.procs = state.procs.filter((item) => item !== proc);
    return '';
  }
  if (proc.worker) {
    // рабочий процесс: главный тут же запускает новый
    state.procs = state.procs.filter((item) => item !== proc);
    const { pid, started, ...rest } = proc;
    const fresh = spawn(state, rest);
    if (proc.comm === 'gunicorn') {
      const time = Date.now();
      const note = signal === 9 ? `[ERROR] Worker (pid:${proc.pid}) was sent SIGKILL! Perhaps out of memory?` : `[INFO] Worker exiting (pid: ${proc.pid})`;
      log(state, unit, `${gunicornTime(time)} [${proc.ppid}] ${note}`, { source: `gunicorn[${proc.ppid}]`, time });
      log(state, unit, `${gunicornTime(time)} [${fresh.pid}] [INFO] Booting worker with pid: ${fresh.pid}`, { source: `gunicorn[${fresh.pid}]`, time });
    }
    return '';
  }
  // главный процесс сервиса
  if (signal === 1 && (service.packaged || proc.comm === 'gunicorn')) {
    const workers = respawnWorkers(state, proc.unit);
    if (proc.comm === 'gunicorn') {
      const time = Date.now();
      log(state, unit, `${gunicornTime(time)} [${proc.pid}] [INFO] Handling signal: hup`, { source: `gunicorn[${proc.pid}]`, time });
      log(state, unit, `${gunicornTime(time)} [${proc.pid}] [INFO] Hang up: Master`, { source: `gunicorn[${proc.pid}]`, time });
      for (const worker of workers) log(state, unit, `${gunicornTime(time)} [${worker.pid}] [INFO] Booting worker with pid: ${worker.pid}`, { source: `gunicorn[${worker.pid}]`, time });
    }
    return '';
  }
  killProcs(state, proc.unit);
  const restart = service.packaged ? service.packaged.restart ?? 'no' : customSpec(service).restart;
  if (signal === 9) {
    log(state, unit, `${unit}: Main process exited, code=killed, status=9/KILL`);
    log(state, unit, `${unit}: Failed with result 'signal'.`);
    Object.assign(service.record, { active: false, failed: true, since: Date.now(), result: 'signal' });
    delete service.record.status;
  } else {
    log(state, unit, `${unit}: Deactivated successfully.`);
    Object.assign(service.record, { active: false, failed: false, since: Date.now() });
  }
  delete service.record.mainPid;
  const again = restart === 'always' || (restart === 'on-failure' && signal === 9);
  if (again) {
    log(state, unit, `${unit}: Scheduled restart job, restart counter is at 1.`);
    startService(fs, service);
  }
  return '';
}

export const kill = {
  help: `kill PID… — послать процессу сигнал (по умолчанию TERM — «завершись»).
  kill -9 PID     KILL — убить сразу, без уборки
  kill -HUP PID   HUP — перечитать настройки (nginx, gunicorn)
Номер процесса — из ps aux или pgrep.`,
  run(ctx) {
    let signal = 15;
    const pids = [];
    const args = [...ctx.args];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '-s' || arg === '-n') {
        signal = parseSignal(args[(i += 1)] ?? '');
        if (signal === null) return fail(`bash: kill: ${args[i]}: invalid signal specification\n`);
      } else if (arg === '-l') {
        return ok(' 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 4) SIGILL\t 5) SIGTRAP\n 6) SIGABRT\t 7) SIGBUS\t 8) SIGFPE\t 9) SIGKILL\t10) SIGUSR1\n11) SIGSEGV\t12) SIGUSR2\t13) SIGPIPE\t14) SIGALRM\t15) SIGTERM\n');
      } else if (arg.startsWith('-') && arg.length > 1) {
        signal = parseSignal(arg.slice(1));
        if (signal === null) return fail(`bash: kill: ${arg.slice(1)}: invalid signal specification\n`);
      } else {
        pids.push(arg);
      }
    }
    if (!pids.length) return fail('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n', 2);
    const state = systemState(ctx.fs);
    let err = '';
    for (const value of pids) {
      if (!/^\d+$/.test(value)) {
        err += `bash: kill: ${value}: arguments must be process or job IDs\n`;
        continue;
      }
      const proc = state.procs.find((item) => item.pid === Number(value));
      if (!proc) {
        err += `bash: kill: (${value}) - No such process\n`;
        continue;
      }
      err += signalProcess(ctx.fs, proc, signal, 'bash: kill: ');
    }
    return { out: '', err, code: err ? 1 : 0 };
  },
};

/** pgrep/pkill: процессы по имени (или по всей строке с -f), свой ps не считается. */
function matchProcs(ctx, name, args) {
  const state = systemState(ctx.fs);
  let full = false;
  let user = null;
  let pattern = null;
  const flags = { l: false, a: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-u') user = args[(i += 1)];
    else if (/^-[flaxe]+$/.test(arg) && !/^-\d/.test(arg)) {
      if (arg.includes('f')) full = true;
      if (arg.includes('l')) flags.l = true;
      if (arg.includes('a')) flags.a = true;
    } else if (!arg.startsWith('-')) pattern = arg;
  }
  if (pattern === null) return { error: fail(`${name}: no matching criteria specified\nTry \`${name} --help' for more information.\n`, 2) };
  let regex;
  try {
    regex = new RegExp(pattern);
  } catch (e) {
    return { error: fail(`${name}: invalid regular expression\n`, 2) };
  }
  const procs = sortedProcs(state).filter((proc) => regex.test(full ? proc.cmd : proc.comm) && (!user || proc.user === user));
  return { procs, flags };
}

export const pgrep = {
  help: `pgrep имя — номера процессов по имени.
  -a   с командой целиком
  -f   искать по всей строке команды (pgrep -f manage.py)
  -u   только процессы пользователя`,
  run(ctx) {
    const found = matchProcs(ctx, 'pgrep', ctx.args);
    if (found.error) return found.error;
    if (!found.procs.length) return { out: '', err: '', code: 1 };
    return ok(found.procs.map((proc) => (found.flags.a ? `${proc.pid} ${proc.cmd}` : found.flags.l ? `${proc.pid} ${proc.comm}` : String(proc.pid))).join('\n') + '\n');
  },
};

export const pkill = {
  help: `pkill имя — послать сигнал всем процессам с таким именем (по умолчанию TERM).
  pkill -f 'manage.py runserver'   по всей строке команды
  pkill -9 имя                     KILL`,
  run(ctx) {
    let signal = 15;
    const rest = [];
    for (const arg of ctx.args) {
      const parsed = /^-[A-Z0-9]+$/i.test(arg) && !/^-[flau]+$/.test(arg) ? parseSignal(arg.slice(1)) : null;
      if (parsed !== null) signal = parsed;
      else rest.push(arg);
    }
    const found = matchProcs(ctx, 'pkill', rest);
    if (found.error) return found.error;
    if (!found.procs.length) return { out: '', err: '', code: 1 };
    let err = '';
    const state = systemState(ctx.fs);
    for (const proc of found.procs) {
      if (!state.procs.includes(proc)) continue;   // уже завершён вместе с сервисом
      const problem = signalProcess(ctx.fs, proc, signal, '');
      if (problem) err += `pkill: killing pid ${proc.pid} failed: Operation not permitted\n`;
    }
    return { out: '', err, code: 0 };
  },
};

export const top = {
  help: `top — процессы, которые больше всего нагружают сервер.
В тренажёре нет живого экрана: top показывает один снимок, как top -bn1.`,
  run(ctx) {
    const state = systemState(ctx.fs);
    const procs = sortedProcs(state).sort((a, b) => cpuOf(b) - cpuOf(a) || a.pid - b.pid);
    const now = Date.now();
    const busy = procs.reduce((sum, proc) => sum + cpuOf(proc), 0);
    const load = (busy / 100).toFixed(2);
    const head = [
      `top - ${clock(now)} up 3 days,  2:14,  1 user,  load average: ${load}, ${load}, ${(busy / 150).toFixed(2)}`,
      `Tasks: ${String(procs.length).padStart(3)} total,   ${busy ? 1 : 0} running, ${String(procs.length - (busy ? 1 : 0)).padStart(3)} sleeping,   0 stopped,   0 zombie`,
      `%Cpu(s): ${Math.min(busy / 2, 99).toFixed(1).padStart(4)} us,  0.3 sy,  0.0 ni, ${Math.max(100 - busy / 2 - 0.3, 0).toFixed(1).padStart(4)} id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st`,
      'MiB Mem :   1963.4 total,    412.8 free,    786.1 used,    764.5 buff/cache',
      'MiB Swap:   2048.0 total,   2048.0 free,      0.0 used.   1177.3 avail Mem',
      '',
      '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND',
    ];
    const rows = procs.map((proc) => {
      const mem = memOf(proc);
      const res = Math.round(mem * 20100);
      return `${String(proc.pid).padStart(7)} ${proc.user.slice(0, 8).padEnd(8)}  20   0 ${String(res * 3 + 8000).padStart(7)} ${String(res).padStart(6)} ${String(Math.round(res / 3)).padStart(6)} ${cpuOf(proc) ? 'R' : 'S'} ${cpuOf(proc).toFixed(1).padStart(5)} ${mem.toFixed(1).padStart(5)}   0:00.12 ${proc.comm}`;
    });
    return ok(`${[...head, ...rows].join('\n')}\n`);
  },
};

// --- setup задачи ---

/**
 * services: {имя: {active, enabled}} — состояние сервисов в начале задачи (unit своих
 * сервисов — файлом в setup.files). processes: [{user, command, name?, cpu?, mem?, pid?}] —
 * отдельные процессы (зависший runserver, скрипт, который грузит процессор).
 */
export function buildSystem(fs, setup) {
  if (!setup.services && !setup.processes) return;
  const state = systemState(fs);
  const time = Date.now() - 2 * 3600 * 1000;
  for (const [name, spec] of Object.entries(setup.services ?? {})) {
    const packaged = PACKAGED[name];
    if (packaged) {
      // пакет считается установленным: его файлы, которых нет в setup, — как после apt install
      fs.root.apt ??= ['git', 'curl', 'python3-venv', 'python3-pip'];
      if (!fs.root.apt.includes(packaged.pkg)) fs.root.apt.push(packaged.pkg);
      installFiles(fs, APT[packaged.pkg]);
      state.services[name] ??= {};
    }
    const service = findService(fs, name);
    if (!service) continue;
    if (spec?.enabled) enable(fs, service);
    if (spec?.active) startService(fs, service, time);
  }
  for (const proc of setup.processes ?? []) {
    const command = proc.command;
    spawn(state, {
      ...(proc.pid ? { pid: proc.pid } : {}),
      user: proc.user ?? 'shop',
      comm: proc.name ?? basename(command.split(/\s+/)[0]),
      cmd: command,
      cpu: proc.cpu,
      mem: proc.mem,
      started: time,
    });
  }
}

function installFiles(fs, pkg) {
  fs.as('root', () => {
    for (const [path, text] of Object.entries(pkg?.files ?? {})) {
      if (fs.exists(path)) continue;
      fs.mkdirAs(dirname(path), 'root');
      fs.createFile(path, text === null ? { content: '', size: 1205632 } : { content: text });
      if (text === null) fs.lookup(path).mode = 0o755;
    }
    for (const [path, target] of Object.entries(pkg?.links ?? {})) {
      if (fs.exists(path, { follow: false })) continue;
      fs.mkdirAs(dirname(path), 'root');
      fs.symlink(target, path);
    }
  });
}

// --- правила проверки ---

/** Правило service/process: true — не пройдено, null — это не такое правило. */
export function failedSystemRule(rule, fs) {
  const state = systemState(fs);
  if ('service' in rule) {
    const service = findService(fs, rule.service);
    if (!service) return rule.active !== false && rule.enabled !== false;
    if ('active' in rule && (procsOf(state, service.name).length > 0) !== rule.active) return true;
    if ('enabled' in rule && isEnabled(fs, service) !== rule.enabled) return true;
    return false;
  }
  if ('process' in rule) {
    const regex = new RegExp(rule.process);
    const running = state.procs.some((proc) => regex.test(proc.cmd));
    return running !== (rule.running ?? true);
  }
  return null;
}

// setup задачи с services/processes — сразу при создании ФС задачи
VirtualFS.setupHooks.push(buildSystem);

// apt install пакета с сервисом — сервис включён и запущен, как в Ubuntu; remove — остановлен,
// purge — ещё и выключен
installHooks.push((fs, name, action) => {
  const packaged = Object.entries(PACKAGED).find(([, item]) => item.pkg === name);
  if (!packaged) return;
  const [service] = packaged;
  const state = systemState(fs);
  state.services[service] ??= {};
  const found = findService(fs, service);
  if (action === 'install') {
    if (!found) return;
    enable(fs, found);
    startService(fs, found);
    return;
  }
  const record = { name: service, path: PACKAGED[service].unit, packaged: PACKAGED[service], record: state.services[service] };
  stopService(fs, record);
  if (action === 'purge') disable(fs, record);
});
