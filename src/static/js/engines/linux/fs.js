// Виртуальная файловая система Linux-симулятора: дерево в памяти браузера.
// Узел — папка, файл или символическая ссылка; у каждого владелец, группа, права и время
// изменения. Жёсткая ссылка — две записи в папках, указывающие на один и тот же узел.
// Права проверяются для текущего пользователя (fs.user): root может всё.

export const USERS = {
  root: { uid: 0, groups: ['root'] },
  shop: { uid: 1000, groups: ['shop', 'sudo'] },
  'www-data': { uid: 33, groups: ['www-data'] },
};
export const GROUPS = { root: 0, sudo: 27, 'www-data': 33, shop: 1000 };
export const HOME = '/home/shop';
export const DAY = 24 * 60 * 60 * 1000;

const MESSAGES = {
  ENOENT: 'No such file or directory',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  EACCES: 'Permission denied',
  EEXIST: 'File exists',
  ENOTEMPTY: 'Directory not empty',
  EPERM: 'Operation not permitted',
  ELOOP: 'Too many levels of symbolic links',
};

/** Ошибка файловой системы: code — как в Linux (ENOENT…), message — текст для терминала. */
export class FsError extends Error {
  constructor(code) {
    super(MESSAGES[code]);
    this.code = code;
  }
}

const textSize = (text) => new TextEncoder().encode(text).length;

function makeNode(type, props = {}) {
  const node = {
    type, owner: 'root', group: 'root', mode: type === 'dir' ? 0o755 : 0o644,
    mtime: Date.now(), nlink: 1, ...props,
  };
  if (type === 'dir' && !node.children) node.children = new Map();
  if (type === 'file') {
    node.content ??= '';
    node.size ??= textSize(node.content);
  }
  return node;
}

/** «6M» → байты. Число без единицы — байты. */
export function parseSize(value) {
  const match = /^(\d+(?:\.\d+)?)\s*([KMG]?)$/i.exec(String(value).trim());
  if (!match) throw new Error(`Неверный размер: ${value}`);
  const power = { '': 0, K: 1, M: 2, G: 3 }[match[2].toUpperCase()];
  return Math.round(Number(match[1]) * 1024 ** power);
}

