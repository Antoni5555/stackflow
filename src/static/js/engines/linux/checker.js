// Правила задач в терминале (check.type: state) — по итоговому состоянию ФС и выводу.
// Формат — docs/content-format.md: path + exists | contains | not_contains | mode | owner
// | group | link_to,
// или output_matches — вывод последней команды. Проверка идёт от root: права ученика
// не должны мешать проверке.

import { failedCronRule } from './cron.js';
import { FsError, VirtualFS, dirname, normalize } from './fs.js';
import { Shell } from './shell.js';
import { failedSystemRule } from './system.js';

const search = (pattern, text) => new RegExp(pattern, 'm').test(text);

/** Правила других модулей (учебный Docker): hook(rule, shell) → true | false | null (не его). */
export const ruleHooks = [];

/** true — правило не пройдено (правила Linux; Git добавляет свои — engines/git/checker.js). */
export function failedRule(rule, shell) {
  const { fs } = shell;
  // правила других модулей — первыми: у {docker: port} есть ключ port, как у правила порта
  for (const hook of ruleHooks) {
    const failed = hook(rule, shell);
    if (failed !== null) return failed;
  }
  const system = failedSystemRule(rule, fs);   // service: и process:
  if (system !== null) return system;
  const cron = failedCronRule(rule, fs);       // crontab:
  if (cron !== null) return cron;
  if ('output_matches' in rule) return !search(rule.output_matches, shell.lastOutput);
  return fs.as('root', () => {
    let node = null;
    try {
      node = fs.lookup(rule.path, { follow: false });
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
    }
    if ('exists' in rule) return Boolean(node) !== Boolean(rule.exists);
    if (!node) return true;
    // not_contains — шаблона в файле нет («маркеров конфликта не осталось»); файла нет — не пройдено
    for (const [key, found] of [['contains', false], ['not_contains', true]]) {
      if (!(key in rule)) continue;
      try {
        return search(rule[key], fs.readFile(rule.path)) === found;
      } catch (e) {
        return true;
      }
    }
    if ('mode' in rule) return (node.mode & 0o7777) !== parseInt(rule.mode, 8);
    if ('owner' in rule) return node.owner !== rule.owner;
    if ('group' in rule) return node.group !== rule.group;
    if ('link_to' in rule) {
      return node.type !== 'link'
        || normalize(node.target, dirname(normalize(rule.path))) !== normalize(rule.link_to);
    }
    return true;
  });
}

/** Первое непройденное правило или null. */
export function firstFailedRule(rules, shell) {
  return rules.find((rule) => failedRule(rule, shell)) ?? null;
}

/** Новая оболочка по setup задачи: cwd — из setup или домашняя папка. */
export function shellFromSetup(setup) {
  return new Shell(VirtualFS.fromSetup(setup), setup.cwd ? { cwd: setup.cwd } : {});
}

/**
 * Проверка эталона (тест сайта): solution проходит все правила, нетронутый setup — нет.
 * Каждая строка solution — с кодом 0, кроме ожидаемых неудач (expectedFailure по выводу).
 * Возвращает список проблем (пустой — всё хорошо).
 */
export function verifyTask(task, options = {}) {
  return verifySteps(task, options, (shell, line) => shell.run(line).chunks);
}

/**
 * То же для задач, где вывод приходит позже (psql в учебном Docker — PGlite асинхронный):
 * каждая строка дожидается своего вывода. Возвращает Promise со списком проблем.
 */
export async function verifyTaskAsync(task, options = {}) {
  const steps = [];
  const shell = (options.makeShell ?? shellFromSetup)(task.setup);
  for (const line of task.solution.split('\n')) {
    if (!line.trim()) continue;
    const result = shell.run(line);
    const later = result.pending ? (await result.pending).chunks : [];
    steps.push([line, [...result.chunks, ...later], shell.status]);
  }
  return verifySteps(task, { ...options, makeShell: () => shell, fresh: options.makeShell ?? shellFromSetup },
    null, steps);
}

function verifySteps(task, {
  makeShell = shellFromSetup, firstFailed = firstFailedRule, expectedFailure = () => false, fresh = makeShell,
} = {}, runLine = null, done = null) {
  const problems = [];
  const shell = makeShell(task.setup);
  const steps = done ?? task.solution.split('\n').filter((line) => line.trim())
    .map((line) => {
      const chunks = runLine(shell, line);
      return [line, chunks, shell.status];
    });
  for (const [line, chunks, code] of steps) {
    const errors = chunks.filter((chunk) => chunk.err).map((chunk) => chunk.text.trim());
    if (code !== 0 && !expectedFailure(chunks)) problems.push(`команда «${line}» завершилась с кодом ${code}: ${errors.join(' ')}`);
  }
  const failed = firstFailed(task.rules, shell);
  if (failed) problems.push(`эталон не проходит правило: ${failed.fail}`);
  if (!firstFailed(task.rules, fresh(task.setup))) {
    problems.push('нетронутый setup проходит все правила — задачу нечего решать');
  }
  return problems;
}
