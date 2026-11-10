// Задача fix: исправить файлы и проверить правилами (регулярные выражения).
// Правило: must_match — шаблон обязан найтись, must_not_match — не должен; file — какой файл.
// Флаг m: ^ и $ — границы строк, как в Python с re.M.

import { CodeEditor } from '../editor.js';
import { solved } from '../task-ui.js';
import { drafts, hideAlert, inlineCode, showAlert } from '../trainer-ui.js';

const root = document.querySelector('[data-exercise]');
const exercise = JSON.parse(document.getElementById('exercise-data').textContent);
const alertEl = root.querySelector('[data-alert]');
const tabs = [...root.querySelectorAll('[data-file]')];
const names = exercise.file_names;   // порядок файлов из YAML
const draftKey = (name) => `draft:${root.dataset.exercise}:${name}`;

// Текущий текст каждого файла: черновик из браузера или исходный
const files = Object.fromEntries(
  names.map((name) => [name, drafts.get(draftKey(name)) ?? exercise.files[name]]),
);
let current = names[0];

const editor = new CodeEditor(root.querySelector('.editor'), {
  onRun: check,
  onChange: (value) => {
    files[current] = value;
    drafts.set(draftKey(current), value);
    hideAlert(alertEl);
  },
});
editor.value = files[current];

function open(name) {
  current = name;
  editor.value = files[name];
  for (const tab of tabs) {
    const active = tab.dataset.file === name;
    tab.classList.toggle('tab--active', active);
    tab.setAttribute('aria-selected', active);
  }
}

/** Первое непройденное правило или null. */
function failedRule() {
  return exercise.check.rules.find((rule) => {
    const text = files[rule.file || names[0]] ?? '';
    const pattern = rule.must_match ?? rule.must_not_match;
    const found = new RegExp(pattern, 'm').test(text);
    return 'must_match' in rule ? !found : found;
  }) ?? null;
}

function check() {
  hideAlert(alertEl);
  const rule = failedRule();
  if (!rule) {
    solved(root, alertEl, 'Ошибка исправлена.');
    return;
  }
  // если ошибка в другом файле — переключаемся на него, чтобы было видно, где искать
  if (rule.file && rule.file !== current && tabs.length) open(rule.file);
  showAlert(alertEl, 'error', `<strong>Пока не так.</strong> Подсказка: ${inlineCode(rule.fail)}`);
}

for (const tab of tabs) tab.addEventListener('click', () => open(tab.dataset.file));
root.querySelector('[data-action="check"]').addEventListener('click', check);
root.querySelector('[data-action="reset"]').addEventListener('click', () => {
  for (const name of names) {
    files[name] = exercise.files[name];
    drafts.remove(draftKey(name));
  }
  editor.value = files[current];
  hideAlert(alertEl);
});
