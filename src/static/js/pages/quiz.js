// Задача quiz: single / multiple — выбор вариантов, order — порядок кнопками ↑ ↓.
// Проверка в браузере; при ошибке говорим, что именно не так, но верный ответ не показываем.

import { solved } from '../task-ui.js';
import { hideAlert, showAlert } from '../trainer-ui.js';

const root = document.querySelector('[data-exercise]');
const exercise = JSON.parse(document.getElementById('exercise-data').textContent);
const alertEl = root.querySelector('[data-alert]');
const quiz = root.querySelector('[data-quiz]');
const list = quiz.querySelector('[data-quiz-list]');

const fail = (text) => showAlert(alertEl, 'error', `<strong>Пока не так.</strong> ${text}`);

// --- order: перемешать при открытии, двигать кнопками ---

function currentOrder() {
  return [...list.children].map((item) => Number(item.dataset.index));
}

function updateButtons() {
  const items = [...list.children];
  items.forEach((item, i) => {
    item.querySelector('[data-move="-1"]').disabled = i === 0;
    item.querySelector('[data-move="1"]').disabled = i === items.length - 1;
  });
}

function shuffle() {
  const items = [...list.children];
  // Fisher–Yates; если случайно вышел верный порядок — перемешиваем ещё раз
  do {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  } while (items.length > 1 && items.every((item, i) => Number(item.dataset.index) === exercise.answer[i]));
  list.replaceChildren(...items);
  updateButtons();
}

if (list) {
  shuffle();
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-move]');
    if (!button) return;
    const item = button.closest('li');
    if (button.dataset.move === '-1') item.previousElementSibling?.before(item);
    else item.nextElementSibling?.after(item);
    updateButtons();
    // кнопка упёрлась в край и выключилась — фокус на соседнюю, чтобы клавиатура не потерялась
    if (button.disabled) item.querySelector('[data-move]:not(:disabled)')?.focus();
    hideAlert(alertEl);
  });
}

// --- проверка ---

function checkOrder() {
  const order = currentOrder();
  const wrong = order.findIndex((index, i) => index !== exercise.answer[i]);
  if (wrong === -1) return solved(root, alertEl, 'Порядок правильный.');
  return fail(`${wrong + 1}-й шаг стоит не на своём месте.`);
}

function checkChoice() {
  const picked = [...quiz.querySelectorAll('input:checked')].map((input) => Number(input.value));
  if (!picked.length) {
    return fail(exercise.kind === 'single' ? 'Выберите вариант ответа.' : 'Отметьте хотя бы один вариант.');
  }
  const extra = picked.filter((index) => !exercise.answer.includes(index));
  const missing = exercise.answer.filter((index) => !picked.includes(index));
  if (!extra.length && !missing.length) return solved(root, alertEl, 'Ответ правильный.');
  if (exercise.kind === 'single') return fail('Этот вариант не подходит — перечитайте условие.');
  if (extra.length) return fail(extra.length > 1 ? 'Отмечены лишние варианты.' : 'Отмечен лишний вариант.');
  return fail('Отмечены не все верные варианты.');
}

quiz.querySelector('[data-action="check"]').addEventListener('click', () => {
  hideAlert(alertEl);
  if (exercise.kind === 'order') checkOrder();
  else checkChoice();
});
quiz.addEventListener('change', () => hideAlert(alertEl));
