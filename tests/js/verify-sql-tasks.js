// Проверка эталонов SQL-задач для pytest (tests/test_sql_tasks.py).
// stdin: JSON {base, tasks: [{name, setup, solution, starter_code, check}]} → stdout: {name: [проблемы]}.
// Эталон должен проходить свою проверку, заготовка — нет. PGlite — тот же, что в браузере.

import { PGlite } from '@electric-sql/pglite';

import { verifySqlTask } from '../../src/static/js/engines/sql/checker.js';
import { textParsers } from '../../src/static/js/engines/sql/session.js';

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  const { base, tasks } = JSON.parse(input);
  const db = new PGlite();
  const parsers = await textParsers(db);
  const result = {};
  for (const task of tasks) result[task.name] = await verifySqlTask(db, parsers, base, task);
  await db.close();
  process.stdout.write(JSON.stringify(result));
});
