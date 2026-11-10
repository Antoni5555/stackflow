// Тренажёр SQL: PostgreSQL (PGlite) на учебной базе магазина.
// Код — в localStorage, база — в IndexedDB браузера: переживают перезагрузку.
// «Запустить всё» — все запросы по порядку; «Выполнить выделенное» — только выделенный
// текст; «Пошагово» — по одному запросу за нажатие, текущий выделяется в редакторе.

import { CodeEditor } from '../editor.js';
import { SqlEngine } from '../engines/sql/engine.js';
import { splitStatements } from '../engines/sql/split.js';
import { SchemaStrip, mentionedTables, runStep } from '../engines/sql/view.js';
import { highlightSql } from '../highlight.js';
import { drafts, showAlert, hideAlert, showEngineStatus } from '../trainer-ui.js';

const STATUS = {
  loading: '<span class="spinner spinner--sm" aria-hidden="true"></span>Загружаем PostgreSQL… первый раз ~3 МБ, дальше из кэша',
  ready: '<span class="dot dot--ok" aria-hidden="true"></span>PostgreSQL 16 · база «магазин»',
  busy: '<span class="spinner spinner--sm" aria-hidden="true"></span>Выполняется…',
  failed: 'Не удалось загрузить PostgreSQL — проверьте интернет и обновите страницу',
};

const DRAFT_KEY = 'playground:sql';
const DATA_DIR = 'idb://stackflow-playground-sql';

const root = document.querySelector('[data-playground="sql"]');
const textarea = root.querySelector('textarea.editor__code');
const log = root.querySelector('[data-run-log]');
const empty = root.querySelector('[data-run-empty]');
const alertEl = root.querySelector('[data-run-alert]');
const buttons = {
  run: root.querySelector('[data-action="run"]'),
  selected: root.querySelector('[data-action="run-selected"]'),
  step: root.querySelector('[data-action="step"]'),
};
const schema = new SchemaStrip(root.querySelector('[data-schema]'));
const DEFAULT_CODE = textarea.value;

const engine = new SqlEngine(
  {
    worker: root.dataset.worker,
    pglite: root.dataset.pglite,
    base: JSON.parse(document.getElementById('sql-dataset').textContent),
    dataDir: DATA_DIR,
  },
  (state) => showEngineStatus(root.querySelector('[data-engine-status]'), Object.values(buttons), state, STATUS),
);

let stepping = null;      // { statements, index, text } — пошаговый режим

const editor = new CodeEditor(textarea.closest('.editor'), {
  onRun: () => runAll(),
  highlight: highlightSql,
  onChange: (value) => {
    drafts.set(DRAFT_KEY, value);
    if (stepping && stepping.text !== value) stopStepping();
  },
});
const saved = drafts.get(DRAFT_KEY);
if (saved !== null) editor.value = saved;

async function refreshSchema(results = []) {
  const tables = await engine.schema();
  if (tables.aborted) return;
  const names = tables.map((table) => table.name);
  const used = results.flatMap((item) => mentionedTables(item.sql, names));
  const created = results.flatMap((item) => (item.changes ?? [])
    .filter((change) => change.status === 'created').map((change) => change.table));
  schema.render(tables, { used, created });
  return tables;
}

function clearLog() {
  log.replaceChildren();
  hideAlert(alertEl);
  empty.hidden = false;
}

/** Номера строк — от начала редактора, а не выделенного куска. */
function shiftLines(results, text, start) {
  const before = text.slice(0, start);
  const lines = before.split('\n').length - 1;
  const column = start - before.lastIndexOf('\n') - 1;
  for (const item of results) {
    if (item.error?.line === 1 && item.error.column) item.error.column += column;
    item.line += lines;
    if (item.error) item.error.line += lines;
  }
}

/** Выполнить текст и добавить карточки в журнал (начиная с номера first). */
async function execute(sql, { offset = 0, first = 1, append = false } = {}) {
  if (!append) clearLog();
  const results = await engine.run(sql);
  if (results.aborted) {
    showAlert(alertEl, 'error', results.aborted);
    refreshSchema();
    return null;
  }
  if (offset) shiftLines(results, editor.value, offset);
  const tables = await refreshSchema(results);
  empty.hidden = true;
  results.forEach((item, i) => log.append(runStep(item, first + i, tables ?? [])));
  if (!results.length) showAlert(alertEl, 'error', 'Здесь нет ни одного запроса — только пробелы или комментарии.');
  return results;
}

function runAll() {
  stopStepping();
  return execute(editor.value);
}

function runSelected() {
  stopStepping();
  const { selectionStart: start, selectionEnd: end } = textarea;
  if (start === end) {
    clearLog();
    showAlert(alertEl, 'error', 'Выделите в редакторе запрос (или несколько) — выполнится только выделенное.');
    return;
  }
  execute(editor.value.slice(start, end), { offset: start });
}

function stopStepping() {
  stepping = null;
  buttons.step.textContent = 'Пошагово';
}

async function step() {
  if (!stepping) {
    const statements = splitStatements(editor.value);
    if (!statements.length) return execute(editor.value);
    stepping = { statements, index: 0, text: editor.value };
    clearLog();
  }
  const { statements, index } = stepping;
  const statement = statements[index];
  // текущий запрос — выделен в редакторе
  textarea.focus();
  textarea.setSelectionRange(statement.start, statement.start + statement.sql.length);
  const results = await execute(statement.sql, { offset: statement.start, first: index + 1, append: true });
  if (!results || results.some((item) => item.error) || index + 1 >= statements.length) {
    stopStepping();
    return;
  }
  stepping.index += 1;
  buttons.step.textContent = `Дальше: запрос ${index + 2} из ${statements.length}`;
}

buttons.run.addEventListener('click', runAll);
buttons.selected.addEventListener('click', runSelected);
buttons.step.addEventListener('click', step);

document.querySelector('[data-action="restart"]').addEventListener('click', async () => {
  stopStepping();
  editor.value = DEFAULT_CODE;
  drafts.remove(DRAFT_KEY);
  clearLog();
  await engine.reset();
  refreshSchema();
});

engine.init().then(
  () => refreshSchema(),
  () => showAlert(alertEl, 'error', 'PostgreSQL не загрузился. Проверьте интернет и обновите страницу.'),
);
