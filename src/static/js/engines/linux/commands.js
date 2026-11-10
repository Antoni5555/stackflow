// Команды Linux-симулятора. Каждая — { help, run(ctx) }: ctx = { sh, fs, args, stdin, tty, name },
// run возвращает { out, err, code, action }. Сообщения об ошибках — дословно как в Ubuntu
// (их цитируют уроки), справка --help — коротко по-русски.

import {
  DAY, FsError, GROUPS, USERS, VirtualFS, basename, dirname, normalize,
} from './fs.js';
import { globMatch } from './glob.js';

// --- общие помощники ---

const ok = (out = '') => ({ out, err: '', code: 0 });
const fail = (err, code = 1) => ({ out: '', err, code });
const lines = (text) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));
const joinLines = (items) => (items.length ? `${items.join('\n')}\n` : '');

/**
 * Разбор флагов: -la, -n 5, -n5, --help, -- (дальше только операнды).
 * spec: { flags: 'la', values: 'n', long: {'--recursive': 'r'}, numeric: true (-5 = -n 5) }.
 */
function options(name, args, spec = {}) {
  const opts = {};
  const operands = [];
  const flags = spec.flags ?? '';
  const values = spec.values ?? '';
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (spec.long?.[arg]) {
      opts[spec.long[arg]] = true;
      continue;
    }
    if (!arg.startsWith('-') || arg === '-') {
      operands.push(arg);
      continue;
    }
    if (spec.numeric && /^-\d+$/.test(arg)) {
      opts.n = arg.slice(1);
      continue;
    }
    if (arg.startsWith('--')) {
      return { error: fail(`${name}: unrecognized option '${arg}'\nTry '${name} --help' for more information.\n`, 2) };
    }
    for (let j = 1; j < arg.length; j += 1) {
      const ch = arg[j];
      if (values.includes(ch)) {
        const value = arg.slice(j + 1) || args[i + 1];
        if (value === undefined) {
          return { error: fail(`${name}: option requires an argument -- '${ch}'\nTry '${name} --help' for more information.\n`, 2) };
        }
        opts[ch] = value;
        if (!arg.slice(j + 1)) i += 1;
        break;
      }
      if (!flags.includes(ch)) {
        return { error: fail(`${name}: invalid option -- '${ch}'\nTry '${name} --help' for more information.\n`, 2) };
      }
      opts[ch] = true;
    }
  }
  return { opts, operands };
}

/** Сообщение об ошибке ФС в стиле coreutils: «cat: x: No such file or directory». */
const fsError = (name, path, error) => `${name}: ${path}: ${error.message}\n`;

/** Выполнить fn(путь) для каждого операнда; ошибки ФС собрать, код 1. */
function eachPath(ctx, paths, fn, format = (path, e) => fsError(ctx.name, path, e)) {
  let out = '';
  let err = '';
  let code = 0;
  for (const path of paths) {
    try {
      out += fn(path) ?? '';
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      err += format(path, e);
      code = 1;
    }
  }
  return { out, err, code };
}

/** Текст файлов (или stdin, если файлов нет или «-»). */
function readInputs(ctx, paths, each) {
  if (!paths.length) paths = ['-'];
  return eachPath(ctx, paths, (path) => {
    const text = path === '-' ? ctx.stdin : ctx.fs.readFile(ctx.sh.resolve(path));
    return each(text, path, paths.length);
  });
}

