// Команда git Linux-симулятора: git <подкоманда> …. Вывод и ошибки — как у настоящего
// git 2.43 (на английском): их цитируют уроки. Редактора нет: commit без -m — ошибка,
// merge, revert и продолжение слияния берут сообщение по умолчанию.

import { FsError, normalize } from '../linux/fs.js';
import { countChanges, merge3, toLines, unifiedHunks, diffLines } from './diff.js';
import {
  GLOBAL_CONFIG, ancestors, configValue, decorations, emptyRepo, findRoot, formatConfig,
  globalConfig, headId, headTree, makeCommit, makeId, makeIgnore, mergeBase, moveHead, repoAt,
  resolveRev, short, workTree, writeWork,
} from './repo.js';

const NOT_REPO = 'fatal: not a git repository (or any of the parent directories): .git\n';

const ok = (out = '') => ({ out, err: '', code: 0 });
const fail = (err, code = 1) => ({ out: '', err, code });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Флаги подкоманды: --long, --key=value, -m "текст", -n 5, -5; values — флаги со значением. */
function parse(args, values = []) {
  const opts = {};
  const rest = [];
  const paths = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      paths.push(...args.slice(i + 1));
      break;
    }
    const eq = /^(--[\w-]+)=(.*)$/s.exec(arg);
    if (eq) {
      (opts[eq[1]] ??= []).push(eq[2]);
    } else if (values.includes(arg)) {
      (opts[arg] ??= []).push(args[i + 1] ?? '');
      i += 1;
    } else if (/^-[A-Za-z]/.test(arg) && values.includes(arg.slice(0, 2)) && arg.length > 2) {
      (opts[arg.slice(0, 2)] ??= []).push(arg.slice(2));        // -Sтекст, -n5
    } else if (/^-\d+$/.test(arg)) {
      opts['-n'] = [arg.slice(1)];
    } else if (/^-[A-Za-z]{2,}$/.test(arg) && !values.some((v) => arg.startsWith(v))) {
      // флаги вместе: -am "текст" → -a и -m "текст" (значение — у последнего)
      for (const ch of arg.slice(1)) {
        const key = `-${ch}`;
        if (values.includes(key)) {
          (opts[key] ??= []).push(args[i + 1] ?? '');
          i += 1;
        } else {
          opts[key] = [true];
        }
      }
    } else if (arg.startsWith('-') && arg !== '-') {
      opts[arg] = [true];
    } else {
      rest.push(arg);
    }
  }
  const has = (...names) => names.some((name) => name in opts);
  const value = (...names) => names.map((name) => opts[name]).find(Boolean)?.slice(-1)[0];
  const all = (...names) => names.flatMap((name) => opts[name] ?? []);
  return { opts, rest, paths, has, value, all };
}

// --- общее для подкоманд ---

/** Контекст репозитория: корень, данные, пути относительно корня и текущей папки. */
function open(ctx) {
  const root = findRoot(ctx.fs, ctx.sh.cwd);
  if (!root) return null;
  const repo = repoAt(ctx.fs, root);
  const g = { ...ctx, root, repo };
  /** Путь из аргумента → путь от корня репозитория ('' — сам корень). */
  g.rel = (path) => {
    const abs = ctx.sh.resolve(path);
    if (abs === root) return '';
    if (!abs.startsWith(`${root}/`)) throw new GitError(`fatal: ${path}: '${path}' is outside repository at '${root}'\n`, 128);
    return abs.slice(root.length + 1);
  };
  /** Путь от корня → как его покажет status (от текущей папки). */
  g.show = (rel) => {
    const from = ctx.sh.cwd === root ? [] : ctx.sh.cwd.slice(root.length + 1).split('/');
    const to = rel.split('/');
    let common = 0;
    while (common < from.length && from[common] === to[common]) common += 1;
    return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/');
  };
  g.work = () => workTree(ctx.fs, root);
  g.ignore = () => makeIgnore(g.work()['.gitignore']);
  g.write = (rel, text) => writeWork(ctx.fs, root, rel, text);
  g.branchLabel = () => repo.head.branch ?? `HEAD detached at ${short(repo.head.detached)}`;
  return g;
}

class GitError extends Error {
  constructor(text, code = 1) {
    super(text);
    this.text = text;
    this.code = code;
  }
}

/** Пути под префиксом ('' или '.' — все). */
const under = (paths, prefix) => paths.filter((path) => !prefix || path === prefix || path.startsWith(`${prefix}/`));

function identity(g) {
  const name = configValue(g.fs, g.repo, 'user.name');
  const email = configValue(g.fs, g.repo, 'user.email');
  if (!name || !email) {
    throw new GitError(`Author identity unknown

*** Please tell me who you are.

Run

  git config --global user.email "you@example.com"
  git config --global user.name "Your Name"

to set your account's default identity.
Omit --global to set the identity only in this repository.

fatal: unable to auto-detect email address (got 'shop@server.(none)')
`, 128);
  }
  return { author: name, email };
}

/** Строка статистики: «2 files changed, 3 insertions(+), 1 deletion(-)» + create/delete mode. */
function stat(before, after) {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter((path) => before[path] !== after[path]);
  if (!paths.length) return '';
  let added = 0;
  let removed = 0;
  let modes = '';
  for (const path of paths) {
    const change = countChanges(before[path] ?? '', after[path] ?? '');
    added += change.added;
    removed += change.removed;
    if (!(path in before)) modes += ` create mode 100644 ${path}\n`;
    if (!(path in after)) modes += ` delete mode 100644 ${path}\n`;
  }
  let line = ` ${plural(paths.length, 'file', 'files')} changed`;
  if (added || !removed) line += `, ${plural(added, 'insertion(+)', 'insertions(+)')}`;
  if (removed || !added) line += `, ${plural(removed, 'deletion(-)', 'deletions(-)')}`;
  return `${line}\n${modes}`;
}

/** Есть ли изменения, которые затронет переход на дерево target (status «грязный»). */
function dirtyPaths(g, target) {
  const head = headTree(g.repo);
  const work = g.work();
  return [...new Set([...Object.keys(head), ...Object.keys(target)])]
    .filter((path) => head[path] !== target[path])
    .filter((path) => (path in g.repo.index ? g.repo.index[path] !== head[path] : path in head)
      || (path in work ? work[path] !== (g.repo.index[path] ?? head[path]) : path in head));
}

function overwriteError(paths, what) {
  return new GitError(`error: Your local changes to the following files would be overwritten by ${what}:
${paths.map((path) => `\t${path}`).join('\n')}
Please commit your changes or stash them before you ${what === 'checkout' ? 'switch branches' : what}.
Aborting
`, 1);
}

/** Перенести рабочую папку и индекс с дерева HEAD на дерево target (switch, reset --hard). */
function checkoutTree(g, target, { force = false } = {}) {
  const head = headTree(g.repo);
  if (!force) {
    const dirty = dirtyPaths(g, target);
    if (dirty.length) throw overwriteError(dirty, 'checkout');
  }
  for (const path of new Set([...Object.keys(head), ...Object.keys(target), ...(force ? Object.keys(g.repo.index) : [])])) {
    if (!force && head[path] === target[path]) continue;
    g.write(path, target[path] ?? null);
    if (path in target) g.repo.index[path] = target[path];
    else delete g.repo.index[path];
  }
}

