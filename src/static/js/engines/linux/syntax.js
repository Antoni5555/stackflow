// Разбор команд bash для симулятора: текст → токены → дерево команд.
// Поддержано: кавычки, \, $(…) и `…`, комментарии, | && || ; перевод строки,
// перенаправления > >> 2> 2>> 2>&1 <, ( … ), if/elif/else/fi, for … in …; do … done, «!».
// Ошибки — как в bash 5.2: «syntax error near unexpected token `fi'».

const OPERATORS = ['&&', '||', '2>&1', '2>>', '2>', '>>', '>', '<', '|', ';', '(', ')'];
const REDIRECTS = new Set(['>', '>>', '2>', '2>>', '<', '2>&1']);
const RESERVED = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'do', 'done', '!']);

/** Синтаксическая ошибка; line — номер строки (для скриптов), source — текст этой строки. */
export class ShellSyntaxError extends SyntaxError {
  constructor(message, line = null) {
    super(message);
    this.line = line;
  }
}

/** Конец $(…): индекс после закрывающей скобки (с учётом вложенных скобок и кавычек). */
function substEnd(text, start, line) {
  let depth = 1;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') i += 2;
    else if (ch === "'") {
      const close = text.indexOf("'", i + 1);
      i = close === -1 ? text.length : close + 1;
    } else if (ch === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i += 1;
    } else {
      if (ch === '(') depth += 1;
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
  }
  throw new ShellSyntaxError("unexpected EOF while looking for matching `)'", line);
}

/**
 * Текст → токены: {word: [{text, quote, subst?}], line} | {op, line}.
 * quote — '', "'" или '"'; subst — часть $(…) (text — команда внутри).
 * Перевод строки — оператор '\n'. Возвращает {tokens, lines} (lines — номер строки в конце).
 */
export function tokenize(text) {
  const tokens = [];
  let word = null;
  let i = 0;
  let line = 1;
  const push = (part) => {
    word ??= { word: [], line };
    word.word.push(part);
  };
  const end = () => {
    if (word) tokens.push(word);
    word = null;
  };
  const countLines = (from, to) => {
    for (let k = from; k < to; k += 1) if (text[k] === '\n') line += 1;
  };
  const backquote = (from, quote) => {
    const close = text.indexOf('`', from + 1);
    if (close === -1) throw new ShellSyntaxError('unexpected EOF while looking for matching ``\'', line);
    push({ text: text.slice(from + 1, close), quote, subst: true });
    countLines(from, close);
    return close + 1;
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '\n') {          // перенос длинной команды
      i += 2;
      line += 1;
      continue;
    }
    if (ch === '\n') {
      end();
      tokens.push({ op: '\n', line });
      line += 1;
      i += 1;
      continue;
    }
    if (ch === '#' && !word) {                            // комментарий до конца строки
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      end();
      i += 1;
      continue;
    }
    if (text.startsWith('$(', i)) {
      const close = substEnd(text, i + 2, line);
      push({ text: text.slice(i + 2, close - 1), quote: '', subst: true });
      countLines(i, close);
      i = close;
      continue;
    }
    if (ch === '`') {
      i = backquote(i, '');
      continue;
    }
    // «2>» — оператор, только если 2 стоит отдельным словом
    const op = OPERATORS.find((item) => text.startsWith(item, i) && (!item.startsWith('2') || !word));
    if (op) {
      end();
      tokens.push({ op, line });
      i += op.length;
      continue;
    }
    if (ch === "'") {
      const close = text.indexOf("'", i + 1);
      if (close === -1) throw new ShellSyntaxError("unexpected EOF while looking for matching `''", line);
      push({ text: text.slice(i + 1, close), quote: "'" });
      countLines(i, close);
      i = close + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let chunk = '';
      let pushed = false;
      const flush = () => {
        if (chunk) {
          push({ text: chunk, quote: '"' });
          pushed = true;
        }
        chunk = '';
      };
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && '"\\$`'.includes(text[j + 1])) {
          chunk += text[j + 1];
          j += 2;
        } else if (text.startsWith('$(', j)) {
          flush();
          const close = substEnd(text, j + 2, line);
          push({ text: text.slice(j + 2, close - 1), quote: '"', subst: true });
          pushed = true;
          j = close;
        } else if (text[j] === '`') {
          flush();
          j = backquote(j, '"');
          pushed = true;
        } else {
          if (text[j] === '\n') line += 1;
          chunk += text[j];
          j += 1;
        }
      }
      if (j >= text.length) throw new ShellSyntaxError('unexpected EOF while looking for matching `"\'', line);
      flush();
      if (!pushed) push({ text: '', quote: '"' });       // "" — пустое слово, но слово
      i = j + 1;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) {
      push({ text: text[i + 1], quote: "'" });
      i += 2;
      continue;
    }
    let j = i;
    while (j < text.length && !/[\s'"\\`]/.test(text[j]) && !text.startsWith('$(', j)
      && !OPERATORS.some((item) => !item.startsWith('2') && text.startsWith(item, j))) {
      j += 1;
    }
    push({ text: text.slice(i, j), quote: '' });
    i = j;
  }
  end();
  return { tokens, lines: line };
}

