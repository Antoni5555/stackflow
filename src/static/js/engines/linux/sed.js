// sed — потоковый редактор, как GNU sed 4.9 в Ubuntu 24.04 (сообщения об ошибках — дословно).
// Поддержано: команды s, d, p, q, Q, =, a, i, c; адреса N, $, /re/, \%re%, диапазоны, «!»;
// флаги -n, -e, -i[СУФФИКС], -E/-r, -s. Остальные команды (y, {…}, h, N…) — понятный отказ.

import { FsError } from './fs.js';

const fail = (err, code = 1) => ({ out: '', err, code });

const USAGE = 'Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n';

/** Ошибка в сценарии: «sed: -e expression #1, char 5: unterminated `s' command». */
class ScriptError extends Error {
  constructor(message, pos) {
    super(message);
    this.pos = pos;
  }
}

// --- регулярные выражения: POSIX (BRE/ERE) → JavaScript ---

const CLASSES = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v', blank: ' \\t', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f',
};

const escapeRe = (ch) => ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Конец скобочного выражения [...], начиная с «[» на позиции i; -1 — не закрыто. */
function bracketEnd(text, i) {
  let j = i + 1;
  if (text[j] === '^') j += 1;
  if (text[j] === ']') j += 1;
  while (j < text.length) {
    if (text[j] === '[' && /[:.=]/.test(text[j + 1] ?? '')) {
      const close = text.indexOf(`${text[j + 1]}]`, j + 2);
      if (close === -1) return -1;
      j = close + 2;
      continue;
    }
    if (text[j] === ']') return j;
    j += 1;
  }
  return -1;
}

/** [...] из POSIX в JS: [[:digit:]] → [0-9], обратная косая внутри — буквально (кроме \n, \t). */
function convertBracket(body) {
  let out = '[';
  let i = 1;
  if (body[i] === '^') {
    out += '^';
    i += 1;
  }
  if (body[i] === ']') {
    out += '\\]';
    i += 1;
  }
  while (i < body.length - 1) {
    const ch = body[i];
    const cls = /^\[:(\w+):\]/.exec(body.slice(i));
    if (cls) {
      out += CLASSES[cls[1]] ?? '';
      i += cls[0].length;
    } else if (ch === '\\' && /[nt]/.test(body[i + 1] ?? '')) {
      out += `\\${body[i + 1]}`;
      i += 2;
    } else {
      out += ch === '\\' || ch === '[' ? `\\${ch}` : ch;
      i += 1;
    }
  }
  return `${out}]`;
}

/** Шаблон sed → исходник RegExp. extended — ERE (-E), delim — разделитель (\delim — буквально). */
function toJsRegex(pattern, extended, delim) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '[') {
      const end = bracketEnd(pattern, i);
      out += convertBracket(pattern.slice(i, end + 1));
      i = end;
    } else if (ch === '\\') {
      const next = pattern[i + 1] ?? '';
      i += 1;
      if (next === delim) out += escapeRe(next);
      else if (next === '<' || next === '>') out += '\\b';
      else if (next === 'n') out += '\\n';
      else if (next === 't') out += '\\t';
      else if (!extended && '(){}+?|'.includes(next)) out += next;
      else if (/[1-9]/.test(next) || /[wWsSbB.*[\]^$\\/]/.test(next) || (extended && '(){}+?|'.includes(next))) {
        out += `\\${next}`;
      } else out += escapeRe(next);
    } else if (!extended && '(){}+?|'.includes(ch)) {
      out += `\\${ch}`;
    } else if (!extended && ch === '*' && (out === '' || out === '^')) {
      out += '\\*';                                 // «*» в начале BRE — обычный символ
    } else if (ch === '/') {
      out += '\\/';
    } else {
      out += ch;
    }
  }
  return out;
}

