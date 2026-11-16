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
const STDIN_MAX_ROWS = 8;
// введённое значение в выводе runner.py помечает этими символами (INPUT_START/INPUT_END)
const INPUT_MARK = /\x02([^\x03]*)\x03/g;

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

/** Вывод с введёнными значениями: они — серым, как набранное с клавиатуры. */
function showInputs(output) {
  const target = consoleEl.querySelector('.console__line:not([class*="--"])');
  if (!target || !output.includes('\x02')) return;
  const parts = [];
  let last = 0;
  for (const match of output.replace(/\n$/, '').matchAll(INPUT_MARK)) {
    parts.push(match.input.slice(last, match.index));
    const typed = document.createElement('span');
    typed.className = 'console__input';
    typed.textContent = match[1];
    parts.push(typed);
    last = match.index + match[0].length;
  }
  parts.push(output.replace(/\n$/, '').slice(last));
  target.replaceChildren(...parts);
}

async function run() {
  // пустые строки в конце — не значения: лишний Enter ничего не ломает
  const stdin = stdinField.hidden ? null : stdinEditor.value.replace(/\n+$/, '');
  const result = await engine.run(editor.value, '', stdin);
  showConsole(consoleEl, result.aborted ? { error: result.aborted } : result);
  if (!result.aborted) showInputs(result.output);
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
// поле «Ввод» — тот же редактор: номера строк показывают, какая строка какому input()
const stdinEditor = new CodeEditor(stdinField.querySelector('.editor'), {
  onRun: run,
  onChange: (value) => {
    drafts.set(STDIN_KEY, value);
    fitStdin();
  },
});

/** Высота поля — по числу строк (от 1 до STDIN_MAX_ROWS), дальше прокрутка. */
function fitStdin() {
  const rows = stdinEditor.value.split('\n').length;
  stdinText.rows = Math.min(Math.max(rows, 1), STDIN_MAX_ROWS);
}

stdinEditor.value = drafts.get(STDIN_KEY) ?? '';
fitStdin();
toggleStdin(editor.value);

runButton.addEventListener('click', run);
root.querySelector('[data-action="clear"]').addEventListener('click', () => {
  consoleEl.replaceChildren();
});
document.querySelector('[data-action="restart"]').addEventListener('click', () => {
  editor.value = DEFAULT_CODE;
  drafts.remove(DRAFT_KEY);
  stdinEditor.value = '';
  fitStdin();
  drafts.remove(STDIN_KEY);
  toggleStdin(DEFAULT_CODE);
  consoleEl.replaceChildren();
  engine.reset();
});

engine.init().catch(() => {
  showConsole(consoleEl, { error: 'Python не загрузился. Проверьте интернет и обновите страницу.' });
});
