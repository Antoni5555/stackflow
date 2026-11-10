// Страница задачи: редактор, «Запустить», «Проверить» (exercise — тесты, predict — ответ).

import { CodeEditor } from '../editor.js';
import { PythonEngine } from '../engines/python/engine.js';
import { markSolved } from '../progress.js';
import {
  drafts, escapeHtml, hideAlert, inlineCode, showAlert, showConsole, showEngineStatus,
} from '../trainer-ui.js';

const root = document.querySelector('[data-exercise]');
const exercise = JSON.parse(document.getElementById('exercise-data').textContent);
const alertEl = root.querySelector('[data-alert]');
const consoleEl = root.querySelector('[data-console]');
const explanation = root.querySelector('[data-explanation]');
const runButton = root.querySelector('[data-action="run"]');
const checkButton = root.querySelector('[data-action="check"]');
const resetButton = root.querySelector('[data-action="reset"]');
const nextLink = document.querySelector('.task__nav a[aria-label^="Дальше"]');

const engineButtons = [runButton, checkButton].filter(Boolean);
const badge = root.querySelector('[data-engine-status]');
const engine = new PythonEngine(
  {
    worker: root.dataset.worker,
    runner: root.dataset.runner,
    pyodide: root.dataset.pyodide,
    hashSeed: '0',   // одинаковый результат у всех учеников (порядок set, хеши строк)
  },
  (state) => showEngineStatus(badge, engineButtons, state),
);

// Черновик решения хранится в браузере для каждой задачи отдельно
const draftKey = `draft:${root.dataset.exercise}`;
const textarea = root.querySelector('textarea.editor__code');
const editor = new CodeEditor(textarea.closest('.editor'), {
  onRun: () => (exercise.type === 'predict' ? check() : run()),
  onChange: (value) => drafts.set(draftKey, value),
});
const draft = drafts.get(draftKey);
if (draft !== null) editor.value = draft;

/** Показать разбор; вернуть HTML ссылки «Дальше →» для сообщения. */
function revealExplanation() {
  const next = nextLink ? ` <a href="${nextLink.href}">Дальше →</a>` : '';
  explanation.hidden = false;
  return next;
}

async function run() {
  hideAlert(alertEl);
  const result = await engine.run(editor.value, exercise.inputs || '');
  if (result.aborted) {
    showConsole(consoleEl, { error: result.aborted });
    return;
  }
  showConsole(consoleEl, result);
}

async function checkExercise() {
  const result = await engine.check(editor.value, exercise);
  if (result.aborted) {
    showAlert(alertEl, 'error', `<strong>${result.aborted}</strong>`);
    return;
  }
  showConsole(consoleEl, result);
  if (result.failed.length === 0) {
    markSolved(root.dataset.exercise);
    const next = revealExplanation();
    showAlert(alertEl, 'success', `<strong>Верно!</strong> Решение прошло все проверки.${next}`);
  } else {
    // Показываем только первую непройденную проверку — это подсказка, а не список ответов
    showAlert(alertEl, 'error',
      `<strong>Пока не так.</strong> Подсказка: ${inlineCode(result.failed[0])}`);
  }
}

async function checkPredict() {
  const result = await engine.check(editor.value, exercise);
  if (result.aborted) {
    showAlert(alertEl, 'error', `<strong>${result.aborted}</strong>`);
    return;
  }
  // После попытки показываем настоящий вывод и разбор: сравнить — и есть обучение
  showConsole(consoleEl, { output: result.actual }, 'Программа вывела:');
  const next = revealExplanation();
  if (result.correct) {
    markSolved(root.dataset.exercise);
    showAlert(alertEl, 'success', `<strong>Верно!</strong> Вывод совпал.${next}`);
  } else {
    showAlert(alertEl, 'error',
      '<strong>Не совпало.</strong> Сравните свой ответ с настоящим выводом ниже и прочитайте разбор.');
  }
}

function check() {
  hideAlert(alertEl);
  return exercise.type === 'predict' ? checkPredict() : checkExercise();
}

runButton?.addEventListener('click', run);
checkButton?.addEventListener('click', check);
resetButton?.addEventListener('click', () => {
  editor.value = exercise.starter_code || '';
  drafts.remove(draftKey);
  hideAlert(alertEl);
  consoleEl.hidden = true;
});

engine.init().catch(() => {
  showAlert(alertEl, 'error', escapeHtml('Python не загрузился. Проверьте интернет и обновите страницу.'));
});
