// Модель репозитория Git поверх виртуальной ФС Linux-симулятора.
// Репозиторий — объект в узле папки .git (поле repo): коммиты, индекс, ветки, теги,
// HEAD, reflog, stash и состояние незаконченного слияния. Обычный JSON — сохраняется
// вместе с ФС в браузере. Рабочая папка — настоящие файлы ФС.
// Снимок файлов (tree) — {путь от корня репозитория: текст}.

import { FsError, HOME, dirname, normalize } from '../linux/fs.js';
import { globToRegExp } from '../linux/glob.js';

export const DEFAULT_BRANCH = 'main';

// --- id коммитов: короткие и детерминированные (одни и те же команды — те же id) ---

function fnv(text, seed) {
  let hash = 0x811c9dc5 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 40 hex-символов, как у настоящего git; в выводе обычно первые 7. */
export function makeId(data) {
  const text = JSON.stringify(data);
  return [1, 2, 3, 4, 5].map((seed) => fnv(text, seed)).join('');
}

export const short = (id) => id.slice(0, 7);

// --- поиск и создание репозитория ---

export function emptyRepo() {
  return {
    commits: {},             // id → {id, parents, message, tree, author, email, time, seq}
    heads: {},               // ветка → id
    tags: {},                // тег → id
    remotes: {},             // имя → url
    remoteHeads: {},         // 'origin/main' → id
    upstream: {},            // ветка → 'origin/main'
    head: { branch: DEFAULT_BRANCH },   // или {detached: id}
    index: {},               // путь → текст: что войдёт в следующий коммит
    config: {},
    reflog: [],              // [{id, message}] — новые в конце
    stash: [],               // [{message, base, index, work}] — новые в начале
    state: null,             // незаконченное слияние: {type, message, head, conflicts, …}
    seq: 0,                  // порядок коммитов (для log и одинаковых id)
  };
}

/** Корень репозитория: ближайшая папка вверх от cwd, где есть .git. */
export function findRoot(fs, cwd) {
  let dir = cwd;
  for (;;) {
    try {
      const git = fs.as('root', () => fs.lookup(normalize('.git', dir)));
      if (git.repo) return dir;
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
    }
    if (dir === '/') return null;
    dir = dirname(dir);
  }
}

export function repoAt(fs, root) {
  return fs.as('root', () => fs.lookup(normalize('.git', root))).repo;
}

// --- рабочая папка ---

/** Файлы рабочей папки (кроме .git): {путь от корня: текст}. Читаем как root. */
export function workTree(fs, root) {
  const files = {};
  fs.as('root', () => {
    for (const [path, node] of fs.walk(root)) {
      const rel = path.slice(root.length + 1);
      if (!rel || rel === '.git' || rel.startsWith('.git/')) continue;
      if (node.type === 'file') files[rel] = node.content;
    }
  });
  return files;
}

/** Записать файл рабочей папки (создав папки) или удалить (text === null). */
export function writeWork(fs, root, rel, text) {
  const abs = normalize(rel, root);
  if (text === null || text === undefined) {
    if (fs.exists(abs, { follow: false })) fs.remove(abs);
    // пустые папки, оставшиеся от удалённого файла, git тоже не хранит
    let dir = dirname(abs);
    while (dir !== root && dir.startsWith(root) && fs.exists(dir) && !fs.list(dir).length) {
      fs.remove(dir);
      dir = dirname(dir);
    }
    return;
  }
  fs.mkdir(dirname(abs), { parents: true });
  fs.writeFile(abs, text);
}

// --- .gitignore ---

/** Правила .gitignore корня: [{regex, negate, dirOnly}]. */
function ignoreRules(text) {
  const rules = [];
  for (let line of (text ?? '').split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes('/');
    const pattern = line.replace(/^\//, '');
    // ** — любые папки; остальное — как glob имён
    const source = pattern.split('**').map((part) => globToRegExp(part).source.slice(1, -1)).join('.*');
    rules.push({ regex: new RegExp(anchored ? `^${source}$` : `(^|/)${source}$`), negate, dirOnly });
  }
  return rules;
}

/** Игнорируется ли путь (файл или папка на пути к нему). */
export function makeIgnore(gitignore) {
  const rules = ignoreRules(gitignore);
  return (path) => {
    const parts = path.split('/');
    let ignored = false;
    for (let i = 1; i <= parts.length; i += 1) {
      const sub = parts.slice(0, i).join('/');
      const isDir = i < parts.length;
      for (const rule of rules) {
        if (rule.dirOnly && !isDir) continue;
        if (rule.regex.test(sub)) ignored = !rule.negate;
      }
      if (ignored && isDir) return true;       // игнорируемая папка — всё внутри тоже
    }
    return ignored;
  };
}

// --- коммиты и ссылки ---

export function headId(repo) {
  return repo.head.detached ?? repo.heads[repo.head.branch] ?? null;
}

export function headTree(repo) {
  const id = headId(repo);
  return id ? { ...repo.commits[id].tree } : {};
}

/** Все предки коммита (включая его самого). */
export function ancestors(repo, id) {
  const seen = new Set();
  const stack = id ? [id] : [];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...repo.commits[current].parents);
  }
  return seen;
}