/** Ошибка JS-движка → текст как у GNU regex. */
function regexMessage(error) {
  const text = error.message;
  if (/Unterminated group/.test(text)) return 'Unmatched ( or \\(';
  if (/Unmatched '\)'/.test(text)) return 'Unmatched ) or \\)';
  if (/Nothing to repeat/.test(text)) return 'Invalid preceding regular expression';
  if (/Invalid escape|\\ at end/.test(text)) return 'Trailing backslash';
  if (/Incomplete quantifier|numbers out of order/.test(text)) return 'Invalid content of \\{\\}';
  return 'Invalid regular expression';
}

// --- разбор сценария ---

/**
 * Сценарий → список команд { addr1, addr2, negate, cmd, … }.
 * Адрес: { line } | { last: true } | { regex }.
 */
class Parser {
  constructor(text, extended) {
    this.text = text;
    this.i = 0;
    this.extended = extended;
  }

  peek() { return this.text[this.i]; }

  skipSpaces() {
    while (this.i < this.text.length && /[ \t]/.test(this.text[this.i])) this.i += 1;
  }

  error(message, pos = this.i) { throw new ScriptError(message, pos); }

  /** Часть до разделителя delim (с учётом \delim и, в шаблоне, скобок [...]). */
  readPart(delim, isRegex, unterminated) {
    let part = '';
    while (this.i < this.text.length) {
      const ch = this.text[this.i];
      if (ch === '\\') {
        if (this.i + 1 >= this.text.length) break;
        part += ch + this.text[this.i + 1];
        this.i += 2;
        continue;
      }
      if (isRegex && ch === '[') {
        const end = bracketEnd(this.text, this.i);
        if (end === -1) break;
        part += this.text.slice(this.i, end + 1);
        this.i = end + 1;
        continue;
      }
      if (ch === delim) {
        this.i += 1;
        return part;
      }
      if (ch === '\n' && isRegex) break;
      part += ch;
      this.i += 1;
    }
    return this.error(unterminated, this.text.length);
  }

  compile(pattern, delim, flags) {
    if (pattern === '') return null;                // пустой шаблон — последний использованный
    const source = toJsRegex(pattern, this.extended, delim);
    try {
      return new RegExp(source, flags);
    } catch (e) {
      return this.error(regexMessage(e));
    }
  }

  readAddress() {
    const ch = this.peek();
    if (/\d/.test(ch ?? '')) {
      const match = /^\d+/.exec(this.text.slice(this.i));
      this.i += match[0].length;
      const line = Number(match[0]);
      if (line === 0) this.error('invalid usage of line address 0');
      return { line };
    }
    if (ch === '$') {
      this.i += 1;
      return { last: true };
    }
    if (ch === '/' || ch === '\\') {
      let delim = '/';
      if (ch === '\\') {
        this.i += 1;
        delim = this.peek();
      }
      this.i += 1;
      const pattern = this.readPart(delim, true, 'unterminated address regex');
      let flags = '';
      while (/[IM]/.test(this.peek() ?? '')) {
        if (this.peek() === 'I') flags = 'i';
        this.i += 1;
      }
      return { regex: this.compile(pattern, delim, flags) };
    }
    return null;
  }

  /** После команды — только пробелы и ; или конец строки. */
  endCommand() {
    this.skipSpaces();
    const ch = this.peek();
    if (ch === undefined || ch === ';' || ch === '\n') {
      this.i += 1;
      return;
    }
    if (ch === '#') {
      while (this.i < this.text.length && this.text[this.i] !== '\n') this.i += 1;
      return;
    }
    this.error('extra characters after command', this.i + 1);
  }

  /** Текст команд a, i, c: «a текст» или «a\» + перевод строки + текст. */
  readText(cmd) {
    this.skipSpaces();
    if (this.peek() === '\\') {
      this.i += 1;
      if (this.peek() === '\n') this.i += 1;
      else this.skipSpaces();
    }
    const start = this.i;
    while (this.i < this.text.length && this.text[this.i] !== '\n') this.i += 1;
    const text = this.text.slice(start, this.i).replace(/\\(.)/g, '$1');
    if (this.i === start && this.i >= this.text.length && cmd) {
      this.error("expected \\ after `a', `c' or `i'", start);
    }
    this.i += 1;
    return text;
  }

