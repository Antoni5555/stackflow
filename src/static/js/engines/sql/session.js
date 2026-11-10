// Работа с базой PGlite: выполнить текст ученика по запросам, снять таблицы
// до и после, описать схему, сбросить базу к учебным данным.
// Не зависит от воркера: те же функции проверяет Node-тест (tests/js/sql.test.js)
// с PGlite из npm — значит, сайт и тест считают одинаково.
//
// Значения — текстом, как их выводит PostgreSQL (1499.00, t, 2026-03-01 12:00:00+03):
// так их видит ученик в psql и так их описывают задачи.

import { mentionedColumns, parseJoin } from './join.js';
import { errorLocation, splitStatements, statementKind } from './split.js';

export const TIMEZONE = 'Europe/Moscow';
export const MAX_ROWS = 500;          // учебная база маленькая; больше на экране не нужно
export const JOIN_ROWS = 40;          // строк исходной таблицы на картинке JOIN

const quote = (name) => `"${name.replace(/"/g, '""')}"`;

/** Парсеры «как есть» для всех типов: PGlite отдаёт значения строками, без перевода в JS. */
export async function textParsers(db) {
  const { rows } = await db.query('SELECT oid FROM pg_type');
  return Object.fromEntries(rows.map(({ oid }) => [oid, (value) => value]));
}

/** Сессия: часовой пояс задач (заказы около полуночи не уходят в соседний месяц). */
export async function prepareSession(db) {
  await db.exec(`SET TimeZone TO '${TIMEZONE}'`);
}

/** Удалить всё, что создано в базе, и загрузить учебные данные (schema.sql + seed.sql + setup). */
export async function resetDatabase(db, base = '') {
  const { rows } = await db.query(`
    SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'`);
  const drops = rows.map(({ nspname }) => `DROP SCHEMA ${quote(nspname)} CASCADE;`).join('\n');
  await db.exec(`${drops}\nCREATE SCHEMA public;\nSET search_path TO public;`);
  await prepareSession(db);
  if (base.trim()) await db.exec(base);
}

