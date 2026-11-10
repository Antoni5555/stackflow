// Shell Linux-симулятора: разбор строки (кавычки, переменные, *, |, >, >>, 2>, 2>&1, <,
// &&, ||, ;) и выполнение команд над виртуальной ФС. Похож на bash, но без if/for.
// run(line) → { chunks: [{text, err}], action? } — вывод для терминала и просьба к
// интерфейсу (clear — очистить экран, edit — открыть nano).

import { COMMANDS } from './commands.js';
import { FsError, HOME, VirtualFS, normalize } from './fs.js';
import { globToRegExp, hasGlob } from './glob.js';

const OPERATORS = ['&&', '||', '2>&1', '2>>', '2>', '>>', '>', '<', '|', ';'];
const MAX_SCRIPT_DEPTH = 10;

// --- разбор строки ---

/**
 * Строка → токены: {op} или {word: [{text, quote}]}; quote — '', "'" или '"'.
 * Части слова в кавычках не раскрываются как * и (в одинарных) как $.
 */
export function tokenize(line) {
  const tokens = [];
  let word = null;
  let i = 0;
  const push = (text, quote) => {
    word ??= [];
    word.push({ text, quote });
  };
  const end = () => {
    if (word) tokens.push({ word });
    word = null;
  };
  while (i < line.length) {
    const ch = line[i];
    if (ch === '#' && !word) break;                       // комментарий до конца строки
    if (/\s/.test(ch)) {
      end();
      i += 1;
      continue;
    }
    // «2>» — оператор, только если 2 стоит отдельным словом
    const op = OPERATORS.find((item) => line.startsWith(item, i)
      && (!item.startsWith('2') || !word));
    if (op) {
      end();
      tokens.push({ op });
      i += op.length;
      continue;
    }
    if (ch === "'") {
      const close = line.indexOf("'", i + 1);
      if (close === -1) throw new SyntaxError("unexpected EOF while looking for matching `''");
      push(line.slice(i + 1, close), "'");
      i = close + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let text = '';
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\' && '"\\$`'.includes(line[j + 1])) j += 1;
        text += line[j];
        j += 1;
      }
      if (j >= line.length) throw new SyntaxError('unexpected EOF while looking for matching `"\'');
      push(text, '"');
      i = j + 1;
      continue;
    }
    if (ch === '\\' && i + 1 < line.length) {
      push(line[i + 1], "'");
      i += 2;
      continue;
    }
    let j = i;
    while (j < line.length && !/[\s'"\\]/.test(line[j])
      && !OPERATORS.some((item) => !item.startsWith('2') && line.startsWith(item, j))) {
      j += 1;
    }
    push(line.slice(i, j), '');
    i = j;
  }
  end();
  return tokens;
}

/**
 * Токены → список [{pipeline, next}]: next — '&&', '||', ';' или null.
 * Ступень конвейера: {words, redirects: [{op, target}]}.
 */
export function parse(tokens) {
  const list = [];
  let pipeline = [];
  let stage = { words: [], redirects: [] };
  const finishStage = () => {
    if (!stage.words.length && !stage.redirects.length) {
      throw new SyntaxError('syntax error near unexpected token');
    }
    pipeline.push(stage);
    stage = { words: [], redirects: [] };
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.word) {
      stage.words.push(token.word);
    } else if (token.op === '2>&1') {
      stage.redirects.push({ op: '2>&1' });
    } else if (['>', '>>', '2>', '2>>', '<'].includes(token.op)) {
      const target = tokens[i + 1];
      if (!target?.word) throw new SyntaxError("syntax error near unexpected token `newline'");
      stage.redirects.push({ op: token.op, target: target.word });
      i += 1;
    } else if (token.op === '|') {
      finishStage();
    } else {
      finishStage();
      list.push({ pipeline, next: token.op });
      pipeline = [];
    }
  }
  // «ls |» или «make &&» — bash ждал бы продолжения; у нас одна строка — это ошибка
  const last = tokens[tokens.length - 1];
  if (last?.op && ['|', '&&', '||'].includes(last.op)) {
    throw new SyntaxError('syntax error: unexpected end of file');
  }
  if (stage.words.length || stage.redirects.length) finishStage();
  if (pipeline.length) list.push({ pipeline, next: null });
  return list;
}

// --- shell ---

export class Shell {
  constructor(fs = new VirtualFS(), { cwd = HOME, env = {}, args = [], depth = 0 } = {}) {
    this.fs = fs;
    this.cwd = cwd;
    this.env = {
      HOME, USER: 'shop', SHELL: '/bin/bash', LANG: 'C.UTF-8',
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      ...env,
    };
    this.args = args;              // $0, $1… для скрипта
    this.depth = depth;
    this.status = 0;               // код выхода последней команды — $?
    this.history = [];
    this.lastOutput = '';          // вывод последней команды — для правила output_matches
  }

