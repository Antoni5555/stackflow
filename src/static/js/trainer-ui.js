// Общие куски интерфейса тренажёров: статус движка, консоль вывода, сообщения, черновики.

const SPINNER = '<span class="spinner spinner--sm" aria-hidden="true"></span>';

// Подписи состояния движка. starting — когда файлы движка уже в кэше браузера:
// при каждом открытии страницы движок запускается заново, но ничего не скачивается
const STATUS = {
  python: {
    loading: `${SPINNER}Загружаем Python… первый раз ~13 МБ, дальше из кэша`,
    starting: `${SPINNER}Запускаем Python…`,
    ready: '<span class="dot dot--ok" aria-hidden="true"></span>Python готов',
    failed: 'Не удалось загрузить Python — проверьте интернет и обновите страницу',
  },
  django: {
    loading: `${SPINNER}Загружаем Python и Django… первый раз ~15 МБ, дальше из кэша`,
    starting: `${SPINNER}Запускаем Python и Django…`,
    ready: '<span class="dot dot--ok" aria-hidden="true"></span>Django 5.2 · база SQLite',
    failed: 'Не удалось загрузить Django — проверьте интернет и обновите страницу',
  },
  sql: {
    loading: `${SPINNER}Загружаем PostgreSQL… первый раз ~3 МБ, дальше из кэша`,
    starting: `${SPINNER}Запускаем PostgreSQL…`,
    ready: '<span class="dot dot--ok" aria-hidden="true"></span>PostgreSQL 16 · база «магазин»',
    failed: 'Не удалось загрузить PostgreSQL — проверьте интернет и обновите страницу',
  },
};
const BUSY = `${SPINNER}Выполняется…`;

/** Показать состояние движка (python | django | sql) и (раз)блокировать кнопки, которым он нужен.
 * После первой удачной загрузки браузер это запоминает: дальше — «Запускаем…». */
export function showEngineStatus(badge, buttons, state, engine = 'python') {
  const loadedKey = `engine-loaded:${engine}`;
  const texts = STATUS[engine];
  if (state === 'ready') drafts.set(loadedKey, '1');
  const loading = drafts.get(loadedKey) ? texts.starting : texts.loading;
  badge.innerHTML = state === 'busy' ? BUSY : state === 'loading' ? loading : texts[state];
  for (const button of buttons) button.disabled = state !== 'ready';
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/** Текст подсказки из контента: `код` → <code>код</code>, остальное экранируется. */
export function inlineCode(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function line(text, modifier = '') {
  const div = document.createElement('div');
  div.className = `console__line${modifier ? ` console__line--${modifier}` : ''}`;
  div.textContent = text;
  return div;
}

/** Консоль: заголовок, вывод программы и ошибка (traceback). */
export function showConsole(consoleEl, { output = '', error = '' }, title = '>>> main.py') {
  consoleEl.replaceChildren(line(title, 'muted'));
  if (output) consoleEl.append(line(output.replace(/\n$/, '')));
  if (error) consoleEl.append(line(error, 'error'));
  if (!output && !error) consoleEl.append(line('(программа ничего не вывела)', 'muted'));
  consoleEl.hidden = false;
}

/** Сообщение под редактором: success | error. html — уже безопасный HTML. */
export function showAlert(alertEl, kind, html) {
  const icon = kind === 'success' ? '✓' : '!';
  alertEl.className = `alert alert--${kind}`;
  alertEl.innerHTML = `<span class="alert__icon" aria-hidden="true">${icon}</span><div>${html}</div>`;
  alertEl.hidden = false;
}

export function hideAlert(alertEl) {
  alertEl.hidden = true;
}

// Черновики в localStorage. Он может быть недоступен (приватный режим) — тогда просто не сохраняем.
export const drafts = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // ничего: черновик — удобство, а не обязательная функция
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // см. выше
    }
  },
};
