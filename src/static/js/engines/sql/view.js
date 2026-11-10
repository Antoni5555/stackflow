// Журнал выполнения SQL и полоса «Схема базы» (trainers/components/_playground_sql.html).
// Карточка на каждый запрос: DDL — новая или изменённая таблица, DML — строки
// с подсветкой (добавлено / изменено / удалено), SELECT — результат, а с JOIN —
// исходные таблицы с цветом совпавших пар.

import { mask } from './split.js';

const SHOWN_ROWS = 200;       // строк результата на экране; остальное — «ещё N»
const CHANGED_ROWS = 50;      // изменённых строк в карточке DML
const MATCH_COLORS = 6;       // m1…m6 в trainers.css

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 1 строка, 2 строки, 5 строк */
export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${n} ${word}`;
}

const rowsText = (n) => plural(n, 'строка', 'строки', 'строк');

/** Таблица данных: rows — [{ values, className, old? }]; NULL — серым, как в psql. */
function dataTable(columns, rows) {
  const table = el('table', 'data-table data-table--compact');
  const head = el('tr');
  for (const column of columns) head.append(el('th', '', column));
  table.append(el('thead'));
  table.tHead.append(head);
  const body = el('tbody');
  for (const { values, className, old = {} } of rows) {
    const tr = el('tr', className || '');
    values.forEach((value, i) => {
      const td = value === null ? el('td', 'muted', 'NULL') : el('td', '', value);
      if (columns[i] in old) {
        // изменённая ячейка: было → стало
        td.className = 'cell--changed';
        td.textContent = `${old[columns[i]] ?? 'NULL'} → ${value ?? 'NULL'}`;
      }
      tr.append(td);
    });
    body.append(tr);
  }
  table.append(body);
  return table;
}

function dbTable(title, columns, rows, { flag, alias, result } = {}) {
  const box = el('div', `db-table${result ? ' db-table--result' : ''}`);
  const name = el('div', 'db-table__name', title);
  if (alias) name.append(' ', el('span', 'db-table__alias', alias));
  if (flag) name.append(' ', el('span', 'schema-table__flag', flag));
  box.append(name, dataTable(columns, rows));
  return box;
}

// --- Схема ---

/** Колонки ограничения: PRIMARY KEY (a, b) → ['a', 'b'] */
const constraintColumns = (definition) => (/\(([^)]*)\)/.exec(definition)?.[1] ?? '')
  .split(',').map((name) => name.trim().replace(/^"|"$/g, ''));

/** Короткое имя типа: timestamp with time zone → timestamptz; ? — может быть NULL. */
export function shortType(column) {
  const type = column.type
    .replace('timestamp with time zone', 'timestamptz')
    .replace('timestamp without time zone', 'timestamp')
    .replace('character varying', 'varchar')
    .replace(/^integer$/, 'int');
  return column.notNull ? type : `${type}?`;
}

function keyColumns(table) {
  const pk = new Set();
  const fk = new Map();
  for (const con of table.constraints) {
    if (con.type === 'primary key') constraintColumns(con.definition).forEach((name) => pk.add(name));
    if (con.type === 'foreign key') constraintColumns(con.definition).forEach((name) => fk.set(name, con.references));
  }
  return { pk, fk };
}

function columnItem(column, { pk, fk }) {
  const li = el('li');
  const mark = pk.has(column.name) ? 'PK' : fk.has(column.name) ? 'FK' : '';
  li.append(el('span', fk.has(column.name) && !pk.has(column.name) ? 'fk' : 'pk', mark));
  li.append(column.name, ' ', el('span', 'type', shortType(column)));
  if (fk.has(column.name)) li.title = `ссылается на ${fk.get(column.name)}`;
  return li;
}

/** Карточка структуры таблицы (новая или изменённая — в журнале). */
function schemaCard(table, { isNew, newColumns = [] }) {
  const card = el('div', `schema-table${isNew ? ' schema-table--new' : ''}`);
  const name = el('div', 'schema-table__name', table.name);
  if (isNew) name.append(' ', el('span', 'schema-table__flag', 'новая'));
  card.append(name);
  const keys = keyColumns(table);
  const ul = el('ul');
  for (const column of table.columns) {
    const li = columnItem(column, keys);
    if (newColumns.includes(column.name)) li.className = 'row--added';
    ul.append(li);
  }
  card.append(ul);
  const wrap = el('div', 'schema schema--inline');
  wrap.append(card);
  return wrap;
}

/** Таблицы, которые упомянуты в тексте (для отметки «в запросе»). */
export function mentionedTables(sql, names) {
  const text = mask(sql).toLowerCase();
  return names.filter((name) => new RegExp(`(^|[^a-z0-9_."])${name}([^a-z0-9_"]|$)`).test(text));
}

export class SchemaStrip {
  constructor(root) {
    this.root = root;
    this.summary = root.querySelector('[data-schema-summary]');
    this.list = root.querySelector('[data-schema-tables]');
    this.tables = [];
  }

  /** used — таблицы последнего запуска, created — созданные им. */
  render(tables, { used = [], created = [] } = {}) {
    this.tables = tables;
    const open = new Set([...this.list.querySelectorAll('details[open]')].map((item) => item.dataset.table));
    this.summary.textContent = tables.length
      ? `${plural(tables.length, 'таблица', 'таблицы', 'таблиц')} · нажмите, чтобы раскрыть`
      : 'таблиц нет — создайте первую: CREATE TABLE';
    const items = tables.map((table) => {
      const item = el('details', 'explorer__item');
      item.dataset.table = table.name;
      if (open.has(table.name)) item.open = true;
      const summary = el('summary');
      summary.append(el('span', 'explorer__name', table.name));
      if (created.includes(table.name)) summary.append(el('span', 'badge badge--done', 'новая'));
      else if (used.includes(table.name)) summary.append(el('span', 'badge badge--current', 'в запросе'));
      summary.append(el('span', 'explorer__meta', rowsText(table.rowCount)));
      const keys = keyColumns(table);
      const cols = el('ul', 'explorer__cols');
      for (const column of table.columns) cols.append(columnItem(column, keys));
      item.append(summary, cols);
      return item;
    });
    const hint = el('p', 'muted small', 'Нажмите на таблицу — увидите колонки. PK — первичный ключ, FK — ссылка на другую таблицу, ? — может быть NULL.');
    this.list.replaceChildren(...items, hint);
  }

  get names() {
    return this.tables.map((table) => table.name);
  }
}

// --- Журнал ---

/** Короткая подпись запроса: первая строка без лишних пробелов. */
function caption(sql) {
  const first = sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  return first.length > 70 ? `${first.slice(0, 68)}…` : first;
}

const TX_TEXT = {
  begin: 'транзакция начата', start: 'транзакция начата', commit: 'зафиксировано', end: 'зафиксировано',
  rollback: 'отменено', abort: 'отменено', savepoint: 'точка сохранения', release: 'точка снята',
};

function badgeFor(item) {
  if (item.error) return ['ошибка', 'badge--error'];
  const first = /[a-z]+/i.exec(item.sql)?.[0].toLowerCase();
  const created = item.changes?.filter((change) => change.status === 'created') ?? [];
  if (item.kind === 'ddl') {
    if (created.length) return ['таблица создана', 'badge--done'];
    if (item.changes?.some((change) => change.status === 'dropped')) return ['таблица удалена', ''];
    if (item.changes?.some((change) => change.status === 'altered')) return ['таблица изменена', 'badge--done'];
    return ['выполнено', ''];
  }
  if (item.kind === 'dml') {
    const n = item.affected ?? 0;
    if (first === 'insert') return [`+${rowsText(n)}`, 'badge--done'];
    if (first === 'delete') return [`удалено: ${rowsText(n)}`, ''];
    if (first === 'update') return [`изменено: ${rowsText(n)}`, ''];
    return [rowsText(n), ''];
  }
  if (item.kind === 'tx') return [TX_TEXT[first] ?? 'выполнено', ''];
  if (item.kind === 'set') return ['настройка сессии', ''];
  if (item.columns) return [rowsText(item.rowCount), ''];
  return ['выполнено', ''];
}

function errorBox(error) {
  const box = el('div', 'alert alert--error');
  box.append(el('span', 'alert__icon', '!'));
  const text = el('div');
  const where = error.column ? `строка ${error.line}, позиция ${error.column}` : `строка ${error.line}`;
  text.append(el('strong', '', `ERROR: ${error.message}`), el('br'), el('span', 'muted small', where));
  if (error.detail) text.append(el('br'), `DETAIL: ${error.detail}`);
  if (error.hint) text.append(el('br'), `HINT: ${error.hint}`);
  if (/current transaction is aborted/.test(error.message)) {
    text.append(el('br'), el('span', 'small', 'В транзакции уже была ошибка: выполните ROLLBACK, чтобы продолжить.'));
  }
  box.append(text);
  return box;
}

const MARK_CLASS = { added: 'row--added', changed: 'row--changed', removed: 'row--removed' };

/** Таблица с изменёнными строками: только отмеченные, остальные — числом. */
function changedRows(change) {
  const marked = change.rows.filter((row) => row.mark);
  const rest = change.rows.length - marked.length;
  const counts = ['added', 'changed', 'removed']
    .map((mark) => [mark, marked.filter((row) => row.mark === mark).length])
    .filter(([, n]) => n);
  const flag = counts.map(([mark, n]) => ({ added: '+', changed: '~', removed: '−' }[mark] + n)).join(' ');
  const rows = marked.slice(0, CHANGED_ROWS).map((row) => ({
    values: row.values, className: MARK_CLASS[row.mark], old: row.old,
  }));
  const box = dbTable(change.table, change.columns, rows, { flag });
  const hidden = marked.length - rows.length;
  if (rest || hidden) {
    const parts = [];
    if (hidden) parts.push(`ещё ${rowsText(hidden)} с изменениями`);
    if (rest) parts.push(`${rowsText(rest)} без изменений не показаны`);
    box.append(el('p', 'muted small', parts.join(' · ')));
  }
  return box;
}

function changesBody(item, schema) {
  const parts = [];
  for (const change of item.changes ?? []) {
    const table = schema.find((t) => t.name === change.table);
    if (change.status === 'dropped') {
      parts.push(el('p', 'small', `Таблица ${change.table} удалена вместе с данными.`));
      continue;
    }
    if ((change.status === 'created' || change.status === 'altered') && table) {
      parts.push(schemaCard(table, { isNew: change.status === 'created', newColumns: change.newColumns }));
    }
    if (change.rows.some((row) => row.mark) && !(change.status === 'created' && !change.rows.length)) {
      parts.push(changedRows(change));
    }
  }
  return parts;
}

/**
 * Цвета пар JOIN: «ключевая» сторона — та, где совпавших строк меньше (категории
 * для товаров, пользователи для заказов); каждая её строка — свой цвет, строки
 * другой стороны берут цвет пары. Попали в результат без пары — без цвета,
 * не попали совсем — серые.
 */
export function joinColors(view) {
  const matched = view.pairs.filter(([l, r]) => l && r);
  const distinct = (i) => new Set(matched.map((pair) => pair[i])).size;
  const keySide = distinct(1) <= distinct(0) ? 1 : 0;
  const color = new Map();
  for (const pair of matched) {
    if (!color.has(pair[keySide])) color.set(pair[keySide], (color.size % MATCH_COLORS) + 1);
  }
  const other = new Map();
  for (const pair of matched) if (!other.has(pair[1 - keySide])) other.set(pair[1 - keySide], color.get(pair[keySide]));
  const sides = keySide === 1 ? [other, color] : [color, other];
  // в результате, но без пары (LEFT/RIGHT/FULL JOIN) — без цвета; не в результате — серая
  const present = [new Set(view.pairs.map((pair) => pair[0])), new Set(view.pairs.map((pair) => pair[1]))];
  const classOf = (side, id) => {
    if (sides[side].has(id)) return `m${sides[side].get(id)}`;
    return present[side].has(id) ? '' : 'row--unmatched';
  };
  return {
    left: (id) => classOf(0, id),
    right: (id) => classOf(1, id),
    result: ([l, r]) => (l && r ? `m${color.get([l, r][keySide])}` : ''),
  };
}

function joinViz(view) {
  const colors = joinColors(view);
  const side = (info, classOf) => {
    const rows = info.rows.map((values, i) => ({ values, className: classOf(info.ids[i]) }));
    const box = dbTable(info.table, info.columns, rows, { alias: info.alias });
    if (info.total > info.rows.length) box.append(el('p', 'muted small', `первые ${info.rows.length} из ${info.total}`));
    return box;
  };
  const viz = el('div', 'join-viz');
  const op = el('div', 'join-viz__op');
  op.append(el('span', 'join-viz__kind', view.type), el('code', '', view.on));
  viz.append(side(view.left, colors.left), op, side(view.right, colors.right));
  return { viz, colors };
}

const JOIN_NOTE = {
  'INNER JOIN': 'Одинаковый цвет — строки совпали по условию ON. Серые строки в результат не попали: у них нет пары или их отсеял WHERE.',
  'LEFT JOIN': 'Одинаковый цвет — строки совпали по условию ON. Строка слева без пары (без цвета) тоже попадает в результат — с NULL в колонках правой таблицы. Серые в результат не попали.',
  'RIGHT JOIN': 'Одинаковый цвет — строки совпали по условию ON. Строка справа без пары (без цвета) тоже попадает в результат — с NULL в колонках левой таблицы. Серые в результат не попали.',
  'FULL JOIN': 'Одинаковый цвет — строки совпали по условию ON. Строки без пары с обеих сторон (без цвета) тоже попадают в результат — с NULL на месте второй таблицы. Серые в результат не попали.',
};

function resultBody(item) {
  const parts = [];
  let colors = null;
  if (item.join) {
    const join = joinViz(item.join);
    parts.push(join.viz);
    colors = item.join.resultPairs ? join.colors : null;
  }
  const shown = item.rows.slice(0, SHOWN_ROWS).map((values, i) => ({
    values, className: colors ? colors.result(item.join.resultPairs[i] ?? [null, null]) : '',
  }));
  const box = dbTable('результат', item.columns, shown, { result: true });
  if (!item.rows.length) box.append(el('p', 'muted small', 'Запрос не вернул ни одной строки.'));
  const more = item.rowCount - shown.length;
  if (more > 0) box.append(el('p', 'muted small', `ещё ${rowsText(more)} не показаны`));
  parts.push(box);
  if (item.join) parts.push(el('p', 'muted small', JOIN_NOTE[item.join.type] ?? JOIN_NOTE['INNER JOIN']));
  return parts;
}

/** Карточка одного запроса. schema — схема после запуска (типы колонок новых таблиц). */
export function runStep(item, number, schema = []) {
  const li = el('li', 'run-step');
  const head = el('div', 'run-step__head');
  const [badgeText, badgeClass] = badgeFor(item);
  head.append(
    el('span', 'run-step__num', String(number)),
    el('code', '', caption(item.sql)),
    el('span', `badge ${badgeClass}`.trim(), badgeText),
  );
  if (item.ms !== undefined) head.append(el('span', 'run-step__time', `${item.ms} мс`));
  li.append(head);
  const body = item.error ? [errorBox(item.error)]
    : [...changesBody(item, schema), ...(item.columns ? resultBody(item) : [])];
  if (body.length) {
    const wrap = el('div', 'run-step__body');
    wrap.append(...body);
    li.append(wrap);
  }
  return li;
}
