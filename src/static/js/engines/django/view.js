// Тренажёр Django на странице: ответ на запрос (статус, заголовки, страница в iframe),
// SQL, которые ушли в базу (с подсветкой N+1), вывод ORM и полоса «Модели».
// Данные — из engines/django/runner.py (через DjangoEngine).

import { highlightSql } from '../../highlight.js';

const N_PLUS_ONE = 3;      // столько одинаковых по форме запросов подряд — уже N+1

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${n} ${word}`;
}

const queriesText = (n) => plural(n, 'запрос', 'запроса', 'запросов');

// --- SQL ---

/** Форма запроса: значения (числа и строки) → ?. Запросы одной формы отличаются только ими. */
export function sqlShape(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, '?').replace(/\b\d+(?:\.\d+)?\b/g, '?');
}

/**
 * Группы N+1: подряд идущие запросы одной формы (от N_PLUS_ONE штук).
 * [{ start, count, table }] — table из FROM, для подсказки.
 */
export function findNPlusOne(queries) {
  const groups = [];
  let start = 0;
  for (let i = 1; i <= queries.length; i += 1) {
    const same = i < queries.length && sqlShape(queries[i].sql) === sqlShape(queries[start].sql);
    if (same) continue;
    const count = i - start;
    if (count >= N_PLUS_ONE) {
      const table = /\bFROM\s+"?([\w]+)"?/i.exec(queries[start].sql)?.[1] ?? '';
      groups.push({ start, count, table });
    }
    start = i;
  }
  return groups;
}

/** SQL Django в одну строку → по строкам на FROM, JOIN, WHERE…: так его можно прочитать. */
export function formatSql(sql) {
  return sql
    .replace(/\s+(FROM|WHERE|INNER JOIN|LEFT OUTER JOIN|GROUP BY|HAVING|ORDER BY|LIMIT|VALUES|SET|RETURNING)\b/g, '\n$1')
    .replace(/\s+(AND|OR)\b(?![^(]*\))/g, '\n  $1');
}

/** Список SQL: номер, текст с подсветкой, время; группы N+1 — с отметкой и подсказкой. */
export function queryList(queries) {
  const wrap = el('div', 'sql-queries');
  if (!queries.length) {
    wrap.append(el('p', 'muted small', 'В базу не ушло ни одного запроса.'));
    return wrap;
  }
  const groups = findNPlusOne(queries);
  const inGroup = new Map();
  groups.forEach((group) => {
    for (let i = group.start; i < group.start + group.count; i += 1) inGroup.set(i, group);
  });
  for (const group of groups) {
    const note = el('div', 'callout callout--warning small');
    note.append(el('strong', '', `N+1: ${queriesText(group.count)} одной формы подряд`),
      ` — к таблице ${group.table} отдельно для каждой строки. Загрузите связь заранее: `,
      el('code', '', 'select_related()'), ' (ForeignKey) или ', el('code', '', 'prefetch_related()'),
      ' (обратная связь, ManyToMany).');
    wrap.append(note);
  }
  const item = (i) => {
    const li = el('li', `sql-queries__item${inGroup.has(i) ? ' sql-queries__item--repeat' : ''}`);
    const code = el('pre', 'sql-output');
    code.innerHTML = highlightSql(formatSql(queries[i].sql));
    li.append(el('span', 'sql-queries__num', String(i + 1)), code, el('span', 'run-step__time', `${queries[i].ms} мс`));
    return li;
  };
  const list = el('ol', 'sql-queries__list');
  for (let i = 0; i < queries.length; i += 1) {
    list.append(item(i));
    const group = inGroup.get(i);
    if (group?.start !== i) continue;
    // повторы группы N+1 — свёрнуты: видно первый, остальные отличаются только значениями
    const rest = el('details', 'sql-queries__more');
    rest.append(el('summary', 'small', `ещё ${queriesText(group.count - 1)} такой же формы — отличаются только значениями`));
    const inner = el('ol', 'sql-queries__list');
    for (let j = i + 1; j < group.start + group.count; j += 1) inner.append(item(j));
    rest.append(inner);
    list.append(el('li'));
    list.lastChild.append(rest);
    i = group.start + group.count - 1;
  }
  wrap.append(list);
  return wrap;
}

// --- Ответ ---

/** 2xx — зелёный, 3xx — обычный, 4xx и 5xx — красный. */
function badgeClass(status) {
  if (status >= 400) return 'badge--error';
  return status >= 300 ? '' : 'badge--done';
}

function console_(text, error = false) {
  const box = el('div', 'console');
  box.append(el('div', `console__line${error ? ' console__line--error' : ''}`, text));
  return box;
}

/**
 * Карточка ответа. onNavigate(method, path, data) — клик по ссылке или отправка формы
 * в показанной странице: тренажёр сам отправляет следующий запрос.
 */
export function responseCard(response, onNavigate) {
  const li = el('li', 'run-step');
  const head = el('div', 'run-step__head');
  head.append(
    el('code', '', `${response.method} ${response.path}`),
    el('span', `badge ${badgeClass(response.status)}`.trim(), `${response.status} ${response.reason}`),
    el('span', 'badge', queriesText(response.queries.length)),
  );
  if (findNPlusOne(response.queries).length) head.append(el('span', 'badge badge--warning', 'N+1'));
  if (response.templates.length) head.append(el('span', 'muted small', `шаблон: ${response.templates.join(', ')}`));
  const body = el('div', 'run-step__body');
  if (response.error) body.append(console_(response.error, true));

  const location = response.headers.Location;
  if (location) {
    const redirect = el('p', 'small');
    const link = el('button', 'btn btn--ghost btn--sm', `Перейти на ${location}`);
    link.type = 'button';
    link.addEventListener('click', () => onNavigate('GET', location));
    redirect.append(`Редирект (${response.status}) → `, el('code', '', location), ' ', link);
    body.append(redirect);
  }
  if ((response.headers['Content-Type'] ?? '').startsWith('text/html') && response.body) {
    body.append(pagePreview(response, onNavigate));
  } else if (response.body) {
    const pre = el('pre', 'sql-output');
    pre.textContent = response.body;
    body.append(pre);
  }

  const headers = el('details', 'hint');
  headers.append(el('summary', '', 'Заголовки ответа'));
  const list = el('ul', 'response-headers');
  for (const [name, value] of Object.entries(response.headers)) {
    const item = el('li');
    item.append(el('code', '', name), `: ${value}`);
    list.append(item);
  }
  headers.append(list);
  body.append(headers, el('h4', 'run-step__subtitle', 'SQL-запросы'), queryList(response.queries));
  li.append(head, body);
  return li;
}

/**
 * Страница ответа в изолированном iframe: без allow-scripts — код страницы не выполняется;
 * allow-same-origin — чтобы перехватить клики по ссылкам и отправку форм.
 */
function pagePreview(response, onNavigate) {
  const frame = el('div', 'preview__frame');
  const iframe = el('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.title = `Ответ ${response.method} ${response.path}`;
  iframe.addEventListener('load', () => {
    const doc = iframe.contentDocument;
    if (!doc) return;
    // высота — по странице (в пределах разумного), без пустого места под короткой страницей
    const content = Math.ceil(doc.body?.getBoundingClientRect().bottom ?? 0) + 16;
    iframe.style.height = `${Math.min(Math.max(content, 120), 640)}px`;
    const resolve = (href) => new URL(href, `http://testserver${response.path}`);
    // Без allow-forms браузер не отправляет форму и не создаёт событие submit —
    // отправку ловим сами: кнопка отправки или Enter в поле формы
    const submit = (form, submitter = null) => {
      const url = resolve(form.getAttribute('action') || response.path);
      const data = Object.fromEntries(new FormData(form, submitter));
      const method = (form.getAttribute('method') || 'GET').toUpperCase();
      onNavigate(method === 'POST' ? 'POST' : 'GET', url.pathname, data);
    };
    doc.addEventListener('click', (event) => {
      const button = event.target.closest('button, input[type="submit"]');
      if (button?.form && (button.type || 'submit') === 'submit') {
        event.preventDefault();
        submit(button.form, button);
        return;
      }
      const link = event.target.closest('a[href]');
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute('href');
      if (!href.startsWith('#')) onNavigate('GET', resolve(href).pathname + resolve(href).search);
    });
    doc.addEventListener('keydown', (event) => {
      const field = event.target.closest('input');
      if (event.key === 'Enter' && field?.form) {
        event.preventDefault();
        submit(field.form);
      }
    });
  }, { once: true });
  iframe.srcdoc = response.body;
  frame.append(iframe);
  return frame;
}