/** Слияние деревьев: {tree, conflicts: [путь], kinds: {путь: content | modify/delete}}. */
function mergeTrees(base, ours, theirs, labels) {
  const tree = {};
  const conflicts = [];
  const kinds = {};
  for (const path of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
    const [b, o, t] = [base[path], ours[path], theirs[path]];
    let result;
    if (o === t) result = o;
    else if (b === o) result = t;
    else if (b === t) result = o;
    else if (o === undefined || t === undefined) {
      result = o ?? t;                        // удалён с одной стороны, изменён с другой
      conflicts.push(path);
      kinds[path] = 'modify/delete';
    } else {
      const merged = merge3(b ?? '', o, t, labels);
      result = merged.text;
      if (merged.conflict) {
        conflicts.push(path);
        kinds[path] = b === undefined ? 'add/add' : 'content';
      }
    }
    if (result !== undefined) tree[path] = result;
  }
  return { tree, conflicts: conflicts.sort(), kinds };
}

/**
 * Применить слияние к рабочей папке: файлы с конфликтами — с маркерами, в индексе — наша
 * версия; остальное — в индекс сразу. Возвращает вывод «Auto-merging / CONFLICT».
 */
function applyMerge(g, merged, theirsTree) {
  const head = headTree(g.repo);
  let out = '';
  for (const path of Object.keys({ ...head, ...merged.tree })) {
    if (head[path] === merged.tree[path]) continue;
    g.write(path, merged.tree[path] ?? null);
    if (merged.conflicts.includes(path)) continue;
    if (path in merged.tree) g.repo.index[path] = merged.tree[path];
    else delete g.repo.index[path];
  }
  for (const path of merged.conflicts) {
    if (merged.kinds[path] === 'content' || merged.kinds[path] === 'add/add') {
      out += `Auto-merging ${path}\nCONFLICT (${merged.kinds[path]}): Merge conflict in ${path}\n`;
    } else {
      const deleted = path in theirsTree ? 'HEAD' : 'theirs';
      out += `CONFLICT (modify/delete): ${path} deleted in ${deleted} and modified in the other. Version of ${path} left in tree.\n`;
    }
  }
  return out;
}

// --- подкоманды ---

const SUB = {};

SUB.init = (ctx) => {
  const dir = ctx.sh.resolve(ctx.args[0] ?? '.');
  const gitDir = normalize('.git', dir);
  if (ctx.fs.exists(gitDir) && ctx.fs.lookup(gitDir).repo) {
    return ok(`Reinitialized existing Git repository in ${gitDir}/\n`);
  }
  ctx.fs.mkdir(dir, { parents: true });
  ctx.fs.mkdir(gitDir);
  ctx.fs.lookup(gitDir).repo = emptyRepo();
  return ok(`Initialized empty Git repository in ${gitDir}/\n`);
};

SUB.config = (ctx) => {
  const p = parse(ctx.args);
  const global = p.has('--global');
  const g = global ? null : open(ctx);
  if (!global && !g && !p.has('--list', '-l')) return fail('fatal: not in a git directory\n', 128);
  const values = global ? globalConfig(ctx.fs) : g.repo.config;
  const save = () => {
    if (global) ctx.fs.writeFile(GLOBAL_CONFIG, formatConfig(values));
  };
  if (p.has('--list', '-l')) {
    const lines = [
      ...Object.entries(global ? values : globalConfig(ctx.fs)),
      ...(global ? [] : Object.entries(g?.repo.config ?? {})),
    ];
    return ok(lines.map(([key, value]) => `${key}=${value}\n`).join(''));
  }
  const [key, value] = p.rest;
  if (!key) return fail('usage: git config [<options>]\n', 129);
  if (!/^[\w-]+\.[\w.-]+$/.test(key)) return fail(`error: key does not contain a section: ${key}\n`);
  if (p.has('--unset')) {
    delete values[key];
    save();
    return ok();
  }
  if (value === undefined) {
    const found = global ? values[key] : configValue(ctx.fs, g.repo, key);
    return found === undefined ? { out: '', err: '', code: 1 } : ok(`${found}\n`);
  }
  values[key] = value;
  save();
  return ok();
};

/** Состояние трёх областей: staged, unstaged, untracked, conflicts. */
export function statusData(g) {
  const head = headTree(g.repo);
  const { index } = g.repo;
  const work = g.work();
  const ignore = makeIgnore(work['.gitignore']);
  const conflicts = g.repo.state?.conflicts ?? [];
  const staged = [];
  for (const path of [...new Set([...Object.keys(head), ...Object.keys(index)])].sort()) {
    if (conflicts.includes(path)) continue;
    if (!(path in head)) staged.push(['new file', path]);
    else if (!(path in index)) staged.push(['deleted', path]);
    else if (head[path] !== index[path]) staged.push(['modified', path]);
  }
  const unstaged = [];
  for (const path of Object.keys(index).sort()) {
    if (conflicts.includes(path)) continue;
    if (!(path in work)) unstaged.push(['deleted', path]);
    else if (work[path] !== index[path]) unstaged.push(['modified', path]);
  }
  const untrackedFiles = Object.keys(work).filter((path) => !(path in index) && !ignore(path)).sort();
  const untracked = [];
  for (const path of untrackedFiles) {
    // неотслеживаемая папка целиком показывается одной строкой «dir/»
    const parts = path.split('/');
    let shown = path;
    for (let i = 1; i < parts.length; i += 1) {
      const dir = parts.slice(0, i).join('/');
      if (!Object.keys(index).some((tracked) => tracked.startsWith(`${dir}/`))) {
        shown = `${dir}/`;
        break;
      }
    }
    if (!untracked.includes(shown)) untracked.push(shown);
  }
  return { staged, unstaged, untracked, untrackedFiles, conflicts };
}

/** Строки «Your branch is ahead of 'origin/main' by 1 commit.» */
function trackingInfo(g) {
  const branch = g.repo.head.branch;
  const upstream = branch && g.repo.upstream[branch];
  if (!upstream || !(upstream in g.repo.remoteHeads)) return '';
  const local = ancestors(g.repo, g.repo.heads[branch]);
  const remote = ancestors(g.repo, g.repo.remoteHeads[upstream]);
  const ahead = [...local].filter((id) => !remote.has(id)).length;
  const behind = [...remote].filter((id) => !local.has(id)).length;
  if (ahead && behind) {
    return `Your branch and '${upstream}' have diverged,\nand have ${ahead} and ${behind} different commits each, respectively.\n  (use "git pull" if you want to integrate the remote branch with yours)\n`;
  }
  if (ahead) return `Your branch is ahead of '${upstream}' by ${plural(ahead, 'commit', 'commits')}.\n  (use "git push" to publish your local commits)\n`;
  if (behind) return `Your branch is behind '${upstream}' by ${plural(behind, 'commit', 'commits')}, and can be fast-forwarded.\n  (use "git pull" to update your local branch)\n`;
  return `Your branch is up to date with '${upstream}'.\n`;
}

