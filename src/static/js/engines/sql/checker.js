// Проверка SQL-задач: решение ученика и эталон выполняются на одной и той же
// свежей базе (учебные данные + setup задачи), потом сравнивается то, что
// задано в check.type:
//   result — результат последнего запроса (колонки по порядку и по имени, значения текстом);
//   state  — таблицы из tables после решения (все колонки или перечисленные);
//   schema — структура таблиц из tables: колонки и ограничения, без данных.
// Работает и в воркере (страница задачи), и в Node (тест эталонов content/).

import { describeSchema, resetDatabase, runScript, shortType, snapshotTables } from './session.js';

const plural = (n, one, few, many) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${n} ${word}`;
};
const rows = (n) => plural(n, 'строка', 'строки', 'строк');
const columnsText = (n) => plural(n, 'колонка', 'колонки', 'колонок');
const value = (v) => (v === null ? 'NULL' : v);
const rowText = (row) => `(${row.map(value).join(', ')})`;
const key = (row) => JSON.stringify(row);

/** Что получилось после текста: результат последнего запроса, таблицы, схема. */
async function outcome(db, parsers, base, setup, code, check) {
  await resetDatabase(db, `${base}\n${setup ?? ''}`);
  const log = await runScript(db, parsers, code);
  const failed = log.find((item) => item.error);
  const result = { log, error: failed?.error ?? null };
  if (failed) return result;
  if (check.type === 'result') {
    const last = [...log].reverse().find((item) => item.columns);
    result.result = last ? { columns: last.columns, rows: last.rows } : null;
  } else if (check.type === 'state') {
    const tables = await snapshotTables(db, parsers, check.tables.map((table) => table.name));
    result.tables = Object.fromEntries(check.tables.map(({ name, columns }) => {
      const table = tables[name];
      if (!table) return [name, null];
      const shown = columns ?? table.columns;
      const index = shown.map((column) => table.columns.indexOf(column));
      return [name, {
        columns: shown,
        missing: shown.filter((_, i) => index[i] === -1),
        rows: table.rows.map((row) => index.map((i) => (i === -1 ? null : row[i]))),
        // без своих колонок порядок — по первичному ключу; с колонками — сравниваем как набор
        ordered: !columns,
      }];
    }));
  } else {
    const names = check.tables.map((table) => table.name);
    const schema = await describeSchema(db);
    result.schema = Object.fromEntries(names.map((name) => [name, schema.find((t) => t.name === name) ?? null]));
  }
  return result;
}

// --- Сравнение ---

/** Строки как набор: одинаковые строки считаются, порядок не важен. */
function rowDiff(expected, actual) {
  const left = new Map();
  for (const row of expected) left.set(key(row), (left.get(key(row)) ?? 0) + 1);
  const extra = [];
  for (const row of actual) {
    const n = left.get(key(row)) ?? 0;
    if (n) left.set(key(row), n - 1);
    else extra.push(row);
  }
  const missing = expected.filter((row) => {
    const n = left.get(key(row)) ?? 0;
    if (!n) return false;
    left.set(key(row), n - 1);
    return true;
  });
  return { missing, extra };
}

/** Таблица «получилось» с отметками: строки, которых не хватает, и лишние. */
function markedRows(expected, actual, ordered) {
  const { missing, extra } = rowDiff(expected, actual);
  const extraLeft = new Map();
  for (const row of extra) extraLeft.set(key(row), (extraLeft.get(key(row)) ?? 0) + 1);
  const marked = actual.map((row, i) => {
    const n = extraLeft.get(key(row)) ?? 0;
    if (n) {
      extraLeft.set(key(row), n - 1);
      return { values: row, mark: 'extra' };
    }
    return { values: row, mark: ordered && key(expected[i] ?? []) !== key(row) ? 'moved' : null };
  });
  // недостающие — первыми: их важнее всего увидеть, а лишних бывает много
  return [...missing.map((row) => ({ values: row, mark: 'missing' })), ...marked];
}

function compareResult(expected, actual, orderMatters) {
  if (!actual) return { message: 'Последний запрос ничего не вернул — нужен SELECT, который выводит результат.' };
  const panel = { kind: 'result', expected, actual: { columns: actual.columns, rows: [] } };
  if (expected.columns.join('\0') !== actual.columns.join('\0')) {
    panel.actual.rows = actual.rows.map((values) => ({ values, mark: null }));
    const message = expected.columns.length !== actual.columns.length
      ? `Ожидалось ${columnsText(expected.columns.length)} (${expected.columns.join(', ')}), получилось ${actual.columns.length}: ${actual.columns.join(', ')}.`
      : `Колонки по порядку: ожидалось ${expected.columns.join(', ')} — получилось ${actual.columns.join(', ')}. Имя задаёт AS.`;
    return { message, panel };
  }
  const { missing, extra } = rowDiff(expected.rows, actual.rows);
  panel.actual.rows = markedRows(expected.rows, actual.rows, orderMatters);
  if (missing.length || extra.length) {
    const parts = [];
    if (expected.rows.length !== actual.rows.length) parts.push(`ожидалось ${rows(expected.rows.length)}, получилось ${actual.rows.length}`);
    if (extra.length) parts.push(`лишние: ${rows(extra.length)}, например ${rowText(extra[0])}`);
    if (missing.length) parts.push(`не хватает: ${rows(missing.length)}, например ${rowText(missing[0])}`);
    return { message: `${parts.join('; ')}.`.replace(/^./, (ch) => ch.toUpperCase()), panel };
  }
  if (orderMatters && expected.rows.some((row, i) => key(row) !== key(actual.rows[i]))) {
    return { message: 'Строки те же, но порядок другой — проверьте ORDER BY.', panel };
  }
  return null;
}

function compareTables(expected, actual) {
  for (const [name, table] of Object.entries(expected)) {
    const got = actual[name];
    if (!got) return { message: `Таблицы ${name} нет — её удалили или переименовали?` };
    if (got.missing.length) return { message: `В таблице ${name} нет колонки ${got.missing[0]}.` };
    const { missing, extra } = rowDiff(table.rows, got.rows);
    if (!missing.length && !extra.length) continue;
    // только различающиеся строки: в таблице их обычно одна-две из десятков
    const panel = {
      kind: 'state', table: name, same: got.rows.length - extra.length,
      expected: { columns: table.columns, rows: missing },
      actual: { columns: got.columns, rows: extra.map((row) => ({ values: row, mark: 'extra' })) },
    };
    if (table.rows.length !== got.rows.length) {
      return { message: `Таблица ${name}: ожидалось ${rows(table.rows.length)}, получилось ${got.rows.length}.`, panel };
    }
    return {
      message: `Таблица ${name}: строка ${rowText(extra[0])} не такая, как нужно — ожидалась ${rowText(missing[0])}.`,
      panel,
    };
  }
  return null;
}

const columnText = (column) => [
  shortType({ ...column, notNull: true }), column.notNull ? 'NOT NULL' : 'может быть NULL',
  column.default !== null ? `DEFAULT ${column.default}` : 'без DEFAULT',
  column.identity ? `GENERATED ${column.identity.toUpperCase()} AS IDENTITY` : null,
].filter(Boolean).join(', ');

function compareSchema(expected, actual) {
  for (const [name, table] of Object.entries(expected)) {
    const got = actual[name];
    if (!table) return { message: `Эталон не создаёт таблицу ${name} — сообщите об ошибке в задаче.` };
    if (!got) return { message: `Таблицы ${name} нет — её нужно создать (CREATE TABLE ${name}).` };
    for (const column of table.columns) {
      const mine = got.columns.find((c) => c.name === column.name);
      if (!mine) return { message: `В таблице ${name} не хватает колонки ${column.name} (${columnText(column)}).` };
      for (const field of ['type', 'notNull', 'default', 'identity']) {
        if (mine[field] !== column[field]) {
          return { message: `${name}.${column.name}: ожидалось ${columnText(column)} — у вас ${columnText(mine)}.` };
        }
      }
    }
    const extra = got.columns.find((c) => !table.columns.some((column) => column.name === c.name));
    if (extra) return { message: `В таблице ${name} лишняя колонка ${extra.name}.` };
    const text = (con) => con.definition;
    const want = table.constraints.map(text);
    const have = got.constraints.map(text);
    const absent = want.find((definition) => !have.includes(definition));
    if (absent) return { message: `В таблице ${name} не хватает ограничения: ${absent}.` };
    const unneeded = have.find((definition) => !want.includes(definition));
    if (unneeded) return { message: `В таблице ${name} лишнее ограничение: ${unneeded}.` };
  }
  return null;
}

/**
 * Проверить решение: { ok, message, error, panel, log }.
 * error — ошибка PostgreSQL в решении ученика; panel — «ожидалось / получилось»;
 * log — журнал запросов ученика (как в песочнице). reference — кэш эталона по задаче.
 */
export async function checkSolution(db, parsers, base, task, code, reference = new Map()) {
  const cacheKey = JSON.stringify([task.setup, task.solution, task.check]);
  if (!reference.has(cacheKey)) {
    const expected = await outcome(db, parsers, base, task.setup, task.solution, task.check);
    if (expected.error) throw new Error(`эталон падает: ${expected.error.message}`);
    reference.set(cacheKey, expected);
  }
  const expected = reference.get(cacheKey);
  const actual = await outcome(db, parsers, base, task.setup, code, task.check);
  if (actual.error) {
    return { ok: false, error: actual.error, message: 'В решении ошибка — запрос не выполнился.', log: actual.log };
  }
  if (!actual.log.length) return { ok: false, message: 'Здесь пока нет ни одного запроса.', log: [] };
  const failure = task.check.type === 'result'
    ? compareResult(expected.result, actual.result, task.check.order_matters !== false)
    : task.check.type === 'state' ? compareTables(expected.tables, actual.tables)
      : compareSchema(expected.schema, actual.schema);
  return failure ? { ok: false, ...failure, log: actual.log } : { ok: true, log: actual.log };
}

/** Для теста эталонов: эталон проходит, заготовка (или пустое решение) — нет. */
export async function verifySqlTask(db, parsers, base, task) {
  const problems = [];
  const reference = new Map();
  try {
    const good = await checkSolution(db, parsers, base, task, task.solution, reference);
    if (!good.ok) problems.push(`эталон не проходит свою проверку: ${good.message}`);
    // без заготовки — запрос, который ничего не меняет: так видно задачу,
    // где эталон оставляет базу как была (проверка state или schema прошла бы сама)
    const starter = await checkSolution(db, parsers, base, task, task.starter_code || 'SELECT 1;', reference);
    if (starter.ok) {
      problems.push(task.starter_code
        ? 'заготовка уже проходит проверку — задача решается без изменений'
        : 'проверку проходит решение, которое ничего не делает (SELECT 1) — эталон не меняет базу?');
    }
  } catch (error) {
    problems.push(error.message);
  }
  return problems;
}