/** Размер для человека, как в ls -h и du -h: 4.0K, 12K, 1.5M. */
export function humanSize(bytes, { small = false } = {}) {
  if (bytes < 1024 && small) return String(bytes);
  const units = ['K', 'M', 'G', 'T'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value < 10 ? Math.ceil(value * 10) / 10 : Math.ceil(value);
  if (rounded >= 1024 && unit < units.length - 1) return `1.0${units[unit + 1]}`;
  return `${value < 10 ? rounded.toFixed(1) : rounded}${units[unit]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(ms) {
  const date = new Date(ms);
  const day = String(date.getDate()).padStart(2, ' ');
  const recent = Math.abs(Date.now() - ms) < 180 * DAY;
  const time = recent
    ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    : ` ${date.getFullYear()}`;
  return `${MONTHS[date.getMonth()]} ${day} ${time}`;
}

/** Права в виде drwxr-xr-x. */
export function modeString(node) {
  const type = { dir: 'd', link: 'l', file: '-' }[node.type];
  let text = '';
  for (const shift of [6, 3, 0]) {
    const bits = (node.mode >> shift) & 7;
    text += (bits & 4 ? 'r' : '-') + (bits & 2 ? 'w' : '-') + (bits & 1 ? 'x' : '-');
  }
  if (node.mode & 0o1000) text = `${text.slice(0, 8)}${text[8] === 'x' ? 't' : 'T'}`;
  return type + text;
}

// Порядок как в LANG=C.UTF-8 (обычный для серверов Ubuntu): побайтовый, .env раньше backup
export const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortNames = (names) => names.sort(byteOrder);

/** Узел без перехода по ссылке в последней части (для ls -l, rm, mv). */
const lstat = (ctx, path) => ctx.fs.lookup(ctx.sh.resolve(path), { follow: false });

// --- навигация и просмотр ---

const pwd = {
  help: 'pwd — показать текущую папку (полный путь).',
  run: ({ sh }) => ok(`${sh.cwd}\n`),
};

const cd = {
  help: `cd [папка] — перейти в папку.
  cd        — домой (~)
  cd ..     — на уровень выше
  cd -      — в предыдущую папку`,
  run({ sh, fs, args }) {
    let target = args[0] ?? sh.env.HOME;
    if (args.length > 1) return fail('bash: cd: too many arguments\n');
    if (target === '-') target = sh.env.OLDPWD ?? sh.cwd;
    const abs = sh.resolve(target);
    try {
      const node = fs.lookup(abs);
      if (node.type !== 'dir') throw new FsError('ENOTDIR');
      fs.require(node, 'x');
    } catch (e) {
      return fail(`bash: cd: ${target}: ${e.message}\n`);
    }
    sh.env.OLDPWD = sh.cwd;
    sh.cwd = abs;
    return ok(args[0] === '-' ? `${abs}\n` : '');
  },
};

const ls = {
  help: `ls [флаги] [путь…] — список файлов в папке.
  -l   подробно: права, владелец, размер, дата
  -a   показать скрытые (имя с точки)
  -h   размеры в K, M, G (вместе с -l)
  -R   с вложенными папками
Флаги можно писать вместе: ls -la`,
  run(ctx) {
    const parsed = options('ls', ctx.args, { flags: 'lahR1d' });
    if (parsed.error) return parsed.error;
    const { opts } = parsed;
    const paths = parsed.operands.length ? parsed.operands : ['.'];
    const files = [];
    const dirs = [];
    let err = '';
    let code = 0;
    for (const path of paths) {
      try {
        const node = ctx.fs.lookup(ctx.sh.resolve(path));
        if (node.type === 'dir' && !opts.d) dirs.push(path);
        else files.push([path, lstat(ctx, path)]);
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        err += `ls: cannot access '${path}': ${e.message}\n`;
        code = 2;
      }
    }
    const blocks = [];
    if (files.length) blocks.push(formatEntries(ctx, files, opts, null));
    const showHeaders = paths.length > 1 || opts.R;
    const visit = (path) => {
      let entries;
      try {
        entries = ctx.fs.list(ctx.sh.resolve(path));
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        err += `ls: cannot open directory '${path}': ${e.message}\n`;
        code = 2;
        return;
      }
      let items = entries.filter(([name]) => opts.a || !name.startsWith('.'));
      if (opts.a) {
        const self = ctx.fs.lookup(ctx.sh.resolve(path));
        items = [['.', self], ['..', ctx.fs.lookup(dirname(ctx.sh.resolve(path)))], ...items];
      }
      const order = sortNames(items.map(([name]) => name));
      const sorted = order.map((name) => items.find(([item]) => item === name));
      let block = formatEntries(ctx, sorted, opts, path);
      if (showHeaders) block = `${path}:\n${block}`;
      blocks.push(block);
      if (opts.R) {
        for (const [name, node] of sorted) {
          if (node.type === 'dir' && name !== '.' && name !== '..') {
            visit(path === '/' ? `/${name}` : `${path}/${name}`);
          }
        }
      }
    };
    for (const path of dirs) visit(path);
    return { out: blocks.filter(Boolean).join('\n'), err, code };
  },
};

function formatEntries(ctx, entries, opts, dirPath) {
  if (!entries.length) return dirPath && opts.l ? 'total 0\n' : '';
  if (!opts.l) {
    const names = entries.map(([name]) => name);
    // В терминал — в строку через два пробела, в конвейер и файл — по одному в строке
    return ctx.tty && !opts['1'] ? `${names.join('  ')}\n` : joinLines(names);
  }
  const rows = entries.map(([name, node]) => {
    const size = VirtualFS.sizeOf(node);
    return [
      modeString(node), String(node.nlink ?? 1), node.owner, node.group,
      opts.h ? humanSize(size, { small: true }) : String(size),
      formatDate(node.mtime),
      node.type === 'link' ? `${name} -> ${node.target}` : name,
    ];
  });
  const width = (col) => Math.max(...rows.map((row) => row[col].length));
  const text = rows.map((row) => [
    row[0], row[1].padStart(width(1)), row[2].padEnd(width(2)), row[3].padEnd(width(3)),
    row[4].padStart(width(4)), row[5], row[6],
  ].join(' '));
  const total = entries.reduce((sum, [, node]) => sum + Math.ceil(VirtualFS.sizeOf(node) / 4096) * 4, 0);
  const header = dirPath !== null ? `total ${opts.h ? humanSize(total * 1024) : total}\n` : '';
  return header + joinLines(text);
}

const BINARY_GARBAGE = '\u001f\u008b\u0008\u0000\u0000\u0000\u0000\u0000\u0000\u0003\ufffd\ufffd\n';

const cat = {
  help: `cat [файл…] — вывести содержимое файлов.
  -n   с номерами строк
Без файла читает ввод (из конвейера).`,
  run(ctx) {
    const parsed = options('cat', ctx.args, { flags: 'n' });
    if (parsed.error) return parsed.error;
    let number = 0;
    return readInputs(ctx, parsed.operands, (text, path) => {
      if (path !== '-') {
        const node = ctx.fs.lookup(ctx.sh.resolve(path));
        if (node.binary) return BINARY_GARBAGE;
      }
      if (!parsed.opts.n) return text;
      return joinLines(lines(text).map((line) => `${String(number += 1).padStart(6)}\t${line}`));
    });
  },
};

const echo = {
  help: `echo [текст…] — напечатать текст.
  -n   без перевода строки в конце
  -e   понимать \\n и \\t
Пример: echo "DEBUG=False" > .env`,
  run({ args }) {
    let rest = args;
    let newline = true;
    let escapes = false;
    while (rest.length && /^-[ne]+$/.test(rest[0])) {
      if (rest[0].includes('n')) newline = false;
      if (rest[0].includes('e')) escapes = true;
      rest = rest.slice(1);
    }
    let text = rest.join(' ');
    if (escapes) text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
    return ok(newline ? `${text}\n` : text);
  },
};

// --- создание, копирование, удаление ---

const mkdir = {
  help: `mkdir [-p] папка… — создать папку.
  -p   вместе с родителями; без ошибки, если папка уже есть`,
  run(ctx) {
    const parsed = options('mkdir', ctx.args, { flags: 'pv', long: { '--parents': 'p' } });
    if (parsed.error) return parsed.error;
    if (!parsed.operands.length) return fail("mkdir: missing operand\nTry 'mkdir --help' for more information.\n");
    return eachPath(ctx, parsed.operands, (path) => {
      ctx.fs.mkdir(ctx.sh.resolve(path), { parents: parsed.opts.p });
    }, (path, e) => `mkdir: cannot create directory ‘${path}’: ${e.message}\n`);
  },
};

const touch = {
  help: 'touch файл… — создать пустой файл или обновить время изменения.',
  run(ctx) {
    const parsed = options('touch', ctx.args, {});
    if (parsed.error) return parsed.error;
    if (!parsed.operands.length) return fail("touch: missing file operand\nTry 'touch --help' for more information.\n");
    return eachPath(ctx, parsed.operands, (path) => ctx.fs.touch(ctx.sh.resolve(path)),
      (path, e) => `touch: cannot touch '${path}': ${e.message}\n`);
  },
};

const rm = {
  help: `rm [флаги] путь… — удалить файлы.
  -r   папку целиком, со всем содержимым
  -f   без ошибки, если файла нет
Осторожно: rm -rf удаляет без вопросов и без корзины.`,
  run(ctx) {
    const parsed = options('rm', ctx.args, { flags: 'rRfiv', long: { '--recursive': 'r', '--force': 'f' } });
    if (parsed.error) return parsed.error;
    const { opts, operands } = parsed;
    const recursive = opts.r || opts.R;
    if (!operands.length) {
      return opts.f ? ok() : fail("rm: missing operand\nTry 'rm --help' for more information.\n");
    }
    let out = '';
    let err = '';
    let code = 0;
    for (const path of operands) {
      const abs = ctx.sh.resolve(path);
      if (abs === '/' && recursive) {
        err += "rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n";
        code = 1;
        continue;
      }
      try {
        const node = lstat(ctx, path);
        if (node.type === 'dir' && !recursive) {
          err += `rm: cannot remove '${path}': Is a directory\n`;
          code = 1;
          continue;
        }
        ctx.fs.remove(abs, { recursive });
        if (opts.v) out += `removed '${path}'\n`;
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        if (opts.f && e.code === 'ENOENT') continue;
        err += `rm: cannot remove '${path}': ${e.message}\n`;
        code = 1;
      }
    }
    return { out, err, code };
  },
};

const rmdir = {
  help: 'rmdir папка… — удалить пустую папку.',
  run(ctx) {
    return eachPath(ctx, ctx.args, (path) => {
      const node = lstat(ctx, path);
      if (node.type !== 'dir') throw new FsError('ENOTDIR');
      ctx.fs.remove(ctx.sh.resolve(path));
    }, (path, e) => `rmdir: failed to remove '${path}': ${e.message}\n`);
  },
};

/** Куда класть при cp/mv: в папку (тогда dst/имя) или по этому пути. */
function destination(ctx, source, dest, many) {
  const abs = ctx.sh.resolve(dest);
  let isDir = false;
  try {
    isDir = ctx.fs.lookup(abs).type === 'dir';
  } catch (e) {
    if (many || dest.endsWith('/')) throw e;
  }
  return isDir ? normalize(basename(ctx.sh.resolve(source)), abs) : abs;
}

function copyOrMove(ctx, move) {
  const name = move ? 'mv' : 'cp';
  const parsed = options(name, ctx.args, { flags: move ? 'fiv' : 'rRfiv', long: { '--recursive': 'r' } });
  if (parsed.error) return parsed.error;
  const { opts, operands } = parsed;
  if (operands.length < 2) {
    return fail(operands.length
      ? `${name}: missing destination file operand after '${operands[0]}'\nTry '${name} --help' for more information.\n`
      : `${name}: missing file operand\nTry '${name} --help' for more information.\n`);
  }
  const dest = operands.pop();
  const many = operands.length > 1;
  if (many) {
    try {
      if (ctx.fs.lookup(ctx.sh.resolve(dest)).type !== 'dir') throw new FsError('ENOTDIR');
    } catch (e) {
      return fail(`${name}: target '${dest}': ${e.message}\n`);
    }
  }
  let out = '';
  let err = '';
  let code = 0;
  for (const source of operands) {
    try {
      const node = move ? lstat(ctx, source) : ctx.fs.lookup(ctx.sh.resolve(source));
      if (!move && node.type === 'dir' && !opts.r && !opts.R) {
        err += `cp: -r not specified; omitting directory '${source}'\n`;
        code = 1;
        continue;
      }
      if (!move) ctx.fs.require(node, 'r');
      const target = destination(ctx, source, dest, many);
      const from = ctx.sh.resolve(source);
      if (target === from || target.startsWith(`${from}/`)) {
        err += `${name}: cannot ${move ? 'move' : 'copy'} '${source}' to a subdirectory of itself, '${dest}'\n`;
        code = 1;
        continue;
      }
      if (ctx.fs.exists(target, { follow: false }) && ctx.fs.lookup(target).type === 'dir' && node.type !== 'dir') {
        err += `${name}: cannot overwrite directory '${dest}' with non-directory\n`;
        code = 1;
        continue;
      }
      if (move) {
        ctx.fs.detach(from);
        ctx.fs.attach(target, node);
      } else {
        ctx.fs.attach(target, ctx.fs.clone(node));
      }
      if (opts.v) out += `'${source}' -> '${target}'\n`;
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      const verb = e.code === 'ENOENT' && !ctx.fs.exists(ctx.sh.resolve(source), { follow: false })
        ? 'cannot stat' : `cannot ${move ? 'move' : 'create regular file'}`;
      const subject = verb === 'cannot stat' ? source : dest;
      err += `${name}: ${verb} '${subject}': ${e.message}\n`;
      code = 1;
    }
  }
  return { out, err, code };
}

const cp = {
  help: `cp [-r] откуда куда — скопировать.
  -r   копировать папку целиком (без -r папка пропускается)
cp a.txt b.txt   — копия под новым именем
cp a.txt папка/  — копия в папку`,
  run: (ctx) => copyOrMove(ctx, false),
};

const mv = {
  help: `mv откуда куда — переместить или переименовать.
mv old.txt new.txt — переименовать
mv a.txt папка/    — переместить в папку`,
  run: (ctx) => copyOrMove(ctx, true),
};

const ln = {
  help: `ln [-s] цель имя_ссылки — создать ссылку.
  -s   символическая ссылка (ярлык; ломается, если цель удалить)
Без -s — жёсткая ссылка: второе имя того же файла.`,
  run(ctx) {
    const parsed = options('ln', ctx.args, { flags: 'sfv' });
    if (parsed.error) return parsed.error;
    const [target, link] = parsed.operands;
    if (!target) return fail("ln: missing file operand\nTry 'ln --help' for more information.\n");
    const linkPath = link ?? basename(target);
    let abs = ctx.sh.resolve(linkPath);
    if (ctx.fs.exists(abs) && ctx.fs.lookup(abs).type === 'dir') abs = normalize(basename(target), abs);
    try {
      if (ctx.fs.exists(abs, { follow: false })) {
        if (!parsed.opts.f) throw new FsError('EEXIST');
        ctx.fs.remove(abs);
      }
      if (parsed.opts.s) {
        ctx.fs.symlink(target, abs);
      } else {
        const node = ctx.fs.lookup(ctx.sh.resolve(target));
        if (node.type === 'dir') return fail(`ln: ${target}: hard link not allowed for directory\n`);
        ctx.fs.attach(abs, node);
        node.nlink += 1;
      }
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      if (e.code === 'EEXIST') return fail(`ln: failed to create ${parsed.opts.s ? 'symbolic' : 'hard'} link '${linkPath}': File exists\n`);
      if (!parsed.opts.s && !ctx.fs.exists(ctx.sh.resolve(target))) return fail(`ln: failed to access '${target}': ${e.message}\n`);
      return fail(`ln: failed to create ${parsed.opts.s ? 'symbolic' : 'hard'} link '${linkPath}': ${e.message}\n`);
    }
    return ok();
  },
};

// --- текст ---

function headTail(ctx, fromEnd) {
  const name = fromEnd ? 'tail' : 'head';
  const parsed = options(name, ctx.args, { values: 'n', numeric: true });
  if (parsed.error) return parsed.error;
  const raw = String(parsed.opts.n ?? 10);
  const fromLine = fromEnd && raw.startsWith('+');      // tail -n +2 — со 2-й строки до конца
  const count = Number(raw.replace(/^\+/, ''));
  if (Number.isNaN(count)) return fail(`${name}: invalid number of lines: '${parsed.opts.n}'\n`);
  const paths = parsed.operands;
  let first = true;
  const result = readInputs(ctx, paths, (text, path, total) => {
    const all = lines(text);
    let picked = fromEnd ? all.slice(Math.max(all.length - count, 0)) : all.slice(0, count);
    if (fromLine) picked = all.slice(Math.max(count - 1, 0));
    const header = total > 1 ? `${first ? '' : '\n'}==> ${path} <==\n` : '';
    first = false;
    return header + joinLines(picked);
  });
  result.err = result.err.replace(new RegExp(`^${name}: (.+?): `, 'gm'), `${name}: cannot open '$1' for reading: `);
  return result;
}

const head = {
  help: `head [-n N] [файл…] — первые строки (по умолчанию 10).
  -n N  сколько строк (можно -5)`,
  run: (ctx) => headTail(ctx, false),
};

const tail = {
  help: `tail [-n N] [файл…] — последние строки (по умолчанию 10).
  -n N  сколько строк (можно -5)
  -n +N начиная со строки N (tail -n +2 — без заголовка CSV)`,
  run: (ctx) => headTail(ctx, true),
};

const wc = {
  help: `wc [флаги] [файл…] — посчитать строки, слова и байты.
  -l   только строки
  -w   только слова
  -c   только байты`,
  run(ctx) {
    const parsed = options('wc', ctx.args, { flags: 'lwc' });
    if (parsed.error) return parsed.error;
    const { opts } = parsed;
    const pick = opts.l || opts.w || opts.c ? opts : { l: true, w: true, c: true };
    const rows = [];
    const totals = [0, 0, 0];
    const result = readInputs(ctx, parsed.operands, (text, path) => {
      const counts = [
        (text.match(/\n/g) ?? []).length,
        text.split(/\s+/).filter(Boolean).length,
        new TextEncoder().encode(text).length,
      ];
      counts.forEach((n, i) => { totals[i] += n; });
      rows.push([counts, path === '-' ? '' : path]);
      return '';
    });
    if (parsed.operands.length > 1) rows.push([totals, 'total']);
    const keys = ['l', 'w', 'c'];
    const selected = (counts) => counts.filter((_, i) => pick[keys[i]]);
    const single = rows.length === 1 && !rows[0][1] && selected(rows[0][0]).length === 1;
    const width = single ? 0 : Math.max(...rows.flatMap(([c]) => selected(c).map((n) => String(n).length)), 1);
    result.out = joinLines(rows.map(([counts, path]) => [
      ...selected(counts).map((n) => String(n).padStart(width)), path,
    ].filter((item, i, all) => item !== '' || i < all.length - 1).join(' ')));
    return result;
  },
};

const grep = {
  help: `grep [флаги] шаблон [файл…] — найти строки с шаблоном.
  -i   без учёта регистра
  -n   с номерами строк
  -c   только число найденных строк
  -v   строки БЕЗ шаблона
  -r   искать во всех файлах папки
Шаблон — регулярное выражение: grep "ERROR" app.log`,
  run(ctx) {
    const parsed = options('grep', ctx.args, { flags: 'invcrRlE' });
    if (parsed.error) return parsed.error;
    const { opts } = parsed;
    const [pattern, ...paths] = parsed.operands;
    if (pattern === undefined) return fail("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n", 2);
    let regex;
    try {
      regex = new RegExp(pattern.replace(/\\([|(){}+?])/g, '$1'), opts.i ? 'i' : '');
    } catch (e) {
      return fail('grep: Unmatched ( or \\(\n', 2);
    }
    const recursive = opts.r || opts.R;
    let files = paths.length ? paths : [recursive ? '.' : '-'];
    let err = '';
    if (recursive) {
      files = files.flatMap((path) => {
        if (path === '-') return [path];
        try {
          return [...ctx.fs.walk(ctx.sh.resolve(path), {
            onError: (p, e) => { err += `grep: ${p}: ${e.message}\n`; },
          })].filter(([, node]) => node.type === 'file')
            .map(([abs]) => (path === '.' ? abs.replace(`${ctx.sh.resolve('.')}/`, '') : `${path.replace(/\/$/, '')}${abs.slice(ctx.sh.resolve(path).length)}`));
        } catch (e) {
          err += `grep: ${path}: ${e.message}\n`;
          return [];
        }
      });
    }
    const prefix = files.length > 1 || recursive;
    let found = false;
    let code = 0;
    let out = '';
    for (const path of files) {
      let text;
      try {
        if (path === '-') text = ctx.stdin;
        else {
          const node = ctx.fs.lookup(ctx.sh.resolve(path));
          if (node.type === 'dir') {
            err += `grep: ${path}: Is a directory\n`;
            continue;
          }
          text = ctx.fs.readFile(ctx.sh.resolve(path));
        }
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        err += `grep: ${path}: ${e.message}\n`;
        code = 2;
        continue;
      }
      const name = path === '-' ? '(standard input)' : path;
      const matched = lines(text).map((line, i) => [line, i + 1])
        .filter(([line]) => regex.test(line) !== Boolean(opts.v));
      if (matched.length) found = true;
      if (opts.c) out += `${prefix ? `${name}:` : ''}${matched.length}\n`;
      else if (opts.l) out += matched.length ? `${name}\n` : '';
      else {
        out += joinLines(matched.map(([line, n]) => `${prefix ? `${name}:` : ''}${opts.n ? `${n}:` : ''}${line}`));
      }
    }
    return { out, err, code: code || (found ? 0 : 1) };
  },
};

const sort = {
  help: `sort [флаги] [файл…] — отсортировать строки.
  -n   как числа (10 после 9, а не после 1)
  -r   в обратном порядке
  -u   без повторов`,
  run(ctx) {
    const parsed = options('sort', ctx.args, { flags: 'nru' });
    if (parsed.error) return parsed.error;
    const { opts } = parsed;
    let all = [];
    const result = readInputs(ctx, parsed.operands, (text) => {
      all.push(...lines(text));
      return '';
    });
    const number = (line) => parseFloat(line.trim()) || 0;
    all.sort(opts.n
      ? (a, b) => number(a) - number(b) || byteOrder(a, b)
      : byteOrder);
    if (opts.r) all.reverse();
    if (opts.u) all = all.filter((line, i) => i === 0 || line !== all[i - 1]);
    result.out = joinLines(all);
    return result;
  },
};

const uniq = {
  help: `uniq [-c] [файл] — убрать повторы, идущие подряд (обычно после sort).
  -c   показать, сколько раз встретилась строка`,
  run(ctx) {
    const parsed = options('uniq', ctx.args, { flags: 'c' });
    if (parsed.error) return parsed.error;
    const groups = [];
    const result = readInputs(ctx, parsed.operands.slice(0, 1), (text) => {
      for (const line of lines(text)) {
        const last = groups[groups.length - 1];
        if (last && last[0] === line) last[1] += 1;
        else groups.push([line, 1]);
      }
      return '';
    });
    result.out = joinLines(groups.map(([line, n]) => (parsed.opts.c ? `${String(n).padStart(7)} ${line}` : line)));
    return result;
  },
};

function fieldList(spec) {
  const fields = new Set();
  for (const part of spec.split(',')) {
    const [from, to] = part.split('-');
    const start = Number(from || 1);
    const end = part.includes('-') ? Number(to || 1000) : start;
    for (let n = start; n <= end; n += 1) fields.add(n);
  }
  return [...fields].sort((a, b) => a - b);
}

const cut = {
  help: `cut -d разделитель -f поля [файл…] — вырезать столбцы.
  -d ','   разделитель (по умолчанию табуляция)
  -f 1,3   номера полей; можно диапазон 2-4
Пример: cut -d ',' -f 2 orders.csv`,
  run(ctx) {
    const parsed = options('cut', ctx.args, { values: 'df' });
    if (parsed.error) return parsed.error;
    const { opts } = parsed;
    if (!opts.f) return fail("cut: you must specify a list of bytes, characters, or fields\nTry 'cut --help' for more information.\n");
    if (opts.d && opts.d.length !== 1) return fail('cut: the delimiter must be a single character\n');
    const delimiter = opts.d ?? '\t';
    const fields = fieldList(opts.f);
    return readInputs(ctx, parsed.operands, (text) => joinLines(lines(text).map((line) => {
      if (!line.includes(delimiter)) return line;
      const parts = line.split(delimiter);
      return fields.filter((n) => n <= parts.length).map((n) => parts[n - 1]).join(delimiter);
    })));
  },
};

// --- поиск и размеры ---

/** Сравнение find: +N — больше, -N — меньше, N — ровно. */
function compare(spec, value) {
  const n = Number(spec.replace(/^[+-]/, ''));
  if (spec.startsWith('+')) return value > n;
  if (spec.startsWith('-')) return value < n;
  return value === n;
}

const SIZE_UNITS = { c: 1, k: 1024, M: 1024 ** 2, G: 1024 ** 3, '': 512 };

const find = {
  help: `find [папка…] [условия] — найти файлы.
  -name '*.log'   по имени (шаблон в кавычках)
  -type f | d     только файлы | только папки
  -size +5M       больше 5 МБ (k, M, G; -5M — меньше)
  -mtime +7       изменены больше 7 дней назад (-7 — меньше)
  -maxdepth N     не глубже N уровней
Пример: find /var/log -name '*.log' -size +1M`,
  run(ctx) {
    const paths = [];
    let i = 0;
    while (i < ctx.args.length && !ctx.args[i].startsWith('-')) paths.push(ctx.args[i++]);
    if (!paths.length) paths.push('.');
    const tests = [];
    let maxdepth = Infinity;
    while (i < ctx.args.length) {
      const test = ctx.args[i];
      const value = ctx.args[i + 1];
      if (test === '-print') {
        i += 1;
        continue;
      }
      if (!['-name', '-iname', '-type', '-size', '-mtime', '-maxdepth'].includes(test)) {
        return fail(`find: unknown predicate \`${test}'\n`);
      }
      if (value === undefined) return fail(`find: missing argument to \`${test}'\n`);
      if (test === '-maxdepth') maxdepth = Number(value);
      else if (test === '-type' && !['f', 'd', 'l'].includes(value)) return fail(`find: Unknown argument to -type: ${value}\n`);
      else if (test === '-size' && !/^[+-]?\d+[ckMG]?$/.test(value)) return fail(`find: invalid -size type \`${value.slice(-1)}'\n`);
      else tests.push([test, value]);
      i += 2;
    }
    const matches = (name, node) => tests.every(([test, value]) => {
      if (test === '-name') return globMatch(value, name);
      if (test === '-iname') return globMatch(value.toLowerCase(), name.toLowerCase());
      if (test === '-type') return { f: 'file', d: 'dir', l: 'link' }[value] === node.type;
      if (test === '-size') {
        const unit = SIZE_UNITS[/[ckMG]$/.test(value) ? value.slice(-1) : ''];
        return compare(value.replace(/[ckMG]$/, ''), Math.ceil(VirtualFS.sizeOf(node) / unit));
      }
      if (test === '-mtime') return compare(value, Math.floor((Date.now() - node.mtime) / DAY));
      return true;
    });
    let out = '';
    let err = '';
    let code = 0;
    for (const start of paths) {
      const visit = (shown, abs, node, depth) => {
        if (matches(basename(shown) || shown, node)) out += `${shown}\n`;
        if (node.type !== 'dir' || depth >= maxdepth) return;
        let entries;
        try {
          entries = ctx.fs.list(abs);
        } catch (e) {
          err += `find: ‘${shown}’: ${e.message}\n`;
          code = 1;
          return;
        }
        for (const [name, child] of entries.sort(([a], [b]) => byteOrder(a, b))) {
          visit(`${shown.replace(/\/$/, '')}/${name}`, normalize(name, abs), child, depth + 1);
        }
      };
      try {
        const abs = ctx.sh.resolve(start);
        visit(start, abs, ctx.fs.lookup(abs), 0);
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        err += `find: ‘${start}’: ${e.message}\n`;
        code = 1;
      }
    }
    return { out, err, code };
  },
};

