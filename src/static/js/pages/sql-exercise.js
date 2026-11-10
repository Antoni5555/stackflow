// SQL-задача: редактор, «Запустить» — журнал запросов на свежей базе, «Проверить» —
// сравнение с эталоном (engines/sql/checker.js): верно — разбор и «Дальше»,
// нет — что именно не так и таблицы «ожидалось / получилось».

import { CodeEditor } from '../editor.js';
import { SqlEngine } from '../engines/sql/engine.js';
import { SchemaStrip, checkPanel, mentionedTables, runStep } from '../engines/sql/view.js';
import { highlightSql } from '../highlight.js';
import { solved } from '../task-ui.js';
import { drafts, escapeHtml, hideAlert, showAlert, showEngineStatus } from '../trainer-ui.js';

const root = document.querySelector('[data-exercise]');
const exercise = JSON.parse(document.getElementById('exercise-data').textContent);
const alertEl = root.querySelector('[data-alert]');
const log = root.querySelector('[data-run-log]');
const panel = root.querySelector('[data-sql-panel]');
const textarea = root.querySelector('textarea.editor__code');
const runButton = root.querySelector('[data-action="run"]');
const checkButton = root.querySelector('[data-action="check"]');
const schema = new SchemaStrip(root.querySelector('[data-schema]'));
const task = { setup: exercise.setup ?? '', solution: exercise.solution, check: exercise.check };

const engine = new SqlEngine(
  {
    worker: root.dataset.sqlWorker,
    pglite: root.dataset.pglite,
    base: JSON.parse(document.getElementById('sql-dataset').textContent),
  },
  (state) => showEngineStatus(root.querySelector('[data-engine-status]'), [runButton, checkButton], state, 'sql'),
);

const draftKey = `draft:${root.dataset.exercise}`;
const editor = new CodeEditor(textarea.closest('.editor'), {
  onRun: () => run(),
  highlight: highlightSql,
  onChange: (value) => drafts.set(draftKey, value),
});
const draft = drafts.get(draftKey);
if (draft !== null) editor.value = draft;

/** Схема — как её видит ученик после запуска (новые таблицы, отметки «в запросе»). */
async function refreshSchema(results = []) {
  const tables = await engine.schema();
  if (tables.aborted) return [];
  const names = tables.map((table) => table.name);
  schema.render(tables, {
    used: results.flatMap((item) => mentionedTables(item.sql, names)),
    created: results.flatMap((item) => (item.changes ?? [])
      .filter((change) => change.status === 'created').map((change) => change.table)),
  });
  return tables;
}

function showLog(results, tables) {
  log.replaceChildren(...results.map((item, i) => runStep(item, i + 1, tables)));
}

function clear() {
  hideAlert(alertEl);
  panel.hidden = true;
  panel.replaceChildren();
}

async function run() {
  clear();
  const results = await engine.runFresh(editor.value, task.setup);
  if (results.aborted) {
    showAlert(alertEl, 'error', escapeHtml(results.aborted));
    return;
  }
  if (!results.length) showAlert(alertEl, 'error', 'Здесь пока нет ни одного запроса.');
  showLog(results, await refreshSchema(results));
}

async function check() {
  clear();
  const result = await engine.check(task, editor.value);
  if (result.aborted) {
    showAlert(alertEl, 'error', escapeHtml(result.aborted));
    return;
  }
  // журнал — решения ученика: видно, что сделал каждый запрос
  showLog(result.log, await refreshSchema(result.log));
  if (result.ok) {
    solved(root, alertEl, 'Решение совпало с эталоном.');
    return;
  }
  if (result.error) {
    showAlert(alertEl, 'error', '<strong>Пока не так.</strong> Запрос завершился ошибкой — она в журнале ниже.');
    return;
  }
  showAlert(alertEl, 'error', `<strong>Пока не так.</strong> ${escapeHtml(result.message)}`);
  if (result.panel) {
    panel.replaceChildren(...checkPanel(result.panel));
    panel.hidden = false;
  }
}

runButton.addEventListener('click', run);
checkButton.addEventListener('click', check);
root.querySelector('[data-action="reset"]').addEventListener('click', () => {
  editor.value = exercise.starter_code || '';
  drafts.remove(draftKey);
  clear();
  log.replaceChildren();
});

engine.init().then(
  // схема — базы задачи: учебные данные + setup (своя таблица задачи видна сразу)
  () => engine.reset(task.setup).then(() => refreshSchema()),
  () => showAlert(alertEl, 'error', 'PostgreSQL не загрузился. Проверьте интернет и обновите страницу.'),
);
