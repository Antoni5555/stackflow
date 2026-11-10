// «GitHub» внутри симулятора: удалённые репозитории и команды remote, push, fetch, pull, clone.
// Удалённые репозитории хранятся в корне ФС (fs.root.github: {«owner/name»: {commits, heads, tags}}) —
// сохраняются вместе с ФС. Любой адрес github.com/<owner>/<name> считается созданным на сайте
// (пустым), SSH-ключ — настроенным: в тренажёре это теория.

import { normalize } from '../linux/fs.js';
import {
  EXTRA, GitError, SUBCOMMANDS, checkoutTree, fail, ok, openRepo,
} from './commands.js';
import {
  DEFAULT_BRANCH, ancestors, emptyRepo, headId, makeCommit, repoAt, short,
} from './repo.js';

/** git@github.com:shop/shop.git, https://github.com/shop/shop(.git) → «shop/shop». */
export function remoteKey(url) {
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url ?? '');
  return match ? `${match[1]}/${match[2]}` : null;
}

/** Удалённый репозиторий по адресу (создаётся пустым при первом обращении). */
export function server(fs, url) {
  const key = remoteKey(url);
  if (!key) return null;
  fs.root.github ??= {};
  fs.root.github[key] ??= { commits: {}, heads: {}, tags: {} };
  return fs.root.github[key];
}

const NO_REMOTE = (name) => new GitError(`fatal: '${name}' does not appear to be a git repository
fatal: Could not read from remote repository.

Please make sure you have the correct access rights
and the repository exists.
`, 128);

