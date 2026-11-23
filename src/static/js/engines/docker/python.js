// python внутри образов python:3.12: --version и простые однострочники
// python -c "print(2490 * 2)". Настоящего Python в учебном Docker нет (для кода — тренажёр
// Python), поэтому -c понимает только print() с числами, строками и арифметикой.

const VERSION = 'Python 3.12.16\n';
const LIMIT = 'в учебном Docker python -c понимает только print() с числами и строками — код пишите в тренажёре Python\n';

/** Число Python → текст: 4980, 2490.0, 0.1. */
function repr(value) {
  if (typeof value === 'string') return value;
  if (Number.isInteger(value.n) && !value.float) return String(value.n);
  if (Number.isInteger(value.n)) return `${value.n}.0`;
  return String(value.n);
}

/** Арифметика Python над числами: + - * / // % ** и скобки. null — не понимаем. */
function evaluate(text) {
  const tokens = text.match(/\d+\.\d*|\d+|\*\*|\/\/|[-+*/%()]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const num = (n, float) => ({ n, float });
  function atom() {
    const token = next();
    if (token === '(') {
      const value = sum();
      if (next() !== ')') throw new Error('syntax');
      return value;
    }
    if (token === '-') {
      const value = power();
      return num(-value.n, value.float);
    }
    if (/^\d/.test(token ?? '')) return num(Number(token), token.includes('.'));
    throw new Error('syntax');
  }
  function power() {
    const base = atom();
    if (peek() === '**') {
      next();
      const exp = power();
      return num(base.n ** exp.n, base.float || exp.float || exp.n < 0);
    }
    return base;
  }
  function product() {
    let left = power();
    while (['*', '/', '//', '%'].includes(peek())) {
      const op = next();
      const right = power();
      if ((op !== '*') && right.n === 0) throw new Error('zero');
      const float = left.float || right.float;
      if (op === '*') left = num(left.n * right.n, float);
      else if (op === '/') left = num(left.n / right.n, true);
      else if (op === '//') left = num(Math.floor(left.n / right.n), float);
      else left = num(((left.n % right.n) + right.n) % right.n, float);
    }
    return left;
  }
  function sum() {
    let left = product();
    while (['+', '-'].includes(peek())) {
      const op = next();
      const right = product();
      left = num(op === '+' ? left.n + right.n : left.n - right.n, left.float || right.float);
    }
    return left;
  }
  const value = sum();
  if (i !== tokens.length) throw new Error('syntax');
  return value;
}

/** Аргумент print: 'текст', "текст" или выражение. */
function printArg(text) {
  const quoted = /^\s*(['"])(.*)\1\s*$/.exec(text);
  if (quoted) return quoted[2];
  return repr(evaluate(text));
}

export const python = {
  help: 'python — Python 3.12 в контейнере: python --version, python -c "print(2 * 3)".',
  run({ args }) {
    if (args[0] === '--version' || args[0] === '-V') return { out: VERSION };
    if (args[0] !== '-c') {
      if (!args.length) return {};     // без терминала: читает пустой ввод и выходит
      return { err: LIMIT, code: 1 };
    }
    if (args.length < 2) return { err: 'Argument expected for the -c option\nusage: python3 [option] ... [-c cmd | -m mod | file | -] [arg] ...\nTry `python -h\' for more information.\n', code: 2 };
    const lines = [];
    for (const statement of args[1].split(/;|\n/).map((part) => part.trim()).filter(Boolean)) {
      const call = /^print\((.*)\)$/.exec(statement);
      if (!call) return { out: lines.join(''), err: LIMIT, code: 1 };
      try {
        const parts = call[1].trim() ? call[1].split(',').map(printArg) : [];
        lines.push(`${parts.join(' ')}\n`);
      } catch (e) {
        if (e.message === 'zero') {
          return { out: lines.join(''), err: 'Traceback (most recent call last):\n  File "<string>", line 1, in <module>\nZeroDivisionError: division by zero\n', code: 1 };
        }
        return { out: lines.join(''), err: LIMIT, code: 1 };
      }
    }
    return { out: lines.join('') };
  },
};
