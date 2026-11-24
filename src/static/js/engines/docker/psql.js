// psql внутри контейнера postgres: настоящий PostgreSQL — PGlite (грузится лениво, при
// первом psql). Вывод — как у psql 16: таблицы, «(1 row)», «CREATE TABLE», «INSERT 0 2»,
// ошибки с LINE и ^. Данные живут в томе PGDATA: журнал изменяющих команд (SQL) хранится
// в записи тома и проигрывается заново в новом PGlite (после перезагрузки страницы).
//
// psql асинхронный (PGlite), а оболочка симулятора — нет: команда возвращает pending —
// обещание вывода; терминал дожидается его и печатает (engines/linux/terminal.js).

import { dockerState } from './state.js';

const PG_DATA = '/var/lib/postgresql/data';
const SOCKET = 'connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed';
const VERSION = 'PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit';
// числовые типы (выравниваются вправо): int2, int4, int8, oid, float4, float8, money, numeric
const NUMERIC = new Set([20, 21, 23, 26, 700, 701, 790, 1700]);

// --- загрузка PGlite ---

let loadPGlite = async () => {
  const url = globalThis.document?.querySelector('[data-pglite]')?.dataset.pglite;
  if (!url) throw new Error('не задан адрес PGlite (data-pglite)');
  return (await import(/* адрес CDN из настроек */ url)).PGlite;
};

/** Тесты в Node подставляют PGlite из node_modules. */
export function setPGliteLoader(loader) {
  loadPGlite = loader;
}

let PGliteClass = null;
const instances = new Map();          // «том/база» → Promise<PGlite>
const queues = new Map();             // по экземпляру — команды строго по очереди

/** Все значения — текстом, как их печатает psql (t/f, даты, numeric). */
function textParsers() {
  const parsers = {};
  for (let oid = 0; oid < 10000; oid += 1) parsers[oid] = (value) => value;
  return parsers;
}

/** Метаданные кластера в записи тома: базы, роли, журнал SQL по базам. */
export function clusterOf(volume) {
  return volume.pg;
}

/** Новый кластер после initdb: базы postgres, template0/1 и POSTGRES_DB, суперпользователь. */
export function initCluster(volume, { user = 'postgres', database = null }) {
  const db = database || user;
  volume.pg = {
    superuser: user,
    roles: [user],
    databases: { postgres: user, template0: user, template1: user, ...(db !== 'postgres' ? { [db]: user } : {}) },
    sql: {},
  };
}

async function instance(volume, db) {
  const key = `${volume.name}/${db}`;
  if (!instances.has(key)) {
    instances.set(key, (async () => {
      PGliteClass ??= await loadPGlite();
      const pg = new PGliteClass({ parsers: textParsers() });
      await pg.waitReady;
      const cluster = volume.pg;
      // имя базы и версия — как у настоящего сервера в контейнере
      await pg.exec(`CREATE FUNCTION public.current_database() RETURNS name LANGUAGE sql AS $$ SELECT '${db.replace(/'/g, "''")}'::name $$;
CREATE FUNCTION public.version() RETURNS text LANGUAGE sql AS $$ SELECT '${VERSION}'::text $$;`);
      for (const role of cluster.roles.filter((name) => name !== 'postgres')) {
        await pg.exec(`CREATE ROLE "${role}" ${role === cluster.superuser ? 'SUPERUSER ' : ''}LOGIN`);
      }
      await pg.exec('SET search_path = public, pg_catalog');
      for (const sql of cluster.sql[db] ?? []) {
        try {
          await pg.exec(sql);
        } catch (e) {
          // журнал проигрывается как есть: ошибка одной команды не мешает остальным
        }
      }
      return pg;
    })());
  }
  return instances.get(key);
}

/** Выполнить fn(pg) в очереди этой базы. */
async function withDb(volume, db, user, fn) {
  const key = `${volume.name}/${db}`;
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(async () => {
    const pg = await instance(volume, db);
    if (user !== 'postgres') await pg.exec(`SET SESSION AUTHORIZATION "${user}"`);
    else await pg.exec('RESET SESSION AUTHORIZATION');
    return fn(pg);
  });
  queues.set(key, run.catch(() => {}));
  return run;
}