/** Общий предок для слияния — ближайший (по порядку коммитов). */
export function mergeBase(repo, a, b) {
  const common = [...ancestors(repo, a)].filter((id) => ancestors(repo, b).has(id));
  return common.sort((x, y) => repo.commits[y].seq - repo.commits[x].seq)[0] ?? null;
}

/**
 * Ревизия → id: HEAD, HEAD~2, HEAD^, ветка, тег, origin/main, начало id.
 * null — не найдено.
 */
export function resolveRev(repo, rev) {
  const match = /^(.+?)((?:~\d*|\^\d*)*)$/.exec(rev);
  if (!match) return null;
  const [, name, suffix] = match;
  let id = null;
  if (name === 'HEAD' || name === '@') id = headId(repo);
  else if (repo.heads[name]) id = repo.heads[name];
  else if (repo.tags[name]) id = repo.tags[name];
  else if (repo.remoteHeads[name]) id = repo.remoteHeads[name];
  else if (repo.remoteHeads[name.replace(/^remotes\//, '')]) id = repo.remoteHeads[name.replace(/^remotes\//, '')];
  else if (/^[0-9a-f]{4,40}$/.test(name)) {
    const found = Object.keys(repo.commits).filter((key) => key.startsWith(name));
    id = found.length === 1 ? found[0] : null;
  }
  for (const step of suffix.match(/[~^]\d*/g) ?? []) {
    if (!id) return null;
    const n = step.length > 1 ? Number(step.slice(1)) : 1;
    if (step[0] === '~') {
      for (let k = 0; k < n && id; k += 1) id = repo.commits[id].parents[0] ?? null;
    } else {
      id = n === 0 ? id : repo.commits[id].parents[n - 1] ?? null;
    }
  }
  return id;
}

/** Создать коммит и сдвинуть текущую ветку (или detached HEAD). */
export function makeCommit(repo, { tree, message, parents, author, email, time = Date.now() }) {
  repo.seq += 1;
  const id = makeId({ tree, message, parents, author, email, seq: repo.seq });
  repo.commits[id] = { id, parents, message, tree: { ...tree }, author, email, time, seq: repo.seq };
  return id;
}

export function moveHead(repo, id, reason) {
  if (repo.head.branch) repo.heads[repo.head.branch] = id;
  else repo.head = { detached: id };
  repo.reflog.push({ id, message: reason });
}

/** Подписи ссылок для log, как у git: (HEAD -> main, tag: v1, origin/main, feature). */
export function decorations(repo, id) {
  const current = repo.head.branch;
  const head = repo.head.detached === id ? ['HEAD']
    : current && repo.heads[current] === id ? [`HEAD -> ${current}`] : [];
  const pick = (refs) => Object.entries(refs).filter(([, target]) => target === id).map(([name]) => name).sort();
  return [
    ...head,
    ...pick(repo.tags).map((name) => `tag: ${name}`),
    ...pick(repo.remoteHeads),
    ...pick(repo.heads).filter((name) => name !== current || repo.head.detached),
  ];
}

// --- настройки: ~/.gitconfig (--global) и config репозитория ---

/** Простой INI ~/.gitconfig → {'user.name': …}. */
export function parseConfig(text) {
  const result = {};
  let section = '';
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.trim();
    const head = /^\[([\w.-]+)\]$/.exec(line);
    if (head) section = head[1];
    const pair = /^([\w-]+)\s*=\s*(.*)$/.exec(line);
    if (pair && section) result[`${section}.${pair[1]}`] = pair[2].replace(/^"(.*)"$/, '$1');
  }
  return result;
}

export function formatConfig(values) {
  const sections = {};
  for (const [key, value] of Object.entries(values)) {
    const dot = key.lastIndexOf('.');
    (sections[key.slice(0, dot)] ??= []).push(`\t${key.slice(dot + 1)} = ${value}`);
  }
  return Object.entries(sections).map(([name, items]) => `[${name}]\n${items.join('\n')}\n`).join('');
}

export const GLOBAL_CONFIG = `${HOME}/.gitconfig`;

export function globalConfig(fs) {
  try {
    return parseConfig(fs.as('root', () => fs.readFile(GLOBAL_CONFIG)));
  } catch (e) {
    return {};
  }
}

/** Значение настройки: сначала репозиторий, потом ~/.gitconfig. */
export function configValue(fs, repo, key) {
  return repo?.config[key] ?? globalConfig(fs)[key];
}

// --- история из setup задачи ---

/** Учебные имя и почта по умолчанию (если setup не просит пустую настройку). */
export const DEFAULT_IDENTITY = { 'user.name': 'Shop Developer', 'user.email': 'dev@shop.example' };

/**
 * Построить репозиторий по setup: repo (папка), commits [{message, branch, from, files}],
 * head, gitconfig (null — без настройки). Рабочая папка = дерево HEAD, поверх — setup.files.
 */
export function buildRepo(fs, setup) {
  const root = setup.repo ?? setup.cwd ?? HOME;
  if (setup.gitconfig !== null) {
    const values = setup.gitconfig ?? DEFAULT_IDENTITY;
    if (Object.keys(values).length) {
      fs.as('shop', () => fs.writeFile(GLOBAL_CONFIG, formatConfig(values)));
    }
  }
  if (!setup.commits) return null;          // commits: [] — репозиторий без коммитов
  fs.as('shop', () => fs.mkdir(root, { parents: true }));
  const repo = emptyRepo();
  fs.as('shop', () => fs.mkdir(normalize('.git', root)));
  fs.lookup(normalize('.git', root)).repo = repo;

  const identity = { ...DEFAULT_IDENTITY, ...(setup.gitconfig ?? {}) };
  let time = Date.now() - (setup.commits?.length ?? 0) * 3600 * 1000;
  for (const item of setup.commits ?? []) {
    const branch = item.branch ?? DEFAULT_BRANCH;
    if (!(branch in repo.heads) && Object.keys(repo.heads).length) {
      repo.heads[branch] = repo.heads[item.from ?? DEFAULT_BRANCH];
    }
    const parent = repo.heads[branch] ?? null;
    const tree = parent ? { ...repo.commits[parent].tree } : {};
    for (const [path, text] of Object.entries(item.files ?? {})) {
      if (text === null) delete tree[path];
      else tree[path] = text;
    }
    const parents = [parent, ...(item.merge ? [repo.heads[item.merge]] : [])].filter(Boolean);
    repo.heads[branch] = makeCommit(repo, {
      tree, message: item.message, parents,
      author: identity['user.name'], email: identity['user.email'], time,
    });
    repo.reflog.push({ id: repo.heads[branch], message: `commit: ${item.message}` });
    time += 3600 * 1000;
  }
  repo.head = { branch: setup.head ?? DEFAULT_BRANCH };
  const tree = headTree(repo);
  repo.index = { ...tree };
  // файлы последнего коммита — в рабочую папку; setup.files (незакоммиченные правки) не трогаем
  const edited = new Set(Object.keys(setup.files ?? {}));
  fs.as('shop', () => {
    for (const [path, text] of Object.entries(tree)) {
      if (!edited.has(normalize(path, root))) writeWork(fs, root, path, text);
    }
  });
  return { root, repo };
}