/** Место на диске: файл — по блокам 4K (тяжёлый файл — по размеру), папка — 4K. */
function diskUsage(ctx, abs) {
  let total = 0;
  for (const [, node] of ctx.fs.walk(abs)) {
    total += Math.ceil(VirtualFS.sizeOf(node) / 4096) * 4096;
  }
  return total;
}

const du = {
  help: `du [-sh] [путь…] — сколько места занимают папки.
  -s   только итог по каждому пути
  -h   в K, M, G
Пример: du -sh /var/log`,
  run(ctx) {
    const parsed = options('du', ctx.args, { flags: 'sha' });
    if (parsed.error) return parsed.error;
    const { opts } = parsed;
    const format = (bytes) => (opts.h ? humanSize(bytes) : String(Math.ceil(bytes / 1024)));
    const paths = parsed.operands.length ? parsed.operands : ['.'];
    return eachPath(ctx, paths, (path) => {
      const abs = ctx.sh.resolve(path);
      if (opts.s) return `${format(diskUsage(ctx, abs))}\t${path}\n`;
      let out = '';
      for (const [sub, node] of ctx.fs.walk(abs)) {
        if (node.type !== 'dir') continue;
        out = `${format(diskUsage(ctx, sub))}\t${path.replace(/\/$/, '')}${sub.slice(abs.length)}\n${out}`;
      }
      return out.split('\n').filter(Boolean).reverse().join('\n') + '\n';
    }, (path, e) => `du: cannot access '${path}': ${e.message}\n`);
  },
};

