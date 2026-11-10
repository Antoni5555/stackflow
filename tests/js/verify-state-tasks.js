// Проверка эталонов задач в терминале для pytest (tests/test_state_tasks.py).
// stdin: JSON [{name, setup, rules, solution}] → stdout: JSON {name: [проблемы]}.

import { verifyTask } from '../../src/static/js/engines/linux/checker.js';

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const result = {};
  for (const task of JSON.parse(input)) {
    try {
      result[task.name] = verifyTask(task);
    } catch (e) {
      result[task.name] = [`симулятор упал: ${e.message}`];
    }
  }
  process.stdout.write(JSON.stringify(result));
});
