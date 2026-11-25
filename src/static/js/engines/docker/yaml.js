// Мини-YAML для compose.yaml: словари и списки блоками, «- ключ: значение», строки в кавычках,
// [a, b] и {a: b} в одну строку, | и > для многострочного текста, комментарии #.
// Значения — строки (как их видит compose до проверки схемы). Ошибки — как у go-yaml:
// «yaml: line 4: mapping values are not allowed in this context».

export class YamlError extends Error {}

/** Убрать комментарий # (вне кавычек). */
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}

/** Скаляр: "строка", 'строка', ~/null → null, остальное — как написано. */
function scalar(text, line) {
  const value = text.trim();
  if (value === '' || value === '~' || value === 'null') return null;
  if (value.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(value)) throw new YamlError(`yaml: line ${line}: found unexpected end of stream`);
    return JSON.parse(value);
  }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(value)) throw new YamlError(`yaml: line ${line}: found unexpected end of stream`);
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('[') || value.startsWith('{')) return flow(value, line);
  return value;
}

/** [a, "b", c] и {a: b, c: d} — в одну строку. */
function flow(text, line) {
  let i = 0;
  const skip = () => {
    while (/\s/.test(text[i] ?? '')) i += 1;
  };
  const item = (stop) => {
    skip();
    if (text[i] === '[' || text[i] === '{') return value();
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i];
      let j = i + 1;
      while (j < text.length && text[j] !== quote) j += text[j] === '\\' && quote === '"' ? 2 : 1;
      const raw = text.slice(i, j + 1);
      i = j + 1;
      return scalar(raw, line);
    }
    let j = i;
    while (j < text.length && !stop.includes(text[j])) j += 1;
    const raw = text.slice(i, j);
    i = j;
    return scalar(raw, line);
  };
  const value = () => {
    skip();
    if (text[i] === '[') {
      i += 1;
      const list = [];
      skip();
      if (text[i] === ']') {
        i += 1;
        return list;
      }
      for (;;) {
        list.push(item(',]'));
        skip();
        if (text[i] === ',') i += 1;
        else if (text[i] === ']') {
          i += 1;
          return list;
        } else throw new YamlError(`yaml: line ${line}: did not find expected ',' or ']'`);
      }
    }
    if (text[i] === '{') {
      i += 1;
      const map = {};
      skip();
      if (text[i] === '}') {
        i += 1;
        return map;
      }
      for (;;) {
        skip();
        let j = i;
        while (j < text.length && text[j] !== ':' && text[j] !== '}' && text[j] !== ',') j += 1;
        const key = scalar(text.slice(i, j), line);
        i = j;
        if (text[i] === ':') {
          i += 1;
          map[key] = item(',}');
        } else map[key] = null;
        skip();
        if (text[i] === ',') i += 1;
        else if (text[i] === '}') {
          i += 1;
          return map;
        } else throw new YamlError(`yaml: line ${line}: did not find expected ',' or '}'`);
      }
    }
    return item(',]}');
  };
  const result = value();
  skip();
  if (i < text.length) throw new YamlError(`yaml: line ${line}: did not find expected <document start>`);
  return result;
}

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#-][^:#]*?|-[^\s:#][^:#]*?)\s*:(?:\s+(.*))?$/;