const DISK = 15 * 1024 ** 3;
const DISK_BASE = 4.2 * 1024 ** 3;

const df = {
  help: `df [-h] — свободное место на дисках.
  -h   в K, M, G`,
  run(ctx) {
    const parsed = options('df', ctx.args, { flags: 'hT' });
    if (parsed.error) return parsed.error;
    let files = 0;
    for (const [, node] of ctx.fs.as('root', () => [...ctx.fs.walk('/')])) {
      if (node.type === 'file') files += node.size;
    }
    const used = DISK_BASE + files;
    const rows = [
      ['/dev/sda1', DISK, used, '/'],
      ['tmpfs', 982 * 1024 ** 2, 0, '/dev/shm'],
    ];
    const human = parsed.opts.h;
    const format = (bytes) => (human ? (bytes ? humanSize(bytes).replace(/\.0(?=[KMGT])/, '') : '0') : String(Math.round(bytes / 1024)));
    const table = [
      ['Filesystem', human ? 'Size' : '1K-blocks', 'Used', human ? 'Avail' : 'Available', 'Use%', 'Mounted on'],
      ...rows.map(([fs, size, use, mount]) => [
        fs, format(size), format(use), format(size - use), `${Math.ceil((use / size) * 100)}%`, mount,
      ]),
    ];
    const widths = table[0].map((_, col) => Math.max(...table.map((row) => row[col].length)));
    return ok(joinLines(table.map((row) => row.map((cell, col) => (col === 0 || col === 5
      ? cell.padEnd(widths[col]) : cell.padStart(widths[col]))).join(' ').trimEnd())));
  },
};

