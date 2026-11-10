// Задача на вёрстку (exercise, check.type: dom): файлы, предпросмотр, проверка правилами.

import { firstFailedRule } from '../engines/html/checker.js';
import { htmlWorkspace } from '../html-workspace.js';
import { solved } from '../task-ui.js';
import { hideAlert, inlineCode, showAlert } from '../trainer-ui.js';

const root = document.querySelector('[data-exercise]');
const exercise = JSON.parse(document.getElementById('exercise-data').textContent);
const alertEl = root.querySelector('[data-alert]');

const workspace = htmlWorkspace(root, {
  initial: exercise.files,
  names: exercise.file_names,
  draftPrefix: `draft:${root.dataset.exercise}:`,
  onChange: () => hideAlert(alertEl),
  onRun: check,
});

async function check() {
  hideAlert(alertEl);
  await workspace.renderNow();
  const rule = firstFailedRule(exercise.check.rules, workspace.files.files, workspace.preview);
  if (!rule) {
    solved(root, alertEl, 'Страница собрана правильно.');
    return;
  }
  if (rule.file && rule.file !== workspace.files.current) workspace.files.open(rule.file);
  showAlert(alertEl, 'error', `<strong>Пока не так.</strong> Подсказка: ${inlineCode(rule.fail)}`);
}

root.querySelector('[data-action="check"]').addEventListener('click', check);
root.querySelector('[data-action="reset"]').addEventListener('click', () => {
  workspace.reset();
  hideAlert(alertEl);
});