  readSubstitute(command) {
    const delim = this.peek();
    if (delim === undefined || delim === '\n' || delim === '\\') {
      this.error("unterminated `s' command", this.i);
    }
    this.i += 1;
    const pattern = this.readPart(delim, true, "unterminated `s' command");
    const replacement = this.readPart(delim, false, "unterminated `s' command");
    let global = false;
    let nth = 1;
    let print = false;
    let flags = '';
    while (this.i < this.text.length) {
      const ch = this.peek();
      if (ch === 'g') global = true;
      else if (ch === 'p') print = true;
      else if (ch === 'i' || ch === 'I') flags = 'i';
      else if (/\d/.test(ch)) {
        const match = /^\d+/.exec(this.text.slice(this.i));
        nth = Number(match[0]);
        if (nth === 0) this.error("number option to `s' command may not be zero", this.i + 1);
        this.i += match[0].length;
        continue;
      } else if (ch === 'w' || ch === 'e' || ch === 'm' || ch === 'M') {
        throw new ScriptError(`флаг ${ch} у команды s в тренажёре не поддерживается`, null);
      } else if (/[ \t;\n#}]/.test(ch)) break;
      else this.error("unknown option to `s'", this.i + 1);
      this.i += 1;
    }
    const regex = this.compile(pattern, delim, flags);
    const groups = regex ? new RegExp(`${regex.source}|`).exec('').length - 1 : 9;
    const ref = /\\([1-9])/g;
    for (const [, digit] of replacement.matchAll(ref)) {
      if (Number(digit) > groups) {
        this.error(`invalid reference \\${digit} on \`s' command's RHS`, this.i);
      }
    }
    Object.assign(command, {
      regex, flags, replacement: parseReplacement(replacement, delim), global, nth, print,
    });
    this.endCommand();
  }

  parse() {
    const commands = [];
    while (this.i < this.text.length) {
      while (/[ \t\n;]/.test(this.peek() ?? '')) this.i += 1;
      if (this.i >= this.text.length) break;
      if (this.peek() === '#') {
        while (this.i < this.text.length && this.text[this.i] !== '\n') this.i += 1;
        continue;
      }
      const command = { addr1: this.readAddress(), addr2: null, negate: false };
      if (command.addr1 && this.peek() === ',') {
        this.i += 1;
        this.skipSpaces();
        command.addr2 = this.readAddress();
        if (!command.addr2) this.error("unexpected `,'");
      }
      this.skipSpaces();
      if (this.peek() === '!') {
        command.negate = true;
        this.i += 1;
        this.skipSpaces();
      }
      const cmd = this.peek();
      if (cmd === undefined || cmd === '\n' || cmd === ';') this.error('missing command');
      this.i += 1;
      command.cmd = cmd;
      if ('dp='.includes(cmd)) {
        this.endCommand();
      } else if (cmd === 'q' || cmd === 'Q') {
        this.skipSpaces();
        const match = /^\d+/.exec(this.text.slice(this.i));
        command.exit = match ? Number(match[0]) : 0;
        if (match) this.i += match[0].length;
        this.endCommand();
      } else if (cmd === 'a' || cmd === 'i' || cmd === 'c') {
        command.text = this.readText(cmd);
      } else if (cmd === 's') {
        this.readSubstitute(command);
      } else if ('yhHgGxnNDPbtTlrRwWvzeFL{}:'.includes(cmd)) {
        throw new ScriptError(`команда «${cmd}» в тренажёре не поддерживается (есть s, d, p, q, =, a, i, c)`, null);
      } else {
        this.error(`unknown command: \`${cmd}'`);
      }
      commands.push(command);
    }
    return commands;
  }
}

/** Замена → список частей: строка, { group: N } (0 — всё совпадение, &). */
function parseReplacement(text, delim) {
  const parts = [];
  let literal = '';
  const flush = () => {
    if (literal) parts.push(literal);
    literal = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '&') {
      flush();
      parts.push({ group: 0 });
    } else if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      i += 1;
      if (/[1-9]/.test(next)) {
        flush();
        parts.push({ group: Number(next) });
      } else if (next === 'n') literal += '\n';
      else if (next === 't') literal += '\t';
      else literal += next;                         // \& \\ \/ \delim — сам символ
    } else {
      literal += ch;
    }
  }
  flush();
  return parts;
}