/** Карточка ORM: вывод (print и значение последней строки), ошибка, SQL. */
export function ormCard(orm) {
  const li = el('li', 'run-step');
  const head = el('div', 'run-step__head');
  head.append(el('code', '', 'orm.py'), el('span', 'badge', queriesText(orm.queries.length)));
  if (findNPlusOne(orm.queries).length) head.append(el('span', 'badge badge--warning', 'N+1'));
  const body = el('div', 'run-step__body');
  if (orm.output) body.append(console_(orm.output.replace(/\n$/, '')));
  if (orm.error) body.append(console_(orm.error, true));
  if (!orm.output && !orm.error) body.append(el('p', 'muted small', 'Код ничего не вывел — добавьте print() или оставьте выражение последней строкой.'));
  body.append(el('h4', 'run-step__subtitle', 'SQL-запросы'), queryList(orm.queries));
  li.append(head, body);
  return li;
}

// --- Модели ---

const TYPE_NAMES = {
  BigAutoField: 'int', AutoField: 'int', IntegerField: 'int', PositiveIntegerField: 'int',
  SmallIntegerField: 'int', BigIntegerField: 'int', CharField: 'str', TextField: 'str',
  EmailField: 'str', SlugField: 'str', URLField: 'str', DecimalField: 'Decimal',
  FloatField: 'float', BooleanField: 'bool', DateTimeField: 'datetime', DateField: 'date',
  JSONField: 'json',
};

