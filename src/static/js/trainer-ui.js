// Общие куски интерфейса тренажёров: статус движка, консоль вывода, сообщения, черновики.

const STATUS = {
  loading: '<span class="spinner spinner--sm" aria-hidden="true"></span>Загружаем Python… первый раз ~13 МБ, дальше из кэша',
  ready: '<span class="dot dot--ok" aria-hidden="true"></span>Python готов',
  busy: '<span class="spinner spinner--sm" aria-hidden="true"></span>Выполняется…',
  failed: 'Не удалось загрузить Python — проверьте интернет и обновите страницу',
};

/** Показать состояние движка и (раз)блокировать кнопки, которым нужен движок.
 * texts — свои подписи состояний (у SQL — про PostgreSQL), по умолчанию про Python. */
export function showEngineStatus(badge, buttons, state, texts = STATUS) {
  badge.innerHTML = texts[state];
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