/** Схема для полосы «Схема базы»: таблицы, колонки, ограничения и число строк. */
export async function schemaOverview(db) {
  const tables = await describeSchema(db);
  for (const table of tables) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${quote(table.name)}`);
    table.rowCount = rows[0].n;
  }
  return tables;
}

/** Есть ли в базе хоть одна своя таблица (пустая база песочницы — загрузить учебные данные). */
export async function hasTables(db) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
  return rows[0].n > 0;
}

// --- Схема ---

/**
 * Таблицы схемы public: колонки (имя, тип, NOT NULL, DEFAULT, identity) и ограничения
 * (тип, текст определения от самого PostgreSQL). По ней рисуется полоса «Схема»
 * и проверяются задачи на CREATE/ALTER TABLE.
 */
export async function describeSchema(db) {
  const columns = await db.query(`
    SELECT c.relname AS "table", a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS not_null, pg_get_expr(d.adbin, d.adrelid) AS "default",
           a.attidentity AS identity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE c.relkind IN ('r', 'p')
    ORDER BY c.relname, a.attnum`);
  const constraints = await db.query(`
    SELECT c.relname AS "table", k.conname AS name, k.contype AS type,
           pg_get_constraintdef(k.oid) AS definition,
           f.relname AS references
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    LEFT JOIN pg_class f ON f.oid = k.confrelid
    WHERE k.contype IN ('p', 'u', 'c', 'f')
    ORDER BY c.relname, k.contype, pg_get_constraintdef(k.oid)`);
  const tables = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, { name, columns: [], constraints: [] });
    return tables.get(name);
  };
  for (const col of columns.rows) {
    table(col.table).columns.push({
      name: col.name,
      type: col.type,
      notNull: col.not_null,
      default: col.default,
      identity: { a: 'always', d: 'by default' }[col.identity] ?? null,
    });
  }
  const TYPES = { p: 'primary key', u: 'unique', c: 'check', f: 'foreign key' };
  for (const con of constraints.rows) {
    table(con.table).constraints.push({
      name: con.name, type: TYPES[con.type], definition: con.definition, references: con.references,
    });
  }
  return [...tables.values()];
}

// --- Снимки таблиц ---

/** Колонки первичного ключа каждой таблицы: { orders: ['id'], product_tags: ['product_id', 'tag_id'] }. */
async function primaryKeys(db) {
  const { rows } = await db.query(`
    SELECT c.relname AS "table", array_agg(a.attname ORDER BY k.ord) AS columns
    FROM pg_constraint p
    JOIN pg_class c ON c.oid = p.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE p.contype = 'p'
    GROUP BY c.relname`);
  return Object.fromEntries(rows.map((row) => [row.table, row.columns]));
}

/**
 * Таблицы целиком: { name: { columns, key, rows } }. key — индексы колонок первичного
 * ключа (пусто — ключа нет, строки сравниваются целиком). Строки — по ключу,
 * без ключа — по тексту строки: порядок одинаковый у ученика и у эталона.
 */
export async function snapshotTables(db, parsers, names = null) {
  const keys = await primaryKeys(db);
  const { rows } = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  const result = {};
  for (const { tablename: name } of rows) {
    if (names && !names.includes(name)) continue;
    const pk = keys[name] ?? [];
    const order = pk.length ? pk.map(quote).join(', ') : `${quote(name)}::text`;
    const [res] = await db.exec(`SELECT * FROM ${quote(name)} ORDER BY ${order}`, { parsers, rowMode: 'array' });
    const columns = res.fields.map((field) => field.name);
    result[name] = { columns, key: pk.map((col) => columns.indexOf(col)), rows: res.rows };
  }
  return result;
}

const rowId = (table, row) => JSON.stringify(table.key.length ? table.key.map((i) => row[i]) : row);

/**
 * Отличия таблицы после запроса: строки с отметкой added / changed (+ какие колонки и что было)
 * / removed / null. Удалённые строки — в конце, чтобы их было видно.
 */
export function diffTable(before, after) {
  const old = new Map(before ? before.rows.map((row) => [rowId(before, row), row]) : []);
  const seen = new Set();
  const rows = after.rows.map((values) => {
    const id = rowId(after, values);
    const prev = old.get(id);
    if (!prev || seen.has(id)) return { values, mark: 'added' };
    seen.add(id);
    const changed = after.columns.filter((col, i) => {
      const j = before.columns.indexOf(col);
      return j === -1 || prev[j] !== values[i];
    });
    if (!changed.length) return { values, mark: null };
    // old — прежние значения изменённых колонок: на экране «5 → 10»
    const oldValues = Object.fromEntries(changed.map((col) => [col, prev[before.columns.indexOf(col)] ?? null]));
    return { values, mark: 'changed', changed, old: oldValues };
  });
  for (const [id, prev] of old) {
    if (seen.has(id)) continue;
    rows.push({ values: after.columns.map((col) => prev[before.columns.indexOf(col)] ?? null), mark: 'removed' });
  }
  return rows;
}

/** Что изменил запрос: созданные, удалённые таблицы и таблицы с изменёнными строками или колонками. */
export function diffSnapshots(before, after) {
  const changes = [];
  for (const [name, table] of Object.entries(after)) {
    const prev = before[name];
    const columnsChanged = prev && prev.columns.join('\0') !== table.columns.join('\0');
    const rows = diffTable(prev, table);
    if (prev && !columnsChanged && rows.every((row) => !row.mark)) continue;
    changes.push({
      table: name,
      status: !prev ? 'created' : columnsChanged ? 'altered' : 'rows',
      columns: table.columns,
      newColumns: prev ? table.columns.filter((col) => !prev.columns.includes(col)) : [],
      rows,
    });
  }
  for (const name of Object.keys(before)) {
    if (!(name in after)) changes.push({ table: name, status: 'dropped', columns: before[name].columns, rows: [] });
  }
  return changes;
}

// --- Картинка JOIN ---

/**
 * Какие строки двух таблиц совпали: таблицы (колонки из запроса + ключ), пары строк
 * и для каждой строки результата — её пара (если запрос без группировки).
 * Строки связываем по ctid — физическому адресу строки: он есть у любой таблицы.
 */
export async function joinView(db, parsers, sql, columnsOfResult) {
  const join = parseJoin(sql);
  if (!join) return null;
  const keys = await primaryKeys(db);
  const ref = (side) => quote(side.alias ?? side.table);
  const pairs = await db.query(
    `SELECT ${ref(join.left)}.ctid::text AS l, ${ref(join.right)}.ctid::text AS r ${join.from}`,
  );
  const side = async (info) => {
    const [all] = await db.exec(`SELECT * FROM ${quote(info.table)} LIMIT 0`, { parsers });
    const names = all.fields.map((field) => field.name);
    const pk = keys[info.table] ?? [];
    const shown = [...new Set([...pk, ...mentionedColumns(sql, names)])];
    const columns = shown.length ? names.filter((name) => shown.includes(name)) : names;
    const order = pk.length ? pk.map(quote).join(', ') : 'ctid';
    const [res] = await db.exec(
      `SELECT ctid::text, ${columns.map(quote).join(', ')}, count(*) OVER () FROM ${quote(info.table)} ORDER BY ${order} LIMIT ${JOIN_ROWS}`,
      { parsers, rowMode: 'array' },
    );
    return {
      ...info,
      columns,
      ids: res.rows.map((row) => row[0]),
      rows: res.rows.map((row) => row.slice(1, -1)),
      total: Number(res.rows[0]?.at(-1) ?? 0),
    };
  };
  const view = {
    type: join.type,
    on: join.on,
    left: await side(join.left),
    right: await side(join.right),
    pairs: pairs.rows.map((row) => [row.l, row.r]),
    resultPairs: null,
  };
  if (!join.grouped && columnsOfResult) {
    // тот же запрос, к каждой строке результата — адреса её пары
    const [res] = await db.exec(
      `SELECT ${ref(join.left)}.ctid::text, ${ref(join.right)}.ctid::text, ${join.select} ${join.tail}`,
      { parsers, rowMode: 'array' },
    ).catch(() => [null]);
    if (res) view.resultPairs = res.rows.slice(0, MAX_ROWS).map((row) => [row[0], row[1]]);
  }
  return view;
}

// --- Выполнение текста ученика ---

function describeError(error, text, statement) {
  const result = { message: error.message, line: statement.line };
  if (error.detail) result.detail = error.detail;
  if (error.hint) result.hint = error.hint;
  if (error.position) Object.assign(result, errorLocation(text, statement, Number(error.position)));
  return result;
}

/**
 * Выполнить текст по запросам, до первой ошибки (как psql с ON_ERROR_STOP).
 * Для каждого: { sql, line, kind, ms, columns, rows, truncated, affected, changes, join, error }.
 * Таблицы снимаются до и после каждого запроса, который может что-то изменить:
 * база маленькая, целиком — быстрее, чем выяснять, что именно затронуто.
 */
export async function runScript(db, parsers, text) {
  const statements = splitStatements(text);
  const results = [];
  let snapshot = null;
  for (const statement of statements) {
    const kind = statementKind(statement.sql);
    const watch = kind !== 'query' && kind !== 'set';
    const item = { sql: statement.sql, line: statement.line, kind };
    if (watch && !snapshot) snapshot = await snapshotTables(db, parsers).catch(() => null);
    const started = performance.now();
    try {
      // строки — массивами: у SELECT id, id две колонки с одним именем
      const [res] = await db.exec(statement.sql, { parsers, rowMode: 'array' });
      item.ms = Math.round(performance.now() - started);
      if (res?.fields.length) {
        item.columns = res.fields.map((field) => field.name);
        item.rows = res.rows.slice(0, MAX_ROWS);
        item.rowCount = res.rows.length;
        item.truncated = res.rows.length > MAX_ROWS;
      }
      if (kind === 'dml') item.affected = res?.affectedRows ?? 0;
      if (kind === 'query' && /\bjoin\b/i.test(statement.sql)) {
        item.join = await joinView(db, parsers, statement.sql, item.columns).catch(() => null);
      }
    } catch (error) {
      item.error = describeError(error, text, statement);
      results.push(item);
      break;
    }
    if (watch && snapshot) {
      // В прерванной транзакции снять таблицы нельзя — тогда просто без отличий
      const after = await snapshotTables(db, parsers).catch(() => null);
      if (after) item.changes = diffSnapshots(snapshot, after);
      snapshot = after;
    }
    results.push(item);
  }
  return results;
}
