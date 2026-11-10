// Движок git: подключает к Linux-симулятору git, «GitHub», окружение Python и apt
// (только на страницах Git — на страницах Linux эти команды отвечают, что появятся позже).

import { COMMANDS } from '../linux/commands.js';
import { VirtualFS } from '../linux/fs.js';
import { Shell } from '../linux/shell.js';
import { apt } from './apt.js';
import { git } from './commands.js';
import { deactivate, pip, python, buildVenv } from './python.js';
import { buildRemote } from './remote.js';
import { buildRepo } from './repo.js';

Object.assign(COMMANDS, {
  git, pip, pip3: pip, python, python3: python, deactivate, apt, 'apt-get': apt,
});

/** Оболочка по setup задачи Git: файлы, ~/.gitconfig, история, «GitHub», venv. */
export function gitShellFromSetup(setup = {}) {
  const fs = VirtualFS.fromSetup(setup);
  const built = buildRepo(fs, setup);
  if (built && setup.remote) buildRemote(fs, built.root, setup.remote);
  const cwd = setup.cwd ?? built?.root;
  if (setup.venv) buildVenv(fs, cwd ?? '/home/shop', setup.venv);
  return new Shell(fs, cwd ? { cwd } : {});
}

export { buildRepo };