function statusText(g) {
  const { staged, unstaged, untracked, conflicts } = statusData(g);
  const { repo } = g;
  let out = repo.head.branch ? `On branch ${repo.head.branch}\n` : `HEAD detached at ${short(repo.head.detached)}\n`;
  out += trackingInfo(g);
  const state = repo.state;
  if (state?.type === 'merge') {
    out += conflicts.length
      ? 'You have unmerged paths.\n  (fix conflicts and run "git commit")\n  (use "git merge --abort" to abort the merge)\n'
      : 'All conflicts fixed but you are still merging.\n  (use "git commit" to conclude merge)\n';
  } else if (state?.type === 'rebase') {
    out += `You are currently rebasing branch '${state.branch}' on '${short(state.onto)}'.\n  (fix conflicts and then run "git rebase --continue")\n  (use "git rebase --abort" to check out the original branch)\n`;
  } else if (state && state.type !== 'stash') {
    const name = state.type;
    out += `You are currently ${name === 'revert' ? 'reverting' : 'cherry-picking'} commit ${short(state.commit)}.\n  (fix conflicts and run "git ${name} --continue")\n  (use "git ${name} --abort" to cancel the ${name} operation)\n`;
  }
  if (!headId(repo)) out += '\nNo commits yet\n';
  const section = (title, hints, items) => {
    if (!items.length) return '';
    // «new file:   a.txt» — подпись выровнена, после неё минимум 3 пробела, как у git
    const label = (kind) => (kind ? `${kind}:`.padEnd(Math.max(12, kind.length + 4)) : '');
    return `\n${title}:\n${hints.map((hint) => `  (${hint})\n`).join('')}${items.map(([kind, path]) => `\t${label(kind)}${g.show(path)}\n`).join('')}`;
  };
  out += section('Changes to be committed', [headId(repo) ? 'use "git restore --staged <file>..." to unstage' : 'use "git rm --cached <file>..." to unstage'], staged);
  out += section('Unmerged paths', ['use "git add <file>..." to mark resolution'], conflicts.map((path) => ['both modified', path]));
  out += section('Changes not staged for commit', ['use "git add <file>..." to update what will be committed', 'use "git restore <file>..." to discard changes in working directory'], unstaged);
  out += section('Untracked files', ['use "git add <file>..." to include in what will be committed'], untracked.map((path) => ['', path]));
  out += '\n';
  if (staged.length || conflicts.length) return out.replace(/\n\n$/, '\n');
  if (unstaged.length) return `${out}no changes added to commit (use "git add" and/or "git commit -a")\n`;
  if (untracked.length) return `${out}nothing added to commit but untracked files present (use "git add" to track)\n`;
  return `${out.replace(/\n\n$/, '\n')}${headId(repo) ? 'nothing to commit, working tree clean' : 'nothing to commit (create/copy files and use "git add" to track)'}\n`;
}

SUB.status = (g) => {
  const p = parse(g.args);
  if (!p.has('-s', '--short')) return ok(statusText(g));
  const { staged, unstaged, untracked, conflicts } = statusData(g);
  const codes = {};
  const letter = { 'new file': 'A', modified: 'M', deleted: 'D' };
  for (const [kind, path] of staged) codes[path] = `${letter[kind]} `;
  for (const [kind, path] of unstaged) codes[path] = `${(codes[path] ?? '  ')[0]}${letter[kind]}`;
  for (const path of conflicts) codes[path] = 'UU';
  const lines = Object.keys(codes).sort().map((path) => `${codes[path]} ${g.show(path)}`);
  lines.push(...untracked.map((path) => `?? ${g.show(path)}`));
  return ok(lines.length ? `${lines.join('\n')}\n` : '');
};

SUB.add = (g) => {
  const p = parse(g.args);
  const force = p.has('-f', '--force');
  let specs = [...p.rest, ...p.paths];
  if (p.has('-A', '--all')) specs = [g.sh.cwd === g.root ? '.' : g.root];
  if (!specs.length) return ok('Nothing specified, nothing added.\nhint: Maybe you wanted to say \'git add .\'?\n');
  const work = g.work();
  const ignore = makeIgnore(work['.gitignore']);
  const { index } = g.repo;
  const ignored = [];
  const plan = [];
  for (const spec of specs) {
    const prefix = g.rel(spec);
    const paths = under([...new Set([...Object.keys(work), ...Object.keys(index)])], prefix);
    if (!paths.length) {
      if (ignore(prefix) && !force) {
        ignored.push(spec);
        continue;
      }
      return fail(`fatal: pathspec '${spec}' did not match any files\n`, 128);
    }
    for (const path of paths) {
      if (path in work && !(path in index) && ignore(path) && !force) {
        if (path === prefix) ignored.push(spec);
        continue;
      }
      plan.push(path);
    }
  }
  for (const path of plan) {
    if (path in work) index[path] = work[path];
    else delete index[path];
    if (g.repo.state?.conflicts) g.repo.state.conflicts = g.repo.state.conflicts.filter((item) => item !== path);
  }
  // конфликт после stash pop решён — особого состояния больше нет
  if (g.repo.state?.type === 'stash' && !g.repo.state.conflicts.length) g.repo.state = null;
  if (ignored.length) {
    return fail(`The following paths are ignored by one of your .gitignore files:\n${ignored.join('\n')}\nhint: Use -f if you really want to add them.\nhint: Turn this message off by running\nhint: "git config advice.addIgnoredFile false"\n`);
  }
  return ok();
};

SUB.rm = (g) => {
  const p = parse(g.args);
  const cached = p.has('--cached');
  const recursive = p.has('-r');
  const { index } = g.repo;
  let out = '';
  const remove = [];
  for (const spec of [...p.rest, ...p.paths]) {
    const prefix = g.rel(spec);
    const paths = under(Object.keys(index), prefix);
    if (!paths.length) return fail(`fatal: pathspec '${spec}' did not match any files\n`, 128);
    if (!recursive && !(prefix in index)) return fail(`fatal: not removing '${spec}' recursively without -r\n`, 128);
    remove.push(...paths);
  }
  if (!remove.length) return fail('usage: git rm [-f | --force] [-n] [-r] [--cached] [--ignore-unmatch]\n', 129);
  for (const path of remove.sort()) {
    delete index[path];
    if (!cached) g.write(path, null);
    out += `rm '${path}'\n`;
  }
  return ok(out);
};

SUB.commit = (g) => {
  const p = parse(g.args, ['-m', '--message']);
  const { repo } = g;
  const state = repo.state;
  if (state?.conflicts?.length) {
    return fail("error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.\n", 128);
  }
  const amend = p.has('--amend');
  const parentId = headId(repo);
  if (amend && !parentId) return fail('fatal: You have nothing to amend.\n', 128);
  if (p.has('-a', '--all')) {
    const work = g.work();
    for (const path of Object.keys(repo.index)) {
      if (path in work) repo.index[path] = work[path];
      else delete repo.index[path];
    }
  }
  let message = p.all('-m', '--message').filter((m) => m !== true).join('\n\n');
  if (!message && amend && p.has('--no-edit')) message = repo.commits[parentId].message;
  if (!message && ['merge', 'revert', 'cherry-pick'].includes(state?.type)) message = state.message;
  if (!message) {
    return fail('error: в тренажёре нет редактора для сообщения коммита.\nНапишите его сразу: git commit -m "что сделано"\n');
  }
  const old = amend ? repo.commits[parentId] : null;
  const parents = amend ? old.parents
    : [parentId, ...(state?.type === 'merge' ? [state.theirs] : [])].filter(Boolean);
  const before = parents[0] ? repo.commits[parents[0]].tree : {};
  if (!amend && !state && JSON.stringify(sortTree(repo.index)) === JSON.stringify(sortTree(headTree(repo))) && !p.has('--allow-empty')) {
    return { out: statusText(g), err: '', code: 1 };
  }
  const who = identity(g);
  const id = makeCommit(repo, { tree: repo.index, message, parents, ...who });
  const reason = amend ? 'commit (amend)' : state?.type === 'merge' ? 'commit (merge)' : parentId ? 'commit' : 'commit (initial)';
  moveHead(repo, id, `${reason}: ${message.split('\n')[0]}`);
  if (state && state.type !== 'rebase') repo.state = null;
  const where = repo.head.branch ? `${repo.head.branch}${parentId ? '' : ' (root-commit)'}` : 'detached HEAD';
  return ok(`[${where} ${short(id)}] ${message.split('\n')[0]}\n${stat(before, repo.index)}`);
};

