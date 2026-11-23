// test и [ … ] — проверки в if, как встроенная команда bash 5.2 (ошибки дословно).
// До 4 аргументов — правила POSIX (как в bash), больше — разбор с -a, -o, !, ( ).

import { FsError } from './fs.js';

const UNARY = new Set(['-e', '-f', '-d', '-s', '-r', '-w', '-x', '-L', '-h', '-z', '-n']);
const BINARY = new Set(['=', '==', '!=', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge']);

class TestError extends Error {}

function integer(text) {
  if (!/^\s*[+-]?\d+\s*$/.test(text)) throw new TestError(`${text}: integer expression expected`);
  return Number(text);
}

function unary(ctx, op, value) {
  if (op === '-z') return value === '';
  if (op === '-n') return value !== '';
  const { fs, sh } = ctx;
  try {
    const path = sh.resolve(value);
    if (op === '-L' || op === '-h') return fs.lookup(path, { follow: false }).type === 'link';
    const node = fs.lookup(path);
    if (op === '-e') return true;
    if (op === '-f') return node.type === 'file';
    if (op === '-d') return node.type === 'dir';
    if (op === '-s') return node.type === 'dir' || (node.size ?? 0) > 0;
    return fs.can(node, op[1]);                    // -r -w -x
  } catch (e) {
    if (e instanceof FsError) return false;
    throw e;
  }
}

function binary(left, op, right) {
  switch (op) {
    case '=': case '==': return left === right;
    case '!=': return left !== right;
    case '<': return left < right;
    case '>': return left > right;
    case '-eq': return integer(left) === integer(right);
    case '-ne': return integer(left) !== integer(right);
    case '-lt': return integer(left) < integer(right);
    case '-le': return integer(left) <= integer(right);
    case '-gt': return integer(left) > integer(right);
    default: return integer(left) >= integer(right);
  }
}

/** Общий разбор для 4+ аргументов: expr → and (-o) → term (-a) → ! ( ) унарные, бинарные. */
function parseExpression(ctx, args) {
  let pos = 0;
  const term = () => {
    if (pos >= args.length) throw new TestError('argument expected');
    const arg = args[pos];
    if (arg === '!') {
      pos += 1;
      return !term();
    }
    if (arg === '(') {
      pos += 1;
      const value = expr();
      if (args[pos] !== ')') throw new TestError("`)' expected");
      pos += 1;
      return value;
    }
    if (pos + 2 < args.length && BINARY.has(args[pos + 1])) {
      pos += 3;
      return binary(arg, args[pos - 2], args[pos - 1]);
    }
    if (UNARY.has(arg) && pos + 1 < args.length) {
      pos += 2;
      return unary(ctx, arg, args[pos - 1]);
    }
    pos += 1;
    return arg !== '';
  };
  const and = () => {
    let value = term();
    while (args[pos] === '-a') {
      pos += 1;
      value = term() && value;
    }
    return value;
  };
  const expr = () => {
    let value = and();
    while (args[pos] === '-o') {
      pos += 1;
      value = and() || value;
    }
    return value;
  };
  const value = expr();
  if (pos < args.length) throw new TestError('too many arguments');
  return value;
}

/** Правила POSIX по числу аргументов (так делает bash). */
function evaluate(ctx, args) {
  const [a, b, c] = args;
  switch (args.length) {
    case 0: return false;
    case 1: return a !== '';
    case 2:
      if (a === '!') return b === '';
      if (UNARY.has(a)) return unary(ctx, a, b);
      throw new TestError(`${a}: unary operator expected`);
    case 3:
      if (BINARY.has(b)) return binary(a, b, c);
      if (b === '-a') return a !== '' && c !== '';
      if (b === '-o') return a !== '' || c !== '';
      if (a === '!') return !evaluate(ctx, [b, c]);
      if (a === '(' && c === ')') return b !== '';
      throw new TestError(`${b}: binary operator expected`);
    case 4:
      if (a === '!') return !evaluate(ctx, args.slice(1));
      if (a === '(' && args[3] === ')') return evaluate(ctx, [b, c]);
      return parseExpression(ctx, args);
    default:
      return parseExpression(ctx, args);
  }
}

function run(ctx, name, args) {
  if (args.length === 1 && args[0] === '--help') return { out: `${HELP}\n`, err: '', code: 0 };
  const prefix = `${ctx.sh.errPrefix()}${name}: `;
  if (name === '[') {
    if (args[args.length - 1] !== ']') return { out: '', err: `${prefix}missing \`]'\n`, code: 2 };
    args = args.slice(0, -1);
  }
  try {
    return { out: '', err: '', code: evaluate(ctx, args) ? 0 : 1 };
  } catch (e) {
    if (!(e instanceof TestError)) throw e;
    return { out: '', err: `${prefix}${e.message}\n`, code: 2 };
  }
}

const HELP = `test условие  или  [ условие ] — проверка для if: код 0 — да, 1 — нет.
Пробелы обязательны: [ -f file ], а не [-f file].
  -e путь   существует        -f файл     обычный файл
  -d папка  папка             -s файл     не пустой
  -r -w -x  можно читать / писать / запускать
  -z текст  пустая строка     -n текст    не пустая
  a = b, a != b          строки равны / не равны
  1 -eq 2  -ne -lt -le -gt -ge   числа: = ≠ < ≤ > ≥
  ! условие — не; -a — и; -o — или
Пример: if [ -d /backups ]; then echo есть; fi`;

// noHelp: [ "$1" = --help ] — это сравнение, а не просьба о справке
export const testCommand = { noHelp: true, run: (ctx) => run(ctx, 'test', ctx.args) };
export const bracket = { noHelp: true, run: (ctx) => run(ctx, '[', ctx.args) };
