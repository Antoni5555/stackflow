// Задача в терминале (exercise, check.type: state): команды над файлами из setup,
// «Проверить» — правила по итоговому состоянию, «Сбросить» — снова setup.

import { firstFailedRule, shellFromSetup } from '../engines/linux/checker.js';
import { HOME } from '../engines/linux/fs.js';
import { linuxWorkspace } from '../linux-workspace.js';
import { solved } from '../task-ui.js';
import { hideAlert, inlineCode, showAlert } from '../trainer-ui.js';

const root = document.querySelector('[data-exercise]');
const exercise = JSON.parse(document.getElementById('exercise-data').textContent);
const alertEl = root.querySelector('[data-alert]');

const workspace = linuxWorkspace(root, {
  makeShell: () => shellFromSetup(exercise.setup),
  treeRoot: exercise.setup.cwd ?? HOME,
  onCommand: () => hideAlert(alertEl),
  greeting: 'Выполните команды из условия. Справка по команде — команда --help.',
});

root.querySelector('[data-action="check"]').addEventListener('click', () => {
  hideAlert(alertEl);
  const rule = firstFailedRule(exercise.check.expect, workspace.shell);
  if (!rule) {
    solved(root, alertEl, 'Состояние сервера такое, как нужно.');
    return;
  }
  showAlert(alertEl, 'error', `<strong>Пока не так.</strong> Подсказка: ${inlineCode(rule.fail)}`);
});

root.querySelector('[data-action="reset"]').addEventListener('click', () => {
  workspace.reset();
  hideAlert(alertEl);
  workspace.terminal.input.focus();
});
