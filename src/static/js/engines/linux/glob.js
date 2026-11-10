// Шаблоны имён файлов: *, ?, [abc] — для раскрытия в shell и find -name.
// Символ после \u0000 — из кавычек, сравнивается буквально.

export const hasGlob = (parts) => parts.some((part) => !part.quote && /[*?[]/.test(part.text));

export function globToRegExp(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\u0000') {                 // символ из кавычек — буквально
      source += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i += 1;
    } else if (ch === '*') source += '[^/]*';
    else if (ch === '?') source += '[^/]';
    else if (ch === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) source += '\\[';
      else {
        source += `[${pattern.slice(i + 1, close).replace(/^!/, '^')}]`;
        i = close;
      }
    } else source += ch.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function globMatch(pattern, name) {
  return globToRegExp(pattern).test(name);
}
