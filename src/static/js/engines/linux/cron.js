// crontab — расписание задач пользователя, как cron в Ubuntu 24.04 (Debian crontab).
// Хранение — /var/spool/cron/crontabs/ИМЯ (ученик напрямую не читает), проверка строк
// при установке — как в cron («bad minute»). Задачи по времени не запускаются.
// setup: crontab: {shop: "0 3 * * * …\n"}; правило задачи: {crontab: shop, matches: 'regex'}.

import { FsError, USERS, VirtualFS } from './fs.js';

const SPOOL = '/var/spool/cron/crontabs';
const TEMP_DIR = '/tmp/crontab.Lq3k2Z';
const TEMP = `${TEMP_DIR}/crontab`;

// Шаблон, который crontab -e показывает в первый раз (как в Ubuntu)
const TEMPLATE = `# Edit this file to introduce tasks to be run by cron.
#
# Each task to run has to be defined through a single line
# indicating with different fields when the task will be run
# and what command to run for the task
#
# To define the time you can provide concrete values for
# minute (m), hour (h), day of month (dom), month (mon),
# and day of week (dow) or use '*' in these fields (for 'any').
#
# Notice that tasks will be started based on the cron's system
# daemon's notion of time and timezones.
#
# Output of the crontab jobs (including errors) is sent through
# email to the user the crontab file belongs to (unless redirected).
#
# For example, you can run a backup of all your user accounts
# at 5 a.m every week with:
# 0 5 * * 1 tar -zcf /var/backups/home.tgz /home/
#
# For more information see the manual pages of crontab(5) and cron(8)
#
# m h  dom mon dow   command
`;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, base: 1 },
  { name: 'day-of-week', min: 0, max: 7, names: DAYS, base: 0 },
];
const SPECIAL = /^@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)$/;

const ok = (out = '') => ({ out, err: '', code: 0 });
const fail = (err, code = 1) => ({ out: '', err, code });

/** Одно поле времени: *, 5, 1-5, *\/10, 1-30/5, 1,15,30, jan, mon-fri. */
function validField(text, field) {
  const value = (token) => {
    if (/^\d+$/.test(token)) return Number(token);
    const index = field.names?.indexOf(token.toLowerCase()) ?? -1;
    return index === -1 ? NaN : index + field.base;
  };
  return text.split(',').every((item) => {
    const match = /^(\*|(\w+)(?:-(\w+))?)(?:\/(\d+))?$/.exec(item);
    if (!match) return false;
    if (match[4] !== undefined && Number(match[4]) === 0) return false;
    if (match[1] === '*') return true;
    const from = value(match[2]);
    const to = match[3] === undefined ? from : value(match[3]);
    return [from, to].every((n) => n >= field.min && n <= field.max) && from <= to;
  });
}

/**
 * Первая ошибка файла crontab {line, message} или null — как cron 3.0pl1 (Ubuntu): он
 * останавливается на первой ошибке, строки считает с нуля (с комментариями и пустыми),
 * а если полей не хватило — уже дочитал до конца строки, и номер на 1 больше.
 * Строка без команды («0 3 * * *», «@daily») cron принимает.
 */
export function crontabError(text) {
  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || /^[A-Za-z_]\w*\s*=/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words[0].startsWith('@')) {
      if (!SPECIAL.test(words[0])) return { line: index, message: 'bad time specifier' };
      continue;
    }
    const k = FIELDS.findIndex((field, n) => words[n] === undefined || !validField(words[n], field));
    if (k !== -1) {
      return { line: words[k] === undefined ? index + 1 : index, message: `bad ${FIELDS[k].name}` };
    }
  }
  return null;
}

const spoolPath = (user) => `${SPOOL}/${user}`;

/** Текст crontab пользователя или null (читает от root — как сам cron). */
export function readCrontab(fs, user) {
  return fs.as('root', () => {
    try {
      return fs.readFile(spoolPath(user));
    } catch (e) {
      if (e instanceof FsError) return null;
      throw e;
    }
  });
}

function writeCrontab(fs, user, text) {
  fs.as('root', () => {
    fs.mkdirAs(SPOOL, 'root').mode = 0o1730;
    const node = fs.writeFile(spoolPath(user), text);
    Object.assign(node, { owner: user, group: user, mode: 0o600 });
  });
}

function removeCrontab(fs, user) {
  fs.as('root', () => fs.remove(spoolPath(user)));
}

/**
 * Проверить и поставить текст. source — имя файла в сообщениях ("-", "/tmp/…").
 * Возвращает {err, code}; prefix — строки до ошибок (crontab -e пишет «installing» первым).
 */
function install(fs, user, text, source, prefix = '', dryRun = false) {
  if (text && !text.endsWith('\n')) {
    return { err: `${prefix}new crontab file is missing newline before EOF, can't install.\n`, code: 1 };
  }
  const error = crontabError(text);
  if (error) {
    return {
      err: `${prefix}"${source}":${error.line}: ${error.message}\nerrors in crontab file, can't install.\n`,
      code: 1,
    };
  }
  if (dryRun) return { out: 'The syntax of the crontab file was successfully checked.\n', err: prefix, code: 0 };
  writeCrontab(fs, user, text);
  return { err: prefix, code: 0 };
}

// --- команда ---

const USAGE = `usage:\tcrontab [-u user] [-n] file
\tcrontab [ -u user ] [ -i ] { -e | -l | -r }

\t-h\t(displays this help message)

\tfile\t(default operation is replace, per 1003.2)
\t-n\t(dry run: checks the syntax, then bails out)
\t-u user\t(choose the user whose crontab is touched)

\t-e\t(edit user's crontab)
\t-l\t(list user's crontab)
\t-r\t(delete user's crontab)

\t-i\t(prompt before deleting user's crontab)
`;