/** Забыть экземпляры тома (том удалён) — тесты и docker volume rm. */
export function forgetVolume(name) {
  for (const key of [...instances.keys()]) {
    if (key.startsWith(`${name}/`)) {
      instances.delete(key);
      queues.delete(key);
    }
  }
}

// --- разбор SQL ---

/** Текст → команды [{text, start}] по «;» вне кавычек, $$ и комментариев. */
export function splitStatements(text) {
  const result = [];
  let start = 0;
  let i = 0;
  const push = (end) => {
    const piece = text.slice(start, end);
    if (piece.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim()) {
      const lead = piece.length - piece.trimStart().length;
      result.push({ text: piece.trim(), start: start + lead });
    }
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i += 1;
      while (i < text.length && !(text[i] === ch && text[i + 1] !== ch)) i += text[i] === ch ? 2 : 1;
      i += 1;
    } else if (ch === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i))?.[0];
      if (tag) {
        const end = text.indexOf(tag, i + tag.length);
        i = end === -1 ? text.length : end + tag.length;
      } else i += 1;
    } else if (ch === ';') {
      push(i);
      start = i + 1;
      i += 1;
    } else i += 1;
  }
  push(text.length);
  return result;
}

/** Есть ли незакрытая команда (интерактивный psql ждёт продолжения). */
export function incomplete(text) {
  const statements = splitStatements(`${text}\n;`);
  const trimmed = text.replace(/--[^\n]*/g, '').trim();
  if (!trimmed) return false;
  if (!trimmed.endsWith(';')) return true;
  return statements.length === 0;
}

const words = (sql) => sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').trim().split(/\s+/).map((w) => w.toUpperCase());

