// Тренажёр Django: файлы проекта (models.py, views.py, urls.py, шаблоны, orm.py) на вкладках,
// «Отправить» — запрос через тестовый клиент Django, «Выполнить orm.py» — строки ORM.
// Каждый запуск собирает проект и базу заново (engines/django/runner.py). Файлы — в localStorage.

import { DjangoEngine } from '../engines/django/engine.js';
import { ModelsStrip, ormCard, responseCard } from '../engines/django/view.js';
import { FileEditor } from '../file-editor.js';
import { escapeHtml, hideAlert, showAlert, showEngineStatus } from '../trainer-ui.js';

const ORM_FILE = 'orm.py';

const root = document.querySelector('[data-playground="django"]');
const project = JSON.parse(document.getElementById('django-project').textContent);
const form = root.querySelector('[data-request-form]');
const log = root.querySelector('[data-run-log]');
const alertEl = root.querySelector('[data-run-alert]');
const buttons = [root.querySelector('[data-action="send"]'), root.querySelector('[data-action="orm"]')];
const models = new ModelsStrip(root.querySelector('[data-schema]'));
const names = Object.keys(project.files);

const engine = new DjangoEngine(
  {
    worker: root.dataset.worker,
    runner: root.dataset.runner,
    pyodide: root.dataset.pyodide,
    django: root.dataset.django,
    djangoRunner: root.dataset.djangoRunner,
  },
  (state) => showEngineStatus(root.querySelector('[data-engine-status]'), buttons, state, 'django'),
);

const editor = new FileEditor(root, {
  initial: project.files,
  names,
  draftPrefix: 'playground:django:',
  // Ctrl+Enter: во вкладке orm.py — выполнить её, в остальных — отправить запрос
  onRun: () => (editor.current === ORM_FILE ? runOrm() : sendRequest()),
});

/** Файлы проекта — без orm.py: это не модуль приложения, а строки для shell. */
function projectFiles() {
  return Object.fromEntries(Object.entries(editor.files).filter(([name]) => name !== ORM_FILE));
}

async function execute(payload) {
  hideAlert(alertEl);
  const result = await engine.run({ files: projectFiles(), setup: project.setup, strictSetup: false, ...payload });
  if (result.aborted) {
    showAlert(alertEl, 'error', escapeHtml(result.aborted));
    return null;
  }
  if (result.error) {
    // ошибка в файлах проекта: models.py, views.py, urls.py — как в терминале runserver
    log.replaceChildren();
    const where = { load: 'Проект не собрался', migrate: 'Таблицы не создались', setup: 'Учебные данные не загрузились' }[result.stage];
    showAlert(alertEl, 'error', `<strong>${where}.</strong><pre class="console console__line--error">${escapeHtml(result.error)}</pre>`);
    return null;
  }
  models.render(result.models);
  if (result.setup_error) {
    showAlert(alertEl, 'error', `${escapeHtml(result.setup_error)}. Учебные данные рассчитаны на модели Category и Product из примера — база пустая.`);
  }
  return result;
}

async function sendRequest(method = form.elements.method.value, path = form.elements.path.value, data = null) {
  form.elements.method.value = method === 'POST' ? 'POST' : 'GET';
  form.elements.path.value = path;
  const result = await execute({ requests: [{ method, path, data }] });
  if (result) log.replaceChildren(responseCard(result.requests[0], sendRequest));
}

async function runOrm() {
  const code = editor.files[ORM_FILE];
  if (!code.trim()) {
    showAlert(alertEl, 'error', 'orm.py пуст — напишите строку ORM, например <code>Product.objects.count()</code>.');
    return;
  }
  const result = await execute({ orm: code });
  if (result) log.replaceChildren(ormCard(result.orm));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendRequest();
});
root.querySelector('[data-action="orm"]').addEventListener('click', () => runOrm());

document.querySelector('[data-action="restart"]').addEventListener('click', () => {
  editor.reset();
  form.elements.path.value = '/products/';
  form.elements.method.value = 'GET';
  log.replaceChildren();
  hideAlert(alertEl);
});

engine.init().catch(() => {
  showAlert(alertEl, 'error', 'Python и Django не загрузились. Проверьте интернет и обновите страницу.');
});
