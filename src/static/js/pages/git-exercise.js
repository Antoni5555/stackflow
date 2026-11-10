// Задача Git (exercise, check.type: state, курс с движком git): терминал с Git над setup
// задачи (история, «GitHub», venv), граф и три области, «Проверить» — правила Git и Linux.

import { firstFailedGitRule } from '../engines/git/checker.js';
import { gitShellFromSetup } from '../engines/git/index.js';
import { GitView } from '../engines/git/view.js';
import { HOME } from '../engines/linux/fs.js';
import { linuxWorkspace } from '../linux-workspace.js';
import { solved } from '../task-ui.js';
import { hideAlert, inlineCode, showAlert } from '../trainer-ui.js';

const root = document.querySelector('[data-exercise]');
const exercise = JSON.parse(document.getElementById('exercise-data').textContent);
const alertEl = root.querySelector('[data-alert]');
const view = new GitView(root.querySelector('[data-git-view]'));
const { setup } = exercise;

const workspace = linuxWorkspace(root, {
  makeShell: () => gitShellFromSetup(setup),
  treeRoot: setup.repo ?? setup.cwd ?? HOME,
  onCommand: (shell) => {
    hideAlert(alertEl);
    view.render(shell);
  },
  greeting: 'Выполните команды из условия. Справка — git --help или git <команда> --help.',
});
view.render(workspace.shell);

root.querySelector('[data-action="check"]').addEventListener('click', () => {
  hideAlert(alertEl);
  const rule = firstFailedGitRule(exercise.check.expect, workspace.shell, setup);
  if (!rule) {
    solved(root, alertEl, 'Репозиторий в нужном состоянии.');
    return;
  }
  showAlert(alertEl, 'error', `<strong>Пока не так.</strong> Подсказка: ${inlineCode(rule.fail)}`);
});

root.querySelector('[data-action="reset"]').addEventListener('click', () => {
  workspace.reset();
  view.known = null;
  view.render(workspace.shell);
  hideAlert(alertEl);
  workspace.terminal.input.focus();
});
