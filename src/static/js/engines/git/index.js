// Движок git: подключает команду git к Linux-симулятору (только на страницах Git —
// на страницах Linux git отвечает, что появится в тренажёре Git).

import { COMMANDS } from '../linux/commands.js';
import { VirtualFS } from '../linux/fs.js';
import { Shell } from '../linux/shell.js';
import { git } from './commands.js';
import { buildRepo } from './repo.js';

COMMANDS.git = git;

/** Оболочка по setup задачи Git: файлы, ~/.gitconfig, история коммитов, «GitHub». */
export function gitShellFromSetup(setup = {}) {
  const fs = VirtualFS.fromSetup(setup);
  const built = buildRepo(fs, setup);
  const cwd = setup.cwd ?? built?.root;
  return new Shell(fs, cwd ? { cwd } : {});
}

export { buildRepo };
