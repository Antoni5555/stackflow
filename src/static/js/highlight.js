// Подсветка HTML, CSS, Python и SQL при наборе (слой под textarea, js/editor.js).
// Свой небольшой разбор без библиотек: теги, атрибуты, значения, комментарии, свойства CSS;
// в Python — ключевые слова, встроенные функции, строки, числа, комментарии.
// Классы — те же, что у кода в уроках (base.css, rendering.TOKEN_CLASSES): kw, fn, str, num, cm.
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

// --- Python ---

const PY_KEYWORDS = new Set(`False None True and as assert async await break class continue def del
elif else except finally for from global if import in is lambda nonlocal not or pass raise return
try while with yield match case`.split(/\s+/));

const PY_BUILTINS = new Set(`abs all any bin bool breakpoint bytearray bytes callable chr classmethod
compile complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr
globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max
memoryview min next object oct open ord pow print property range repr reversed round set setattr
slice sorted staticmethod str sum super tuple type vars zip __import__ self cls
Exception ValueError TypeError KeyError IndexError ZeroDivisionError AttributeError NameError
RuntimeError StopIteration NotImplementedError FileNotFoundError OSError ImportError
ArithmeticError LookupError RecursionError AssertionError`.split(/\s+/));

// Строка с префиксом (f, r, b, rb…), тройные кавычки — до закрывающих (или до конца текста),
// обычные — до закрывающей кавычки или конца строки (пока ученик печатает)
const PY_TOKEN = new RegExp([
  '(#[^\\n]*)',
  '((?:[rRbBuUfF]{1,2})?(?:\'\'\'[\\s\\S]*?(?:\'\'\'|$(?![\\s\\S]))|"""[\\s\\S]*?(?:"""|$(?![\\s\\S]))|\'(?:\\\\.|[^\'\\\\\\n])*\'?|"(?:\\\\.|[^"\\\\\\n])*"?))',
  '((?:0[xX][\\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\\d[\\d_]*\\.?[\\d_]*|\\.\\d[\\d_]*)(?:[eE][+-]?\\d+)?[jJ]?)(?![\\p{L}\\d_]))',
  '([\\p{L}_][\\p{L}\\p{N}_]*)',
  '([\\s\\S])',
].join('|'), 'gu');

export function highlightPython(text) {
  let out = '';
  let afterDef = false;       // имя после def / class — как имя функции
  for (const match of text.matchAll(PY_TOKEN)) {
    const [token, comment, string, number, word] = match;
    if (comment) out += span('cm', comment);
    else if (string) out += span('str', string);
    else if (number) out += span('num', number);
    else if (word) {
      if (afterDef) out += span('fn', word);
      else if (PY_KEYWORDS.has(word)) out += span('kw', word);
      else if (PY_BUILTINS.has(word)) out += span('fn', word);
      else out += escape(word);
      afterDef = word === 'def' || word === 'class';
      continue;
    } else out += escape(token);
    if (!/^[ \t]+$/.test(token)) afterDef = false;
  }
  return out;
}

// --- SQL ---

const SQL_KEYWORDS = new Set(`add all alter and any as asc begin between by cascade case check
column commit constraint create cross current_date current_timestamp default delete desc distinct
drop else end except exists explain false fetch filter first foreign from full grant group having
identity if ilike in index inner insert intersect into is join key last lateral left like limit
materialized not null nulls offset on or order outer over partition primary recursive references
rename replace restrict returning revoke right rollback row rows savepoint schema select sequence set
table then to transaction true truncate union unique update using values view when where window
with generated always serial bigserial integer int smallint bigint numeric decimal real text varchar
char boolean bool date time timestamp timestamptz interval jsonb json uuid array`.split(/\s+/));

// Строки '…' (и E'…'), $$…$$, имена в "кавычках", числа, комментарии -- и /* */
const SQL_TOKEN = new RegExp([
  '(--[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$(?![\\s\\S])))',
  '([eE]\'(?:\'\'|\\\\.|[^\'\\\\])*\'?|\'(?:\'\'|[^\'])*\'?|\\$([A-Za-z_]\\w*)?\\$[\\s\\S]*?(?:\\$\\3\\$|$(?![\\s\\S])))',
  '("(?:""|[^"])*"?)',
  '(\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)',
  '([\\p{L}_][\\p{L}\\p{N}_$]*)',
  '([\\s\\S])',
].join('|'), 'gu');

export function highlightSql(text) {
  let out = '';
  for (const match of text.matchAll(SQL_TOKEN)) {
    const [token, comment, string, , quoted, number, word] = match;
    if (comment) out += span('cm', comment);
    else if (string) out += span('str', string);
    else if (quoted) out += escape(quoted);
    else if (number) out += span('num', number);
    else if (word) {
      const lower = word.toLowerCase();
      if (SQL_KEYWORDS.has(lower)) out += span('kw', word);
      // имя перед скобкой — функция: count(…), now()
      else if (text[match.index + word.length] === '(') out += span('fn', word);
      else out += escape(word);
    } else out += escape(token);
  }
  return out;
}

/** Подсветка по имени файла: .html, .css, .py; для остальных (nginx.conf…) — без подсветки. */
export function highlighterFor(filename) {
  if (/\.html?$/i.test(filename)) return highlightHtml;
  if (/\.css$/i.test(filename)) return highlightCss;
  if (/\.py$/i.test(filename)) return highlightPython;
  if (/\.sql$/i.test(filename)) return highlightSql;
  return null;
}