/** После nano в crontab -e: изменения → проверка и установка. */
function afterEdit(fs, user, original) {
  let text = '';
  try {
    text = fs.as('root', () => fs.readFile(TEMP));
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
  }
  const chunks = [];
  if (text === original) {
    chunks.push({ text: 'crontab: no changes made to crontab\n', err: true });
  } else {
    const result = install(fs, user, text, TEMP, 'crontab: installing new crontab\n');
    if (result.code) {
      // настоящий crontab спрашивает «Do you want to retry the same edit?» — у нас правка
      // сохраняется до следующего crontab -e
      fs.root.cronDraft = { ...(fs.root.cronDraft ?? {}), [user]: text };
      chunks.push({ text: result.err, err: true });
      chunks.push({ text: '(в тренажёре вопроса «retry» нет: crontab -e откроет вашу правку снова)\n', err: false });
      return chunks;
    }
    chunks.push({ text: result.err, err: true });
  }
  if (fs.root.cronDraft) delete fs.root.cronDraft[user];
  fs.as('root', () => {
    try {
      fs.remove(TEMP_DIR, { recursive: true });
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
    }
  });
  return chunks;
}

export const crontab = {
  help: `crontab — расписание задач пользователя (cron).
  crontab -l          показать
  crontab -e          изменить в nano
  crontab -r          удалить всё расписание
  crontab файл        поставить расписание из файла (crontab - — из ввода)
  crontab -n файл     только проверить строки, не ставить
  sudo crontab -u ИМЯ -l    расписание другого пользователя
Строка: минута час день месяц день_недели команда
  0 3 * * * /srv/shop/bin/backup.sh     каждый день в 03:00
  */15 * * * * …                        каждые 15 минут
Добавить строку, не открывая редактор:
  (crontab -l; echo "0 3 * * * /srv/shop/bin/backup.sh") | crontab -`,
  run({ sh, fs, args, stdin }) {
    let user = fs.user;
    let mode = null;
    let dryRun = false;
    const files = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '-u') {
        if (fs.user !== 'root') return fail('must be privileged to use -u\n');
        user = args[i + 1];
        i += 1;
        if (!USERS[user]) return fail(`crontab: user \`${user}' unknown\n`);
      } else if (/^-[elr]$/.test(arg)) {
        if (mode) return fail(`crontab: usage error: only one operation permitted\n${USAGE}`);
        mode = arg[1];
      } else if (arg === '-n') {
        dryRun = true;
      } else if (arg === '-i') {
        // спросить перед -r: в тренажёре не спрашиваем
      } else if (arg.startsWith('-') && arg !== '-') {
        return fail(`crontab: invalid option -- '${arg.slice(1, 2)}'\ncrontab: usage error: unrecognized option\n${USAGE}`);
      } else files.push(arg);
    }
    if (mode && files.length) return fail(`crontab: usage error: no arguments permitted after this option\n${USAGE}`);
    if (!mode && !files.length) {
      return fail(`crontab: usage error: file name must be specified for replace\n${USAGE}`);
    }
    const current = readCrontab(fs, user);
    if (mode === 'l') return current === null ? fail(`no crontab for ${user}\n`) : ok(current);
    if (mode === 'r') {
      if (current === null) return fail(`no crontab for ${user}\n`);
      removeCrontab(fs, user);
      return ok();
    }
    if (mode === 'e') {
      const draft = fs.root.cronDraft?.[user];
      const original = current ?? TEMPLATE;
      const owner = sh.env.USER ?? 'shop';      // nano работает от того, кто сидит в терминале
      fs.as('root', () => {
        const dir = fs.mkdirAs(TEMP_DIR, owner);
        dir.mode = 0o700;
        const node = fs.writeFile(TEMP, draft ?? original);
        Object.assign(node, { owner, group: owner, mode: 0o600 });
      });
      return {
        err: current === null ? `no crontab for ${user} - using an empty one\n` : '',
        action: { type: 'edit', path: TEMP, name: TEMP, onClose: () => afterEdit(fs, user, original) },
      };
    }
    // crontab ФАЙЛ / crontab -
    const [source] = files;
    let text;
    if (source === '-') text = stdin;
    else {
      try {
        text = fs.readFile(sh.resolve(source));
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        return fail(`${source}: ${e.message}\n`);
      }
    }
    const result = install(fs, user, text, source, '', dryRun);
    return { out: result.out ?? '', err: result.err, code: result.code };
  },
};

// --- setup и правило задачи ---

VirtualFS.setupHooks.push((fs, setup) => {
  fs.mkdirAs(SPOOL, 'root').mode = 0o1730;
  for (const [user, value] of Object.entries(setup.crontab ?? {})) {
    const text = String(value ?? '');
    writeCrontab(fs, user, text && !text.endsWith('\n') ? `${text}\n` : text);
  }
});

/** Правило {crontab: user, matches | not_matches | exists}; null — правило не про crontab. */
export function failedCronRule(rule, fs) {
  if (!('crontab' in rule)) return null;
  const text = readCrontab(fs, rule.crontab);
  if ('exists' in rule) return (text !== null) !== Boolean(rule.exists);
  // строки-комментарии не в счёт: шаблон ищется в настоящих строках расписания
  const lines = (text ?? '').split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
  if ('matches' in rule) return !new RegExp(rule.matches, 'm').test(lines);
  if ('not_matches' in rule) return new RegExp(rule.not_matches, 'm').test(lines);
  return true;
}
