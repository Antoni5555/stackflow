// Правила задач Git (check.type: state, курс с движком git). Формат — docs/content-format.md:
// все правила Linux плюс branch, tag, tracked, staged (по умолчанию «есть», exists: false — «нет»),
// head, commit_in, commit_count, clean, merged, pushed, config, stash_count, pip_package.
// Репозиторий — setup.repo (или setup.cwd): правило смотрит туда, куда бы ни ушёл ученик.

import { failedRule as failedLinuxRule, verifyTask } from '../linux/checker.js';
import { HOME, normalize } from '../linux/fs.js';
import { openRepo, statusData } from './commands.js';
import { gitShellFromSetup } from './index.js';
import { installed, canonical } from './python.js';
import { server } from './remote.js';
import { ancestors, configValue, findRoot, headTree } from './repo.js';

const search = (pattern, text) => new RegExp(pattern, 'm').test(text);
const GIT_KEYS = ['branch', 'tag', 'tracked', 'staged', 'head', 'commit_in', 'commit_count',
  'clean', 'merged', 'pushed', 'config', 'stash_count', 'pip_package'];

/** Репозиторий задачи: открыт как из его корня (не из текущей папки ученика). */
function repoContext(shell, setup) {
  const where = setup.repo ?? setup.cwd ?? HOME;
  const root = findRoot(shell.fs, where);
  if (!root) return null;
  return openRepo({ sh: { ...shell, cwd: root, resolve: (path) => normalize(path, root) }, fs: shell.fs, args: [] });
}

/** true — правило не пройдено. */
function failedGitRule(rule, shell, setup) {
  const key = GIT_KEYS.find((name) => name in rule);
  if (!key) return failedLinuxRule(rule, shell);
  const expectYes = rule.exists !== false;
  if (key === 'config') {
    const g = repoContext(shell, setup);
    const value = configValue(shell.fs, g?.repo ?? null, rule.config.key);
    return value === undefined || !search(rule.config.value ?? '', value);
  }
  if (key === 'pip_package') {
    const venv = normalize(rule.venv ?? 'venv', setup.cwd ?? setup.repo ?? HOME);
    const version = installed(shell.fs, venv)[canonical(rule.pip_package.name)];
    return !version || (rule.pip_package.version !== undefined && version !== String(rule.pip_package.version));
  }
  const g = repoContext(shell, setup);
  if (!g) return true;                                // репозитория нет — ни одно правило Git не выполнено
  const { repo } = g;
  switch (key) {
    case 'branch':
      return (rule.branch in repo.heads) !== expectYes;
    case 'tag':
      return (rule.tag in repo.tags) !== expectYes;
    case 'tracked':
      return (rule.tracked in headTree(repo)) !== expectYes;
    case 'staged': {
      const inIndex = repo.index[rule.staged] !== headTree(repo)[rule.staged];
      return inIndex !== expectYes;
    }
    case 'head':
      return repo.head.branch !== rule.head;
    case 'commit_in': {
      const tip = repo.heads[rule.commit_in.branch];
      if (!tip) return true;
      return ![...ancestors(repo, tip)].some((id) => search(rule.commit_in.message, repo.commits[id].message));
    }
    case 'commit_count': {
      const tip = repo.heads[rule.commit_count.branch];
      return (tip ? ancestors(repo, tip).size : 0) !== Number(rule.commit_count.count);
    }
    case 'clean': {
      const { staged, unstaged, untracked, conflicts } = statusData(g);
      const clean = !staged.length && !unstaged.length && !untracked.length && !conflicts.length && !repo.state;
      return clean !== Boolean(rule.clean);
    }
    case 'merged': {
      const [from, into] = [repo.heads[rule.merged.from], repo.heads[rule.merged.into]];
      return !from || !into || !ancestors(repo, into).has(from);
    }
    case 'pushed': {
      const url = repo.remotes.origin;
      const remote = url && server(shell.fs, url);
      return !remote || !repo.heads[rule.pushed] || remote.heads[rule.pushed] !== repo.heads[rule.pushed];
    }
    case 'stash_count':
      return repo.stash.length !== Number(rule.stash_count);
    default:
      return true;
  }
}

/** Первое непройденное правило задачи Git или null. */
export function firstFailedGitRule(rules, shell, setup) {
  return rules.find((rule) => failedGitRule(rule, shell, setup)) ?? null;
}

/** Проверка эталона задачи Git (тест сайта): как у Linux, но оболочка — с репозиторием. */
export function verifyGitTask(task) {
  return verifyTask(task, {
    makeShell: gitShellFromSetup,
    firstFailed: (rules, shell) => firstFailedGitRule(rules, shell, task.setup),
  });
}
