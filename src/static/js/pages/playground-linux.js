// Тренажёр Linux: свободная работа в терминале сервера магазина.
// Файлы, папка и история сохраняются в браузере; «Начать заново» — сервер по умолчанию.

import { VirtualFS } from '../engines/linux/fs.js';
import { Shell } from '../engines/linux/shell.js';
import { linuxWorkspace } from '../linux-workspace.js';
import { drafts } from '../trainer-ui.js';

const STORAGE_KEY = 'playground:linux';
const root = document.querySelector('[data-playground="linux"]');
const setup = JSON.parse(document.getElementById('linux-setup').textContent);
const GREETING = 'Сервер магазина: проект в /srv/shop. Список команд — help, справка — команда --help.';

/** Оболочка из сохранённого состояния (если есть) или по умолчанию. */
function makeShell(fresh = false) {
  const saved = fresh ? null : drafts.get(STORAGE_KEY);
  if (saved) {
    try {
      const state = JSON.parse(saved);
      const shell = new Shell(VirtualFS.fromJSON(state.fs), { cwd: state.cwd, env: state.env });
      shell.history = state.history ?? [];
      return shell;
    } catch (e) {
      drafts.remove(STORAGE_KEY);      // испорченное сохранение — начинаем с чистого сервера
    }
  }
  return new Shell(VirtualFS.fromSetup(setup), { cwd: setup.cwd });
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
  onCommand: save,
  greeting: GREETING,
});

document.querySelector('[data-action="restart"]')?.addEventListener('click', () => {
  drafts.remove(STORAGE_KEY);
  fresh = true;
  workspace.reset();
  fresh = false;
});