// --- права и пользователи ---

/** chmod: 755 или u+x,g-w,o=r → новые права. */
function applyMode(spec, mode, isDir) {
  if (/^[0-7]{3,4}$/.test(spec)) return parseInt(spec, 8);
  let result = mode;
  for (const clause of spec.split(',')) {
    const match = /^([ugoa]*)([+\-=])([rwxX]*)$/.exec(clause);
    if (!match) return null;
    const who = match[1] || 'a';
    let bits = 0;
    for (const ch of match[3]) {
      if (ch === 'X' && !isDir && !(mode & 0o111)) continue;
      bits |= { r: 4, w: 2, x: 1, X: 1 }[ch];
    }
    const shifts = [...(who.includes('a') ? 'ugo' : who)].map((ch) => ({ u: 6, g: 3, o: 0 }[ch]));
    for (const shift of shifts) {
      if (match[2] === '+') result |= bits << shift;
      else if (match[2] === '-') result &= ~(bits << shift);
      else result = (result & ~(7 << shift)) | (bits << shift);
    }
  }
  return result;
}

/** Применить fn к пути и (с -R) ко всему внутри. */
function recursively(ctx, path, recursive, fn) {
  const abs = ctx.sh.resolve(path);
  const nodes = recursive ? [...ctx.fs.walk(abs)] : [[abs, ctx.fs.lookup(abs)]];
  for (const [, node] of nodes) fn(node);
}