  get user() {
    return this.fs.user;
  }

  /** Приглашение: shop@server:~/shop$ (у root — #). */
  prompt() {
    const home = this.user === 'root' ? '/root' : HOME;
    let where = this.cwd;
    if (where === home) where = '~';
    else if (where.startsWith(`${home}/`)) where = `~${where.slice(home.length)}`;
    return `${this.user}@server:${where}${this.user === 'root' ? '#' : '$'} `;
  }

  /** Абсолютный путь от текущей папки. */
  resolve(path) {
    return normalize(path, this.cwd);
  }

  // --- раскрытие слов ---

  expandVars(text) {
    return text.replace(/\$(\?|[0-9]|\{[A-Za-z_]\w*\}|[A-Za-z_]\w*)/g, (_, name) => {
      const key = name.replace(/[{}]/g, '');
      if (key === '?') return String(this.status);
      if (/^\d$/.test(key)) return this.args[Number(key)] ?? '';
      if (key === 'PWD') return this.cwd;
      return this.env[key] ?? '';
    });
  }

  /** Части слова → строка (переменные, ~) и, если есть * без кавычек, список файлов. */
  expandWord(parts) {
    let text = '';
    let pattern = '';
    parts.forEach((part, index) => {
      let value = part.quote === "'" ? part.text : this.expandVars(part.text);
      if (index === 0 && !part.quote && /^~(\/|$)/.test(value)) {
        value = this.env.HOME + value.slice(1);
      }
      text += value;
      pattern += part.quote ? [...value].map((ch) => `\u0000${ch}`).join('') : value;
    });
    if (!hasGlob(parts)) return [text];
    const matches = this.glob(pattern);
    return matches.length ? matches : [text];
  }