// --- выполнение ---

/** Адрес совпал со строкой? */
function matchAddress(addr, line, ctx) {
  if (addr.line !== undefined) return ctx.number === addr.line;
  if (addr.last) return ctx.isLast;
  const regex = addr.regex ?? ctx.lastRegex;
  if (!regex) throw new ScriptError('no previous regular expression', null);
  ctx.lastRegex = regex;
  regex.lastIndex = 0;
  return regex.test(line);
}

/** Выбрана ли строка командой (диапазон помнит состояние в command.active). */
function selected(command, line, ctx) {
  const { addr1, addr2 } = command;
  if (!addr1) return true;
  if (!addr2) return matchAddress(addr1, line, ctx);
  if (command.active) {
    // Конец диапазона: номер — до него включительно; шаблон — проверяется со следующей строки
    if (addr2.line !== undefined) {
      if (ctx.number >= addr2.line) command.active = false;
      return true;
    }
    if (matchAddress(addr2, line, ctx)) command.active = false;
    return true;
  }
  if (!matchAddress(addr1, line, ctx)) return false;
  command.start = ctx.number;
  if (addr2.line !== undefined) command.active = addr2.line > ctx.number;
  else if (addr2.last) command.active = !ctx.isLast;
  else command.active = true;
  return true;
}

function substitute(command, line, ctx) {
  const regex = command.regex ?? ctx.lastRegex;
  if (!regex) throw new ScriptError('no previous regular expression', null);
  ctx.lastRegex = regex;
  const search = new RegExp(regex.source, `${regex.flags.replace('g', '')}g`);
  let count = 0;
  let changed = false;
  const result = line.replace(search, (...args) => {
    count += 1;
    const match = args[0];
    if (count < command.nth || (count > command.nth && !command.global)) return match;
    changed = true;
    return command.replacement.map((part) => (
      typeof part === 'string' ? part : (part.group === 0 ? match : args[part.group] ?? '')
    )).join('');
  });
  return { result, changed };
}

/**
 * Прогнать сценарий по тексту одного потока. Возвращает { out, quit, code }.
 * state — номер строки и последний шаблон.
 */
function runStream(commands, text, quiet, state) {
  const all = text === '' ? [] : text.split('\n');
  const noFinalNewline = text !== '' && !text.endsWith('\n');
  if (!noFinalNewline) all.pop();
  let out = '';
  let pending = false;                              // последняя строка была без \n
  for (const command of commands) command.active = false;
  const write = (chunk) => {
    if (pending) out += '\n';
    pending = false;
    out += chunk;
  };
  const writeLine = (line, isLastInput) => {
    if (isLastInput && noFinalNewline) {
      write(line);
      pending = true;
    } else write(`${line}\n`);
  };
  for (let index = 0; index < all.length; index += 1) {
    state.number += 1;
    const ctx = state;
    ctx.isLast = index === all.length - 1;
    const lastInput = index === all.length - 1;
    let line = all[index];
    let deleted = false;
    let quit = null;
    const append = [];
    for (const command of commands) {
      if (selected(command, line, ctx) === command.negate) continue;
      const { cmd } = command;
      if (cmd === 's') {
        const { result, changed } = substitute(command, line, ctx);
        line = result;
        if (changed && command.print) writeLine(line, false);
      } else if (cmd === 'd') {
        deleted = true;
        break;
      } else if (cmd === 'p') {
        writeLine(line, false);
      } else if (cmd === '=') {
        write(`${ctx.number}\n`);
      } else if (cmd === 'a') {
        append.push(command.text);
      } else if (cmd === 'i') {
        write(`${command.text}\n`);
      } else if (cmd === 'c') {
        // В диапазоне текст печатается один раз — в конце диапазона
        if (!command.addr2 || command.negate || !command.active) write(`${command.text}\n`);
        deleted = true;
        break;
      } else if (cmd === 'q') {
        quit = { code: command.exit, print: true };
        break;
      } else if (cmd === 'Q') {
        quit = { code: command.exit, print: false };
        deleted = true;
        break;
      }
    }
    if (!deleted && !quiet && (quit === null || quit.print)) writeLine(line, lastInput);
    for (const item of append) write(`${item}\n`);
    if (quit) return { out, quit: true, code: quit.code };
  }
  return { out, quit: false, code: 0 };
}

