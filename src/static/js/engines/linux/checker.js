// Правила задач в терминале (check.type: state) — по итоговому состоянию ФС и выводу.
// Формат — docs/content-format.md: path + exists | contains | mode | owner | link_to,
// или output_matches — вывод последней команды. Проверка идёт от root: права ученика
// не должны мешать проверке.

import { FsError, VirtualFS, dirname, normalize } from './fs.js';
import { Shell } from './shell.js';

const search = (pattern, text) => new RegExp(pattern, 'm').test(text);

/** true — правило не пройдено (правила Linux; Git добавляет свои — engines/git/checker.js). */
export function failedRule(rule, shell) {
  const { fs } = shell;
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
    if ('contains' in rule) {
      try {
        return !search(rule.contains, fs.readFile(rule.path));
      } catch (e) {
        return true;
      }
    }
    if ('mode' in rule) return (node.mode & 0o7777) !== parseInt(rule.mode, 8);
    if ('owner' in rule) return node.owner !== rule.owner;
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
 * Возвращает список проблем (пустой — всё хорошо).
 */
export function verifyTask(task, { makeShell = shellFromSetup, firstFailed = firstFailedRule } = {}) {
  const problems = [];
  const shell = makeShell(task.setup);
  for (const line of task.solution.split('\n')) {
    if (!line.trim()) continue;
    const { chunks } = shell.run(line);
    const errors = chunks.filter((chunk) => chunk.err).map((chunk) => chunk.text.trim());
    if (shell.status !== 0) problems.push(`команда «${line}» завершилась с кодом ${shell.status}: ${errors.join(' ')}`);
  }
  const failed = firstFailed(task.rules, shell);
  if (failed) problems.push(`эталон не проходит правило: ${failed.fail}`);
  if (!firstFailed(task.rules, makeShell(task.setup))) {
    problems.push('нетронутый setup проходит все правила — задачу нечего решать');
  }
  return problems;
}