  /** Раскрыть шаблон пути: каждая часть с * ищется в своей папке. */
  glob(pattern) {
    const absolute = pattern.startsWith('/');
    const segments = pattern.split('/').filter(Boolean);
    let results = [absolute ? '/' : ''];
    for (const segment of segments) {
      const next = [];
      for (const prefix of results) {
        const dir = prefix ? this.resolve(prefix) : this.cwd;
        if (!/[*?[]/.test(segment.replace(/\u0000./g, ''))) {
          const name = segment.replace(/\u0000/g, '');
          next.push(prefix === '/' ? `/${name}` : prefix ? `${prefix}/${name}` : name);
          continue;
        }
        let entries = [];
        try {
          entries = this.fs.list(dir);
        } catch (e) {
          continue;
        }
        const regex = globToRegExp(segment);
        for (const [name] of entries) {
          if (name.startsWith('.') && !segment.startsWith('.')) continue;   // * не берёт скрытые
          if (regex.test(name)) next.push(prefix === '/' ? `/${name}` : prefix ? `${prefix}/${name}` : name);
        }
      }
      results = next;
    }
    return results.filter((path) => this.fs.exists(this.resolve(path))).sort();
  }

  // --- выполнение ---

  /** Выполнить строку. Возвращает {chunks, action}. */
  run(line) {
    const chunks = [];
    let action = null;
    if (line.trim() && this.depth === 0) this.history.push(line);
    let list;
    try {
      list = parse(tokenize(line));
    } catch (e) {
      this.status = 2;
      return { chunks: [{ text: `bash: ${e.message}\n`, err: true }], action };
    }
    let output = '';
    for (const [index, { pipeline }] of list.entries()) {
      const previous = list[index - 1]?.next;
      if (previous === '&&' && this.status !== 0) continue;
      if (previous === '||' && this.status === 0) continue;
      const result = this.runPipeline(pipeline);
      chunks.push(...result.chunks);
      output += result.chunks.filter((chunk) => !chunk.err).map((chunk) => chunk.text).join('');
      action = result.action ?? action;
    }
    this.lastOutput = output;
    return { chunks, action };
  }

  runPipeline(stages) {
    const chunks = [];
    let stdin = '';
    let action = null;
    stages.forEach((stage, index) => {
      const last = index === stages.length - 1;
      const result = this.runStage(stage, stdin, { piped: !last });
      action = result.action ?? action;
      if (result.err) chunks.push({ text: result.err, err: true });
      if (last) {
        if (result.out) chunks.push({ text: result.out, err: false });
      } else {
        stdin = result.out;
      }
    });
    return { chunks, action };
  }

  /**
   * Одна команда с перенаправлениями. Возвращает {out, err, action}: out — то, что
   * не ушло в файл (в терминал или следующей команде), err — то же для ошибок.
   */
  runStage(stage, stdin, { piped }) {
    let words;
    let redirects;
    try {
      words = stage.words.flatMap((word) => this.expandWord(word));
      redirects = stage.redirects.map((item) => ({
        op: item.op, target: item.target && this.expandWord(item.target).join(' '),
      }));
    } catch (e) {
      this.status = 1;
      return { out: '', err: `bash: ${e.message}\n` };
    }

    // Ввод из файла: cmd < file
    for (const item of redirects.filter((r) => r.op === '<')) {
      try {
        stdin = this.fs.readFile(this.resolve(item.target));
      } catch (e) {
        this.status = 1;
        return { out: '', err: `bash: ${item.target}: ${e.message}\n` };
      }
    }

    // Куда идёт вывод: проверяем файлы до запуска команды (bash создаёт их сразу)
    const outFile = redirects.filter((r) => r.op === '>' || r.op === '>>').pop();
    const errFile = redirects.filter((r) => r.op === '2>' || r.op === '2>>').pop();
    const errToOut = redirects.some((r) => r.op === '2>&1');
    for (const item of [outFile, errFile].filter(Boolean)) {
      try {
        this.fs.writeFile(this.resolve(item.target), '', { append: true });
        if (item.op === '>' || item.op === '2>') this.fs.writeFile(this.resolve(item.target), '');
      } catch (e) {
        this.status = 1;
        return { out: '', err: `bash: ${item.target}: ${e.message}\n` };
      }
    }

    const result = words.length
      ? this.exec(words, stdin, { tty: !piped && !outFile })
      : { out: '', err: '', code: 0 };
    this.status = result.code;

    let { out, err } = result;
    if (errToOut) {
      out += err;
      err = '';
    }
    if (outFile) {
      this.fs.writeFile(this.resolve(outFile.target), out, { append: true });
      out = '';
    }
    if (errFile) {
      this.fs.writeFile(this.resolve(errFile.target), err, { append: true });
      err = '';
    }
    return { out, err, action: result.action };
  }

  /** Запуск команды по словам: присваивание, встроенная, скрипт или «command not found». */
  exec(words, stdin = '', { tty = true } = {}) {
    const [name, ...args] = words;

    // NAME=value — переменная оболочки
    if (/^[A-Za-z_]\w*=/.test(name) && args.length === 0) {
      const eq = name.indexOf('=');
      this.env[name.slice(0, eq)] = name.slice(eq + 1);
      return { out: '', err: '', code: 0 };
    }

    // ./script.sh, /srv/shop/backup.sh — запуск файла
    if (name.includes('/')) return this.runFile(name, args);

    const command = COMMANDS[name];
    if (!command) {
      return { out: '', err: `${name}: command not found\n`, code: 127 };
    }
    if (args.includes('--help') && command.help) {
      return { out: `${command.help.trim()}\n`, err: '', code: 0 };
    }
    try {
      const result = command.run({ sh: this, fs: this.fs, args, stdin, tty, name }) ?? {};
      return { out: result.out ?? '', err: result.err ?? '', code: result.code ?? 0, action: result.action };
    } catch (e) {
      if (e instanceof FsError) return { out: '', err: `${name}: ${e.message}\n`, code: 1 };
      throw e;
    }
  }

  /** Выполнить файл как скрипт: нужен доступ x и (для ./) shebang bash/sh. */
  runFile(path, args, { requireExec = true, inPlace = false } = {}) {
    const abs = this.resolve(path);
    let node;
    try {
      node = this.fs.lookup(abs);
    } catch (e) {
      return { out: '', err: `bash: ${path}: ${e.message}\n`, code: 127 };
    }
    if (node.type === 'dir') return { out: '', err: `bash: ${path}: Is a directory\n`, code: 126 };
    if (requireExec && !this.fs.can(node, 'x')) {
      return { out: '', err: `bash: ${path}: Permission denied\n`, code: 126 };
    }
    let text;
    try {
      text = this.fs.readFile(abs);
    } catch (e) {
      return { out: '', err: `bash: ${path}: ${e.message}\n`, code: 126 };
    }
    if (node.binary || node.content === undefined || (node.size && !text)) {
      return { out: '', err: `bash: ${path}: cannot execute binary file\n`, code: 126 };
    }
    if (this.depth >= MAX_SCRIPT_DEPTH) {
      return { out: '', err: `bash: ${path}: слишком глубокий вызов скриптов\n`, code: 1 };
    }
    // Скрипт — в своей оболочке (переменные и cd не меняют текущую); source — в этой же
    const shell = inPlace ? this : new Shell(this.fs, {
      cwd: this.cwd, env: { ...this.env }, args: [path, ...args], depth: this.depth + 1,
    });
    let out = '';
    let err = '';
    for (const line of text.split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const result = shell.run(line);
      for (const chunk of result.chunks) {
        if (chunk.err) err += chunk.text;
        else out += chunk.text;
      }
    }
    return { out, err, code: shell.status };
  }
}
