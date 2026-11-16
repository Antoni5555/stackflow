// Django-задача: файлы приложения shop на вкладках, проект и тесты выполняет Django в Pyodide
// (engines/django/runner.py). Обычная задача: «Запустить» — запрос к проекту, «Проверить» —
// тесты задачи. Задача «напишите тесты» (check.mutants): «Запустить тесты» — tests.py ученика
// на коде задачи, «Проверить» — ещё и на «сломанных» версиях кода.

import { DjangoEngine } from '../engines/django/engine.js';
import { ModelsStrip, STAGE_TITLES, responseCard } from '../engines/django/view.js';
import { FileEditor } from '../file-editor.js';
import { solved } from '../task-ui.js';
import { escapeHtml, hideAlert, inlineCode, showAlert, showConsole, showEngineStatus } from '../trainer-ui.js';

const TESTS_FILE = 'tests.py';

const root = document.querySelector('[data-exercise]');
const exercise = JSON.parse(document.getElementById('exercise-data').textContent);
const alertEl = root.querySelector('[data-alert]');
const consoleEl = root.querySelector('[data-console]');
const log = root.querySelector('[data-run-log]');
const form = root.querySelector('[data-request-form]');
const runButton = root.querySelector('[data-action="run"]');
const checkButton = root.querySelector('[data-action="check"]');
const schema = root.querySelector('[data-schema]');
const models = schema ? new ModelsStrip(schema) : null;
const writesTests = 'mutants' in exercise.check;
const settings = exercise.settings ?? null;

const engine = new DjangoEngine(
  {
    worker: root.dataset.worker,
    runner: root.dataset.runner,
    pyodide: root.dataset.pyodide,
    django: root.dataset.django,
    djangoRunner: root.dataset.djangoRunner,
  },
  (state) => showEngineStatus(root.querySelector('[data-engine-status]'), [runButton, checkButton], state, 'django'),
);

// файлы, которых нет в заготовке (forms.py), ученик пишет с нуля
const initial = Object.fromEntries(exercise.file_names.map((name) => [name, exercise.files[name] ?? '']));
const editor = new FileEditor(root, {
  initial,
  names: exercise.file_names,
  draftPrefix: `draft:${root.dataset.exercise}:`,
  onChange: () => hideAlert(alertEl),
  onRun: () => run(),
});
if (writesTests && exercise.file_names.includes(TESTS_FILE)) editor.open(TESTS_FILE);

function clear() {
  hideAlert(alertEl);
  consoleEl.hidden = true;
}

/** Ответ движка — ошибка, которую надо показать (тайм-аут, проект не собрался)? */
function failedToRun(result) {
  if (result.aborted) {
    showAlert(alertEl, 'error', escapeHtml(result.aborted));
    return true;
  }
  if (result.stage) {
    log.replaceChildren();
    showAlert(alertEl, 'error', `<strong>${STAGE_TITLES[result.stage]}.</strong><pre class="console console__line--error">${escapeHtml(result.error)}</pre>`);
    return true;
  }
  return false;
}

function showTestOutput(output) {
  showConsole(consoleEl, { output }, '$ python manage.py test shop');
}

async function sendRequest(method = form.elements.method.value, path = form.elements.path.value, data = null) {
  clear();
  form.elements.method.value = method === 'POST' ? 'POST' : 'GET';
  form.elements.path.value = path;
  const result = await engine.run({
    files: editor.files, setup: exercise.setup ?? '', settings, requests: [{ method, path, data }],
  });
  if (failedToRun(result)) return;
  models.render(result.models);
  log.replaceChildren(responseCard(result.requests[0], sendRequest));
}

async function runTests() {
  clear();
  const result = await engine.checkTests({ files: editor.files, mutants: [], settings });
  if (failedToRun(result)) return;
  showTestOutput(result.output);
  if (result.failed.length) showAlert(alertEl, 'error', escapeHtml(result.failed[0]));
}

function run() {
  return writesTests ? runTests() : sendRequest();
}

async function check() {
  clear();
  const result = writesTests
    ? await engine.checkTests({ files: editor.files, mutants: exercise.check.mutants, settings })
    : await engine.check({ files: editor.files, setup: exercise.setup ?? '', tests: exercise.check.tests, settings });
  if (failedToRun(result)) return;
  if (writesTests) showTestOutput(result.output);
  if (!result.failed.length) {
    solved(root, alertEl, writesTests ? 'Тесты ловят все сломанные версии кода.' : 'Все проверки пройдены.');
    return;
  }
  showAlert(alertEl, 'error', `<strong>Пока не так.</strong> Подсказка: ${inlineCode(result.failed[0])}`);
  // упал код ученика, а не проверка: traceback по его файлам
  if (result.error) showConsole(consoleEl, { error: result.error }, 'Ошибка при проверке');
}

if (form) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendRequest();
  });
} else {
  runButton.addEventListener('click', () => run());
}
checkButton.addEventListener('click', check);
root.querySelector('[data-action="reset"]').addEventListener('click', () => {
  editor.reset();
  clear();
  log.replaceChildren();
});

engine.init().catch(() => {
  showAlert(alertEl, 'error', 'Python и Django не загрузились. Проверьте интернет и обновите страницу.');
});