const sortTree = (tree) => Object.fromEntries(Object.entries(tree).sort());

// --- история ---

function formatDate(ms, iso = false) {
  const date = new Date(ms);
  const offset = -date.getTimezoneOffset();
  const zone = `${offset >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}${String(Math.abs(offset) % 60).padStart(2, '0')}`;
  const time = date.toTimeString().slice(0, 8);
  if (iso) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${time} ${zone}`;
  }
  const [weekday, month, day, year] = date.toDateString().split(' ');
  return `${weekday} ${month} ${Number(day)} ${time} ${year} ${zone}`;
}

function commitHeader(repo, commit) {
  const labels = decorations(repo, commit.id);
  let out = `commit ${commit.id}${labels.length ? ` (${labels.join(', ')})` : ''}\n`;
  if (commit.parents.length > 1) out += `Merge: ${commit.parents.map(short).join(' ')}\n`;
  out += `Author: ${commit.author} <${commit.email}>\nDate:   ${formatDate(commit.time)}\n\n`;
  out += commit.message.split('\n').map((line) => (line ? `    ${line}` : '')).join('\n');
  return `${out}\n`;
}

/** Граф для log --graph: «*» — коммит, «|» — другие линии, «|\» и «|/» — развилки. */
function graphPrefixes(order, repo) {
  const lanes = [];
  const result = [];
  for (const id of order) {
    let col = lanes.indexOf(id);
    if (col === -1) {
      lanes.push(id);
      col = lanes.length - 1;
    }
    const line = lanes.map((_, i) => (i === col ? '*' : '|')).join(' ');
    const parents = repo.commits[id].parents;
    lanes[col] = parents[0] ?? null;
    const after = [];
    for (const parent of parents.slice(1)) {
      if (!lanes.includes(parent)) {
        lanes.splice(col + 1, 0, parent);
        after.push(`${lanes.slice(0, col + 1).map(() => '|').join(' ')}\\`);
      }
    }
    // Две линии пришли к одному коммиту — сливаем
    for (let i = lanes.length - 1; i > 0; i -= 1) {
      if (lanes[i] && lanes.indexOf(lanes[i]) < i) {
        lanes.splice(i, 1);
        after.push(`${lanes.slice(0, i).map(() => '|').join(' ')}/`);
      }
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    result.push({ line, after });
  }
  return result;
}

SUB.log = (g) => {
  const p = parse(g.args, ['-n', '-S', '--grep', '--max-count']);
  const { repo } = g;
  const starts = p.has('--all')
    ? [...Object.values(repo.heads), ...Object.values(repo.remoteHeads), ...Object.values(repo.tags), headId(repo)]
    : p.rest.length ? p.rest.map((rev) => {
      const id = resolveRev(repo, rev);
      if (!id) throw new GitError(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.\n`, 128);
      return id;
    }) : [headId(repo)];
  if (!headId(repo) && !p.has('--all') && !p.rest.length) {
    return fail(`fatal: your current branch '${repo.head.branch}' does not have any commits yet\n`, 128);
  }
  const reachable = new Set();
  for (const id of starts.filter(Boolean)) for (const item of ancestors(repo, id)) reachable.add(item);
  let order = [...reachable].sort((a, b) => repo.commits[b].seq - repo.commits[a].seq);
  const search = p.value('-S');
  if (search) {
    const count = (tree) => Object.values(tree).join('\n').split(search).length - 1;
    order = order.filter((id) => {
      const commit = repo.commits[id];
      const parent = commit.parents[0] ? repo.commits[commit.parents[0]].tree : {};
      return count(commit.tree) !== count(parent);
    });
  }
  const grep = p.value('--grep');
  if (grep) order = order.filter((id) => new RegExp(grep).test(repo.commits[id].message));
  const limit = Number(p.value('-n', '--max-count') ?? Infinity);
  order = order.slice(0, limit);
  const oneline = p.has('--oneline');
  const graph = p.has('--graph') ? graphPrefixes(order, repo) : null;
  let out = '';
  order.forEach((id, i) => {
    const commit = repo.commits[id];
    const labels = decorations(repo, id);
    let text = oneline
      ? `${short(id)}${labels.length ? ` (${labels.join(', ')})` : ''} ${commit.message.split('\n')[0]}\n`
      : `${commitHeader(repo, commit)}${graph ? '' : i < order.length - 1 ? '\n' : ''}`;
    if (graph) {
      const { line, after } = graph[i];
      const pad = line.replace(/\*/, '|');
      text = text.split('\n').filter((item, k, all) => k < all.length - 1 || item)
        .map((item, k) => `${k === 0 ? line : pad} ${item}`.trimEnd()).join('\n');
      text += `\n${after.map((item) => `${item}\n`).join('')}`;
      if (!oneline && i < order.length - 1) text += `${pad}\n`;
    }
    out += text;
  });
  return ok(out);
};

SUB.show = (g) => {
  const id = resolveRev(g.repo, g.args[0] ?? 'HEAD');
  if (!id) return fail(`fatal: ambiguous argument '${g.args[0]}': unknown revision or path not in the working tree.\n`, 128);
  const commit = g.repo.commits[id];
  const parent = commit.parents[0] ? g.repo.commits[commit.parents[0]].tree : {};
  return ok(`${commitHeader(g.repo, commit)}\n${treeDiff(parent, commit.tree)}`);
};

const blob = (text) => (text === undefined ? '0000000' : short(makeBlob(text)));
const makeBlob = (text) => [...text].reduce((hash, ch) => (Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0), 2166136261).toString(16).padStart(8, '0').repeat(5);

/** git diff между двумя деревьями (paths — фильтр). */
function treeDiff(before, after, paths = null) {
  let out = '';
  for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (paths && !paths.some((prefix) => under([path], prefix).length)) continue;
    const [a, b] = [before[path], after[path]];
    if (a === b) continue;
    out += `diff --git a/${path} b/${path}\n`;
    if (a === undefined) out += 'new file mode 100644\n';
    if (b === undefined) out += 'deleted file mode 100644\n';
    out += `index ${blob(a)}..${blob(b)}${a !== undefined && b !== undefined ? ' 100644' : ''}\n`;
    out += `--- ${a === undefined ? '/dev/null' : `a/${path}`}\n+++ ${b === undefined ? '/dev/null' : `b/${path}`}\n`;
    out += unifiedHunks(a ?? '', b ?? '');
  }
  return out;
}

