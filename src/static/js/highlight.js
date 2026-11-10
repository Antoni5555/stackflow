// Подсветка HTML и CSS при наборе (слой под textarea, js/editor.js).
// Свой небольшой разбор без библиотек: теги, атрибуты, значения, комментарии, свойства CSS.
// Классы — те же, что у кода в уроках (base.css): kw, fn, str, num, cm.
// Разбор терпит незаконченный код: пока ученик печатает, тег может быть не закрыт.

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls, text) => (text ? `<span class="${cls}">${escape(text)}</span>` : '');

// --- CSS ---

/** Значение свойства: строки, числа с единицами, цвета #fff, !important. */
function cssValue(text) {
  return text.replace(
    /("[^"]*"?|'[^']*'?)|(#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+(?:%|[a-zA-Z]+)?)|(!important)|([^"'#\d!-]+|.)/g,
    (_, str, num, important, other) => {
      if (str) return span('str', str);
      if (num) return span('num', num);
      if (important) return span('kw', important);
      return escape(other);
    },
  );
}

/** Объявление «свойство: значение;» внутри блока. */
function cssDeclaration(text) {
  const colon = text.indexOf(':');
  if (colon === -1) return span('fn', text);
  return span('fn', text.slice(0, colon)) + escape(':') + cssValue(text.slice(colon + 1));
}

export function highlightCss(text) {
  let out = '';
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += span('cm', text.slice(i, stop));
      i = stop;
      continue;
    }
    const ch = text[i];
    if (ch === '{' || ch === '}' || ch === ';') {
      if (ch === '{') depth += 1;
      if (ch === '}') depth = Math.max(depth - 1, 0);
      out += ch;
      i += 1;
      continue;
    }
    // Кусок до следующего { ; } или комментария: селектор, если дальше {, иначе объявление
    let j = i;
    while (j < text.length && !'{};'.includes(text[j]) && !text.startsWith('/*', j)) j += 1;
    const part = text.slice(i, j);
    if (text[j] === '{' || depth === 0) {
      out += part.trimStart().startsWith('@')
        ? part.replace(/^(\s*)(@[\w-]+)(.*)$/s, (_, space, rule, rest) => escape(space) + span('kw', rule) + cssValue(rest))
        : span('kw', part);
    } else {
      out += part.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_, before, body, after) => escape(before) + cssDeclaration(body) + escape(after));
    }
    i = j;
  }
  return out;
}

// --- HTML ---

/** Атрибуты внутри тега: имя — fn, значение — str. */
function htmlAttributes(text) {
  return text.replace(
    /([^\s=/>]+)(\s*=\s*)?("[^"]*"?|'[^']*'?|[^\s>]+)?|(\s+|.)/g,
    (_, name, eq, value, other) => {
      if (other !== undefined) return escape(other);
      return span('fn', name) + (eq ? escape(eq) : '') + (value && eq ? span('str', value) : escape(value ?? ''));
    },
  );
}

export function highlightHtml(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      const stop = end === -1 ? text.length : end + 3;
      out += span('cm', text.slice(i, stop));
      i = stop;
      continue;
    }
    const tag = /^<(\/?)([a-zA-Z!][\w:-]*)/.exec(text.slice(i));
    if (!tag) {
      const next = text.indexOf('<', i + 1);
      const stop = next === -1 ? text.length : next;
      out += escape(text.slice(i, stop));
      i = stop;
      continue;
    }
    // Тег до > (с учётом кавычек в атрибутах); незакрытый — до конца текста
    let j = i + tag[0].length;
    let quote = null;
    while (j < text.length && (quote || text[j] !== '>')) {
      if (quote && text[j] === quote) quote = null;
      else if (!quote && (text[j] === '"' || text[j] === "'")) quote = text[j];
      j += 1;
    }
    const inner = text.slice(i + tag[0].length, j);
    const selfClose = inner.endsWith('/');
    out += escape(`<${tag[1]}`) + span('kw', tag[2])
      + htmlAttributes(selfClose ? inner.slice(0, -1) : inner)
      + escape(`${selfClose ? '/' : ''}${j < text.length ? '>' : ''}`);
    i = Math.min(j + 1, text.length);

    // Внутри <style> — CSS, внутри <script> — как есть, до закрывающего тега
    const name = tag[2].toLowerCase();
    if (!tag[1] && (name === 'style' || name === 'script')) {
      const close = text.toLowerCase().indexOf(`</${name}`, i);
      const stop = close === -1 ? text.length : close;
      const body = text.slice(i, stop);
      out += name === 'style' ? highlightCss(body) : escape(body);
      i = stop;
    }
  }
  return out;
}

/** Подсветка по имени файла: index.html → HTML, style.css → CSS, остальное — без подсветки. */
export function highlighterFor(filename) {
  if (/\.html?$/i.test(filename)) return highlightHtml;
  if (/\.css$/i.test(filename)) return highlightCss;
  return null;
}
