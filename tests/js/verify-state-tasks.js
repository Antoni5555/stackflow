// Проверка эталонов задач в терминале для pytest (tests/test_state_tasks.py).
// stdin: JSON [{name, engine, setup, rules, solution}] → stdout: JSON {name: [проблемы]}.
// engine: linux — Linux-симулятор, git — он же с Git, «GitHub», venv и apt.

import { verifyGitTask } from '../../src/static/js/engines/git/checker.js';
import { verifyTask } from '../../src/static/js/engines/linux/checker.js';

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const result = {};
  for (const task of JSON.parse(input)) {
    try {
      result[task.name] = task.engine === 'git' ? verifyGitTask(task) : verifyTask(task);
    } catch (e) {
      result[task.name] = [`симулятор упал: ${e.message}`];
    }
  }
  process.stdout.write(JSON.stringify(result));
});