/** Путь → части без пустых и «.»; «..» поднимается на уровень (лексически). */
export function normalize(path, cwd = '/') {
  const parts = [];
  const full = path.startsWith('/') ? path : `${cwd}/${path}`;
  for (const part of full.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

export const dirname = (path) => normalize(`${path}/..`);
export const basename = (path) => path.split('/').filter(Boolean).pop() ?? '/';

export class VirtualFS {
  constructor() {
    this.root = makeNode('dir');
    this.user = 'shop';
    // Скелет сервера: системные папки — root, домашняя — shop
    for (const dir of ['/bin', '/etc', '/root', '/srv', '/usr/bin', '/usr/local/bin',
      '/var/log', '/var/www', '/opt', '/dev']) {
      this.mkdirAs(dir, 'root');
    }
    this.lookup('/root').mode = 0o700;
    this.mkdirAs('/tmp', 'root').mode = 0o1777;
    this.mkdirAs(HOME, 'shop');
    // Папка проектов принадлежит пользователю, от которого идёт деплой, — как на нашем сервере
    this.lookup('/srv').owner = 'shop';
    this.lookup('/srv').group = 'shop';
    this.lookup('/home').owner = 'root';
    this.lookup('/dev').children.set('null', makeNode('file', { special: 'null', mode: 0o666 }));
    for (const name of ['python3', 'bash', 'sh']) {
      this.lookup('/usr/bin').children.set(name, makeNode('file', { mode: 0o755, size: 14336 }));
    }
  }

  /**
   * Папка с родителями — для скелета и setup, без проверки прав. Новые папки получают
   * владельца owner, а если он не задан — владельца ближайшей существующей папки
   * (/etc/nginx — root, /srv/shop/logs — shop).
   */
  mkdirAs(path, owner = null, props = {}) {
    let node = this.root;
    for (const name of normalize(path).split('/').filter(Boolean)) {
      if (!node.children.has(name)) {
        const who = owner ?? node.owner;
        node.children.set(name, makeNode('dir', { owner: who, group: owner ?? node.group }));
      }
      node = node.children.get(name);
    }
    Object.assign(node, props);
    return node;
  }

  /**
   * Построить ФС по setup задачи: files {путь: текст | {content|size, owner, mode, mtime}},
   * dirs [путь | {путь: {owner, mode}}], cwd. Владелец по умолчанию — shop.
   */
  static fromSetup(setup = {}) {
    const fs = new VirtualFS();
    const props = (spec) => {
      const result = {};
      if (spec.owner) {
        result.owner = spec.owner;
        result.group = spec.group ?? spec.owner;
      }
      if (spec.mode) result.mode = parseInt(spec.mode, 8);
      if (spec.mtime !== undefined) result.mtime = Date.now() - Number(spec.mtime) * DAY;
      return result;
    };
    for (const item of setup.dirs ?? []) {
      const [path, spec] = typeof item === 'string' ? [item, {}] : Object.entries(item)[0];
      const own = props(spec ?? {});
      // сама папка из setup — по умолчанию shop, промежуточные — как у родителя
      fs.mkdirAs(dirname(path));
      fs.mkdirAs(path, own.owner ?? 'shop', own);
    }
    for (const [path, value] of Object.entries(setup.files ?? {})) {
      const spec = typeof value === 'string' ? { content: value } : value ?? {};
      const parent = fs.mkdirAs(dirname(path));
      const file = makeNode('file', {
        owner: 'shop', group: 'shop', content: spec.content ?? '',
        ...(spec.size !== undefined ? { size: parseSize(spec.size), heavy: true } : {}),
        ...props(spec),
      });
      parent.children.set(basename(path), file);
    }
    return fs;
  }

  // --- права ---

  /** Может ли текущий пользователь r/w/x этот узел. */
  can(node, perm) {
    const bit = { r: 4, w: 2, x: 1 }[perm];
    if (this.user === 'root') return perm !== 'x' || node.type === 'dir' || (node.mode & 0o111) !== 0;
    const groups = USERS[this.user]?.groups ?? [];
    let shift = 0;
    if (node.owner === this.user) shift = 6;
    else if (groups.includes(node.group)) shift = 3;
    return ((node.mode >> shift) & bit) !== 0;
  }

  require(node, perm) {
    if (!this.can(node, perm)) throw new FsError('EACCES');
  }

  // --- поиск узлов ---

  /**
   * Узел по абсолютному пути. follow — проходить ли символическую ссылку в последней части.
   * По пути нужен доступ x к каждой папке.
   */
  lookup(path, { follow = true } = {}, depth = 0) {
    if (depth > 20) throw new FsError('ELOOP');
    const names = normalize(path).split('/').filter(Boolean);
    let node = this.root;
    let current = '/';
    for (const [i, name] of names.entries()) {
      if (node.type !== 'dir') throw new FsError('ENOTDIR');
      if (!this.can(node, 'x')) throw new FsError('EACCES');
      const child = node.children.get(name);
      if (!child) throw new FsError('ENOENT');
      current = normalize(name, current);
      const last = i === names.length - 1;
      if (child.type === 'link' && (!last || follow)) {
        node = this.lookup(normalize(child.target, dirname(current)), { follow: true }, depth + 1);
        current = normalize(child.target, dirname(current));
      } else {
        node = child;
      }
    }
    return node;
  }

  exists(path, options) {
    try {
      this.lookup(path, options);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Папка-родитель и имя — для создания и удаления. */
  parentOf(path) {
    const abs = normalize(path);
    if (abs === '/') throw new FsError('EEXIST');
    const parent = this.lookup(dirname(abs));
    if (parent.type !== 'dir') throw new FsError('ENOTDIR');
    return { parent, name: basename(abs) };
  }

  // --- файлы ---

  readFile(path) {
    const node = this.lookup(path);
    if (node.type === 'dir') throw new FsError('EISDIR');
    this.require(node, 'r');
    if (node.special === 'null') return '';
    return node.content;
  }

  /** Записать (или дописать) текст; файл создаётся, если его нет. */
  writeFile(path, text, { append = false } = {}) {
    let node = null;
    try {
      node = this.lookup(path);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (node) {
      if (node.type === 'dir') throw new FsError('EISDIR');
      this.require(node, 'w');
      if (node.special === 'null') return node;
      node.content = append ? node.content + text : text;
      node.size = textSize(node.content);
      delete node.heavy;
      delete node.binary;
      node.mtime = Date.now();
      return node;
    }
    return this.createFile(path, { content: text });
  }

  /** Новый файл от текущего пользователя (props — content, size, binary). */
  createFile(path, props = {}) {
    const { parent, name } = this.parentOf(path);
    this.require(parent, 'w');
    this.require(parent, 'x');
    const node = makeNode('file', { owner: this.user, group: this.user, ...props });
    parent.children.set(name, node);
    parent.mtime = Date.now();
    return node;
  }

  touch(path) {
    try {
      const node = this.lookup(path);
      if (node.owner !== this.user && this.user !== 'root') this.require(node, 'w');
      node.mtime = Date.now();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.createFile(path);
    }
  }

  // --- папки ---

  mkdir(path, { parents = false } = {}) {
    if (parents) {
      let current = '/';
      for (const name of normalize(path).split('/').filter(Boolean)) {
        current = normalize(name, current);
        if (this.exists(current)) {
          if (this.lookup(current).type !== 'dir') throw new FsError('ENOTDIR');
          continue;
        }
        this.mkdir(current);
      }
      return;
    }
    const { parent, name } = this.parentOf(path);
    if (parent.children.has(name)) throw new FsError('EEXIST');
    this.require(parent, 'w');
    this.require(parent, 'x');
    parent.children.set(name, makeNode('dir', { owner: this.user, group: this.user }));
    parent.mtime = Date.now();
  }

  /** Записи папки: [[имя, узел]] (нужно право r). */
  list(path) {
    const node = this.lookup(path);
    if (node.type !== 'dir') throw new FsError('ENOTDIR');
    this.require(node, 'r');
    return [...node.children.entries()];
  }

  /** Удалить запись (файл, ссылку или пустую папку; recursive — папку целиком). */
  remove(path, { recursive = false } = {}) {
    const { parent, name } = this.parentOf(path);
    const node = parent.children.get(name);
    if (!node) throw new FsError('ENOENT');
    if (node.type === 'dir' && !recursive && node.children.size) throw new FsError('ENOTEMPTY');
    this.require(parent, 'w');
    this.require(parent, 'x');
    if (node.type === 'dir' && recursive) {
      for (const child of [...node.children.keys()]) {
        this.remove(normalize(child, normalize(path)), { recursive: true });
      }
    }
    parent.children.delete(name);
    node.nlink -= 1;
    parent.mtime = Date.now();
  }

  /** Снять запись с места, не трогая сам узел (mv: узел переедет по attach). */
  detach(path) {
    const { parent, name } = this.parentOf(path);
    if (!parent.children.has(name)) throw new FsError('ENOENT');
    this.require(parent, 'w');
    this.require(parent, 'x');
    parent.children.delete(name);
    parent.mtime = Date.now();
  }

  /** Поставить существующий узел по новому пути (mv, жёсткая ссылка). */
  attach(path, node) {
    const { parent, name } = this.parentOf(path);
    this.require(parent, 'w');
    this.require(parent, 'x');
    parent.children.set(name, node);
    parent.mtime = Date.now();
  }

  /** Копия узла от текущего пользователя (cp): права сохраняются, владелец — новый. */
  clone(node) {
    const copy = makeNode(node.type, {
      mode: node.mode, owner: this.user, group: this.user,
      content: node.content, size: node.size, target: node.target,
      heavy: node.heavy, binary: node.binary,
    });
    if (node.type === 'dir') {
      for (const [name, child] of node.children) copy.children.set(name, this.clone(child));
      copy.size = undefined;
    }
    return copy;
  }

  symlink(target, path) {
    const { parent, name } = this.parentOf(path);
    if (parent.children.has(name)) throw new FsError('EEXIST');
    this.require(parent, 'w');
    parent.children.set(name, makeNode('link', {
      target, owner: this.user, group: this.user, mode: 0o777,
    }));
  }

  /** Размер узла для ls и find: папка — 4096, ссылка — длина цели. */
  static sizeOf(node) {
    if (node.type === 'dir') return 4096;
    if (node.type === 'link') return node.target.length;
    return node.size;
  }

  /** Обход дерева: [путь, узел] для path и всего внутри (без перехода по ссылкам). */
  * walk(path, { onError } = {}) {
    const node = this.lookup(path, { follow: true });
    yield [path, node];
    if (node.type !== 'dir') return;
    let entries;
    try {
      entries = this.list(path);
    } catch (e) {
      onError?.(path, e);
      return;
    }
    // порядок как в LANG=C.UTF-8 — побайтовый
    for (const [name, child] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const childPath = path === '/' ? `/${name}` : `${path}/${name}`;
      if (child.type === 'dir') yield* this.walk(childPath, { onError });
      else yield [childPath, child];
    }
  }

  // --- снимок: что изменилось после команды (подсветка в дереве файлов) ---

  /** {путь: подпись} всех узлов под path (без прав доступа — смотрит «сверху»). */
  snapshot(path = '/') {
    const result = {};
    const visit = (current, node) => {
      result[current] = [node.type, node.mode, node.owner, node.group, node.size,
        node.target ?? '', node.type === 'file' ? node.content : ''].join('|');
      if (node.type !== 'dir') return;
      for (const [name, child] of node.children) {
        visit(current === '/' ? `/${name}` : `${current}/${name}`, child);
      }
    };
    const user = this.user;
    this.user = 'root';
    try {
      visit(normalize(path), this.lookup(path, { follow: false }));
    } finally {
      this.user = user;
    }
    return result;
  }

  /** Разница двух снимков: {added, changed, removed} — списки путей. */
  static diff(before, after) {
    const added = [];
    const changed = [];
    for (const [path, signature] of Object.entries(after)) {
      if (!(path in before)) added.push(path);
      else if (before[path] !== signature) changed.push(path);
    }
    const removed = Object.keys(before).filter((path) => !(path in after));
    return { added, changed, removed };
  }

  /** Выполнить fn от имени другого пользователя (sudo). */
  as(user, fn) {
    const previous = this.user;
    this.user = user;
    try {
      return fn();
    } finally {
      this.user = previous;
    }
  }
}
