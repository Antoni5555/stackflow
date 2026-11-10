// Разбор текста SQL на отдельные запросы — чтобы выполнять их по одному и показывать
// результат каждого. Точка с запятой внутри строк, имён в кавычках, $$-строк
// и комментариев запрос не заканчивает.

/**
 * Текст той же длины, где комментарии заменены пробелами, а строки и имена в кавычках —
 * символами _ (переводы строк сохраняются). По нему ищем ; и ключевые слова,
 * не путаясь в кавычках; строка не пробел — конец запроса после неё не обрежется.
 */
export function mask(text) {
  let out = '';
  let i = 0;
  const blank = (part, fill) => part.replace(/[^\n]/g, fill);
  while (i < text.length) {
    const ch = text[i];
    const rest = text.slice(i);
    let end = -1;
    let fill = '_';
    if (rest.startsWith('--')) {
      fill = ' ';
      end = text.indexOf('\n', i);
      if (end === -1) end = text.length;
    } else if (rest.startsWith('/*')) {
      fill = ' ';
      // комментарии /* */ в PostgreSQL бывают вложенными
      let depth = 0;
      let j = i;
      while (j < text.length) {
        if (text.startsWith('/*', j)) { depth += 1; j += 2; } else if (text.startsWith('*/', j)) {
          depth -= 1; j += 2;
          if (!depth) break;
        } else j += 1;
      }
      end = j;
    } else if (ch === "'") {
      // E'…' — с обратной косой чертой как escape; обычная строка — только ''
      const escaped = /[eE]/.test(text[i - 1] ?? '') && !/[\w$]/.test(text[i - 2] ?? '');
      let j = i + 1;
      while (j < text.length) {
        if (escaped && text[j] === '\\') { j += 2; continue; }
        if (text[j] === "'") {
          if (text[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      end = Math.min(j + 1, text.length);
    } else if (ch === '"') {
      let j = i + 1;
      while (j < text.length && !(text[j] === '"' && text[j + 1] !== '"')) j += text[j] === '"' ? 2 : 1;
      end = Math.min(j + 1, text.length);
    } else if (ch === '$' && !/[\w$]/.test(text[i - 1] ?? '')) {
      const tag = /^\$([A-Za-z_]\w*)?\$/.exec(rest);
      if (tag) {
        const close = text.indexOf(tag[0], i + tag[0].length);
        end = close === -1 ? text.length : close + tag[0].length;
      }
    }
    if (end === -1) {
      out += ch;
      i += 1;
    } else {
      out += blank(text.slice(i, end), fill);
      i = end;
    }
  }
  return out;
}

const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;

/**
 * Запросы по порядку: { sql, start, line } — sql без ведущих комментариев и пробелов,
 * start — смещение в исходном тексте (для строки и колонки ошибки), line — с 1.
 */
export function splitStatements(text) {
  const masked = mask(text);
  const statements = [];
  let from = 0;
  const push = (to) => {
    const part = masked.slice(from, to);
    const lead = part.search(/\S/);
    if (lead !== -1) {
      const start = from + lead;
      const tail = masked.slice(start, to).trimEnd().length;
      statements.push({ sql: text.slice(start, start + tail), start, line: lineAt(text, start) });
    }
  };
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] === ';') {
      push(i);
      from = i + 1;
    }
  }
  push(masked.length);
  return statements;
}

const KINDS = {
  query: ['select', 'values', 'table', 'show', 'explain'],
  dml: ['insert', 'update', 'delete', 'merge', 'copy'],
  ddl: ['create', 'alter', 'drop', 'truncate', 'comment', 'grant', 'revoke', 'reindex', 'cluster'],
  tx: ['begin', 'start', 'commit', 'end', 'rollback', 'abort', 'savepoint', 'release'],
  set: ['set', 'reset'],
};

/**
 * Вид запроса: query — только читает; dml — меняет строки; ddl — структуру;
 * tx — транзакция; set — настройка сессии; other — остальное.
 * WITH … INSERT/UPDATE/DELETE — dml, SELECT … INTO — ddl (создаёт таблицу).
 */
export function statementKind(sql) {
  const text = mask(sql).toLowerCase();
  const first = /[a-z]+/.exec(text)?.[0] ?? '';
  if (first === 'with') {
    // слово вне скобок CTE: WITH x AS (…) INSERT …
    let depth = 0;
    let flat = '';
    for (const ch of text) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth = Math.max(depth - 1, 0);
      flat += depth || ch === ')' ? ' ' : ch;
    }
    return /\b(insert|update|delete|merge)\b/.test(flat) ? 'dml' : 'query';
  }
  if (first === 'select' && /\binto\b/.test(text) && !/\binto\s+strict\b/.test(text)) return 'ddl';
  for (const [kind, words] of Object.entries(KINDS)) {
    if (words.includes(first)) return kind;
  }
  return 'other';
}

/** Строка и колонка (с 1) по смещению position (с 1, как в ошибке PostgreSQL) внутри запроса. */
export function errorLocation(text, statement, position) {
  const offset = statement.start + position - 1;
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}
