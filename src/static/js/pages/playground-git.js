// Тренажёр Git: терминал над проектом магазина (история, ветка promo, «GitHub»),
// граф коммитов и три области. Всё сохраняется в браузере; «Начать заново» — проект по умолчанию.

import { gitShellFromSetup } from '../engines/git/index.js';
import { GitView } from '../engines/git/view.js';
import { VirtualFS } from '../engines/linux/fs.js';
import { Shell } from '../engines/linux/shell.js';
import { linuxWorkspace } from '../linux-workspace.js';
import { drafts } from '../trainer-ui.js';

const STORAGE_KEY = 'playground:git';
const root = document.querySelector('[data-playground="git"]');
const setup = JSON.parse(document.getElementById('git-setup').textContent);
const view = new GitView(root.querySelector('[data-git-view]'));
const GREETING = 'Проект магазина в ~/shop: 3 коммита в main, ветка promo, репозиторий на GitHub. Начните с git status или git log --oneline --graph --all.';

function makeShell(fresh = false) {
  const saved = fresh ? null : drafts.get(STORAGE_KEY);
  if (saved) {
    try {
      const state = JSON.parse(saved);
      const shell = new Shell(VirtualFS.fromJSON(state.fs), { cwd: state.cwd, env: state.env });
      shell.history = state.history ?? [];
      return shell;
    } catch (e) {
      drafts.remove(STORAGE_KEY);      // испорченное сохранение — начинаем с чистого проекта
    }
  }
  return gitShellFromSetup(setup);
}

function save(shell) {
  drafts.set(STORAGE_KEY, JSON.stringify({
    fs: shell.fs, cwd: shell.cwd, env: shell.env, history: shell.history.slice(-100),
  }));
}

let fresh = false;
const workspace = linuxWorkspace(root, {
  makeShell: () => makeShell(fresh),
  treeRoot: setup.cwd,
  onCommand: (shell) => {
    save(shell);
    view.render(shell);
  },
  greeting: GREETING,
});
view.render(workspace.shell);

document.querySelector('[data-action="restart"]')?.addEventListener('click', () => {
  drafts.remove(STORAGE_KEY);
  fresh = true;
  workspace.reset();
  fresh = false;
  view.known = null;
  view.render(workspace.shell);
});