SUB.diff = (g) => {
  const p = parse(g.args);
  const { repo } = g;
  const revs = [];
  const paths = [...p.paths];
  for (const arg of p.rest) {
    const id = resolveRev(repo, arg);
    if (id && !paths.length) revs.push(id);
    else paths.push(g.rel(arg));
  }
  const filter = paths.length ? paths.map((path) => (path.startsWith('/') ? g.rel(path) : path)) : null;
  const work = g.work();
  const tracked = (tree) => Object.fromEntries(Object.entries(work).filter(([path]) => path in tree));
  let before;
  let after;
  if (p.has('--staged', '--cached')) {
    before = revs[0] ? repo.commits[revs[0]].tree : headTree(repo);
    after = repo.index;
  } else if (revs.length === 2) {
    [before, after] = revs.map((id) => repo.commits[id].tree);
  } else if (revs.length === 1) {
    before = repo.commits[revs[0]].tree;
    after = { ...tracked({ ...before, ...repo.index }) };
  } else {
    before = repo.index;
    after = tracked(repo.index);
  }
  return ok(treeDiff(before, after, filter));
};

SUB.restore = (g) => {
  const p = parse(g.args, ['--source', '-s']);
  const staged = p.has('--staged', '-S');
  const source = p.value('--source', '-s');
  const { repo } = g;
  const specs = [...p.rest, ...p.paths];
  if (!specs.length) return fail('fatal: you must specify path(s) to restore\n', 128);
  const from = source ? repo.commits[resolveRev(repo, source)]?.tree : null;
  const head = headTree(repo);
  for (const spec of specs) {
    const prefix = g.rel(spec);
    if (staged) {
      const paths = under([...new Set([...Object.keys(head), ...Object.keys(repo.index)])], prefix);
      if (!paths.length) return fail(`error: pathspec '${spec}' did not match any file(s) known to git\n`);
      for (const path of paths) {
        if (path in head) repo.index[path] = head[path];
        else delete repo.index[path];
      }
    } else {
      const tree = from ?? repo.index;
      const paths = under(Object.keys(tree), prefix);
      if (!paths.length) return fail(`error: pathspec '${spec}' did not match any file(s) known to git\n`);
      for (const path of paths) g.write(path, tree[path]);
    }
  }
  return ok();
};

// --- ветки ---

const validBranch = (name) => /^(?!-)(?!.*\.\.)[\w./-]+(?<![./])$/.test(name) && name !== 'HEAD';

SUB.branch = (g) => {
  const p = parse(g.args);
  const { repo } = g;
  const current = repo.head.branch;
  if (p.has('-d', '-D', '--delete')) {
    let out = '';
    for (const name of p.rest) {
      if (!(name in repo.heads)) return fail(`error: branch '${name}' not found\n`);
      if (name === current) return fail(`error: cannot delete branch '${name}' used by worktree at '${g.root}'\n`);
      if (!p.has('-D') && !ancestors(repo, headId(repo)).has(repo.heads[name])) {
        return fail(`error: the branch '${name}' is not fully merged.\nhint: If you are sure you want to delete it, run 'git branch -D ${name}'\n`);
      }
      out += `Deleted branch ${name} (was ${short(repo.heads[name])}).\n`;
      delete repo.heads[name];
      delete repo.upstream[name];
    }
    return ok(out);
  }
  if (p.has('-m', '-M')) {
    const [from, to] = p.rest.length === 2 ? p.rest : [current, p.rest[0]];
    if (!to) return fail('fatal: branch name required\n', 128);
    if (to in repo.heads && !p.has('-M') && to !== from) return fail(`fatal: a branch named '${to}' already exists\n`, 128);
    if (from in repo.heads) {
      repo.heads[to] = repo.heads[from];
      if (to !== from) delete repo.heads[from];
    }
    if (current === from) repo.head = { branch: to };
    return ok();
  }
  if (!p.rest.length) {
    const names = Object.keys(repo.heads).sort();
    let out = '';
    if (repo.head.detached) out += `* (HEAD detached at ${short(repo.head.detached)})\n`;
    out += names.map((name) => `${name === current ? '*' : ' '} ${name}\n`).join('');
    if (p.has('-a', '-r')) {
      if (p.has('-r')) out = '';
      out += Object.keys(repo.remoteHeads).sort().map((name) => `  ${p.has('-r') ? '' : 'remotes/'}${name}\n`).join('');
    }
    return ok(out);
  }
  const [name, start] = p.rest;
  if (!validBranch(name)) return fail(`fatal: '${name}' is not a valid branch name\n`, 128);
  if (name in repo.heads) return fail(`fatal: a branch named '${name}' already exists\n`, 128);
  const id = resolveRev(repo, start ?? 'HEAD');
  if (!id) return fail(`fatal: not a valid object name: '${start ?? current}'\n`, 128);
  repo.heads[name] = id;
  return ok();
};

/** Переключиться на ветку или коммит (общая часть switch и checkout). */
function switchTo(g, target, { create = false, start = null, detach = false } = {}) {
  const { repo } = g;
  const previous = repo.head.branch ?? short(headId(repo) ?? '');
  if (create) {
    if (!validBranch(target)) return fail(`fatal: '${target}' is not a valid branch name\n`, 128);
    if (target in repo.heads) return fail(`fatal: a branch named '${target}' already exists\n`, 128);
    const id = start ? resolveRev(repo, start) : headId(repo);
    if (start && !id) return fail(`fatal: invalid reference: ${start}\n`, 128);
    if (id) checkoutTree(g, repo.commits[id].tree);
    if (id) repo.heads[target] = id;
    repo.head = { branch: target };
    if (start && repo.remoteHeads[start]) repo.upstream[target] = start;
    repo.reflog.push({ id, message: `checkout: moving from ${previous} to ${target}` });
    return ok(`${start && repo.remoteHeads[start] ? `branch '${target}' set up to track '${start}'.\n` : ''}Switched to a new branch '${target}'\n`);
  }
  if (target === repo.head.branch) return ok(`Already on '${target}'\n${trackingInfo(g)}`);
  if (!(target in repo.heads)) {
    const remote = `origin/${target}`;
    if (repo.remoteHeads[remote] && !detach) return switchTo(g, target, { create: true, start: remote });
    const id = resolveRev(repo, target);
    if (!id || !detach) return null;
    checkoutTree(g, repo.commits[id].tree);
    repo.head = { detached: id };
    repo.reflog.push({ id, message: `checkout: moving from ${previous} to ${short(id)}` });
    return ok(`Note: switching to '${target}'.\n\nYou are in 'detached HEAD' state. You can look around, make experimental\nchanges and commit them, and you can discard any commits you make in this\nstate without impacting any branches by switching back to a branch.\n\nHEAD is now at ${short(id)} ${repo.commits[id].message.split('\n')[0]}\n`);
  }
  const id = repo.heads[target];
  checkoutTree(g, repo.commits[id].tree);
  repo.head = { branch: target };
  repo.reflog.push({ id, message: `checkout: moving from ${previous} to ${target}` });
  return ok(`Switched to branch '${target}'\n${trackingInfo(g)}`);
}

SUB.switch = (g) => {
  const p = parse(g.args, ['-c', '-C']);
  const create = p.value('-c', '-C');
  if (create) return switchTo(g, create, { create: true, start: p.rest[0] });
  let [target] = p.rest;
  if (target === '-') target = lastBranch(g.repo);
  if (!target) return fail('fatal: missing branch or commit argument\n', 128);
  return switchTo(g, target, { detach: p.has('--detach', '-d') })
    ?? fail(`fatal: invalid reference: ${target}\n`, 128);
};

function lastBranch(repo) {
  for (const entry of [...repo.reflog].reverse()) {
    const match = /^checkout: moving from (\S+) to/.exec(entry.message);
    if (match) return match[1];
  }
  return null;
}