// --- команда ---

/** Флаги sed: { quiet, extended, separate, inPlace, suffix, scripts, files } или { error }. */
function parseArgs(args) {
  const opts = { scripts: [], files: [], inPlace: false, suffix: '' };
  const usageError = (text) => ({ error: fail(`${text}${USAGE}`, 1) });
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      opts.files.push(...args.slice(i + 1));
      break;
    }
    if (arg === '-n' || arg === '--quiet' || arg === '--silent') opts.quiet = true;
    else if (arg === '-E' || arg === '-r' || arg === '--regexp-extended') opts.extended = true;
    else if (arg === '-s' || arg === '--separate') opts.separate = true;
    else if (arg.startsWith('--expression=')) opts.scripts.push(arg.slice(13));
    else if (arg === '--in-place' || arg.startsWith('--in-place=')) {
      opts.inPlace = true;
      opts.suffix = arg.slice(11);
    } else if (arg.startsWith('--')) {
      return usageError(`sed: unrecognized option '${arg}'\n`);
    } else if (arg.startsWith('-') && arg !== '-') {
      for (let j = 1; j < arg.length; j += 1) {
        const ch = arg[j];
        if (ch === 'n') opts.quiet = true;
        else if (ch === 'E' || ch === 'r') opts.extended = true;
        else if (ch === 's') opts.separate = true;
        else if (ch === 'i') {
          opts.inPlace = true;
          opts.suffix = arg.slice(j + 1);
          break;
        } else if (ch === 'e') {
          const value = arg.slice(j + 1) || args[i + 1];
          if (value === undefined) return usageError("sed: option requires an argument -- 'e'\n");
          opts.scripts.push(value);
          if (!arg.slice(j + 1)) i += 1;
          break;
        } else if (ch === 'f') {
          return { error: fail('sed: сценарий из файла (-f) в тренажёре не поддерживается — пишите его в кавычках\n') };
        } else {
          return usageError(`sed: invalid option -- '${ch}'\n`);
        }
      }
    } else {
      opts.files.push(arg);
    }
  }
  if (!opts.scripts.length) {
    if (!opts.files.length) return { error: fail(USAGE, 1) };
    opts.scripts.push(opts.files.shift());
  }
  return { opts };
}

/** Имя временного файла sed -i — в настоящем sed случайное. */
const TEMP_NAME = 'sedK3x9Qa';

export const sed = {
  help: `sed [флаги] 'сценарий' [файл…] — потоковый редактор: правит текст по правилам.
  -n   не печатать строки сами (только то, что выведет p)
  -i   править файл на месте (-i.bak — сохранить копию в файл.bak)
  -E   расширенные регулярные выражения: ( ) + ? | без обратной косой
  -e   ещё один сценарий (можно несколько)
Команды: s/было/стало/[g] — замена (g — все в строке), d — удалить строку,
  p — напечатать, q — выйти, = — номер строки, a/i/c текст — добавить после/перед/вместо.
Адрес перед командой: 3 — строка 3, $ — последняя, /шаблон/ — строки с шаблоном,
  2,5 — диапазон, ! — все, кроме.
Примеры: sed 's/DEBUG=True/DEBUG=False/' .env
         sed -i 's/8000/8001/g' config.ini
         sed -n '2,4p' orders.csv
         sed '/^#/d' nginx.conf`,
  run(ctx) {
    const parsed = parseArgs(ctx.args);
    if (parsed.error) return parsed.error;
    const { opts } = parsed;
    let commands = [];
    for (const [index, script] of opts.scripts.entries()) {
      try {
        commands = commands.concat(new Parser(script, opts.extended).parse());
      } catch (e) {
        if (!(e instanceof ScriptError)) throw e;
        if (e.pos === null) return fail(`sed: ${e.message}\n`);
        return fail(`sed: -e expression #${index + 1}, char ${e.pos}: ${e.message}\n`);
      }
    }
    try {
      return opts.inPlace ? inPlace(ctx, commands, opts) : stream(ctx, commands, opts);
    } catch (e) {
      if (!(e instanceof ScriptError)) throw e;
      return fail(`sed: ${e.message}\n`, 4);
    }
  },
};

