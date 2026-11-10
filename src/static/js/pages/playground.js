// Песочница Python: свободный код, «Запустить», вывод. Код хранится в localStorage.

import { CodeEditor } from '../editor.js';
import { PythonEngine } from '../engines/python/engine.js';
import { highlightPython } from '../highlight.js';
import { drafts, showConsole, showEngineStatus } from '../trainer-ui.js';

const root = document.querySelector('[data-playground]');
const consoleEl = root.querySelector('[data-console]');
const runButton = root.querySelector('[data-action="run"]');
const badge = root.querySelector('[data-engine-status]');
const textarea = root.querySelector('textarea.editor__code');

const DRAFT_KEY = 'playground:python';
const DEFAULT_CODE = textarea.value;

const engine = new PythonEngine(
  { worker: root.dataset.worker, runner: root.dataset.runner, pyodide: root.dataset.pyodide },
  (state) => showEngineStatus(badge, [runButton], state),
);

async function run() {
  const result = await engine.run(editor.value);
  showConsole(consoleEl, result.aborted ? { error: result.aborted } : result);
}

const editor = new CodeEditor(textarea.closest('.editor'), {
  onRun: run,
  highlight: highlightPython,
  onChange: (value) => drafts.set(DRAFT_KEY, value),
});
const saved = drafts.get(DRAFT_KEY);
if (saved !== null) editor.value = saved;

runButton.addEventListener('click', run);
root.querySelector('[data-action="clear"]').addEventListener('click', () => {
  consoleEl.replaceChildren();
});
document.querySelector('[data-action="restart"]').addEventListener('click', () => {
  editor.value = DEFAULT_CODE;
  drafts.remove(DRAFT_KEY);
  consoleEl.replaceChildren();
  engine.reset();
});

engine.init().catch(() => {
  showConsole(consoleEl, { error: 'Python не загрузился. Проверьте интернет и обновите страницу.' });
});