/** Слово без кавычек и подстановок — его текст (для ключевых слов и имён), иначе null. */
export function plainWord(token) {
  const parts = token?.word;
  if (!parts || parts.length !== 1 || parts[0].quote || parts[0].subst) return null;
  return parts[0].text;
}

/**
 * Токены → дерево. Узлы:
 *   list: [andOr]; andOr: {first: pipeline, rest: [{op, pipeline}]}
 *   pipeline: {negate, commands: [command]}
 *   command: {type: 'simple', words, redirects, line} | {type: 'if', clauses: [{cond, body}], otherwise}
 *          | {type: 'for', name, words | null, body} | {type: 'subshell', body}
 *   у составных — тоже redirects (for …; done > файл).
 */
export class Parser {
  constructor({ tokens, lines }) {
    this.tokens = tokens;
    this.i = 0;
    this.eofLine = lines;
  }

  peek() { return this.tokens[this.i]; }

  keyword(token = this.peek()) {
    const text = plainWord(token);
    return RESERVED.has(text) ? text : null;
  }

  unexpected(token = this.peek()) {
    if (!token) throw new ShellSyntaxError('syntax error: unexpected end of file', this.eofLine);
    const text = token.op === '\n' ? 'newline' : token.op ?? token.word.map((part) => part.text).join('');
    throw new ShellSyntaxError(`syntax error near unexpected token \`${text}'`, token.line);
  }

  skipNewlines() {
    while (this.peek()?.op === '\n') this.i += 1;
  }

  expect(keyword) {
    if (this.keyword() !== keyword) this.unexpected();
    this.i += 1;
  }

  /** Следующая строка верхнего уровня (до перевода строки) или null в конце текста. */
  parseLine() {
    this.skipNewlines();
    if (!this.peek()) return null;
    const list = this.parseList(new Set(), true);
    const next = this.peek();
    if (next && next.op !== '\n') this.unexpected(next);
    this.i += 1;
    return list;
  }

  /** Весь текст сразу (строка терминала, $(…), bash -c). */
  parseAll() {
    const lists = [];
    for (let list = this.parseLine(); list; list = this.parseLine()) lists.push(list);
    return lists.flat();
  }

  /** Команды до ключевого слова из terminators, «)» или конца (stopAtNewline — до конца строки). */
  parseList(terminators, stopAtNewline = false) {
    const items = [];
    for (;;) {
      if (!stopAtNewline) this.skipNewlines();
      const token = this.peek();
      if (!token || token.op === ')' || terminators.has(this.keyword(token))) break;
      if (stopAtNewline && token.op === '\n') break;
      items.push(this.parseAndOr());
      const next = this.peek();
      if (next?.op === ';') {
        this.i += 1;
        continue;
      }
      if (next?.op === '\n' && !stopAtNewline) continue;
      break;
    }
    if (!items.length) this.unexpected();
    return items;
  }

