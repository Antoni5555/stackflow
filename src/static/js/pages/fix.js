// Задача fix: исправить файлы и проверить правилами (регулярные выражения).
// Правило: must_match — шаблон обязан найтись, must_not_match — не должен; file — какой файл.

import { FileEditor } from '../file-editor.js';
import { failedSourceRule } from '../source-rules.js';
import { solved } from '../task-ui.js';
import { hideAlert, inlineCode, showAlert } from '../trainer-ui.js';

const root = document.querySelector('[data-exercise]');
const exercise = JSON.parse(document.getElementById('exercise-data').textContent);
const alertEl = root.querySelector('[data-alert]');

const files = new FileEditor(root, {
  initial: exercise.files,
  names: exercise.file_names,   // порядок файлов из YAML
  draftPrefix: `draft:${root.dataset.exercise}:`,
  onChange: () => hideAlert(alertEl),
  onRun: check,
});

function check() {
  hideAlert(alertEl);
  const rule = exercise.check.rules.find(
    (item) => failedSourceRule(item, files.files, files.names[0]),
  );
  if (!rule) {
    solved(root, alertEl, 'Ошибка исправлена.');
    return;
  }
  // ошибка в другом файле — переключаемся на него, чтобы было видно, где искать
  if (rule.file && rule.file !== files.current) files.open(rule.file);
  showAlert(alertEl, 'error', `<strong>Пока не так.</strong> Подсказка: ${inlineCode(rule.fail)}`);
}

root.querySelector('[data-action="check"]').addEventListener('click', check);
root.querySelector('[data-action="reset"]').addEventListener('click', () => {
  files.reset();
  hideAlert(alertEl);
});