const chmod = {
  help: `chmod права файл… — изменить права доступа.
  числом:  chmod 644 file  (владелец rw, остальные r)
  буквами: chmod u+x script.sh  (u — владелец, g — группа, o — остальные, a — все)
  -R       для папки и всего внутри`,
  run(ctx) {
    let args = ctx.args;
    const recursive = args[0] === '-R';
    if (recursive) args = args.slice(1);
    const [spec, ...paths] = args;
    if (!spec) return fail("chmod: missing operand\nTry 'chmod --help' for more information.\n");
    if (!paths.length) return fail(`chmod: missing operand after ‘${spec}’\nTry 'chmod --help' for more information.\n`);
    if (applyMode(spec, 0, false) === null) return fail(`chmod: invalid mode: ‘${spec}’\nTry 'chmod --help' for more information.\n`);
    return eachPath(ctx, paths, (path) => recursively(ctx, path, recursive, (node) => {
      if (ctx.fs.user !== 'root' && node.owner !== ctx.fs.user) throw new FsError('EPERM');
      node.mode = applyMode(spec, node.mode, node.type === 'dir') | (node.mode & 0o1000 && !/^\d{4}$/.test(spec) ? 0o1000 : 0);
    }), (path, e) => (e.code === 'EPERM'
      ? `chmod: changing permissions of '${path}': Operation not permitted\n`
      : `chmod: cannot access '${path}': ${e.message}\n`));
  },
};

function changeOwner(ctx, name, owner, group, paths, recursive) {
  if (owner && !USERS[owner]) return fail(`${name}: invalid user: ‘${owner}’\n`);
  if (group && !(group in GROUPS)) return fail(`${name}: invalid group: ‘${group}’\n`);
  return eachPath(ctx, paths, (path) => recursively(ctx, path, recursive, (node) => {
    const user = ctx.fs.user;
    const groupAllowed = node.owner === user && (USERS[user]?.groups ?? []).includes(group);
    if (user !== 'root' && (owner || !groupAllowed)) throw new FsError('EPERM');
    if (owner) node.owner = owner;
    if (group) node.group = group;
  }), (path, e) => (e.code === 'EPERM'
    ? `${name}: changing ${owner ? 'ownership' : 'group'} of '${path}': Operation not permitted\n`
    : `${name}: cannot access '${path}': ${e.message}\n`));
}

const chown = {
  help: `chown владелец[:группа] файл… — сменить владельца (нужен sudo).
  -R   для папки и всего внутри
Пример: sudo chown -R www-data:www-data /var/www/shop`,
  run(ctx) {
    const parsed = options('chown', ctx.args, { flags: 'Rv' });
    if (parsed.error) return parsed.error;
    const [spec, ...paths] = parsed.operands;
    if (!spec) return fail("chown: missing operand\nTry 'chown --help' for more information.\n");
    if (!paths.length) return fail(`chown: missing operand after '${spec}'\nTry 'chown --help' for more information.\n`);
    const [owner, group] = spec.split(':');
    return changeOwner(ctx, 'chown', owner, spec.includes(':') ? (group || owner) : null, paths, parsed.opts.R);
  },
};

