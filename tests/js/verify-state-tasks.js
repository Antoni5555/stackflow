// Проверка эталонов задач в терминале для pytest (tests/test_state_tasks.py).
// stdin: JSON [{name, engine, setup, rules, solution}] → stdout: JSON {name: [проблемы]}.
// engine: linux — Linux-симулятор, git — он же с Git, «GitHub», venv и apt.
// Задачи с Docker — после остальных: учебный Docker подключается, как в браузере, только
// когда нужен (он добавляет shop в группу docker — остальные задачи этого не видят).

import { verifyGitTask } from '../../src/static/js/engines/git/checker.js';
import { verifyTask } from '../../src/static/js/engines/linux/checker.js';
import { lineNeedsDocker, loadDocker, taskNeedsDocker } from '../../src/static/js/engines/linux/docker-loader.js';

const needsDocker = (task) => taskNeedsDocker(task.setup, task.rules)
  || task.solution.split('\n').some((line) => lineNeedsDocker(line));

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  const result = {};
  const tasks = JSON.parse(input);
  const ordered = [...tasks.filter((task) => !needsDocker(task)), ...tasks.filter(needsDocker)];
  for (const task of ordered) {
    if (needsDocker(task)) await loadDocker();
    try {
      result[task.name] = task.engine === 'git' ? verifyGitTask(task) : verifyTask(task);
    } catch (e) {
      result[task.name] = [`симулятор упал: ${e.message}`];
    }
  }
  process.stdout.write(JSON.stringify(result));
});
