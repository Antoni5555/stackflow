// Терминал + дерево файлов (trainers/components/_linux_workspace.html).
// Общий для тренажёра Linux и задач с проверкой состояния.

import { Terminal } from './engines/linux/terminal.js';
import { FileTree } from './engines/linux/file-tree.js';
import { Shell } from './engines/linux/shell.js';

/**
 * @param {Element} root — где [data-terminal] и [data-file-tree]
 * @param {object} options — makeShell() → новая Shell (и при «Сбросить»), treeRoot — какая папка
 *   в дереве, onCommand(shell) — после каждой команды (сохранить состояние, снять ошибку)
 */
export function linuxWorkspace(root, { makeShell, treeRoot, onCommand = () => {}, greeting = '' }) {
  let shell = makeShell();
  const tree = new FileTree(root.querySelector('[data-file-tree]'), treeRoot);
  let before = shell.fs.snapshot('/');

  const terminal = new Terminal(root.querySelector('[data-terminal]'), shell, {
    onCommand: () => {
      tree.render(shell.fs, before);
      before = shell.fs.snapshot('/');
      onCommand(shell);
    },
  });
  if (greeting) terminal.print(greeting, 'muted');
  tree.render(shell.fs);

  return {
    get shell() {
      return shell;
    },
    terminal,
    /** Начать заново: новая ФС, пустой экран. */
    reset() {
      shell = makeShell();
      terminal.reset(shell);
      if (greeting) terminal.print(greeting, 'muted');
      before = shell.fs.snapshot('/');
      tree.render(shell.fs);
    },
  };
}

