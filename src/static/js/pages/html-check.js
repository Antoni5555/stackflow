// Проверка эталонов задач на вёрстку (/dev/html-check/, только при DEBUG).
// Каждая задача: эталон (files + solution) — все правила пройдены, заготовка — хотя бы одно нет.
// То же в CI — tests/test_html_tasks.py.

import { verifyHtmlTask } from '../engines/html/checker.js';
import { HtmlPreview } from '../engines/html/preview.js';
import { escapeHtml } from '../trainer-ui.js';

const exercises = JSON.parse(document.getElementById('exercises-data').textContent);
const preview = new HtmlPreview(document.querySelector('[data-preview]'));
const rows = document.querySelector('[data-rows]');
const summary = document.querySelector('[data-summary]');

let problems = 0;
for (const exercise of exercises) {
  const found = await verifyHtmlTask(exercise, preview);
  if (found.length) problems += 1;
  const cell = found.length ? `✗ ${escapeHtml(found.join('; '))}` : '✓';
  rows.insertAdjacentHTML('beforeend', `<tr>
    <td><a href="${exercise.url}">${escapeHtml(exercise.title)}</a></td><td>${cell}</td></tr>`);
}
summary.textContent = problems
  ? `Задач: ${exercises.length}, с ошибками: ${problems}.`
  : `Задач: ${exercises.length}, все эталоны в порядке.`;
