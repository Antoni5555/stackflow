// Дерево файлов под терминалом: папка root и всё внутри, с подсветкой того, что сделала
// последняя команда (создано / изменено / удалено). Изменения вне папки — списком ниже.
// Данные — снимки VirtualFS.snapshot(): {путь: "тип|права|владелец|группа|размер|цель|текст"}.

import { VirtualFS } from './fs.js';
import { humanSize } from './commands.js';

const ICONS = { dir: '📁', file: '📄', link: '🔗' };
const STATUS = { added: 'создано', changed: 'изменено', removed: 'удалено' };

function parse(signature) {
  const [type, mode, owner, , size, target] = signature.split('|');
  return { type, mode: Number(mode), owner, size: Number(size), target };
}

/** Подпись справа: владелец, если не shop; права, если не обычные; размер больших файлов. */
function meta({ type, mode, owner, size }) {
  const parts = [];
  if (owner !== 'shop') parts.push(owner);
  const usual = type === 'dir' ? 0o755 : 0o644;
  if (type !== 'link' && (mode & 0o777) !== usual) parts.push((mode & 0o777).toString(8));
  if (type === 'file' && size >= 1024 * 1024) parts.push(humanSize(size));
  return parts.join(' · ');
}

export class FileTree {
  /** @param {Element} root — [data-file-tree] */
  constructor(root, rootPath) {
    this.list = root.querySelector('[data-tree]');
    this.outside = root.querySelector('[data-tree-outside]');
    root.querySelector('[data-tree-path]').textContent = rootPath;
    this.rootPath = rootPath;
  }

  /** Нарисовать дерево по снимку after; before — снимок до команды (для подсветки). */
  render(fs, before = null) {
    const after = fs.snapshot('/');
    const diff = before ? VirtualFS.diff(before, after) : { added: [], changed: [], removed: [] };
    const status = new Map();
    for (const key of ['added', 'changed', 'removed']) {
      for (const path of diff[key]) status.set(path, key);
    }
    const inside = (path) => path === this.rootPath || path.startsWith(`${this.rootPath}/`);
    const all = { ...after };
    for (const path of diff.removed) all[path] = before[path];

    this.list.replaceChildren(...(all[this.rootPath] ? [this.item(this.rootPath, all, status)] : []));

    // Изменения вне показанной папки: /etc, /var/log… — списком, чтобы их тоже было видно
    const outside = [...status].filter(([path]) => !inside(path));
    this.outside.replaceChildren(...outside.map(([path, kind]) => {
      const li = document.createElement('li');
      li.className = `file--${kind}`;
      li.textContent = `${ICONS[parse(all[path]).type]} ${path} — ${STATUS[kind]}`;
      return li;
    }));
    this.outside.hidden = !outside.length;
  }

  item(path, all, status) {
    const info = parse(all[path]);
    const li = document.createElement('li');
    // «изменено» у папки — только её права или владелец (время в снимок не входит)
    const kind = status.get(path);
    if (kind) li.className = `file--${kind}`;
    const name = path === this.rootPath ? path.split('/').pop() || '/' : path.split('/').pop();
    li.append(`${ICONS[info.type]} ${name}${info.type === 'dir' ? '/' : ''}`);
    if (info.type === 'link') li.append(` → ${info.target}`);
    const text = meta(info);
    if (text) {
      const span = document.createElement('span');
      span.className = 'muted';
      span.textContent = ` ${text}`;
      li.append(span);
    }
    if (info.type === 'dir') {
      const children = Object.keys(all)
        .filter((child) => child !== path && child.startsWith(path === '/' ? '/' : `${path}/`)
          && !child.slice(path.length + 1).includes('/'))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      if (children.length) {
        const ul = document.createElement('ul');
        ul.append(...children.map((child) => this.item(child, all, status)));
        li.append(ul);
      }
    }
    return li;
  }
}