const chgrp = {
  help: `chgrp группа файл… — сменить группу файла.
  -R   для папки и всего внутри`,
  run(ctx) {
    const parsed = options('chgrp', ctx.args, { flags: 'Rv' });
    if (parsed.error) return parsed.error;
    const [group, ...paths] = parsed.operands;
    if (!group || !paths.length) return fail("chgrp: missing operand\nTry 'chgrp --help' for more information.\n");
    return changeOwner(ctx, 'chgrp', null, group, paths, parsed.opts.R);
  },
};

const whoami = {
  help: 'whoami — имя текущего пользователя.',
  run: ({ fs }) => ok(`${fs.user}\n`),
};

const id = {
  help: 'id [пользователь] — номер пользователя и его группы.',
  run({ fs, args }) {
    const name = args[0] ?? fs.user;
    const user = USERS[name];
    if (!user) return fail(`id: ‘${name}’: no such user\n`);
    const groups = user.groups.map((group) => `${GROUPS[group]}(${group})`).join(',');
    const main = user.groups[0];
    return ok(`uid=${user.uid}(${name}) gid=${GROUPS[main]}(${main}) groups=${groups}\n`);
  },
};

const sudo = {
  help: `sudo команда — выполнить команду от имени root (администратора).
Пример: sudo chown www-data file`,
  run({ sh, fs, args, stdin }) {
    let rest = args;
    let user = 'root';
    if (rest[0] === '-u') {
      user = rest[1];
      rest = rest.slice(2);
      if (!USERS[user]) return fail(`sudo: unknown user ${user}\nsudo: error initializing audit plugin sudoers_audit\n`);
    }
    if (!rest.length) return fail('usage: sudo command\n');
    if (!(USERS[fs.user]?.groups ?? []).includes('sudo') && fs.user !== 'root') {
      return fail(`${fs.user} is not in the sudoers file.\n`);
    }
    return fs.as(user, () => sh.exec(rest, stdin, { tty: true }));
  },
};

// --- архивы ---

const TAR = '\u0000TAR\u0000';
const GZ = '\u0000GZ\u0000';

/** Сжатый файл: внутри — исходный текст, размер — ~30 % исходного. */
function gzipNode(content, size) {
  return { content: GZ + JSON.stringify({ content, size }), size: Math.max(Math.round(size * 0.3), 20), binary: true };
}

function gunzipContent(text) {
  if (!text.startsWith(GZ)) return null;
  return JSON.parse(text.slice(GZ.length));
}

const gzip = {
  help: `gzip файл… — сжать файл (появится файл.gz, исходный удаляется).
  -d   распаковать (как gunzip)
  -k   оставить исходный файл`,
  run(ctx) {
    const parsed = options(ctx.name, ctx.args, { flags: 'dkv' });
    if (parsed.error) return parsed.error;
    const unpack = ctx.name === 'gunzip' || parsed.opts.d;
    if (!parsed.operands.length) return fail(`${ctx.name}: compressed data not written to a terminal.\n`);
    return eachPath(ctx, parsed.operands, (path) => {
      const abs = ctx.sh.resolve(path);
      const node = ctx.fs.lookup(abs);
      if (node.type === 'dir') return `${ctx.name}: ${path} is a directory -- ignored\n`;
      if (unpack) {
        if (!path.endsWith('.gz')) throw Object.assign(new FsError('ENOENT'), { message: 'unknown suffix -- ignored' });
        const data = gunzipContent(ctx.fs.readFile(abs));
        if (!data) throw Object.assign(new FsError('ENOENT'), { message: 'not in gzip format' });
        const isTar = data.content.startsWith(TAR);
        ctx.fs.createFile(abs.slice(0, -3), { content: data.content, size: data.size, binary: isTar, heavy: !data.content && data.size > 0 });
      } else {
        if (path.endsWith('.gz')) return `gzip: ${path} already has .gz suffix -- unchanged\n`;
        ctx.fs.createFile(`${abs}.gz`, gzipNode(ctx.fs.readFile(abs), node.size));
      }
      if (!parsed.opts.k) ctx.fs.remove(abs);
      return '';
    });
  },
};

/** Архив tar: внутри — список записей {path, type, content, size, mode, target}. */
function packTar(ctx, paths) {
  const entries = [];
  let err = '';
  for (const path of paths) {
    const abs = ctx.sh.resolve(path);
    const stored = path.replace(/^\/+/, '');
    if (stored !== path && !err) err = "tar: Removing leading `/' from member names\n";
    for (const [sub, node] of ctx.fs.walk(abs)) {
      if (node.type === 'file') ctx.fs.require(node, 'r');
      entries.push({
        path: stored.replace(/\/$/, '') + sub.slice(abs.length),
        type: node.type, content: node.content, size: node.size, mode: node.mode,
        target: node.target, binary: node.binary,
      });
    }
  }
  return { entries, err };
}

const tar = {
  help: `tar — архив из файлов и папок.
  tar -czf backup.tar.gz папка   — создать сжатый архив
  tar -xzf backup.tar.gz         — распаковать в текущую папку
  tar -tzf backup.tar.gz         — показать, что внутри
  c — создать, x — распаковать, t — список, z — сжатие gzip, f — имя архива, v — подробно
  -C папка  — куда распаковать`,
  run(ctx) {
    let args = [...ctx.args];
    if (args[0] && !args[0].startsWith('-')) args[0] = `-${args[0]}`;   // tar czf → -czf
    const parsed = options('tar', args, { flags: 'cxtzvf', values: 'C' });
    if (parsed.error) return parsed.error;
    const { opts } = parsed;
    let operands = parsed.operands;
    const modes = ['c', 'x', 't'].filter((m) => opts[m]);
    if (modes.length !== 1) return fail("tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options\nTry 'tar --help' or 'tar --usage' for more information.\n", 2);
    if (!opts.f) return fail('tar: Refusing to read archive contents from terminal (missing -f option?)\ntar: Error is not recoverable: exiting now\n', 2);
    const archive = operands[0];
    operands = operands.slice(1);
    const archiveAbs = ctx.sh.resolve(archive ?? '');
    try {
      if (opts.c) {
        if (!operands.length) return fail('tar: Cowardly refusing to create an empty archive\nTry \'tar --help\' or \'tar --usage\' for more information.\n', 2);
        const { entries, err } = packTar(ctx, operands);
        const content = TAR + JSON.stringify(entries);
        const size = entries.reduce((sum, entry) => sum + 512 + Math.ceil((entry.size ?? 0) / 512) * 512, 1024);
        const props = opts.z ? gzipNode(content, size) : { content, size, binary: true };
        ctx.fs.writeFile(archiveAbs, '');
        Object.assign(ctx.fs.lookup(archiveAbs), props);
        return { out: opts.v ? joinLines(entries.map((e) => e.path + (e.type === 'dir' ? '/' : ''))) : '', err, code: 0 };
      }
      let content = ctx.fs.readFile(archiveAbs);
      if (opts.z) {
        const data = gunzipContent(content);
        if (!data) return fail('gzip: stdin: not in gzip format\ntar: Child returned status 1\ntar: Error is not recoverable: exiting now\n', 2);
        content = data.content;
      } else if (content.startsWith(GZ)) {
        return fail('tar: This does not look like a tar archive\ntar: Skipping to next header\ntar: Exiting with failure status due to previous errors\n', 2);
      }
      if (!content.startsWith(TAR)) return fail('tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors\n', 2);
      const entries = JSON.parse(content.slice(TAR.length));
      if (opts.t) return ok(joinLines(entries.map((e) => e.path + (e.type === 'dir' ? '/' : ''))));
      const base = opts.C ? ctx.sh.resolve(opts.C) : ctx.sh.cwd;
      for (const entry of entries) {
        const abs = normalize(entry.path, base);
        if (entry.type === 'dir') ctx.fs.mkdir(abs, { parents: true });
        else if (entry.type === 'link') ctx.fs.symlink(entry.target, abs);
        else {
          if (ctx.fs.exists(abs)) ctx.fs.remove(abs);
          ctx.fs.createFile(abs, { content: entry.content, size: entry.size, binary: entry.binary });
        }
        ctx.fs.lookup(abs, { follow: false }).mode = entry.mode;
      }
      return ok(opts.v ? joinLines(entries.map((e) => e.path + (e.type === 'dir' ? '/' : ''))) : '');
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      return fail(`tar: ${archive}: Cannot open: ${e.message}\ntar: Error is not recoverable: exiting now\n`, 2);
    }
  },
};

