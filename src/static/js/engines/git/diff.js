// Строки файлов: разница (git diff), счётчики (+/−) и трёхстороннее слияние с маркерами
// конфликта (merge, revert, cherry-pick, rebase, stash pop). Файлы учебные — небольшие,
// поэтому разница считается простым LCS без оптимизаций.

/** Текст → строки без завершающего перевода строки. */
export const toLines = (text) => (text ? text.replace(/\n$/, '').split('\n') : []);
export const fromLines = (lines) => (lines.length ? `${lines.join('\n')}\n` : '');

/** Разница строк: [{op: '=', '-', '+', line}] — как в unified diff. */
export function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  // lcs[i][j] — длина общей части a[i:] и b[j:]
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: '=', line: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ op: '-', line: a[i] });
      i += 1;
    } else {
      ops.push({ op: '+', line: b[j] });
      j += 1;
    }
  }
  while (i < n) ops.push({ op: '-', line: a[i++] });
  while (j < m) ops.push({ op: '+', line: b[j++] });
  return ops;
}

/** Сколько строк добавлено и удалено (для «2 insertions(+), 1 deletion(-)»). */
export function countChanges(before, after) {
  let added = 0;
  let removed = 0;
  for (const { op } of diffLines(toLines(before), toLines(after))) {
    if (op === '+') added += 1;
    if (op === '-') removed += 1;
  }
  return { added, removed };
}

/** Тело unified diff (@@ … @@ и строки) с 3 строками контекста. */
export function unifiedHunks(before, after, context = 3) {
  const ops = diffLines(toLines(before), toLines(after));
  const changed = ops.map((item, index) => (item.op !== '=' ? index : -1)).filter((index) => index >= 0);
  if (!changed.length) return '';
  // Группы изменений, между которыми больше 2·context общих строк, — разные куски
  const groups = [];
  for (const index of changed) {
    const last = groups[groups.length - 1];
    if (last && index - last[1] <= context * 2 + 1) last[1] = index;
    else groups.push([index, index]);
  }
  let out = '';
  for (const [first, last] of groups) {
    const from = Math.max(first - context, 0);
    const to = Math.min(last + context, ops.length - 1);
    // номера строк начала куска в старом и новом файле
    let oldLine = 1;
    let newLine = 1;
    for (let k = 0; k < from; k += 1) {
      if (ops[k].op !== '+') oldLine += 1;
      if (ops[k].op !== '-') newLine += 1;
    }
    const slice = ops.slice(from, to + 1);
    const oldCount = slice.filter((item) => item.op !== '+').length;
    const newCount = slice.filter((item) => item.op !== '-').length;
    const range = (start, count) => (count === 1 ? `${start}` : `${count ? start : start - 1},${count}`);
    out += `@@ -${range(oldLine, oldCount)} +${range(newLine, newCount)} @@\n`;
    for (const { op, line } of slice) out += `${op === '=' ? ' ' : op}${line}\n`;
  }
  return out;
}

/** Изменения относительно base: [{start, end, lines}] — base[start:end] заменён на lines. */
function hunks(base, other) {
  const result = [];
  let index = 0;
  let current = null;
  for (const { op, line } of diffLines(base, other)) {
    if (op === '=') {
      if (current) result.push(current);
      current = null;
      index += 1;
      continue;
    }
    current ??= { start: index, end: index, lines: [] };
    if (op === '-') {
      current.end += 1;
      index += 1;
    } else {
      current.lines.push(line);
    }
  }
  if (current) result.push(current);
  return result;
}

/** Применить свои изменения к куску base[start:end]. */
function apply(base, start, end, changes) {
  const out = [];
  let index = start;
  for (const change of changes) {
    out.push(...base.slice(index, change.start), ...change.lines);
    index = change.end;
  }
  out.push(...base.slice(index, end));
  return out;
}

/**
 * Трёхстороннее слияние текста: base — общий предок, ours — наша версия, theirs — их.
 * Непересекающиеся правки сливаются сами; пересекающиеся — конфликт с маркерами, как у git.
 * Возвращает {text, conflict}.
 */
export function merge3(base, ours, theirs, { oursLabel = 'HEAD', theirsLabel = 'theirs' } = {}) {
  if (ours === theirs) return { text: ours, conflict: false };
  if (base === ours) return { text: theirs, conflict: false };
  if (base === theirs) return { text: ours, conflict: false };
  const baseLines = toLines(base);
  const oursLines = toLines(ours);
  const theirsLines = toLines(theirs);
  const changes = [
    ...hunks(baseLines, oursLines).map((h) => ({ ...h, side: 'ours' })),
    ...hunks(baseLines, theirsLines).map((h) => ({ ...h, side: 'theirs' })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);

  const out = [];
  let conflict = false;
  let index = 0;
  let i = 0;
  while (i < changes.length) {
    // Группа: правки, задевающие одни и те же (или соседние) строки base
    const group = [changes[i]];
    let end = changes[i].end;
    i += 1;
    while (i < changes.length && changes[i].start <= end) {
      group.push(changes[i]);
      end = Math.max(end, changes[i].end);
      i += 1;
    }
    const start = group[0].start;
    out.push(...baseLines.slice(index, start));
    const mine = group.filter((h) => h.side === 'ours');
    const yours = group.filter((h) => h.side === 'theirs');
    const oursPart = apply(baseLines, start, end, mine);
    const theirsPart = apply(baseLines, start, end, yours);
    if (!mine.length) out.push(...theirsPart);
    else if (!yours.length || oursPart.join('\n') === theirsPart.join('\n')) out.push(...oursPart);
    else {
      conflict = true;
      out.push(`<<<<<<< ${oursLabel}`, ...oursPart, '=======', ...theirsPart, `>>>>>>> ${theirsLabel}`);
    }
    index = end;
  }
  out.push(...baseLines.slice(index));
  return { text: fromLines(out), conflict };
}
