// Python «напишите тесты» (check.type: pytest): ученик пишет файл тестов, pytest в Pyodide
// запускает их на коде задачи («Запустить тесты») и на сломанных версиях («Проверить»).
// Вкладки с кодом задачи — только чтение: проверка всё равно берёт код из задачи.

import { PythonEngine } from '../engines/python/engine.js';
import { FileEditor } from '../file-editor.js';
import { solved } from '../task-ui.js';
import { escapeHtml, hideAlert, inlineCode, showAlert, showConsole, showEngineStatus } from '../trainer-ui.js';

const root = document.querySelector('[data-exercise]');
const exercise = JSON.parse(document.getElementById('exercise-data').textContent);
const alertEl = root.querySelector('[data-alert]');
const consoleEl = root.querySelector('[data-console]');
const runButton = root.querySelector('[data-action="run"]');
const checkButton = root.querySelector('[data-action="check"]');
const testFile = exercise.test_file;

const engine = new PythonEngine(
  { worker: root.dataset.worker, runner: root.dataset.runner, pyodide: root.dataset.pyodide, hashSeed: '0' },
  (state) => showEngineStatus(root.querySelector('[data-engine-status]'), [runButton, checkButton], state),
);

const initial = Object.fromEntries(exercise.file_names.map((name) => [name, exercise.files[name] ?? '']));
const editor = new FileEditor(root, {
  initial,
  names: exercise.file_names,
  draftPrefix: `draft:${root.dataset.exercise}:`,
  readOnly: exercise.file_names.filter((name) => name !== testFile),
  onChange: () => hideAlert(alertEl),
  onRun: () => runTests(),
});
editor.open(testFile);

/** Код задачи — из задачи, а не из вкладок; файл тестов — ученика. */
const studentFiles = () => ({ ...exercise.files, [testFile]: editor.files[testFile] });
const title = `$ pytest -v ${testFile}`;

async function runTests() {
  hideAlert(alertEl);
  const result = await engine.checkTests(studentFiles(), testFile, []);
  if (result.aborted) {
    showConsole(consoleEl, { error: result.aborted }, title);
    return;
  }
  showConsole(consoleEl, { output: result.output }, title);
  if (result.failed.length) showAlert(alertEl, 'error', escapeHtml(result.failed[0]));
}

async function check() {
  hideAlert(alertEl);
  const result = await engine.checkTests(studentFiles(), testFile, exercise.check.mutants);
  if (result.aborted) {
    showConsole(consoleEl, { error: result.aborted }, title);
    return;
  }
  showConsole(consoleEl, { output: result.output }, title);
  if (!result.failed.length) {
    solved(root, alertEl, 'Тесты ловят все сломанные версии кода.');
    return;
  }
  showAlert(alertEl, 'error', `<strong>Пока не так.</strong> Подсказка: ${inlineCode(result.failed[0])}`);
}

runButton.addEventListener('click', runTests);
checkButton.addEventListener('click', check);
root.querySelector('[data-action="reset"]').addEventListener('click', () => {
  editor.reset();
  hideAlert(alertEl);
  consoleEl.hidden = true;
});

engine.init().catch(() => {
  showAlert(alertEl, 'error', 'Python не загрузился. Проверьте интернет и обновите страницу.');
});