// --- оболочка ---

const which = {
  help: 'which команда… — где лежит программа (путь к файлу).',
  run({ sh, fs, args }) {
    let out = '';
    let code = 0;
    for (const name of args) {
      const dirs = (sh.env.PATH ?? '').split(':');
      const found = dirs.map((dir) => normalize(name, dir)).find((path) => {
        try {
          const node = fs.lookup(path);
          return node.type === 'file' && (node.mode & 0o111);
        } catch (e) {
          return false;
        }
      });
      if (found) out += `${found}\n`;
      else if (COMMANDS[name] && !BUILTINS.has(name) && !COMMANDS[name].noWhich) out += `/usr/bin/${name}\n`;
      else code = 1;
    }
    return { out, err: '', code };
  },
};

const BUILTINS = new Set(['cd', 'export', 'source', '.', 'history', 'help', 'clear', 'exit']);

const exportCommand = {
  help: 'export ИМЯ=значение — переменная окружения.',
  run({ sh, args }) {
    for (const arg of args) {
      const eq = arg.indexOf('=');
      if (eq > 0) sh.env[arg.slice(0, eq)] = arg.slice(eq + 1);
    }
    return ok();
  },
};

const bash = {
  help: 'bash файл [аргументы] — выполнить скрипт (права x не нужны).',
  run({ sh, args }) {
    if (!args.length) return fail('bash: интерактивный bash не нужен — вы уже в нём\n');
    return sh.runFile(args[0], args.slice(1), { requireExec: false });
  },
};

const source = {
  help: 'source файл — выполнить скрипт в текущей оболочке (переменные и cd сохранятся).',
  run({ sh, args }) {
    if (!args.length) return fail('bash: source: filename argument required\nsource: usage: source filename [arguments]\n', 2);
    return sh.runFile(args[0], args.slice(1), { requireExec: false, inPlace: true });
  },
};

const history = {
  help: 'history — список введённых команд.',
  run: ({ sh }) => ok(joinLines(sh.history.map((line, i) => `${String(i + 1).padStart(5)}  ${line}`))),
};

const clear = {
  help: 'clear — очистить экран (или Ctrl+L).',
  run: () => ({ action: { type: 'clear' } }),
};

const nano = {
  help: `nano файл — открыть файл в редакторе.
Ctrl+O — сохранить, Ctrl+X — выйти.`,
  run({ sh, fs, args }) {
    const path = args.find((arg) => !arg.startsWith('-'));
    if (!path) return fail('nano: укажите файл: nano имя_файла\n');
    const abs = sh.resolve(path);
    try {
      if (fs.exists(abs) && fs.lookup(abs).type === 'dir') return fail(`nano: ${path} is a directory\n`);
      fs.lookup(dirname(abs));
    } catch (e) {
      return fail(`nano: ${path}: ${e.message}\n`);
    }
    return { action: { type: 'edit', path: abs, name: path } };
  },
};

const trueCommand = { help: 'true — ничего не делает, код выхода 0.', run: () => ok() };
const falseCommand = { help: 'false — ничего не делает, код выхода 1.', run: () => ({ code: 1 }) };

const man = {
  help: 'man команда — справочник (в тренажёре — команда --help).',
  run: ({ args }) => fail(`В тренажёре справочника man нет — наберите: ${args[0] ?? 'команда'} --help\n`, 16),
};

const notHere = (text) => ({ help: text, run: ({ name }) => fail(`${name}: ${text}\n`, 127) });

const help = {
  help: 'help — список команд тренажёра.',
  run: () => ok(`Команды тренажёра (у каждой есть --help):
  навигация:  pwd cd ls
  файлы:      cat touch mkdir rm rmdir cp mv ln nano
  текст:      echo head tail wc grep sort uniq cut
  поиск:      find du df
  права:      chmod chown chgrp whoami id sudo
  архивы:     tar gzip gunzip
  оболочка:   which export source bash history clear
Конвейер |, перенаправления > >> 2> 2>&1 <, цепочки && || ;
Код выхода последней команды — echo $?\n`),
};

export const COMMANDS = {
  pwd, cd, ls, cat, echo, mkdir, touch, rm, rmdir, cp, mv, ln,
  head, tail, wc, grep, sort, uniq, cut, find, du, df,
  chmod, chown, chgrp, whoami, id, sudo,
  tar, gzip, gunzip: gzip,
  which, export: exportCommand, bash, sh: bash, source, '.': source, history, clear, nano,
  true: trueCommand, false: falseCommand, man, help,
  python3: { ...notHere('Python в этом тренажёре не запускается — для кода есть тренажёр Python'), noWhich: true },
  python: { ...notHere('Python в этом тренажёре не запускается — для кода есть тренажёр Python'), noWhich: true },
  git: notHere('Git появится в тренажёре Git'),
  pip: notHere('pip появится вместе с тренажёром Git (venv и pip)'),
  apt: notHere('apt появится вместе с тренажёром Git'),
};
