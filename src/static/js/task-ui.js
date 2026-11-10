// Общее для страниц задач без движка (quiz, fix): верное решение и «Разбор».

import { markSolved } from './progress.js';
import { showAlert } from './trainer-ui.js';

const nextLink = document.querySelector('.task__nav a[aria-label^="Дальше"]');

/** Верно: отметить задачу решённой, открыть разбор, показать «Дальше →». */
export function solved(root, alertEl, text) {
  markSolved(root.dataset.exercise);
  root.querySelector('[data-explanation]').hidden = false;
  const next = nextLink ? ` <a href="${nextLink.href}">Дальше →</a>` : '';
  showAlert(alertEl, 'success', `<strong>Верно!</strong> ${text}${next}`);
}
