// Разбор SELECT с одним JOIN двух таблиц — для картинки «какие строки совпали».
// Берём только простой случай, на котором JOIN и объясняют: FROM a [x] JOIN b [y] ON …
// Подзапросы, три таблицы и больше, USING — без картинки, только результат.

import { mask } from './split.js';

const IDENT = '([a-z_][a-z0-9_]*)';
const NOT_ALIAS = new Set(['join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'on', 'using', 'where', 'outer']);
const FROM_RE = new RegExp(
  `^\\s*${IDENT}(?:\\s+(?:as\\s+)?${IDENT})?\\s+`
  + '((?:inner\\s+|(?:left|right|full)\\s+(?:outer\\s+)?)?join)\\s+'
  + `${IDENT}(?:\\s+(?:as\\s+)?${IDENT})?\\s+on\\s+(\\S[\\s\\S]*?)\\s*$`,
);
// Ключевые слова после FROM … WHERE: до них — часть запроса, по которой ищем пары
const CLAUSE_END = /\b(group\s+by|having|window|order\s+by|limit|offset|fetch|for\s+(?:update|share)|union|intersect|except)\b/g;

/** Где в тексте слова уровня запроса (вне скобок): текст, где всё в скобках — пробелы. */
function topLevel(masked) {
  let depth = 0;
  let out = '';
  for (const ch of masked) {
    if (ch === '(') depth += 1;
    out += depth ? ' ' : ch;
    if (ch === ')') depth = Math.max(depth - 1, 0);
  }
  return out;
}

/**
 * { type, on, left: {table, alias}, right: {table, alias}, select, from, where, tail, grouped }
 * или null. select — список колонок; from — «FROM … [WHERE …]» без GROUP BY/ORDER BY;
 * tail — остаток запроса после from; grouped — есть DISTINCT, GROUP BY, агрегаты или UNION:
 * тогда строку результата нельзя связать с парой строк.
 */
export function parseJoin(sql) {
  const masked = mask(sql).toLowerCase();
  const flat = topLevel(masked);
  if (!/^\s*select\b/.test(flat)) return null;
  const fromAt = flat.search(/\bfrom\b/);
  if (fromAt === -1) return null;
  CLAUSE_END.lastIndex = fromAt;
  const end = CLAUSE_END.exec(flat)?.index ?? sql.length;
  const whereAt = flat.slice(fromAt, end).search(/\bwhere\b/);
  const fromEnd = whereAt === -1 ? end : fromAt + whereAt;
  const match = FROM_RE.exec(masked.slice(fromAt + 4, fromEnd));
  if (!match) return null;
  const [, leftTable, leftAlias, kind, rightTable, rightAlias] = match;
  if ([leftAlias, rightAlias].some((alias) => alias && NOT_ALIAS.has(alias))) return null;
  // третья таблица: … JOIN c ON … после первого ON
  if (/\b(join|natural)\b|,/.test(topLevel(match[6]))) return null;
  // ON — из исходного текста (в маске строки заменены)
  const onStart = fromAt + 4 + match[0].lastIndexOf(match[6]);
  const selectStart = flat.search(/\bselect\b/) + 'select'.length;
  return {
    type: kind === 'join' ? 'INNER JOIN' : kind.replace(/\s+/g, ' ').replace(' outer', '').toUpperCase(),
    on: sql.slice(onStart, onStart + match[6].length),
    left: { table: leftTable, alias: leftAlias ?? null },
    right: { table: rightTable, alias: rightAlias ?? null },
    select: sql.slice(selectStart, fromAt),
    from: sql.slice(fromAt, end).trimEnd(),
    tail: sql.slice(fromAt),
    grouped: /^\s*distinct\b/.test(flat.slice(selectStart))
      || /\b(group\s+by|union|intersect|except)\b/.test(flat)
      || /\b(count|sum|avg|min|max|array_agg|string_agg|bool_and|bool_or|json_agg|jsonb_agg)\s*\(/.test(masked.slice(selectStart, fromAt)),
  };
}

/** Колонки таблицы, которые упомянуты в запросе (чтобы не показывать всю ширину products). */
export function mentionedColumns(sql, columns) {
  const text = mask(sql).toLowerCase();
  return columns.filter((column) => new RegExp(`(^|[^a-z0-9_])${column}([^a-z0-9_(]|$)`).test(text));
}
