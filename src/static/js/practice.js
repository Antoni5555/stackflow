// Плашка «Задачник» в тренажёре: выбранная тема → её задачи (HTML с сервера), «← / →» листают.
// Выбранная тема запоминается в localStorage — после перезагрузки откроется она же.

import { drafts } from './trainer-ui.js';

const STORAGE_KEY = 'practice:topic';

const root = document.querySelector('[data-practice]');
const select = root.querySelector('[data-practice-topic]');
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

select.addEventListener('change', () => {
  drafts.set(STORAGE_KEY, select.value);
  load(select.value);
});

const saved = drafts.get(STORAGE_KEY);
if (saved && [...select.options].some((option) => option.value === saved)) select.value = saved;
load(select.value);