SUB.checkout = (g) => {
  const p = parse(g.args, ['-b', '-B']);
  const create = p.value('-b', '-B');
  if (create) return switchTo(g, create, { create: true, start: p.rest[0] });
  if (p.paths.length) return SUB.restore({ ...g, args: ['--', ...p.paths] });
  const [target] = p.rest;
  if (!target) return fail('error: укажите ветку: git checkout <ветка> (или git switch <ветка>)\n');
  return switchTo(g, target, { detach: true })
    ?? fail(`error: pathspec '${target}' did not match any file(s) known to git\n`);
}

// --- слияние и перенос коммитов ---

SUB.merge = (g) => {
  const p = parse(g.args, ['-m']);
  const { repo } = g;
  if (p.has('--abort')) {
    if (repo.state?.type !== 'merge') return fail('fatal: There is no merge to abort (MERGE_HEAD missing).\n', 128);
    checkoutTree(g, headTree(repo), { force: true });
    repo.state = null;
    return ok();
  }
  if (p.has('--continue')) return SUB.commit({ ...g, args: [] });
  if (repo.state) {
    return fail(repo.state.conflicts?.length
      ? "error: Merging is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.\n"
      : 'fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.\n', 128);
  }
  const [name] = p.rest;
  if (!name) return fail('fatal: No remote for the current branch.\n', 128);
  const theirs = resolveRev(repo, name);
  if (!theirs) return fail(`merge: ${name} - not something we can merge\n`);
  const ours = headId(repo);
  if (ours && ancestors(repo, ours).has(theirs)) return ok('Already up to date.\n');
  const theirsTree = repo.commits[theirs].tree;
  // Перемотка: наша ветка — предок их ветки
  if (!ours || (ancestors(repo, theirs).has(ours) && !p.has('--no-ff'))) {
    const before = headTree(repo);
    checkoutTree(g, theirsTree);
    moveHead(repo, theirs, `merge ${name}: Fast-forward`);
    return ok(`Updating ${short(ours ?? theirs)}..${short(theirs)}\nFast-forward\n${stat(before, theirsTree)}`);
  }
  const base = mergeBase(repo, ours, theirs);
  const merged = mergeTrees(base ? repo.commits[base].tree : {}, headTree(repo), theirsTree, { theirsLabel: name });
  const dirty = dirtyPaths(g, merged.tree);
  if (dirty.length) throw overwriteError(dirty, 'merge');
  const remote = name in repo.remoteHeads;
  const into = repo.head.branch && !['main', 'master'].includes(repo.head.branch) ? ` into ${repo.head.branch}` : '';
  const message = p.value('-m') ?? `Merge ${remote ? 'remote-tracking ' : ''}branch '${name}'${into}`;
  const before = headTree(repo);
  const out = applyMerge(g, merged, theirsTree);
  if (merged.conflicts.length) {
    repo.state = { type: 'merge', theirs, message, conflicts: merged.conflicts };
    return { out: `${out}Automatic merge failed; fix conflicts and then commit the result.\n`, err: '', code: 1 };
  }
  const id = makeCommit(repo, { tree: merged.tree, message, parents: [ours, theirs], ...identity(g) });
  moveHead(repo, id, `merge ${name}: Merge made by the 'ort' strategy.`);
  return ok(`${out}Merge made by the 'ort' strategy.\n${stat(before, merged.tree)}`);
};

/** Перенести изменения одного коммита на HEAD (cherry-pick, revert, шаг rebase). */
function pick(g, id, { revert = false, type, message }) {
  const { repo } = g;
  const commit = repo.commits[id];
  const parent = commit.parents[0] ? repo.commits[commit.parents[0]].tree : {};
  const [base, theirs] = revert ? [commit.tree, parent] : [parent, commit.tree];
  const label = revert ? `parent of ${short(id)} (${commit.message.split('\n')[0]})` : `${short(id)} (${commit.message.split('\n')[0]})`;
  const merged = mergeTrees(base, headTree(repo), theirs, { theirsLabel: label });
  const dirty = dirtyPaths(g, merged.tree);
  if (dirty.length) throw overwriteError(dirty, type === 'rebase' ? 'rebase' : 'merge');
  const out = applyMerge(g, merged, theirs);
  if (merged.conflicts.length) return { out, conflicts: merged.conflicts };
  const before = headTree(repo);
  const who = revert ? identity(g) : { author: commit.author, email: commit.email };
  const newId = makeCommit(repo, { tree: merged.tree, message, parents: [headId(repo)].filter(Boolean), ...who });
  moveHead(repo, newId, `${type}: ${message.split('\n')[0]}`);
  return { out, id: newId, stat: stat(before, merged.tree) };
}

function sequencer(type) {
  return (g) => {
    const p = parse(g.args, ['-m']);
    const { repo } = g;
    const state = repo.state;
    if (p.has('--abort')) {
      if (state?.type !== type) return fail(`error: no ${type} in progress\nfatal: ${type} failed\n`, 128);
      checkoutTree(g, headTree(repo), { force: true });
      repo.state = null;
      return ok();
    }
    if (p.has('--continue')) {
      if (state?.type !== type) return fail(`error: no ${type} in progress\nfatal: ${type} failed\n`, 128);
      return SUB.commit({ ...g, args: [] });
    }
    if (state) return fail(`error: ${state.type} is already in progress\nhint: try "git ${type} (--continue | --abort)"\nfatal: ${type} failed\n`, 128);
    const [rev] = p.rest;
    const id = rev && resolveRev(repo, rev);
    if (!id) return fail(`fatal: bad revision '${rev ?? ''}'\n`, 128);
    const commit = repo.commits[id];
    if (commit.parents.length > 1) return fail(`error: commit ${commit.id} is a merge but no -m option was given.\nfatal: ${type} failed\n`, 128);
    const title = commit.message.split('\n')[0];
    const message = type === 'revert' ? `Revert "${title}"\n\nThis reverts commit ${commit.id}.` : commit.message;
    const result = pick(g, id, { revert: type === 'revert', type, message });
    if (result.conflicts) {
      repo.state = { type, commit: id, message, conflicts: result.conflicts };
      const verb = type === 'revert' ? 'revert' : 'apply';
      return { out: result.out, err: `error: could not ${verb} ${short(id)}... ${title}\nhint: After resolving the conflicts, mark them with\nhint: "git add/rm <pathspec>", then run\nhint: "git ${type} --continue".\nhint: You can instead skip this commit with "git ${type} --skip".\nhint: To abort and get back to the state before "git ${type}",\nhint: run "git ${type} --abort".\n`, code: 1 };
    }
    const where = repo.head.branch ?? 'detached HEAD';
    return ok(`${result.out}[${where} ${short(result.id)}] ${message.split('\n')[0]}\n${result.stat}`);
  };
}

SUB.revert = sequencer('revert');
SUB['cherry-pick'] = sequencer('cherry-pick');

