// Проверка эталонов задач на вёрстку (/dev/html-check/, только при DEBUG).
// Каждая задача: эталон (files + solution) — все правила пройдены, заготовка — хотя бы одно нет.

import { firstFailedRule } from '../engines/html/checker.js';
import { HtmlPreview } from '../engines/html/preview.js';
import { escapeHtml } from '../trainer-ui.js';

const exercises = JSON.parse(document.getElementById('exercises-data').textContent);
const preview = new HtmlPreview(document.querySelector('[data-preview]'));
const rows = document.querySelector('[data-rows]');
const summary = document.querySelector('[data-summary]');

async function failedRule(files, rules) {
  await preview.render(files);
  return firstFailedRule(rules, files, preview);
}

let problems = 0;
for (const exercise of exercises) {
  const solutionRule = await failedRule({ ...exercise.files, ...exercise.solution }, exercise.rules);
  const starterRule = await failedRule(exercise.files, exercise.rules);
  const solutionCell = solutionRule
    ? `✗ не проходит: ${escapeHtml(solutionRule.fail)}`
    : '✓';
  const starterCell = starterRule ? '✓ не проходит' : '✗ проходит все правила — задачу нечего решать';
  if (solutionRule || !starterRule) problems += 1;
  rows.insertAdjacentHTML('beforeend', `<tr>
    <td><a href="${exercise.url}">${escapeHtml(exercise.title)}</a></td>
    <td>${solutionCell}</td><td>${starterCell}</td></tr>`);
}
summary.textContent = problems
  ? `Задач: ${exercises.length}, с ошибками: ${problems}.`
  : `Задач: ${exercises.length}, все эталоны в порядке.`;
