// Плашка «Задачник» в тренажёре: выбранная тема → её задачи (HTML с сервера), «← / →» листают.
// Выбранная тема запоминается в localStorage — после перезагрузки откроется она же.

import { drafts } from './trainer-ui.js';

const STORAGE_KEY = 'practice:topic';

const root = document.querySelector('[data-practice]');
const toggle = root.querySelector('[data-picker-toggle]');
const list = root.querySelector('[data-picker-list]');
const current = root.querySelector('[data-picker-current]');
const options = [...root.querySelectorAll('[data-practice-topic]')];
const box = root.querySelector('[data-practice-tasks]');

async function load(url) {
  box.innerHTML = '<p class="muted small">Загружаем задачи…</p>';
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(response.status);
    box.innerHTML = await response.text();
  } catch (e) {
    box.innerHTML = '<p class="muted small">Не удалось загрузить задачи. Обновите страницу.</p>';
  }
}

// Листаем задачи: прячем текущую, показываем соседнюю
box.addEventListener('click', (event) => {
  const button = event.target.closest('[data-practice-step]');
  if (!button) return;
  const tasks = [...box.querySelectorAll('[data-practice-task]')];
  const current = tasks.findIndex((task) => !task.hidden);
  const next = tasks[current + Number(button.dataset.practiceStep)];
  if (!next) return;
  tasks[current].hidden = true;
  next.hidden = false;
});

// Список тем: открыть / закрыть; закрывается выбором, Esc и кликом мимо
function setOpen(open) {
  list.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  if (open) (options.find((option) => option.getAttribute('aria-current') === 'true') || options[0]).focus();
}

function choose(option) {
  for (const other of options) other.removeAttribute('aria-current');
  option.setAttribute('aria-current', 'true');
  current.textContent = option.textContent;
  load(option.dataset.practiceTopic);
}

toggle.addEventListener('click', () => setOpen(list.hidden));

list.addEventListener('click', (event) => {
  const option = event.target.closest('[data-practice-topic]');
  if (!option) return;
  drafts.set(STORAGE_KEY, option.dataset.practiceTopic);
  choose(option);
  setOpen(false);
  toggle.focus();
});

root.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !list.hidden) {
    setOpen(false);
    toggle.focus();
  }
  // Стрелки — по темам списка, как в обычном выпадающем списке
  if (!list.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    const index = options.indexOf(document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    options[Math.min(Math.max(index + step, 0), options.length - 1)]?.focus();
  }
});

document.addEventListener('click', (event) => {
  if (!list.hidden && !event.target.closest('[data-practice-picker]')) setOpen(false);
});

const saved = drafts.get(STORAGE_KEY);
choose(options.find((option) => option.dataset.practiceTopic === saved) || options[0]);