SUB.rebase = (g) => {
  const p = parse(g.args);
  const { repo } = g;
  const state = repo.state;
  if (p.has('-i', '--interactive')) return fail('error: интерактивный rebase (-i) в тренажёре не поддерживается — это тема для теории.\n');
  if (p.has('--abort')) {
    if (state?.type !== 'rebase') return fail('fatal: No rebase in progress?\n', 128);
    repo.head = { branch: state.branch };
    checkoutTree(g, repo.commits[state.orig].tree, { force: true });
    repo.state = null;
    return ok();
  }
  if (p.has('--continue')) {
    if (state?.type !== 'rebase') return fail('fatal: No rebase in progress?\n', 128);
    if (state.conflicts.length) {
      return fail(`${state.conflicts.map((path) => `${path}: needs merge`).join('\n')}\nYou must edit all merge conflicts and then\nmark them as resolved using git add\n`);
    }
    const current = repo.commits[state.current];
    if (JSON.stringify(sortTree(repo.index)) !== JSON.stringify(sortTree(headTree(repo)))) {
      const id = makeCommit(repo, { tree: repo.index, message: current.message, parents: [headId(repo)], author: current.author, email: current.email });
      moveHead(repo, id, `rebase (continue): ${current.message.split('\n')[0]}`);
    }
    return replay(g, state);
  }
  if (state) return fail('fatal: It seems that there is already a rebase-merge directory, and\nI wonder if you are in the middle of another rebase.\n', 128);
  const [upstreamName] = p.rest;
  const upstream = upstreamName && resolveRev(repo, upstreamName);
  if (!upstream) return fail(`fatal: invalid upstream '${upstreamName ?? ''}'\n`, 128);
  if (!repo.head.branch) return fail('fatal: в тренажёре rebase — только для ветки (не detached HEAD)\n', 128);
  const { staged, unstaged } = statusData(g);
  if (staged.length || unstaged.length) return fail('error: cannot rebase: You have unstaged changes.\nerror: Please commit or stash them.\n');
  const ours = headId(repo);
  if (ancestors(repo, ours).has(upstream)) return ok(`Current branch ${repo.head.branch} is up to date.\n`);
  const base = mergeBase(repo, ours, upstream);
  // свои коммиты ветки после общего предка — по первому родителю, от старых к новым
  const own = [];
  for (let id = ours; id && id !== base; id = repo.commits[id].parents[0]) {
    if (repo.commits[id].parents.length < 2) own.unshift(id);
  }
  const newState = { type: 'rebase', branch: repo.head.branch, onto: upstream, orig: ours, remaining: own, conflicts: [] };
  checkoutTree(g, repo.commits[upstream].tree);
  repo.head = { detached: upstream };
  repo.reflog.push({ id: upstream, message: `rebase (start): checkout ${upstreamName}` });
  return replay(g, newState);
};

/** Перенести оставшиеся коммиты rebase по одному; конфликт — остановка. */
function replay(g, state) {
  const { repo } = g;
  let out = '';
  while (state.remaining.length) {
    const id = state.remaining.shift();
    const commit = repo.commits[id];
    const result = pick(g, id, { type: 'rebase (pick)', message: commit.message });
    out += result.out;
    if (result.conflicts) {
      repo.state = { ...state, current: id, conflicts: result.conflicts };
      return { out, err: `error: could not apply ${short(id)}... ${commit.message.split('\n')[0]}\nhint: Resolve all conflicts manually, mark them as resolved with\nhint: "git add/rm <conflicted_files>", then run "git rebase --continue".\nhint: You can instead skip this commit: run "git rebase --skip".\nhint: To abort and get back to the state before "git rebase", run "git rebase --abort".\n`, code: 1 };
    }
  }
  repo.heads[state.branch] = headId(repo);
  repo.head = { branch: state.branch };
  repo.state = null;
  repo.reflog.push({ id: headId(repo), message: `rebase (finish): returning to refs/heads/${state.branch}` });
  return ok(`${out}Successfully rebased and updated refs/heads/${state.branch}.\n`);
}