  parseAndOr() {
    const node = { first: this.parsePipeline(), rest: [] };
    while (['&&', '||'].includes(this.peek()?.op)) {
      const { op } = this.peek();
      this.i += 1;
      this.skipNewlines();
      node.rest.push({ op, pipeline: this.parsePipeline() });
    }
    return node;
  }

  parsePipeline() {
    let negate = false;
    if (this.keyword() === '!') {
      negate = true;
      this.i += 1;
    }
    const commands = [this.parseCommand()];
    while (this.peek()?.op === '|') {
      this.i += 1;
      this.skipNewlines();
      commands.push(this.parseCommand());
    }
    return { negate, commands };
  }

  parseCommand() {
    const token = this.peek();
    if (!token) this.unexpected();
    if (token.op === '(') {
      this.i += 1;
      const body = this.parseList(new Set());
      if (this.peek()?.op !== ')') this.unexpected();
      this.i += 1;
      return this.withRedirects({ type: 'subshell', body, line: token.line });
    }
    const keyword = this.keyword(token);
    if (keyword === 'if') return this.parseIf();
    if (keyword === 'for') return this.parseFor();
    if (keyword || (token.op && !REDIRECTS.has(token.op))) this.unexpected(token);
    const command = { type: 'simple', words: [], redirects: [], line: token.line };
    for (;;) {
      const next = this.peek();
      if (next?.word) {
        command.words.push(next.word);
        this.i += 1;
      } else if (next && REDIRECTS.has(next.op)) {
        this.readRedirect(command);
      } else break;
    }
    return command;
  }

  readRedirect(command) {
    const { op } = this.peek();
    this.i += 1;
    if (op === '2>&1') {
      command.redirects.push({ op });
      return;
    }
    const target = this.peek();
    if (!target?.word) this.unexpected(target);
    command.redirects.push({ op, target: target.word });
    this.i += 1;
  }

  withRedirects(command) {
    command.redirects = [];
    while (REDIRECTS.has(this.peek()?.op)) this.readRedirect(command);
    return command;
  }

  parseIf() {
    const { line } = this.peek();
    this.i += 1;
    const clauses = [];
    let otherwise = null;
    let cond = this.parseList(new Set(['then']));
    this.expect('then');
    clauses.push({ cond, body: this.parseList(new Set(['elif', 'else', 'fi'])) });
    while (this.keyword() === 'elif') {
      this.i += 1;
      cond = this.parseList(new Set(['then']));
      this.expect('then');
      clauses.push({ cond, body: this.parseList(new Set(['elif', 'else', 'fi'])) });
    }
    if (this.keyword() === 'else') {
      this.i += 1;
      otherwise = this.parseList(new Set(['fi']));
    }
    this.expect('fi');
    return this.withRedirects({ type: 'if', clauses, otherwise, line });
  }

  parseFor() {
    const { line } = this.peek();
    this.i += 1;
    const nameToken = this.peek();
    if (!nameToken?.word) this.unexpected(nameToken);
    const name = nameToken.word.map((part) => part.text).join('');
    this.i += 1;
    let words = null;
    this.skipNewlines();
    if (plainWord(this.peek()) === 'in') {
      this.i += 1;
      words = [];
      while (this.peek()?.word) {
        words.push(this.peek().word);
        this.i += 1;
      }
    }
    if (this.peek()?.op === ';' || this.peek()?.op === '\n') this.i += 1;
    else if (words !== null || this.keyword() !== 'do') this.unexpected();
    this.skipNewlines();
    this.expect('do');
    const body = this.parseList(new Set(['done']));
    this.expect('done');
    return this.withRedirects({ type: 'for', name, words, body, line });
  }
}

/** Разобрать весь текст (строка терминала). */
export const parseAll = (text) => new Parser(tokenize(text)).parseAll();
