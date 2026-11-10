// Карточка «Репозиторий» под терминалом (trainers/components/_git_panel.html):
// граф коммитов (линии и точки — SVG, подписи — HTML) и три области
// (рабочая папка → индекс → репозиторий). Обновляется после каждой команды;
// новые коммиты и только что изменённые файлы подсвечены.

import { openRepo, statusData } from './commands.js';
import { decorations, findRoot, headId, headTree, short } from './repo.js';

const ROW = 32;          // высота строки графа, px
const LANE = 18;         // расстояние между линиями веток, px
const MAX_COMMITS = 40;  // в учебном репозитории больше и не нужно

const SVG = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attrs) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/** Коммиты для графа: все, до которых достают ветки, теги и HEAD, — новые сверху. */
function visibleCommits(repo) {
  const starts = [...Object.values(repo.heads), ...Object.values(repo.remoteHeads),
    ...Object.values(repo.tags), headId(repo)].filter(Boolean);
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...repo.commits[id].parents);
  }
  return [...seen].sort((a, b) => repo.commits[b].seq - repo.commits[a].seq).slice(0, MAX_COMMITS);
}

/** Колонка (линия) каждого коммита: та же раскладка, что у git log --graph. */
function layout(order, repo) {
  const lanes = [];
  const column = {};
  let width = 1;
  for (const id of order) {
    let col = lanes.indexOf(id);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) col = lanes.length;
      lanes[col] = id;
    }
    column[id] = col;
    const [first, ...rest] = repo.commits[id].parents;
    lanes[col] = first ?? null;
    for (const parent of rest) {
      if (!lanes.includes(parent)) {
        const free = lanes.indexOf(null);
        lanes[free === -1 ? lanes.length : free] = parent;
      }
    }
    // одна и та же цель в двух линиях — дальше идёт одной
    lanes.forEach((target, i) => {
      if (target && lanes.indexOf(target) < i) lanes[i] = null;
    });
    width = Math.max(width, lanes.length);
  }
  return { column, width };
}

export class GitView {
  /** @param {Element} root — [data-git-view] */
  constructor(root) {
    this.root = root;
    this.graph = root.querySelector('[data-git-graph]');
    this.areas = root.querySelector('[data-git-areas]');
    this.branch = root.querySelector('[data-git-branch]');
    this.known = null;            // id коммитов при прошлой отрисовке — для подсветки новых
    this.lastFiles = null;
  }

  render(shell) {
    const root = findRoot(shell.fs, shell.cwd);
    if (!root) {
      this.branch.textContent = '';
      this.graph.replaceChildren(el('p', 'muted small', 'Здесь нет репозитория: git init — создать, git clone — скачать с GitHub.'));
      this.areas.replaceChildren();
      this.known = null;
      return;
    }
    const g = openRepo({ sh: shell, fs: shell.fs, args: [] });
    const { repo } = g;
    this.branch.textContent = repo.head.branch ? `${root} · ${repo.head.branch}` : `${root} · HEAD ${short(repo.head.detached)}`;
    this.renderGraph(repo);
    this.renderAreas(g);
  }

  renderGraph(repo) {
    const order = visibleCommits(repo);
    if (!order.length) {
      this.graph.replaceChildren(el('p', 'muted small', 'Коммитов пока нет: git add — подготовить файлы, git commit -m "…" — записать.'));
      this.known = new Set();
      return;
    }
    const fresh = this.known ? order.filter((id) => !this.known.has(id)) : [];
    this.known = new Set(order);
    const { column, width } = layout(order, repo);
    const row = Object.fromEntries(order.map((id, i) => [id, i]));
    const x = (id) => 10 + column[id] * LANE;
    const y = (id) => row[id] * ROW + ROW / 2;
    const picture = svg('svg', {
      class: 'git-graph__lines', width: 20 + (width - 1) * LANE, height: order.length * ROW, 'aria-hidden': 'true',
    });
    // линии к родителям: прямо, если на одной линии, иначе — изгиб у родителя
    for (const id of order) {
      for (const parent of repo.commits[id].parents) {
        if (!(parent in row)) continue;
        const [x1, y1, x2, y2] = [x(id), y(id), x(parent), y(parent)];
        const d = x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}V${y2 - ROW / 2}Q${x1} ${y2} ${x2} ${y2}`;
        picture.append(svg('path', { d, class: 'git-graph__edge' }));
      }
    }
    const head = headId(repo);
    for (const id of order) {
      const classes = ['git-graph__node'];
      if (id === head) classes.push('git-graph__node--head');
      if (fresh.includes(id)) classes.push('git-graph__node--new');
      picture.append(svg('circle', { cx: x(id), cy: y(id), r: 5, class: classes.join(' ') }));
    }
    const list = el('ol', 'git-graph__rows');
    list.style.paddingLeft = `${20 + (width - 1) * LANE + 8}px`;
    for (const id of order) {
      const item = el('li', `git-graph__row${fresh.includes(id) ? ' file--added' : ''}`);
      item.append(el('code', 'git-graph__id', short(id)));
      for (const label of decorations(repo, id)) {
        const kind = label.startsWith('HEAD') ? 'head' : label.startsWith('tag: ') ? 'tag'
          : label.includes('/') && label.split('/')[0] in repo.remotes ? 'remote' : 'branch';
        item.append(el('span', `git-ref git-ref--${kind}`, label));
      }
      item.append(el('span', 'git-graph__message', repo.commits[id].message.split('\n')[0]));
      list.append(item);
    }
    const wrap = el('div', 'git-graph__body');
    wrap.append(picture, list);
    this.graph.replaceChildren(wrap);
  }

  renderAreas(g) {
    const { staged, unstaged, untracked, conflicts } = statusData(g);
    const tree = headTree(g.repo);
    const id = headId(g.repo);
    const column = (title, hint, items, empty) => {
      const box = el('section', 'git-area');
      box.append(el('h4', 'git-area__title', title), el('p', 'git-area__hint muted small', hint));
      const ul = el('ul', 'file-tree git-area__files');
      for (const [kind, path, note] of items) {
        const li = el('li', kind ? `file--${kind}` : '', `📄 ${path}`);
        if (note) li.append(el('span', 'muted', ` ${note}`));
        ul.append(li);
      }
      if (!items.length) ul.append(el('li', 'muted', empty));
      box.append(ul);
      return box;
    };
    const kindOf = { 'new file': 'added', modified: 'changed', deleted: 'removed' };
    const noteOf = { 'new file': 'новый', modified: 'изменён', deleted: 'удалён' };
    const work = [
      ...conflicts.map((path) => ['removed', path, 'конфликт']),
      ...unstaged.map(([kind, path]) => [kindOf[kind], path, noteOf[kind]]),
      ...untracked.map((path) => ['', path, 'не отслеживается']),
    ];
    const index = staged.map(([kind, path]) => [kindOf[kind], path, noteOf[kind]]);
    const commit = id ? `${short(id)} ${g.repo.commits[id].message.split('\n')[0]}` : 'коммитов пока нет';
    const repoFiles = Object.keys(tree).sort().map((path) => ['', path, '']);
    this.areas.replaceChildren(
      column('Рабочая папка', 'отличия от индекса · git add →', work, 'совпадает с индексом'),
      column('Индекс (staged)', 'что войдёт в коммит · git commit →', index, 'пусто — коммитить нечего'),
      column('Репозиторий', commit, repoFiles, 'пусто'),
    );
  }
}