/** Текст YAML → объект. */
export function parseYaml(text) {
  const lines = [];
  text.replace(/\t/g, '    ').split('\n').forEach((raw, n) => {
    const cleaned = stripComment(raw);
    if (!cleaned.trim() || cleaned.trim() === '---') {
      lines.push({ blank: true, raw, line: n + 1 });
      return;
    }
    lines.push({ indent: cleaned.length - cleaned.trimStart().length, text: cleaned.trim(), raw, line: n + 1 });
  });
  let pos = 0;
  const next = () => {
    while (pos < lines.length && lines[pos].blank) pos += 1;
    return lines[pos];
  };

  // | и > — строки с отступом больше родителя
  const blockScalar = (style, parentIndent) => {
    const parts = [];
    let indent = null;
    while (pos < lines.length) {
      const item = lines[pos];
      if (item.blank) {
        parts.push('');
        pos += 1;
        continue;
      }
      if (item.indent <= parentIndent) break;
      indent ??= item.indent;
      parts.push(item.raw.slice(indent));
      pos += 1;
    }
    while (parts.length && parts.at(-1) === '') parts.pop();
    return style.startsWith('|') ? `${parts.join('\n')}\n` : `${parts.join(' ')}\n`;
  };

  const parseValue = (rest, indent, line) => {
    if (rest === undefined || rest === '') {
      const item = next();
      if (!item) return null;
      if (item.indent > indent) return parseBlock(item.indent);
      if (item.indent === indent && item.text.startsWith('-')) return parseBlock(indent);
      return null;
    }
    if (/^[|>][-+]?$/.test(rest)) return blockScalar(rest, indent);
    const value = scalar(rest, line);
    const item = next();
    // значение уже есть, а следующая строка ушла глубже — «mapping values are not allowed»
    if (item && item.indent > indent) {
      throw new YamlError(`yaml: line ${KEY.test(item.text) ? item.line : item.line}: mapping values are not allowed in this context`);
    }
    return value;
  };

  const parseMapping = (indent) => {
    const map = {};
    for (let item = next(); item && item.indent === indent && !/^-(\s|$)/.test(item.text); item = next()) {
      const match = KEY.exec(item.text);
      if (!match) throw new YamlError(`yaml: line ${item.line}: could not find expected ':'`);
      const key = scalar(match[1], item.line);
      if (Object.hasOwn(map, key)) throw new YamlError(`yaml: unmarshal errors:\n  line ${item.line}: mapping key "${key}" already defined at line ${map[`\u0000${key}`]}`);
      pos += 1;
      map[key] = parseValue(match[2], indent, item.line);
      Object.defineProperty(map, `\u0000${key}`, { value: item.line, enumerable: false });
    }
    const item = next();
    if (item && item.indent > indent) throw new YamlError(`yaml: line ${item.line}: did not find expected key`);
    return map;
  };

  const parseSequence = (indent) => {
    const list = [];
    for (let item = next(); item && item.indent === indent && /^-(\s|$)/.test(item.text); item = next()) {
      const content = item.text.replace(/^-\s*/, '');
      if (!content) {
        pos += 1;
        const child = next();
        list.push(child && child.indent > indent ? parseBlock(child.indent) : null);
        continue;
      }
      const offset = item.indent + (item.text.length - content.length);
      if (KEY.test(content) && !content.startsWith('"') && !content.startsWith("'") && !content.startsWith('[') && !content.startsWith('{')) {
        // «- ключ: значение» — словарь, его ключи на отступе offset
        lines[pos] = { ...item, indent: offset, text: content };
        list.push(parseMapping(offset));
        continue;
      }
      pos += 1;
      list.push(scalar(content, item.line));
    }
    return list;
  };

  const parseBlock = (indent) => {
    const item = next();
    if (!item) return null;
    return /^-(\s|$)/.test(item.text) ? parseSequence(indent) : parseMapping(indent);
  };

  const first = next();
  if (!first) return null;
  if (first.indent !== 0) throw new YamlError(`yaml: line ${first.line}: did not find expected <document start>`);
  const result = parseBlock(0);
  const rest = next();
  if (rest) throw new YamlError(`yaml: line ${rest.line}: did not find expected <document start>`);
  return result;
}

// --- вывод: docker compose config ---

const plain = (value) => /^[A-Za-z0-9_./@-][A-Za-z0-9_./@: -]*$/.test(value) && !/: |:$|^(true|false|null|yes|no|on|off|~)$/i.test(value)
  && !/^[\d.]+$/.test(value) && !/\s$/.test(value);

function quote(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === '') return '""';
  return plain(value) ? value : JSON.stringify(value);
}

/** Объект → YAML как печатает compose (отступ 2, списки «- » на уровне ключа + 2). */
export function dumpYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return ' []\n';
    return `\n${value.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const inner = dumpYaml(item, indent + 2).replace(/^\n/, '');
        return `${pad}- ${inner.slice(indent + 2)}`;
      }
      return `${pad}- ${quote(item)}\n`;
    }).join('')}`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (!entries.length) return ' {}\n';
    return `\n${entries.map(([key, item]) => {
      if (item && typeof item === 'object') return `${pad}${key}:${dumpYaml(item, indent + 2)}`;
      return `${pad}${key}: ${quote(item)}\n`;
    }).join('')}`;
  }
  return ` ${quote(value)}\n`;
}
