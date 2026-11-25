// Shell Linux-симулятора: выполнение команд bash над виртуальной ФС — конвейеры,
// перенаправления, && || ;, $(…), if/for, ( … ), exit, скрипты. Разбор текста — syntax.js.
// run(line) → { chunks: [{text, err}], action? } — вывод для терминала и просьба к
// интерфейсу (clear — очистить экран, edit — открыть nano).

import { COMMANDS } from './commands.js';
import { FsError, HOME, VirtualFS, normalize } from './fs.js';
import { globToRegExp } from './glob.js';
import { Parser, ShellSyntaxError, parseAll, tokenize } from './syntax.js';

const MAX_SCRIPT_DEPTH = 10;
const MAX_LOOP = 10000;
const VARIABLE = /\$(\?|#|@|\*|[0-9]|\{[A-Za-z_]\w*\}|[A-Za-z_]\w*)/g;

/** exit N: прерывает скрипт, $(…), ( … ) или bash -c с кодом N. */
export class ExitSignal {
  constructor(code) {
    this.code = code;
  }
}

const outText = (chunks) => chunks.filter((chunk) => !chunk.err).map((chunk) => chunk.text).join('');
const errText = (chunks) => chunks.filter((chunk) => chunk.err).map((chunk) => chunk.text).join('');

// --- shell ---

export class Shell {
  constructor(fs = new VirtualFS(), {
    cwd = HOME, env = {}, args = [], depth = 0, tty = true, machine = null,
  } = {}) {
    this.fs = fs;
    // Машина, где работает оболочка: null — сервер; контейнер Docker —
    // {host, commands (какие команды есть в образе), env (окружение целиком), nested, notFound}
    this.machine = machine;
    // Вывод оболочки идёт в терминал? Нет — у скрипта, чей вывод ушёл в конвейер или файл:
    // тогда и ls внутри скрипта пишет по имени в строке
    this.tty = tty;
    this.cwd = cwd;
    this.env = machine?.env ? { ...env } : {
      HOME, USER: 'shop', SHELL: '/bin/bash', LANG: 'C.UTF-8',
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      ...env,
    };
    this.args = args;              // $0, $1… для скрипта
    this.depth = depth;
    this.status = 0;               // код выхода последней команды — $?
    this.history = [];
    this.lastOutput = '';          // вывод последней команды — для правила output_matches
    this.scriptName = null;        // имя скрипта и номер строки — для ошибок «./a.sh: line 3: …»
    this.line = 0;
    this.action = null;
    this.substErr = '';            // ошибки команд внутри $(…) — выводятся перед ошибками команды
    this.substStatus = null;
    // Вывод, который придёт позже (psql в контейнере — PGlite асинхронный):
    // Promise<{chunks, code}>; терминал дождётся и напечатает
    this.pending = null;
  }



  /** Начало сообщения bash об ошибке: «bash: » в терминале, «./backup.sh: line 3: » в скрипте. */
  errPrefix() {
    return this.scriptName ? `${this.scriptName}: line ${this.line}: ` : 'bash: ';
  }

  /** Оболочка-потомок: свои переменные и папка, общая ФС — для ( … ) и $(…). */
  child({ tty = this.tty } = {}) {
    const sub = new Shell(this.fs, {
      cwd: this.cwd, env: { ...this.env }, args: this.args, depth: this.depth + 1, tty,
      machine: this.inner(),
    });
    Object.assign(sub, { scriptName: this.scriptName, line: this.line, status: this.status });
    return sub;
  }

  get user() {
    return this.fs.user;
  }

  /** Машина для вложенной оболочки ($(…), bash -c, скрипт): та же, но не интерактивная. */
  inner() {
    return this.machine && { ...this.machine, nested: false };
  }

  /** Есть ли команда на этой машине (в контейнере — только то, что есть в образе). */
  hasCommand(name) {
    if (this.machine?.extra?.[name]) return true;
    return name in COMMANDS && (!this.machine?.commands || this.machine.commands.includes(name));
  }

  /** Приглашение: shop@server:~/shop$ (у root — #). */
  prompt() {
    const home = this.user === 'root' ? '/root' : HOME;
    if (this.machine?.prompt) return this.machine.prompt(this);
    // (venv) — активное виртуальное окружение Python (source venv/bin/activate)
    const venv = this.env.VIRTUAL_ENV ? `(${this.env.VIRTUAL_ENV.split('/').pop()}) ` : '';
    let where = this.cwd;
    if (where === home) where = '~';
    else if (where.startsWith(`${home}/`)) where = `~${where.slice(home.length)}`;
    return `${venv}${this.user}@${this.machine?.host ?? 'server'}:${where}${this.user === 'root' ? '#' : '$'} `;
  }

  /**
   * Дополнение по Tab: последнее слово строки — команда (если первое) или путь.
   * Возвращает {line, options}: line — дополненная строка, options — варианты, если их несколько.
   */
  complete(line) {
    const start = Math.max(line.lastIndexOf(' '), line.lastIndexOf('|'), line.lastIndexOf(';')) + 1;
    const head = line.slice(0, start);
    const word = line.slice(start);
    const isCommand = !head.trim() || /(\||&&|;|sudo)\s*$/.test(head.trim());
    let candidates;
    let prefix = '';
    if (isCommand && !word.includes('/')) {
      candidates = Object.keys(COMMANDS)
        .filter((name) => name.startsWith(word) && name !== '.' && this.hasCommand(name))
        .map((name) => [name, ' ']);
    } else {
      const slash = word.lastIndexOf('/');
      prefix = word.slice(0, slash + 1);
      const partial = word.slice(slash + 1);
      const dir = prefix.replace(/^~(?=\/|$)/, this.env.HOME) || '.';
      try {
        candidates = this.fs.list(this.resolve(dir))
          .filter(([name]) => name.startsWith(partial) && (partial.startsWith('.') || !name.startsWith('.')))
          .map(([name, node]) => {
            let isDir = node.type === 'dir';
            if (node.type === 'link') {
              try {
                isDir = this.fs.lookup(this.resolve(`${dir}/${name}`)).type === 'dir';
              } catch (e) {
                isDir = false;
              }
            }
            return [name, isDir ? '/' : ' '];
          });
      } catch (e) {
        candidates = [];
      }
    }
    candidates.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (candidates.length === 1) {
      const [name, suffix] = candidates[0];
      return { line: head + prefix + name + suffix, options: [] };
    }
    if (!candidates.length) return { line, options: [] };
    // общее начало всех вариантов
    let common = candidates[0][0];
    for (const [name] of candidates) {
      while (!name.startsWith(common)) common = common.slice(0, -1);
    }
    const typed = word.slice(prefix.length);
    return {
      line: head + prefix + (common.length > typed.length ? common : typed),
      options: common.length > typed.length ? [] : candidates.map(([name, suffix]) => name + (suffix === '/' ? '/' : '')),
    };
  }

  /** Абсолютный путь от текущей папки. */
  resolve(path) {
    return normalize(path, this.cwd);
  }


  // --- раскрытие слов ---

  expandVars(text) {
    return text.replace(VARIABLE, (_, name) => {
      const key = name.replace(/[{}]/g, '');
      if (key === '?') return String(this.status);
      if (key === '#') return String(Math.max(this.args.length - 1, 0));
      if (key === '@' || key === '*') return this.args.slice(1).join(' ');
      if (/^\d$/.test(key)) return this.args[Number(key)] ?? '';
      if (key === 'PWD') return this.cwd;
      return this.env[key] ?? '';
    });
  }

  /**
   * Части слова → список слов, как в bash: переменные и $(…) без кавычек разбиваются по
   * пробелам и раскрывают *, "$@" — каждый аргумент отдельным словом, "" — пустое слово.
   * split: false — всегда одно слово (NAME=значение, файл перенаправления).
   */
  expandWord(parts, { split = true } = {}) {
    const fields = [];
    let current = null;
    const finish = () => {
      if (current) fields.push(current);
      current = null;
    };
    const add = (text, quoted) => {
      current ??= { text: '', pattern: '', glob: false };
      current.text += text;
      // символ из кавычек в шаблоне помечается \u0000 — * в нём не раскрывается
      current.pattern += quoted ? [...text].map((ch) => `\u0000${ch}`).join('') : text;
      if (!quoted && /[*?[]/.test(text)) current.glob = true;
    };
    const addSplit = (value) => {
      if (!split) {
        add(value, true);
        return;
      }
      value.split(/[ \t\n]+/).forEach((piece, index) => {
        if (index > 0) finish();
        if (piece) add(piece, false);
      });
    };
    parts.forEach((part, index) => {
      if (part.subst) {
        const value = this.substitute(part.text);
        if (part.quote) add(value, true);
        else addSplit(value);
      } else if (part.quote === "'") {
        add(part.text, true);
      } else if (part.quote === '"') {
        const pieces = part.text.split('$@');
        pieces.forEach((piece, k) => {
          if (k > 0) {
            this.args.slice(1).forEach((arg, n) => {
              if (n > 0) finish();
              add(arg, true);
            });
          }
          const value = this.expandVars(piece);
          if (value || pieces.length === 1) add(value, true);
        });
      } else {
        let { text } = part;
        if (index === 0 && /^~(\/|$)/.test(text)) {
          add(this.env.HOME, true);
          text = text.slice(1);
        }
        let last = 0;
        for (const match of text.matchAll(VARIABLE)) {
          if (match.index > last) add(text.slice(last, match.index), !split);
          addSplit(this.expandVars(match[0]));
          last = match.index + match[0].length;
        }
        if (last < text.length) add(text.slice(last), !split);
      }
    });
    finish();
    if (!split) return [fields.map((field) => field.text).join('')];
    return fields.flatMap((field) => {
      if (!field.glob) return [field.text];
      const matches = this.glob(field.pattern);
      return matches.length ? matches : [field.text];
    });
  }

  /** $(…): команда в оболочке-потомке; результат — её вывод без \n в конце. */
  substitute(text) {
    if (this.depth >= MAX_SCRIPT_DEPTH) return '';
    const sub = this.child({ tty: false });
    const chunks = [];
    try {
      sub.execList(parseAll(text), chunks);
    } catch (e) {
      if (e instanceof ShellSyntaxError) {
        chunks.push({ text: `${this.errPrefix()}${e.message}\n`, err: true });
        sub.status = 2;
      } else if (e instanceof ExitSignal) {
        sub.status = e.code;
      } else throw e;
    }
    this.substErr += errText(chunks);
    this.substStatus = sub.status;
    return outText(chunks).replace(/\n+$/, '');
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

  /** Строка терминала: разобрать целиком и выполнить. Возвращает {chunks, action}. */
  run(line) {
    const chunks = [];
    this.action = null;
    this.pending = null;
    if (line.trim() && this.depth === 0) this.history.push(line);
    let list;
    try {
      list = parseAll(line);
    } catch (e) {
      if (!(e instanceof ShellSyntaxError)) throw e;
      this.status = 2;
      return { chunks: [{ text: `bash: ${e.message}\n`, err: true }], action: null };
    }
    try {
      this.execList(list, chunks);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
      this.status = e.code;
      // exit во вложенной оболочке (docker exec -it … bash) — назад в оболочку сервера
      if (this.machine?.nested) return { chunks: [{ text: 'exit\n', err: false }], action: { type: 'leave', code: e.code } };
      // настоящий терминал закрылся бы
      if (this.depth === 0) chunks.push({ text: 'exit\n(в тренажёре терминал не закрывается)\n', err: false });
    }
    this.lastOutput = outText(chunks);
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      return {
        chunks,
        action: this.action,
        pending: pending.then((done) => {
          this.status = done.code;
          this.lastOutput += outText(done.chunks);
          return done;
        }),
      };
    }
    return { chunks, action: this.action };
  }

  /**
   * Скрипт: как bash, читает и выполняет по одной строке (if/for — целиком), поэтому
   * строки до синтаксической ошибки успевают выполниться. Возвращает chunks.
   */
  runScript(text, name) {
    const chunks = [];
    const savedName = this.scriptName;
    this.scriptName = name;
    try {
      const parser = new Parser(tokenize(text));
      for (let list = parser.parseLine(); list; list = parser.parseLine()) this.execList(list, chunks);
    } catch (e) {
      if (e instanceof ShellSyntaxError) {
        this.status = 2;
        let message = `${name}: line ${e.line}: ${e.message}\n`;
        if (e.message.startsWith('syntax error near')) {
          message += `${name}: line ${e.line}: \`${text.split('\n')[e.line - 1].trim()}'\n`;
        }
        chunks.push({ text: message, err: true });
      } else if (e instanceof ExitSignal) {
        this.status = e.code;
      } else throw e;
    } finally {
      this.scriptName = savedName;
    }
    return chunks;
  }

  execList(items, chunks) {
    for (const item of items) this.execAndOr(item, chunks);
    return this.status;
  }

  /** a && b || c — слева направо по коду выхода последней выполненной. */
  execAndOr(node, chunks) {
    this.execPipeline(node.first, chunks);
    for (const { op, pipeline } of node.rest) {
      if ((op === '&&') === (this.status === 0)) this.execPipeline(pipeline, chunks);
    }
  }

  execPipeline({ negate, commands }, chunks) {
    // команды конвейера работают одновременно: ps видит и grep из «ps aux | grep nginx»
    this.pipeline = commands.map((command) => (command.type === 'simple'
      ? command.words.map((word) => word.map((part) => part.text).join(''))
      : ['bash']));
    if (commands.length === 1) {
      this.stageIndex = 0;
      this.runCommand(commands[0], '', chunks, { piped: false });
    } else {
      let stdin = '';
      commands.forEach((command, index) => {
        this.stageIndex = index;
        const last = index === commands.length - 1;
        const own = [];
        try {
          this.runCommand(command, stdin, own, { piped: !last });
        } catch (e) {
          if (!(e instanceof ExitSignal)) throw e;   // часть конвейера — своя оболочка
          this.status = e.code;
        }
        if (last) chunks.push(...own);
        else {
          chunks.push(...own.filter((chunk) => chunk.err));
          stdin = outText(own);
        }
      });
    }
    if (negate) this.status = this.status === 0 ? 1 : 0;
  }

  /** Одна команда конвейера; вывод — в chunks. */
  runCommand(command, stdin, chunks, { piped }) {
    this.line = command.line;
    if (command.type === 'simple') {
      const result = this.runStage(command, stdin, { piped });
      if (result.action) this.action = result.action;
      if (result.pending) {
        const before = this.pending ?? Promise.resolve({ chunks: [], code: 0 });
        this.pending = before.then(async (first) => {
          const next = await result.pending;
          return { chunks: [...first.chunks, ...next.chunks], code: next.code };
        });
      }
      chunks.push(...result.shown);
      if (result.exit !== undefined) throw new ExitSignal(result.exit);
      return;
    }
    // Составная команда (if, for, ( … )): её вывод идёт через её перенаправления
    this.substErr = '';
    const opened = this.openRedirects(command.redirects);
    if (this.substErr) chunks.push({ text: this.substErr, err: true });
    if (opened.error) {
      this.status = 1;
      chunks.push({ text: opened.error, err: true });
      return;
    }
    const inner = [];
    const savedTty = this.tty;
    this.tty = this.tty && !piped && opened.fds[1].stream === 'out';
    try {
      this.runCompound(command, inner);
    } finally {
      this.tty = savedTty;
      for (const chunk of inner) {
        const shown = this.deliver(opened.fds, chunk.err ? 2 : 1, chunk.text);
        if (shown) chunks.push(shown);
      }
    }
  }

  runCompound(command, chunks) {
    if (command.type === 'subshell') {
      const sub = this.child();
      try {
        sub.execList(command.body, chunks);
      } catch (e) {
        if (!(e instanceof ExitSignal)) throw e;
        sub.status = e.code;
      }
      if (sub.action) this.action = sub.action;
      this.status = sub.status;
    } else if (command.type === 'if') {
      for (const { cond, body } of command.clauses) {
        if (this.execList(cond, chunks) === 0) {
          this.execList(body, chunks);
          return;
        }
      }
      if (command.otherwise) this.execList(command.otherwise, chunks);
      else this.status = 0;
    } else if (command.type === 'for') {
      if (!/^[A-Za-z_]\w*$/.test(command.name)) {
        chunks.push({ text: `${this.errPrefix()}\`${command.name}': not a valid identifier\n`, err: true });
        this.status = 1;
        return;
      }
      this.substErr = '';
      // без in — аргументы скрипта; шаблон без совпадений остаётся как есть
      const values = command.words
        ? command.words.flatMap((word) => this.expandWord(word))
        : this.args.slice(1);
      if (this.substErr) chunks.push({ text: this.substErr, err: true });
      this.status = 0;
      for (const value of values.slice(0, MAX_LOOP)) {
        this.env[command.name] = value;
        this.execList(command.body, chunks);
      }
    }
  }

  /**
   * Перенаправления слева направо, как в bash: «2>&1 > f» — ошибки остаются на экране,
   * «> f 2>&1» — оба потока в файл. Файлы открываются (создаются и очищаются) до запуска
   * команды. Возвращает {fds, stdin} или {error}.
   */
  openRedirects(list, stdin = '') {
    const fds = { 1: { stream: 'out' }, 2: { stream: 'err' } };
    for (const item of list) {
      if (item.op === '2>&1') {
        fds[2] = fds[1];
        continue;
      }
      if (item.op === '>&2' || item.op === '1>&2') {
        fds[1] = fds[2];
        continue;
      }
      const [target] = this.expandWord(item.target, { split: false });
      try {
        if (item.op === '<') {
          stdin = this.fs.readFile(this.resolve(target));
          continue;
        }
        const fd = item.op.startsWith('2') ? 2 : 1;
        fds[fd] = { file: this.resolve(target) };
        this.fs.writeFile(fds[fd].file, '', { append: true });
        if (!item.op.endsWith('>>')) this.fs.writeFile(fds[fd].file, '');
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        return { error: `${this.errPrefix()}${target}: ${e.message}\n` };
      }
    }
    return { fds, stdin };
  }

  /** Текст в поток fd: в файл (null) или на экран / дальше по конвейеру ({text, err}). */
  deliver(fds, fd, text) {
    const target = fds[fd];
    if (target.file) {
      this.fs.writeFile(target.file, text, { append: true });
      return null;
    }
    return { text, err: target.stream === 'err' };
  }

  /**
   * Простая команда с перенаправлениями. Возвращает {shown, action, exit?}: shown — то, что
   * не ушло в файл (в терминал или следующей команде), список {text, err}.
   */
  runStage(stage, stdin, { piped }) {
    this.substErr = '';
    this.substStatus = null;
    const first = stage.words[0]?.[0];
    // NAME=значение — без разбиения по пробелам: NAME="media-$(date +%F).tar.gz"
    const assignment = stage.words.length === 1 && first && !first.quote && !first.subst
      && /^[A-Za-z_]\w*=/.test(first.text);
    let words;
    let opened;
    try {
      words = assignment
        ? this.expandWord(stage.words[0], { split: false })
        : stage.words.flatMap((word) => this.expandWord(word));
      opened = this.openRedirects(stage.redirects, stdin);
    } catch (e) {
      if (e instanceof ExitSignal || e instanceof FsError) throw e;
      this.status = 1;
      return { shown: [{ text: `bash: ${e.message}\n`, err: true }] };
    }
    const pre = this.substErr ? [{ text: this.substErr, err: true }] : [];
    if (opened.error) {
      this.status = 1;
      return { shown: [...pre, { text: opened.error, err: true }] };
    }
    const { fds } = opened;
    const result = words.length
      ? this.exec(words, opened.stdin, { tty: this.tty && !piped && fds[1].stream === 'out' })
      : { out: '', err: '', code: this.substStatus ?? 0 };
    // x=$(команда) — код выхода команды
    if (assignment && this.substStatus !== null) result.code = this.substStatus;
    this.status = result.code;

    // Порядок, когда оба потока идут в одно место: обычно вывод, потом ошибки; ls сначала
    // проверяет все аргументы — его ошибки первые (errFirst); у скрипта — как печатал (chunks)
    const parts = result.chunks?.map((chunk) => [chunk.err ? 2 : 1, chunk.text])
      ?? (result.errFirst ? [[2, result.err], [1, result.out]] : [[1, result.out], [2, result.err]]);
    let shown = [];
    for (const [fd, text] of parts) {
      if (!text) continue;
      const chunk = this.deliver(fds, fd, text);
      if (chunk) shown.push(chunk);
    }
    // на экране ошибки команды видны раньше её вывода (кроме скриптов)
    if (!result.chunks) shown = [...shown.filter((chunk) => chunk.err), ...shown.filter((chunk) => !chunk.err)];
    // вывод придёт позже (psql): так же через перенаправления; в конвейер — не передаётся
    let pending = null;
    if (result.pending) {
      pending = result.pending.then((done) => {
        const later = [];
        const parts = [...(done.chunks ?? [
          ...(done.out ? [{ text: done.out, err: false }] : []),
          ...(done.err ? [{ text: done.err, err: true }] : []),
        ])];
        for (const chunk of parts) {
          if (piped && !chunk.err) continue;
          const delivered = this.deliver(fds, chunk.err ? 2 : 1, chunk.text);
          if (delivered) later.push(delivered);
        }
        if (piped) later.push({ text: '(в тренажёре вывод psql не передаётся по конвейеру — запустите команду без |)\n', err: true });
        return { chunks: later, code: done.code ?? 0 };
      });
    }
    return { shown: [...pre, ...shown], action: result.action, exit: result.exit, pending };
  }

  /** exit [N]: код N по модулю 256, без N — код последней команды. */
  exitCommand(args) {
    if (!args.length) return { out: '', err: '', code: this.status, exit: this.status };
    if (!/^[+-]?\d+$/.test(args[0])) {
      return { out: '', err: `${this.errPrefix()}exit: ${args[0]}: numeric argument required\n`, code: 2, exit: 2 };
    }
    if (args.length > 1) return { out: '', err: `${this.errPrefix()}exit: too many arguments\n`, code: 1 };
    const code = ((Number(args[0]) % 256) + 256) % 256;
    return { out: '', err: '', code, exit: code };
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

    if (name === 'exit') return this.exitCommand(args);

    // ./script.sh, /srv/shop/backup.sh — запуск файла
    if (name.includes('/')) return this.runFile(name, args, { tty });

    const command = this.machine?.extra?.[name] ?? (this.hasCommand(name) ? COMMANDS[name] : null);
    if (!command) {
      // свой скрипт в папке из PATH (~/bin/deploy после export PATH="$HOME/bin:$PATH")
      const script = this.findInPath(name);
      if (script) return this.runFile(script, args, { tty });
      if (this.machine?.notFound) return { out: '', err: this.machine.notFound(this, name), code: 127 };
      return { out: '', err: `${this.scriptName ? this.errPrefix() : ''}${name}: command not found\n`, code: 127 };
    }
    if (args.includes('--help') && command.help && !command.noHelp) {
      return { out: `${command.help.trim()}\n`, err: '', code: 0 };
    }
    try {
      const result = command.run({ sh: this, fs: this.fs, args, stdin, tty, name }) ?? {};
      return {
        out: result.out ?? '', err: result.err ?? '', code: result.code ?? 0,
        action: result.action, errFirst: result.errFirst, chunks: result.chunks, pending: result.pending,
      };
    } catch (e) {
      if (e instanceof FsError) return { out: '', err: `${name}: ${e.message}\n`, code: 1 };
      throw e;
    }
  }


  /** Исполняемый текстовый файл name в папках PATH (программы-заглушки apt — не скрипты). */
  findInPath(name) {
    for (const dir of (this.env.PATH ?? '').split(':').filter(Boolean)) {
      const path = normalize(name, this.resolve(dir));
      try {
        const node = this.fs.lookup(path);
        const isScript = node.type === 'file' && node.content && !node.binary;
        if (isScript && (node.mode & 0o111)) return path;
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
      }
    }
    return null;
  }


  /** Выполнить файл как скрипт: нужен доступ x и (для ./) shebang bash/sh. */
  runFile(path, args, { requireExec = true, inPlace = false, tty = true } = {}) {
    const abs = this.resolve(path);
    let node;
    try {
      node = this.fs.lookup(abs);
    } catch (e) {
      return { out: '', err: `${this.errPrefix()}${path}: ${e.message}\n`, code: 127 };
    }
    if (node.type === 'dir') return { out: '', err: `${this.errPrefix()}${path}: Is a directory\n`, code: 126 };
    if (requireExec && !this.fs.can(node, 'x')) {
      return { out: '', err: `${this.errPrefix()}${path}: Permission denied\n`, code: 126 };
    }
    // Программа симулятора в файле (venv/bin/pip, venv/bin/python) — запуск этой команды
    const program = node.program && (this.machine?.extra?.[node.program] ?? COMMANDS[node.program]);
    if (program) {
      const result = program.run({
        sh: this, fs: this.fs, args, stdin: '', tty, name: path.split('/').pop(), venv: node.venv,
      }) ?? {};
      return { out: result.out ?? '', err: result.err ?? '', code: result.code ?? 0 };
    }
    let text;
    try {
      text = this.fs.readFile(abs);
    } catch (e) {
      return { out: '', err: `${this.errPrefix()}${path}: ${e.message}\n`, code: 126 };
    }
    if (node.binary || node.content === undefined || (node.size && !text)) {
      return { out: '', err: `${this.errPrefix()}${path}: cannot execute binary file\n`, code: 126 };
    }
    if (this.depth >= MAX_SCRIPT_DEPTH) {
      return { out: '', err: `${this.errPrefix()}${path}: слишком глубокий вызов скриптов\n`, code: 1 };
    }
    // Скрипт — в своей оболочке (переменные и cd не меняют текущую); source — в этой же
    const shell = inPlace ? this : new Shell(this.fs, {
      cwd: this.cwd, env: { ...this.env }, args: [path, ...args], depth: this.depth + 1, tty,
      machine: this.inner(),
    });
    const savedTty = shell.tty;
    shell.tty = tty;
    let chunks;
    try {
      chunks = shell.runScript(text, path);
    } finally {
      shell.tty = savedTty;
    }
    return { out: outText(chunks), err: errText(chunks), code: shell.status, chunks };
  }
}