SUB.reset = (g) => {
  const p = parse(g.args);
  const { repo } = g;
  const mode = p.has('--hard') ? 'hard' : p.has('--soft') ? 'soft' : 'mixed';
  const args = [...p.rest];
  const revId = args.length && resolveRev(repo, args[0]);
  const rev = revId ? args.shift() : 'HEAD';
  const paths = [...args, ...p.paths];
  if (paths.length) {
    // git reset <файл> — убрать из индекса (как restore --staged)
    const tree = revId ? repo.commits[revId].tree : headTree(repo);
    for (const spec of paths) {
      for (const path of under([...new Set([...Object.keys(tree), ...Object.keys(repo.index)])], g.rel(spec))) {
        if (path in tree) repo.index[path] = tree[path];
        else delete repo.index[path];
      }
    }
    return ok(unstagedAfterReset(g));
  }
  const target = resolveRev(repo, rev);
  if (!target) return fail(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.\n`, 128);
  const tree = repo.commits[target].tree;
  if (mode === 'hard') checkoutTree(g, tree, { force: true });
  moveHead(repo, target, `reset: moving to ${rev}`);
  if (mode !== 'soft') {
    repo.index = { ...tree };
    repo.state = null;
  }
  if (mode === 'hard') return ok(`HEAD is now at ${short(target)} ${repo.commits[target].message.split('\n')[0]}\n`);
  return ok(mode === 'mixed' ? unstagedAfterReset(g) : '');
};

function unstagedAfterReset(g) {
  const { unstaged } = statusData(g);
  if (!unstaged.length) return '';
  return `Unstaged changes after reset:\n${unstaged.map(([kind, path]) => `${kind === 'deleted' ? 'D' : 'M'}\t${path}`).join('\n')}\n`;
}

SUB.tag = (g) => {
  const p = parse(g.args, ['-m']);
  const { repo } = g;
  if (p.has('-d', '--delete')) {
    let out = '';
    for (const name of p.rest) {
      if (!(name in repo.tags)) return fail(`error: tag '${name}' not found.\n`);
      out += `Deleted tag '${name}' (was ${short(repo.tags[name])})\n`;
      delete repo.tags[name];
    }
    return ok(out);
  }
  const [name, rev] = p.rest;
  if (!name) return ok(Object.keys(repo.tags).sort().map((tag) => `${tag}\n`).join(''));
  if (name in repo.tags) return fail(`fatal: tag '${name}' already exists\n`, 128);
  const id = resolveRev(repo, rev ?? 'HEAD');
  if (!id) return fail(`fatal: Failed to resolve '${rev ?? 'HEAD'}' as a valid ref.\n`, 128);
  repo.tags[name] = id;
  return ok();
};

SUB.stash = (g) => {
  const [sub = 'push', ...rest] = g.args[0]?.startsWith('-') ? ['push', ...g.args] : g.args;
  const { repo } = g;
  const pickIndex = (arg) => {
    const n = arg === undefined ? 0 : Number(/^(?:stash@\{)?(\d+)\}?$/.exec(arg)?.[1]);
    if (Number.isNaN(n) || !repo.stash[n]) throw new GitError(arg === undefined ? 'No stash entries found.\n' : `error: ${arg} is not a valid reference\n`, 1);
    return n;
  };
  if (sub === 'list') {
    return ok(repo.stash.map((entry, i) => `stash@{${i}}: ${entry.message}\n`).join(''));
  }
  if (sub === 'drop') {
    const n = pickIndex(rest[0]);
    const [entry] = repo.stash.splice(n, 1);
    return ok(`Dropped refs/stash@{${n}} (${entry.id})\n`);
  }
  if (sub === 'clear') {
    repo.stash = [];
    return ok();
  }
  if (sub === 'pop' || sub === 'apply') {
    const n = pickIndex(rest[0]);
    const entry = repo.stash[n];
    const base = repo.commits[entry.base]?.tree ?? {};
    const theirs = { ...base };
    for (const [path, text] of Object.entries(entry.work)) {
      if (text === null) delete theirs[path];
      else theirs[path] = text;
    }
    const merged = mergeTrees(base, headTree(repo), theirs, { oursLabel: 'Updated upstream', theirsLabel: 'Stashed changes' });
    const dirty = dirtyPaths(g, merged.tree);
    if (dirty.length) throw overwriteError(dirty, 'merge');
    const head = headTree(repo);
    let out = '';
    for (const path of Object.keys({ ...head, ...merged.tree })) {
      if (head[path] === merged.tree[path]) continue;
      g.write(path, merged.tree[path] ?? null);
      // новые файлы из stash остаются в индексе, правки — нет (как в git без --index)
      if (!(path in head) && path in merged.tree) repo.index[path] = merged.tree[path];
      if (!(path in merged.tree)) delete repo.index[path];
    }
    for (const path of merged.conflicts) out += `Auto-merging ${path}\nCONFLICT (content): Merge conflict in ${path}\n`;
    if (merged.conflicts.length) {
      repo.state = { type: 'stash', conflicts: merged.conflicts };
      return { out: `${out}On branch ${repo.head.branch}\nThe stash entry is kept in case you need it again.\n`, err: '', code: 1 };
    }
    out += statusText(g);
    if (sub === 'pop') {
      repo.stash.splice(n, 1);
      out += `Dropped refs/stash@{${n}} (${entry.id})\n`;
    }
    return ok(out);
  }
  if (sub !== 'push' && sub !== 'save') return fail(`error: unknown subcommand: ${sub}\n`, 129);
  const p = parse(rest, ['-m', '--message']);
  const head = headTree(repo);
  const work = g.work();
  const changes = {};
  for (const path of new Set([...Object.keys(head), ...Object.keys(repo.index)])) {
    const now = path in repo.index ? (path in work ? work[path] : null) : null;
    if (now !== (head[path] ?? null) || repo.index[path] !== head[path]) changes[path] = now;
  }
  if (!Object.keys(changes).length) return ok('No local changes to save\n');
  const id = headId(repo);
  const title = id ? `${short(id)} ${repo.commits[id].message.split('\n')[0]}` : '(no commits)';
  const custom = p.value('-m', '--message') ?? (sub === 'save' ? p.rest.join(' ') : '');
  const message = custom ? `On ${repo.head.branch}: ${custom}` : `WIP on ${repo.head.branch}: ${title}`;
  const entryId = makeId({ changes, message, seq: repo.seq, stash: repo.stash.length });
  repo.stash.unshift({ id: entryId, message, base: id, work: changes });
  checkoutTree(g, head, { force: true });
  return ok(`Saved working directory and index state ${message}\n`);
};

SUB.reflog = (g) => {
  const { repo } = g;
  const entries = [...repo.reflog].reverse();
  return ok(entries.map((entry, i) => {
    const labels = i === 0 ? decorations(repo, entry.id) : [];
    return `${short(entry.id)} ${labels.length ? `(${labels.join(', ')}) ` : ''}HEAD@{${i}}: ${entry.message}\n`;
  }).join(''));
};

SUB.blame = (g) => {
  const [spec] = g.args.filter((arg) => !arg.startsWith('-'));
  if (!spec) return fail('usage: git blame [<options>] [<rev-opts>] [<rev>] [--] <file>\n', 129);
  const path = g.rel(spec);
  const { repo } = g;
  const work = g.work();
  if (!(path in work) && !(path in headTree(repo))) return fail(`fatal: no such path '${path}' in HEAD\n`, 128);
  // Цепочка коммитов по первому родителю — от старых к новым
  const chain = [];
  for (let id = headId(repo); id; id = repo.commits[id].parents[0]) chain.unshift(id);
  let text = '';
  let origins = [];
  for (const id of chain) {
    const next = repo.commits[id].tree[path] ?? '';
    origins = carry(text, next, origins, id);
    text = next;
  }
  const current = work[path] ?? text;
  origins = carry(text, current, origins, null);
  const lines = toLines(current);
  const width = String(lines.length).length;
  return ok(lines.map((line, i) => {
    const id = origins[i];
    const commit = id && repo.commits[id];
    const who = commit ? commit.author : 'Not Committed Yet';
    const when = formatDate(commit ? commit.time : Date.now(), true);
    const mark = id && id === chain[0] ? '^' : '';
    const ref = id ? `${mark}${id.slice(0, mark ? 7 : 8)}` : '00000000';
    return `${ref} (${who} ${when} ${String(i + 1).padStart(width)}) ${line}\n`;
  }).join(''));
};

/** Чей каждая строка: общие строки сохраняют автора, новые — получают id. */
function carry(before, after, origins, id) {
  const result = [];
  let k = 0;
  for (const { op } of diffLines(toLines(before), toLines(after))) {
    if (op === '=') result.push(origins[k++]);
    else if (op === '-') k += 1;
    else result.push(id);
  }
  return result;
}

const HELP = `usage: git <команда> [<аргументы>]

Команды тренажёра:
  начать:        init, clone, config
  изменения:     status, add, rm, restore, diff, commit
  история:       log, show, reflog, blame, tag
  ветки:         branch, switch, checkout, merge, rebase
  отменить:      reset, revert, cherry-pick, stash
  GitHub:        remote, push, fetch, pull
Справка по команде — git <команда> --help.
`;

const SUB_HELP = {
  commit: 'git commit -m "сообщение" — записать проиндексированное в историю.\n  -a          сначала добавить изменения отслеживаемых файлов\n  --amend     исправить последний коммит (--no-edit — оставить сообщение)',
  add: 'git add <файл | папка | .> — добавить изменения в индекс (то, что войдёт в коммит).\n  -A  все изменения, в том числе удаления\n  -f  добавить файл, хотя он в .gitignore',
  log: 'git log — история коммитов.\n  --oneline  по одной строке\n  --graph    с графом веток\n  --all      все ветки\n  -n N       последние N\n  -S текст   где текст появился или исчез\n  --grep=re  по сообщению',
  reset: 'git reset [--soft | --mixed | --hard] [HEAD~N] — передвинуть ветку назад.\n  --soft   изменения остаются в индексе\n  --mixed  изменения остаются в файлах (по умолчанию)\n  --hard   изменения стираются',
};

/** Точка входа: команда git для Linux-симулятора. */
export const git = {
  help: HELP,
  run(ctx) {
    const [sub, ...args] = ctx.args;
    if (!sub || sub === 'help' || sub === '--help') return ok(HELP);
    if (sub === '--version' || sub === 'version') return ok('git version 2.43.0\n');
    if (args.includes('--help')) return ok(`${SUB_HELP[sub] ?? `git ${sub} — справки по этой команде в тренажёре нет; список команд — git --help.`}\n`);
    const handler = SUB[sub] ?? EXTRA[sub];
    if (!handler) return fail(`git: '${sub}' is not a git command. See 'git --help'.\n`);
    try {
      if (['init', 'config', 'clone'].includes(sub)) return handler({ ...ctx, args });
      const g = open({ ...ctx, args });
      if (!g) return fail(NOT_REPO, 128);
      return handler(g) ?? ok();
    } catch (e) {
      if (e instanceof GitError) return { out: '', err: e.text, code: e.code };
      if (e instanceof FsError) return fail(`fatal: ${e.message}\n`, 128);
      throw e;
    }
  },
};

/** Подкоманды из других модулей (remote, push, clone… — шаг «GitHub»). */
export const EXTRA = {};
export { SUB as SUBCOMMANDS, open as openRepo, statusText, GitError, checkoutTree, mergeTrees, applyMerge, identity, stat, ok, fail };