/** Тег команды, который печатает psql: CREATE TABLE, INSERT 0 2, UPDATE 3. */
function commandTag(sql, result) {
  const w = words(sql).map((item) => item.replace(/[;(].*$/, ''));
  const rows = result.affectedRows ?? 0;
  const [first] = w;
  if (first === 'INSERT') return `INSERT 0 ${rows}`;
  if (['UPDATE', 'DELETE', 'MERGE', 'COPY', 'MOVE', 'FETCH'].includes(first)) return `${first} ${rows}`;
  if (first === 'SELECT' || first === 'WITH' || first === 'TABLE' || first === 'VALUES') return `SELECT ${result.rows.length || rows}`;
  if (['CREATE', 'DROP', 'ALTER'].includes(first)) {
    let k = 1;
    while (['OR', 'REPLACE', 'TEMP', 'TEMPORARY', 'UNLOGGED', 'UNIQUE', 'GLOBAL', 'LOCAL'].includes(w[k])) k += 1;
    const kind = ['MATERIALIZED', 'FOREIGN', 'EVENT', 'ACCESS'].includes(w[k]) ? `${w[k]} ${w[k + 1]}` : w[k];
    if (kind === 'USER') return `${first} ROLE`;
    if (first === 'CREATE' && kind === 'TABLE' && /\bAS\b/.test(w.join(' '))) return `SELECT ${rows}`;
    return `${first} ${kind}`;
  }
  if (first === 'START') return 'START TRANSACTION';
  if (first === 'TRUNCATE') return 'TRUNCATE TABLE';
  if (first === 'END') return 'COMMIT';
  if (first === 'ABORT') return 'ROLLBACK';
  if (first === 'RESET') return 'RESET';
  return first;
}

/** Только чтение — в журнал тома не пишется. */
const readOnly = (sql) => /^(SELECT|SHOW|EXPLAIN|TABLE|VALUES)$/.test(words(sql)[0] ?? '')
  && !/\bINTO\b/i.test(sql);

// --- вывод в формате psql ---

/** Таблица psql (aligned): заголовки по центру, числа вправо, «(N rows)», пустая строка. */
export function formatTable(fields, rows, { title = null, footer = true } = {}) {
  const head = fields.map((field) => field.name);
  const right = fields.map((field) => NUMERIC.has(field.dataTypeID));
  const cells = rows.map((row) => head.map((name, k) => {
    const value = Array.isArray(row) ? row[k] : row[name];
    if (value === null || value === undefined) return [''];
    const text = Array.isArray(value) ? `{${value.join(',')}}` : String(value);
    return text.split('\n');
  }));
  const widths = head.map((name, k) => Math.max(name.length, ...cells.map((row) => Math.max(...row[k].map((line) => line.length)))));
  const lines = [];
  const center = (text, width) => {
    const left = Math.floor((width - text.length) / 2);
    return `${' '.repeat(left)}${text}${' '.repeat(width - text.length - left)}`;
  };
  const headLine = ` ${head.map((name, k) => center(name, widths[k])).join(' | ')} `;
  if (title) lines.push(center(title, headLine.length).trimEnd());
  lines.push(headLine);
  lines.push(widths.map((width) => '-'.repeat(width + 2)).join('+'));
  for (const row of cells) {
    const height = Math.max(...row.map((cell) => cell.length));
    for (let n = 0; n < height; n += 1) {
      const parts = row.map((cell, k) => {
        const text = cell[n] ?? '';
        const more = n < cell.length - 1;
        const padded = right[k] ? text.padStart(widths[k]) : text.padEnd(widths[k]);
        if (k === row.length - 1) return more ? `${padded}+` : (right[k] ? padded : text);
        return `${padded}${more ? '+' : ' '}`;
      });
      lines.push(` ${parts.map((part, k) => (k === parts.length - 1 ? part : `${part}|`)).join(' ')}`.replace(/ \|/g, ' |'));
    }
  }
  if (footer) lines.push(`(${rows.length} ${rows.length === 1 ? 'row' : 'rows'})`);
  return `${lines.join('\n')}\n\n`;
}

/** Ошибка сервера как в psql: ERROR, LINE с ^, DETAIL, HINT. */
function errorText(error, sql, offset) {
  let text = `ERROR:  ${error.message}\n`;
  const position = Number(error.position);
  if (position) {
    const at = offset + position - 1;
    const before = sql.slice(0, at);
    const lineNo = before.split('\n').length;
    const lineStart = before.lastIndexOf('\n') + 1;
    const line = sql.split('\n')[lineNo - 1];
    const prefix = `LINE ${lineNo}: `;
    text += `${prefix}${line}\n${' '.repeat(prefix.length + at - lineStart)}^\n`;
  }
  if (error.detail) text += `DETAIL:  ${error.detail}\n`;
  if (error.hint) text += `HINT:  ${error.hint}\n`;
  return text;
}

// --- метакоманды ---

const LIST_SQL = `SELECT n.nspname AS "Schema", c.relname AS "Name",
  CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
    WHEN 'i' THEN 'index' WHEN 'S' THEN 'sequence' WHEN 'p' THEN 'partitioned table' END AS "Type",
  pg_catalog.pg_get_userbyid(c.relowner) AS "Owner"
FROM pg_catalog.pg_class c LEFT JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN (%KINDS%) AND n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_toast'
  AND n.nspname <> 'information_schema'
ORDER BY 1, 2`;

async function describeTable(pg, name) {
  const [schema, table] = name.includes('.') ? name.split('.') : ['public', name];
  const columns = await pg.query(`SELECT a.attname AS "Column", pg_catalog.format_type(a.atttypid, a.atttypmod) AS "Type",
  '' AS "Collation", CASE WHEN a.attnotnull THEN 'not null' ELSE '' END AS "Nullable",
  COALESCE(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '') AS "Default"
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE c.relname = $1 AND n.nspname = $2 AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [table, schema]);
  if (!columns.rows.length) return `Did not find any relation named "${name}".\n`;
  const indexes = await pg.query(`SELECT i.relname, pg_catalog.pg_get_indexdef(x.indexrelid) AS def, x.indisprimary
FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
JOIN pg_catalog.pg_class c ON c.oid = x.indrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = $1 AND n.nspname = $2 ORDER BY x.indisprimary DESC, i.relname`, [table, schema]);
  let text = formatTable(columns.fields, columns.rows, { title: `Table "${schema}.${table}"`, footer: false }).replace(/\n\n$/, '\n');
  if (indexes.rows.length) {
    text += 'Indexes:\n';
    for (const row of indexes.rows) {
      const using = row.def.replace(/^.* USING /, '').replace(/^btree /, 'btree ');
      text += `    "${row.relname}"${row.indisprimary === 't' ? ' PRIMARY KEY,' : ''} ${using}\n`;
    }
  }
  return `${text}\n`;
}

function listDatabases(cluster) {
  const rows = Object.entries(cluster.databases).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, owner]) => ({
    Name: name, Owner: owner, Encoding: 'UTF8', 'Locale Provider': 'libc', Collate: 'en_US.utf8', Ctype: 'en_US.utf8',
    'ICU Locale': '', 'ICU Rules': '',
    'Access privileges': name.startsWith('template') ? `=c/${owner}\n${owner}=CTc/${owner}` : '',
  }));
  const fields = ['Name', 'Owner', 'Encoding', 'Locale Provider', 'Collate', 'Ctype', 'ICU Locale', 'ICU Rules', 'Access privileges']
    .map((name) => ({ name, dataTypeID: 25 }));
  return formatTable(fields, rows, { title: 'List of databases' });
}

async function meta(session, line) {
  const [command, ...args] = line.trim().split(/\s+/);
  const { pg: cluster } = session.volume;
  const run = (fn) => withDb(session.volume, session.db, session.user, fn);
  switch (command) {
    case '\\l':
    case '\\l+':
    case '\\list':
      return { out: listDatabases(cluster) };
    case '\\dt':
    case '\\d':
    case '\\dv':
    case '\\di':
    case '\\ds':
      if (command === '\\d' && args[0]) return { out: await run((pg) => describeTable(pg, args[0])) };
      return run(async (pg) => {
        const kinds = { '\\dt': "'r','p'", '\\dv': "'v','m'", '\\di': "'i'", '\\ds': "'S'", '\\d': "'r','p','v','m','S','f'" }[command];
        const result = await pg.query(LIST_SQL.replace('%KINDS%', kinds));
        if (!result.rows.length) return { out: '', err: 'Did not find any relations.\n' };
        return { out: formatTable(result.fields, result.rows, { title: 'List of relations' }) };
      });
    case '\\du':
      return {
        out: formatTable([{ name: 'Role name', dataTypeID: 25 }, { name: 'Attributes', dataTypeID: 25 }],
          cluster.roles.map((role) => ({ 'Role name': role, Attributes: role === cluster.superuser ? 'Superuser, Create role, Create DB, Replication, Bypass RLS' : '' })),
          { title: 'List of roles', footer: false }),
      };
    case '\\c':
    case '\\connect': {
      const db = args[0] ?? session.db;
      const user = args[1] ?? session.user;
      if (!cluster.databases[db]) return { err: `${SOCKET}: FATAL:  database "${db}" does not exist\nPrevious connection kept\n` };
      session.db = db;
      session.user = user;
      return { out: `You are now connected to database "${db}" as user "${user}".\n` };
    }
    case '\\conninfo':
      return { out: `You are connected to database "${session.db}" as user "${session.user}" via socket in "/var/run/postgresql" at port "5432".\n` };
    case '\\q':
    case '\\quit':
      return { quit: true };
    case '\\?':
      return { out: 'General\n  \\q                     quit psql\nInformational\n  \\d[S+]                 list tables, views, and sequences\n  \\d[S+]  NAME           describe table, view, sequence, or index\n  \\dt[S+] [PATTERN]      list tables\n  \\du[S+] [PATTERN]      list roles\n  \\l[+]   [PATTERN]      list databases\nConnection\n  \\c[onnect] [DBNAME [USER]]  connect to new database\n  \\conninfo               display information about current connection\n' };
    default:
      return { err: `invalid command ${command}\nTry \\? for help.\n` };
  }
}

// --- выполнение текста ---

/** CREATE/DROP DATABASE — не в PGlite, а в метаданных кластера (у каждой базы свой PGlite). */
function databaseCommand(session, sql) {
  const create = /^\s*CREATE\s+DATABASE\s+("?)([\w-]+)\1/i.exec(sql);
  const drop = /^\s*DROP\s+DATABASE\s+(IF\s+EXISTS\s+)?("?)([\w-]+)\2/i.exec(sql);
  const { pg: cluster } = session.volume;
  if (create) {
    const name = create[1] ? create[2] : create[2].toLowerCase();
    if (cluster.databases[name]) return { error: `ERROR:  database "${name}" already exists\n` };
    cluster.databases[name] = session.user;
    return { tag: 'CREATE DATABASE' };
  }
  if (drop) {
    const name = drop[2] ? drop[3] : drop[3].toLowerCase();
    if (!cluster.databases[name]) {
      return drop[1] ? { tag: 'DROP DATABASE', notice: `NOTICE:  database "${name}" does not exist, skipping\n` } : { error: `ERROR:  database "${name}" does not exist\n` };
    }
    if (name === session.db) return { error: 'ERROR:  cannot drop the currently open database\n' };
    delete cluster.databases[name];
    delete cluster.sql[name];
    forgetVolume(`${session.volume.name}/${name}`);
    return { tag: 'DROP DATABASE' };
  }
  return null;
}

/**
 * Выполнить SQL-текст (одну или несколько команд). Возвращает {out, err, code}.
 * Как psql -c: команды по очереди, на первой ошибке — остановка, код 1.
 */
async function execute(session, text) {
  const statements = splitStatements(text);
  const { pg: cluster } = session.volume;
  let out = '';
  let err = '';
  for (const statement of statements) {
    const sql = statement.text;
    const database = databaseCommand(session, sql);
    if (database) {
      if (database.error) return { out, err: err + database.error, code: 1 };
      err += database.notice ?? '';
      out += `${database.tag}\n`;
      continue;
    }
    try {
      const result = await withDb(session.volume, session.db, session.user, (pg) => pg.query(sql));
      const tag = commandTag(sql, result);
      if (result.fields.length) out += formatTable(result.fields, result.rows);
      if (!result.fields.length || !/^SELECT /.test(tag)) out += `${tag}\n`;
      // журнал тома: изменения (и транзакции) — чтобы данные пережили перезагрузку
      if (!readOnly(sql)) {
        const role = /^\s*CREATE\s+(ROLE|USER)\s+("?)(\w+)\2/i.exec(sql);
        if (role) {
          cluster.roles.push(role[2] ? role[3] : role[3].toLowerCase());
        } else {
          (cluster.sql[session.db] ??= []).push(sql);
        }
      }
    } catch (error) {
      return { out, err: err + errorText(error, text, statement.start), code: 1 };
    }
  }
  return { out, err, code: 0 };
}

// --- команда psql ---

const envOf = (container, name) => container.env.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);

/** Том PGDATA контейнера: запись тома или null (данные — в bind mount, тома нет). */
function pgVolume(hostFs, container) {
  const state = dockerState(hostFs);
  const mount = container?.mounts.find((item) => item.destination === PG_DATA && item.type === 'volume');
  return (mount && state.volumes[mount.name]) ?? null;
}

/** initdb в контейнере: кластер с суперпользователем POSTGRES_USER и базой POSTGRES_DB. */
export function initDataCluster(hostFs, container) {
  const volume = pgVolume(hostFs, container);
  if (!volume) return;
  initCluster(volume, { user: envOf(container, 'POSTGRES_USER') || 'postgres', database: envOf(container, 'POSTGRES_DB') || null });
  forgetVolume(volume.name);
}

/** Том с данными postgres у контейнера (PGDATA) — или null. */
function dataVolume(hostFs, containerId) {
  const container = dockerState(hostFs).containers.find((c) => c.id === containerId);
  const volume = pgVolume(hostFs, container);
  // база инициализирована до того, как у тома появились метаданные (старое сохранение)
  if (volume && !volume.pg && container.status === 'running') initDataCluster(hostFs, container);
  return volume?.pg ? volume : null;
}

/** Разбор аргументов psql: -U, -d, -c (повторяется), -h, -p, -t, -A, база и пользователь позиционно. */
function parseArgs(args, env) {
  const opts = { commands: [], user: null, db: null };
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = () => args[(i += 1)];
    if (arg === '-U' || arg === '--username') opts.user = value();
    else if (arg.startsWith('-U')) opts.user = arg.slice(2);
    else if (arg.startsWith('--username=')) opts.user = arg.slice(11);
    else if (arg === '-d' || arg === '--dbname') opts.db = value();
    else if (arg.startsWith('-d')) opts.db = arg.slice(2);
    else if (arg.startsWith('--dbname=')) opts.db = arg.slice(9);
    else if (arg === '-c' || arg === '--command') opts.commands.push(value());
    else if (arg.startsWith('--command=')) opts.commands.push(arg.slice(10));
    else if (arg === '-h' || arg === '-p' || arg === '--host' || arg === '--port') value();
    else if (['-t', '-A', '-q', '-X', '-w', '-W', '--no-psqlrc'].includes(arg)) {
      if (arg === '-t') opts.tuples = true;
    } else if (arg === '--version' || arg === '-V') opts.version = true;
    else if (!arg.startsWith('-')) positional.push(arg);
  }
  opts.db ??= positional[0] ?? null;
  opts.user ??= positional[1] ?? env.PGUSER ?? env.USER ?? 'root';
  opts.db ??= env.PGDATABASE ?? opts.user;
  return opts;
}

/** Подключение: роль и база должны существовать (иначе FATAL, код 2). */
function connect(volume, user, db) {
  const { pg: cluster } = volume;
  if (!cluster.roles.includes(user)) return { err: `psql: error: ${SOCKET}: FATAL:  role "${user}" does not exist\n`, code: 2 };
  if (!cluster.databases[db] || db === 'template0') {
    return { err: `psql: error: ${SOCKET}: FATAL:  database "${db}" does not exist\n`, code: 2 };
  }
  return null;
}

/** Интерактивный psql (docker exec -it db psql …): строки — SQL, приглашение shop=#. */
class PsqlSession {
  constructor(volume, user, db) {
    this.volume = volume;
    this.user = user;
    this.db = db;
    this.buffer = '';
    this.history = [];
    this.machine = null;
  }

  prompt() {
    const sign = this.user === this.volume.pg.superuser ? '#' : '>';
    return `${this.db}${this.buffer ? '-' : '='}${sign} `;
  }

  complete(line) {
    return { line, options: [] };
  }

  run(line) {
    if (line.trim()) this.history.push(line);
    const trimmed = line.trim();
    if (!this.buffer && /^(\\q|\\quit|exit|quit)$/.test(trimmed)) return { chunks: [], action: { type: 'leave', code: 0 } };
    if (!this.buffer && trimmed.startsWith('\\')) {
      const pending = meta(this, trimmed).then((result) => ({
        chunks: [...(result.out ? [{ text: result.out, err: false }] : []), ...(result.err ? [{ text: result.err, err: true }] : [])],
        code: 0,
      }));
      return { chunks: [], pending };
    }
    this.buffer += (this.buffer ? '\n' : '') + line;
    if (incomplete(this.buffer)) return { chunks: [] };
    const text = this.buffer;
    this.buffer = '';
    const pending = execute(this, text).then((result) => ({
      chunks: [...(result.out ? [{ text: result.out, err: false }] : []), ...(result.err ? [{ text: result.err, err: true }] : [])],
      code: 0,
    }));
    return { chunks: [], pending };
  }
}

const BANNER = 'psql (16.15 (Debian 16.15-1.pgdg13+2))\nType "help" for help.\n\n';

export const psql = {
  help: 'psql — клиент PostgreSQL: psql -U postgres -d shop -c "SELECT 1".',
  run({ sh, args, tty }) {
    const opts = parseArgs(args, sh.env);
    if (opts.version) return { out: 'psql (PostgreSQL) 16.15 (Debian 16.15-1.pgdg13+2)\n' };
    const volume = sh.machine?.hostFs ? dataVolume(sh.machine.hostFs, sh.machine.container) : null;
    if (!volume) return { err: `psql: error: ${SOCKET}: No such file or directory\n\tIs the server running locally and accepting connections on that socket?\n`, code: 2 };
    const refused = connect(volume, opts.user, opts.db);
    if (refused) return refused;
    const session = new PsqlSession(volume, opts.user, opts.db);
    if (!opts.commands.length) {
      if (!tty || !sh.machine?.interactive) return {};      // без терминала: пустой ввод — выход
      return { out: BANNER, action: { type: 'enter', shell: session, onLeave: () => {} } };
    }
    // -c: команды по очереди; метакоманда — если строка начинается с \
    const pending = (async () => {
      let out = '';
      let err = '';
      for (const command of opts.commands) {
        const result = command.trim().startsWith('\\') ? await meta(session, command) : await execute(session, command);
        out += result.out ?? '';
        err += result.err ?? '';
        if (result.code) return { out, err, code: result.code };
      }
      return { out, err, code: 0 };
    })();
    return { pending };
  },
};

export { PG_DATA };
