// Песочница Python: свободный код, «Запустить», вывод. Код хранится в localStorage.
// Поле «Ввод» видно, только когда в коде есть input(): строки из него input() берёт по порядку.

import { CodeEditor } from '../editor.js';
import { PythonEngine } from '../engines/python/engine.js';
import { highlightPython } from '../highlight.js';
import { drafts, showConsole, showEngineStatus } from '../trainer-ui.js';

const root = document.querySelector('[data-playground]');
const consoleEl = root.querySelector('[data-console]');
const runButton = root.querySelector('[data-action="run"]');
const badge = root.querySelector('[data-engine-status]');
const textarea = root.querySelector('textarea.editor__code');

const stdinField = root.querySelector('[data-stdin]');
const stdinText = stdinField.querySelector('textarea');

const DRAFT_KEY = 'playground:python';
const STDIN_KEY = 'playground:python:stdin';
const DEFAULT_CODE = textarea.value;

const engine = new PythonEngine(
  { worker: root.dataset.worker, runner: root.dataset.runner, pyodide: root.dataset.pyodide },
  (state) => showEngineStatus(badge, [runButton], state),
);

/** В коде есть вызов input() (не в комментарии)? */
function usesInput(code) {
  return code.split('\n').some((line) => /\binput\s*\(/.test(line.split('#')[0]));
}

function toggleStdin(code) {
  stdinField.hidden = !usesInput(code);
}

async function run() {
  const stdin = stdinField.hidden ? null : stdinText.value;
  const result = await engine.run(editor.value, '', stdin);
  showConsole(consoleEl, result.aborted ? { error: result.aborted } : result);
}

const editor = new CodeEditor(textarea.closest('.editor'), {
  onRun: run,
  highlight: highlightPython,
  onChange: (value) => {
    drafts.set(DRAFT_KEY, value);
    toggleStdin(value);
  },
});
const saved = drafts.get(DRAFT_KEY);
if (saved !== null) editor.value = saved;
stdinText.value = drafts.get(STDIN_KEY) ?? '';
toggleStdin(editor.value);
stdinText.addEventListener('input', () => drafts.set(STDIN_KEY, stdinText.value));

runButton.addEventListener('click', run);
root.querySelector('[data-action="clear"]').addEventListener('click', () => {
  consoleEl.replaceChildren();
});
document.querySelector('[data-action="restart"]').addEventListener('click', () => {
  editor.value = DEFAULT_CODE;
  drafts.remove(DRAFT_KEY);
  stdinText.value = '';
  drafts.remove(STDIN_KEY);
  toggleStdin(DEFAULT_CODE);
  consoleEl.replaceChildren();
  engine.reset();
});

engine.init().catch(() => {
  showConsole(consoleEl, { error: 'Python не загрузился. Проверьте интернет и обновите страницу.' });
});