const freshState = () => ({ number: 0, lastRegex: null });

/** Обычный режим: все файлы — один поток (с -s — каждый отдельно), результат — на экран. */
function stream(ctx, commands, opts) {
  const files = opts.files.length ? opts.files : ['-'];
  const inputs = [];
  let err = '';
  let code = 0;
  for (const path of files) {
    try {
      if (path === '-') inputs.push(ctx.stdin);
      else {
        const node = ctx.fs.lookup(ctx.sh.resolve(path));
        if (node.type === 'dir') {
          err += `sed: read error on ${path}: Is a directory\n`;
          code = 4;
          continue;
        }
        inputs.push(ctx.fs.readFile(ctx.sh.resolve(path)));
      }
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      err += `sed: can't read ${path}: ${e.message}\n`;
      code = 2;
    }
  }
  let out = '';
  if (opts.separate) {
    for (const text of inputs) {
      const result = runStream(commands, text, opts.quiet, freshState());
      out += result.out;
      if (result.quit) return { out, err, code: result.code };
    }
  } else {
    // Склейка файлов в один поток; файл без \n в конце склеивается со следующим, как в sed
    const joined = inputs.reduce((all, text) => (
      all && !all.endsWith('\n') && text ? `${all}\n${text}` : all + text
    ), '');
    const result = runStream(commands, joined, opts.quiet, freshState());
    out = result.out;
    if (result.quit) return { out, err, code: result.code || code };
  }
  return { out, err, code };
}

/** sed -i: каждый файл — отдельный поток, вывод — обратно в файл. */
function inPlace(ctx, commands, opts) {
  if (!opts.files.length) return fail('sed: no input files\n', 1);
  let err = '';
  let code = 0;
  const { fs } = ctx;
  for (const path of opts.files) {
    const abs = ctx.sh.resolve(path);
    let node;
    let text;
    try {
      node = fs.lookup(abs);
      if (node.type !== 'file' || node.special) {
        err += `sed: couldn't edit ${path}: not a regular file\n`;
        code = 4;
        continue;
      }
      text = fs.readFile(abs);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      err += `sed: can't read ${path}: ${e.message}\n`;
      code = 2;
      continue;
    }
    // Настоящий sed пишет во временный файл рядом и переименовывает — нужна запись в папку
    const { parent } = fs.parentOf(abs);
    if (!fs.can(parent, 'w') || !fs.can(parent, 'x')) {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : './';
      err += `sed: couldn't open temporary file ${dir}${TEMP_NAME}: Permission denied\n`;
      return { out: '', err, code: 4 };
    }
    const result = runStream(commands, text, opts.quiet, freshState());
    if (opts.suffix) {
      const backup = fs.clone(node);
      if (fs.user === 'root') Object.assign(backup, { owner: node.owner, group: node.group });
      backup.mtime = node.mtime;
      fs.attach(`${abs}${opts.suffix}`, backup);
    }
    // Новый файл: владелец — тот, кто запустил sed (root сохраняет прежнего), права — прежние
    if (fs.user !== 'root' && node.owner !== fs.user) fs.attach(abs, fs.clone(node));
    fs.as('root', () => fs.writeFile(abs, result.out));
    if (result.quit) return { out: '', err, code: result.code || code };
  }
  return { out: '', err, code };
}