export class ModelsStrip {
  constructor(root) {
    this.summary = root.querySelector('[data-schema-summary]');
    this.list = root.querySelector('[data-schema-tables]');
  }

  render(models) {
    const open = new Set([...this.list.querySelectorAll('details[open]')].map((item) => item.dataset.table));
    this.summary.textContent = models.length
      ? `${plural(models.length, 'модель', 'модели', 'моделей')} · нажмите, чтобы раскрыть`
      : 'моделей нет — опишите их в models.py';
    const items = models.map((model) => {
      const item = el('details', 'explorer__item');
      item.dataset.table = model.name;
      if (open.has(model.name)) item.open = true;
      const summary = el('summary');
      summary.append(el('span', 'explorer__name', model.name), el('span', 'explorer__meta', model.table));
      const cols = el('ul', 'explorer__cols');
      for (const field of model.fields) {
        const li = el('li');
        li.append(el('span', field.pk ? 'pk' : field.to ? 'fk' : 'pk', field.pk ? 'PK' : field.to ? 'FK' : ''));
        const type = field.to ? `→ ${field.to}` : `${TYPE_NAMES[field.type] ?? field.type}${field.null ? '?' : ''}`;
        li.append(field.name, ' ', el('span', 'type', type));
        li.title = field.type;
        cols.append(li);
      }
      item.append(summary, cols);
      return item;
    });
    const hint = el('p', 'muted small', 'Поля-связи (→) можно использовать в select_related и в фильтрах через __ (category__name). ? — может быть NULL.');
    this.list.replaceChildren(...items, hint);
  }
}