/** Адрес для вывода «To github.com:shop/shop.git». */
const shown = (url) => url.replace(/^git@/, '').replace(/^https:\/\//, '');

/** Скопировать коммиты, достижимые из id, из одного хранилища в другое. */
function copyCommits(from, to, id) {
  const stack = id ? [id] : [];
  while (stack.length) {
    const current = stack.pop();
    if (to.commits[current]) continue;
    to.commits[current] = { ...from.commits[current], tree: { ...from.commits[current].tree } };
    stack.push(...from.commits[current].parents);
  }
}

function remoteOf(g, name) {
  const url = g.repo.remotes[name];
  if (!url) throw NO_REMOTE(name);
  return { url, data: server(g.fs, url) };
}

EXTRA.remote = (g) => {
  const [sub, ...args] = g.args;
  const { repo } = g;
  if (!sub) return ok(Object.keys(repo.remotes).map((name) => `${name}\n`).join(''));
  if (sub === '-v' || sub === '--verbose') {
    return ok(Object.entries(repo.remotes).map(([name, url]) => `${name}\t${url} (fetch)\n${name}\t${url} (push)\n`).join(''));
  }
  if (sub === 'add') {
    const [name, url] = args;
    if (!name || !url) return fail('usage: git remote add [<options>] <name> <url>\n', 129);
    if (repo.remotes[name]) return fail(`error: remote ${name} already exists.\n`, 3);
    repo.remotes[name] = url;
    return ok();
  }
  if (sub === 'set-url') {
    const [name, url] = args;
    if (!repo.remotes[name]) return fail(`error: No such remote '${name}'\n`, 2);
    repo.remotes[name] = url;
    return ok();
  }
  if (sub === 'remove' || sub === 'rm') {
    const [name] = args;
    if (!repo.remotes[name]) return fail(`error: No such remote: '${name}'\n`, 2);
    delete repo.remotes[name];
    for (const ref of Object.keys(repo.remoteHeads)) if (ref.startsWith(`${name}/`)) delete repo.remoteHeads[ref];
    for (const [branch, upstream] of Object.entries(repo.upstream)) if (upstream.startsWith(`${name}/`)) delete repo.upstream[branch];
    return ok();
  }
  return fail(`error: unknown subcommand: ${sub}\n`, 129);
};

EXTRA.push = (g) => {
  const flags = g.args.filter((arg) => arg.startsWith('-'));
  const [remoteName = null, ...refs] = g.args.filter((arg) => !arg.startsWith('-'));
  const { repo } = g;
  const setUpstream = flags.some((flag) => ['-u', '--set-upstream'].includes(flag));
  const force = flags.some((flag) => ['-f', '--force'].includes(flag));
  const branch = repo.head.branch;
  let name = remoteName;
  let targets = refs;
  if (!name) {
    const upstream = branch && repo.upstream[branch];
    if (!upstream) {
      if (!Object.keys(repo.remotes).length) {
        return fail('fatal: No configured push destination.\nEither specify the URL from the command-line or configure a remote repository using\n\n    git remote add <name> <url>\n\nand then push using the remote name\n\n    git push <name>\n', 128);
      }
      return fail(`fatal: The current branch ${branch} has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin ${branch}\n\nTo have this happen automatically for branches without a tracking\nupstream, see 'push.autoSetupRemote' in 'git help config'.\n`, 128);
    }
    name = upstream.split('/')[0];
  }
  if (!targets.length) targets = [branch];
  const { url, data } = remoteOf(g, name);
  let out = `To ${shown(url)}\n`;
  let err = '';
  let code = 0;
  let upToDate = true;
  for (const ref of targets) {
    if (ref === '--tags') continue;
    const isTag = ref in repo.tags && !(ref in repo.heads);
    const id = isTag ? repo.tags[ref] : repo.heads[ref];
    if (!id) {
      return fail(`error: src refspec ${ref} does not match any\nerror: failed to push some refs to '${url}'\n`);
    }
    const store = isTag ? data.tags : data.heads;
    const old = store[ref];
    if (old === id) continue;
    upToDate = false;
    copyCommits(repo, data, id);
    if (old && !isTag && !ancestors(repo, id).has(old) && !force) {
      // на GitHub есть коммиты, которых нет у нас
      const known = Boolean(repo.commits[old]);
      out += ` ! [rejected]        ${ref} -> ${ref} (${known ? 'non-fast-forward' : 'fetch first'})\n`;
      err += `error: failed to push some refs to '${url}'\n${known
        ? `hint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart. If you want to integrate the remote changes,\nhint: use 'git pull' before pushing again.\n`
        : `hint: Updates were rejected because the remote contains work that you do not\nhint: have locally. This is usually caused by another repository pushing to\nhint: the same ref. If you want to integrate the remote changes, use\nhint: 'git pull' before pushing again.\n`}hint: See the 'Note about fast-forwards' in 'git push --help' for details.\n`;
      code = 1;
      continue;
    }
    store[ref] = id;
    if (!isTag) repo.remoteHeads[`${name}/${ref}`] = id;
    if (!old) out += ` * [new ${isTag ? 'tag' : 'branch'}]      ${ref} -> ${ref}\n`;
    else out += `${force && !ancestors(repo, id).has(old) ? ' + ' : '   '}${short(old)}..${short(id)}  ${ref} -> ${ref}${force && !ancestors(repo, id).has(old) ? ' (forced update)' : ''}\n`;
    if (setUpstream && !isTag) {
      repo.upstream[ref] = `${name}/${ref}`;
      out += `branch '${ref}' set up to track '${name}/${ref}'.\n`;
    }
  }
  if (flags.includes('--tags')) {
    for (const [tag, id] of Object.entries(repo.tags)) {
      if (data.tags[tag] === id) continue;
      upToDate = false;
      copyCommits(repo, data, id);
      data.tags[tag] = id;
      out += ` * [new tag]         ${tag} -> ${tag}\n`;
    }
  }
  if (upToDate) return ok('Everything up-to-date\n');
  return { out, err, code };
};

/** Забрать с GitHub все ветки в origin/*. Возвращает строки вывода «From …». */
function fetchRemote(g, name) {
  const { url, data } = remoteOf(g, name);
  const { repo } = g;
  let lines = '';
  for (const [branch, id] of Object.entries(data.heads).sort()) {
    const ref = `${name}/${branch}`;
    const old = repo.remoteHeads[ref];
    if (old === id) continue;
    copyCommits(data, repo, id);
    repo.remoteHeads[ref] = id;
    lines += old
      ? `   ${short(old)}..${short(id)}  ${branch.padEnd(10)} -> ${ref}\n`
      : ` * [new branch]      ${branch.padEnd(10)} -> ${ref}\n`;
  }
  for (const [tag, id] of Object.entries(data.tags)) {
    if (repo.tags[tag] === id) continue;
    copyCommits(data, repo, id);
    repo.tags[tag] = id;
    lines += ` * [new tag]         ${tag.padEnd(10)} -> ${tag}\n`;
  }
  return lines ? `From ${shown(url).replace(/\.git$/, '')}\n${lines}` : '';
}

EXTRA.fetch = (g) => {
  const [name = 'origin'] = g.args.filter((arg) => !arg.startsWith('-'));
  return ok(fetchRemote(g, name));
};

EXTRA.pull = (g) => {
  const flags = g.args.filter((arg) => arg.startsWith('-'));
  const [remoteName, branchName] = g.args.filter((arg) => !arg.startsWith('-'));
  const { repo } = g;
  const branch = repo.head.branch;
  const upstream = branchName ? `${remoteName}/${branchName}` : (remoteName ? `${remoteName}/${branch}` : repo.upstream[branch]);
  if (!upstream) {
    return fail(`There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=origin/<branch> ${branch}\n\n`);
  }
  const name = upstream.split('/')[0];
  const fetched = fetchRemote(g, name);
  const theirs = repo.remoteHeads[upstream];
  if (!theirs) return fail(`${fetched}fatal: couldn't find remote ref ${upstream.slice(name.length + 1)}\n`, 128);
  const ours = headId(repo);
  if (ours && ancestors(repo, ours).has(theirs)) return ok(`${fetched}Already up to date.\n`);
  const diverged = ours && !ancestors(repo, theirs).has(ours);
  // git 2.43: при разошедшихся ветках нужно выбрать способ — как и на настоящем сервере
  const config = repo.config['pull.rebase'] ?? globalPull(g);
  const rebase = flags.includes('--rebase') || (config === 'true' && !flags.includes('--no-rebase'));
  const merge = flags.includes('--no-rebase') || config === 'false';
  if (diverged && !rebase && !merge && !flags.includes('--ff-only')) {
    return fail(`${fetched}hint: You have divergent branches and need to specify how to reconcile them.\nhint: You can do so by running one of the following commands sometime before\nhint: your next pull:\nhint:\nhint:   git config pull.rebase false  # merge\nhint:   git config pull.rebase true   # rebase\nhint:   git config pull.ff only       # fast-forward only\nhint:\nhint: You can replace "git config" with "git config --global" to set a default\nhint: preference for all repositories. You can also pass --rebase, --no-rebase,\nhint: or --ff-only on the command line to override the configured default per\nhint: invocation.\nfatal: Need to specify how to reconcile divergent branches.\n`, 128);
  }
  if (diverged && flags.includes('--ff-only')) return fail(`${fetched}fatal: Not possible to fast-forward, aborting.\n`, 128);
  const result = rebase && diverged
    ? SUBCOMMANDS.rebase({ ...g, args: [upstream] })
    : SUBCOMMANDS.merge({ ...g, args: [upstream] });
  return { ...result, out: fetched + result.out };
};

function globalPull(g) {
  try {
    const text = g.fs.as('root', () => g.fs.readFile('/home/shop/.gitconfig'));
    return /\[pull\][^[]*rebase\s*=\s*(\w+)/.exec(text)?.[1];
  } catch (e) {
    return undefined;
  }
}

/** git clone <url> [папка]. */
export function clone(ctx) {
  const [url, dirArg] = ctx.args.filter((arg) => !arg.startsWith('-'));
  if (!url) return fail('fatal: You must specify a repository to clone.\n', 129);
  const data = server(ctx.fs, url);
  if (!data) return fail(`fatal: repository '${url}' does not exist\n`, 128);
  const dirName = dirArg ?? remoteKey(url).split('/')[1];
  const dir = ctx.sh.resolve(dirName);
  if (ctx.fs.exists(dir) && ctx.fs.list(dir).length) {
    return fail(`fatal: destination path '${dirName}' already exists and is not an empty directory.\n`, 128);
  }
  ctx.fs.mkdir(dir, { parents: true });
  ctx.fs.mkdir(normalize('.git', dir));
  const repo = emptyRepo();
  ctx.fs.lookup(normalize('.git', dir)).repo = repo;
  repo.remotes.origin = url;
  let out = `Cloning into '${dirName}'...\n`;
  const branches = Object.keys(data.heads);
  if (!branches.length) return ok(`${out}warning: You appear to have cloned an empty repository.\n`);
  for (const [branch, id] of Object.entries(data.heads)) {
    copyCommits(data, repo, id);
    repo.remoteHeads[`origin/${branch}`] = id;
  }
  for (const [tag, id] of Object.entries(data.tags)) {
    copyCommits(data, repo, id);
    repo.tags[tag] = id;
  }
  const main = branches.includes(DEFAULT_BRANCH) ? DEFAULT_BRANCH : branches[0];
  repo.heads[main] = data.heads[main];
  repo.upstream[main] = `origin/${main}`;
  repo.head = { branch: main };
  repo.reflog.push({ id: data.heads[main], message: `clone: from ${url}` });
  const g = openRepo({ ...ctx, sh: { ...ctx.sh, cwd: dir, resolve: (p) => normalize(p, dir) } });
  checkoutTree(g, repo.commits[data.heads[main]].tree, { force: true });
  return ok(out);
}

EXTRA.clone = clone;

/**
 * setup.remote: {url, commits, pushed}. pushed — ветки, уже отправленные на GitHub
 * (в их состоянии из setup.commits); commits — коммиты, которые есть только на GitHub.
 */
export function buildRemote(fs, root, remote) {
  const repo = repoAt(fs, root);
  const data = server(fs, remote.url);
  repo.remotes.origin = remote.url;
  for (const branch of remote.pushed ?? []) {
    const id = repo.heads[branch];
    if (!id) continue;
    copyCommits(repo, data, id);
    data.heads[branch] = id;
    repo.remoteHeads[`origin/${branch}`] = id;
    repo.upstream[branch] = `origin/${branch}`;
  }
  // Коммиты коллег: строятся во временном репозитории поверх веток GitHub
  const scratch = { ...emptyRepo(), commits: { ...repo.commits }, heads: { ...data.heads }, seq: repo.seq };
  for (const item of remote.commits ?? []) {
    const branch = item.branch ?? DEFAULT_BRANCH;
    if (!(branch in scratch.heads) && Object.keys(scratch.heads).length) {
      scratch.heads[branch] = scratch.heads[item.from ?? DEFAULT_BRANCH];
    }
    const parent = scratch.heads[branch] ?? null;
    const tree = parent ? { ...scratch.commits[parent].tree } : {};
    for (const [path, text] of Object.entries(item.files ?? {})) {
      if (text === null) delete tree[path];
      else tree[path] = text;
    }
    scratch.heads[branch] = makeCommit(scratch, {
      tree, message: item.message, parents: [parent].filter(Boolean),
      author: item.author ?? 'Коллега', email: item.email ?? 'colleague@shop.example',
    });
    data.heads[branch] = scratch.heads[branch];
  }
  for (const [id, commit] of Object.entries(scratch.commits)) data.commits[id] ??= commit;
  repo.seq = scratch.seq;
}
