// Git-симулятор (src/static/js/engines/git/): команды и вывод как у git 2.43.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { gitShellFromSetup } from '../../src/static/js/engines/git/index.js';
import { repoAt } from '../../src/static/js/engines/git/repo.js';

const ROOT = '/home/shop/shop';

function run(sh, line) {
  const { chunks } = sh.run(line);
  return {
    out: chunks.filter((c) => !c.err).map((c) => c.text).join(''),
    err: chunks.filter((c) => c.err).map((c) => c.text).join(''),
    code: sh.status,
  };
}

/** Выполнить несколько строк, упасть на первой ошибке (кроме ожидаемых). */
function runAll(sh, lines) {
  for (const line of lines.trim().split('\n')) {
    const result = run(sh, line.trim());
    assert.equal(result.code, 0, `${line}\n${result.out}${result.err}`);
  }
}

const empty = () => gitShellFromSetup({ cwd: ROOT, dirs: [ROOT] });

/** Репозиторий с историей: main — 2 коммита, feature — 1 свой. */
const HISTORY = {
  cwd: ROOT,
  commits: [
    { message: 'Каркас магазина', files: { 'settings.py': 'DEBUG = True\nPORT = 8000\n', 'README.md': '# Shop\n' } },
    { message: 'Корзина', files: { 'cart.py': 'items = []\n' } },
    { message: 'Промокоды', branch: 'feature', files: { 'promo.py': 'CODES = {}\n' } },
  ],
};

describe('первый коммит', () => {
  it('init, status, add, commit, log', () => {
    const sh = empty();
    assert.equal(run(sh, 'git status').err, 'fatal: not a git repository (or any of the parent directories): .git\n');
    assert.equal(run(sh, 'git init').out, `Initialized empty Git repository in ${ROOT}/.git/\n`);
    run(sh, 'echo "DEBUG = True" > settings.py && mkdir app && touch app/views.py');
    assert.equal(run(sh, 'git status').out, `On branch main

No commits yet

Untracked files:
  (use "git add <file>..." to include in what will be committed)
\tapp/
\tsettings.py

nothing added to commit but untracked files present (use "git add" to track)
`);
    run(sh, 'git add .');
    assert.match(run(sh, 'git status').out, /Changes to be committed:\n {2}\(use "git rm --cached <file>\.\.\." to unstage\)\n\tnew file: {3}app\/views\.py\n\tnew file: {3}settings\.py\n/);
    const commit = run(sh, 'git commit -m "Первый коммит"');
    assert.match(commit.out, /^\[main \(root-commit\) [0-9a-f]{7}\] Первый коммит\n 2 files changed, 1 insertion\(\+\)\n create mode 100644 app\/views\.py\n create mode 100644 settings\.py\n$/);
    assert.equal(run(sh, 'git status').out, 'On branch main\nnothing to commit, working tree clean\n');
    assert.match(run(sh, 'git log --oneline').out, /^[0-9a-f]{7} \(HEAD -> main\) Первый коммит\n$/);
    assert.match(run(sh, 'git log').out, /^commit [0-9a-f]{40} \(HEAD -> main\)\nAuthor: Shop Developer <dev@shop\.example>\nDate: {3}\w{3} \w{3} \d+ \d\d:\d\d:\d\d \d{4} [+-]\d{4}\n\n {4}Первый коммит\n$/);
  });

  it('без -m, без настройки, пустой коммит — ошибки как у git', () => {
    const sh = gitShellFromSetup({ cwd: ROOT, dirs: [ROOT], gitconfig: null });
    runAll(sh, 'git init\ntouch a.txt\ngit add a.txt');
    assert.match(run(sh, 'git commit').err, /нет редактора.*git commit -m/s);
    assert.match(run(sh, 'git commit -m x').err, /^Author identity unknown\n\n\*\*\* Please tell me who you are\./);
    runAll(sh, 'git config --global user.name "Анна"\ngit config --global user.email anna@shop.example\ngit commit -m x');
    assert.equal(run(sh, 'cat ~/.gitconfig').out, '[user]\n\tname = Анна\n\temail = anna@shop.example\n');
    assert.equal(run(sh, 'git config user.name').out, 'Анна\n');
    assert.equal(run(sh, 'git config --list').out, 'user.name=Анна\nuser.email=anna@shop.example\n');
    const again = run(sh, 'git commit -m y');
    assert.equal(again.code, 1);
    assert.match(again.out, /nothing to commit, working tree clean/);
  });

  it('commit -am и --amend --no-edit', () => {
    const sh = gitShellFromSetup(HISTORY);
    run(sh, 'echo "DEBUG = False" > settings.py');
    assert.match(run(sh, 'git commit -am "Выключить DEBUG"').out, /1 file changed, 1 insertion\(\+\), 2 deletions\(-\)/);
    run(sh, 'echo "LOG = 1" > log.py && git add log.py');
    assert.match(run(sh, 'git commit --amend --no-edit').out, /\] Выключить DEBUG\n/);
    assert.equal(run(sh, 'git log --oneline').out.split('\n').filter(Boolean).length, 3);
  });
});

describe('.gitignore и индекс', () => {
  it('игнор, add -f, rm --cached, restore --staged, diff', () => {
    const sh = gitShellFromSetup(HISTORY);
    run(sh, 'echo "SECRET=1" > .env && echo ".env" > .gitignore && mkdir __pycache__ && touch __pycache__/x.pyc && echo "__pycache__/" >> .gitignore');
    assert.match(run(sh, 'git status --short').out, /^\?\? \.gitignore\n$/);
    assert.match(run(sh, 'git add .env').err, /^The following paths are ignored by one of your \.gitignore files:\n\.env\nhint: Use -f/);
    runAll(sh, 'git add -f .env\ngit commit -m "Случайно .env"');
    assert.equal(run(sh, 'git rm --cached .env').out, "rm '.env'\n");
    runAll(sh, 'git add .gitignore\ngit commit -m "Убрать .env из репозитория"');
    assert.equal(run(sh, 'git ls-files').code, 1);    // такой команды нет — честная ошибка
    const repo = repoAt(sh.fs, ROOT);
    assert.ok(!('.env' in repo.commits[repo.heads.main].tree));
    assert.ok(sh.fs.exists(`${ROOT}/.env`));

    run(sh, 'echo "PORT = 9000" >> settings.py && git add settings.py');
    assert.match(run(sh, 'git diff --staged').out, /^diff --git a\/settings\.py b\/settings\.py\nindex [0-9a-f]{7}\.\.[0-9a-f]{7} 100644\n--- a\/settings\.py\n\+\+\+ b\/settings\.py\n@@ -1,2 \+1,3 @@\n DEBUG = True\n PORT = 8000\n\+PORT = 9000\n$/);
    assert.equal(run(sh, 'git diff').out, '');
    run(sh, 'git restore --staged settings.py');
    assert.match(run(sh, 'git diff').out, /\+PORT = 9000/);
    run(sh, 'git restore settings.py');
    assert.equal(run(sh, 'git status -s').out, '');
  });
});

describe('ветки и слияние', () => {
  it('branch, switch -c, switch, branch -d с проверкой слияния', () => {
    const sh = gitShellFromSetup(HISTORY);
    assert.equal(run(sh, 'git branch').out, '  feature\n* main\n');
    assert.equal(run(sh, 'git switch -c about').out, "Switched to a new branch 'about'\n");
    runAll(sh, 'echo "О магазине" > about.html\ngit add about.html\ngit commit -m "Страница о магазине"\ngit switch main');
    assert.ok(!sh.fs.exists(`${ROOT}/about.html`));
    assert.match(run(sh, 'git branch -d about').err, /not fully merged/);
    assert.match(run(sh, 'git merge about').out, /^Updating [0-9a-f]{7}\.\.[0-9a-f]{7}\nFast-forward\n 1 file changed, 1 insertion\(\+\)\n create mode 100644 about\.html\n$/);
    assert.match(run(sh, 'git branch -d about').out, /^Deleted branch about \(was [0-9a-f]{7}\)\.\n$/);
    assert.equal(run(sh, 'git switch nope').err, 'fatal: invalid reference: nope\n');
    assert.equal(run(sh, 'git checkout feature').out, "Switched to branch 'feature'\n");
  });

  it('слияние с коммитом слияния и граф', () => {
    const sh = gitShellFromSetup(HISTORY);
    run(sh, 'echo "x" > shipping.py && git add . && git commit -m "Доставка"');
    assert.match(run(sh, 'git merge feature').out, /^Merge made by the 'ort' strategy\.\n 1 file changed, 1 insertion\(\+\)\n create mode 100644 promo\.py\n$/);
    const graph = run(sh, 'git log --oneline --graph').out;
    // порядок — по времени коммитов (git для --graph выводит топологически; граф тот же)
    assert.match(graph, /^\* [0-9a-f]{7} \(HEAD -> main\) Merge branch 'feature'\n\|\\\n\* \| [0-9a-f]{7} Доставка\n\| \* [0-9a-f]{7} \(feature\) Промокоды\n\|\/\n\* [0-9a-f]{7} Корзина\n\* [0-9a-f]{7} Каркас магазина\n$/);
  });

  it('конфликт: маркеры, status, решение, --abort', () => {
    const setup = {
      ...HISTORY,
      commits: [
        ...HISTORY.commits,
        { message: 'Порт 9000', files: { 'settings.py': 'DEBUG = True\nPORT = 9000\n' } },
        { message: 'Порт 7000', branch: 'feature', files: { 'settings.py': 'DEBUG = True\nPORT = 7000\n' } },
      ],
    };
    const sh = gitShellFromSetup(setup);
    const result = run(sh, 'git merge feature');
    assert.equal(result.code, 1);
    assert.equal(result.out, 'Auto-merging settings.py\nCONFLICT (content): Merge conflict in settings.py\nAutomatic merge failed; fix conflicts and then commit the result.\n');
    assert.equal(run(sh, 'cat settings.py').out, 'DEBUG = True\n<<<<<<< HEAD\nPORT = 9000\n=======\nPORT = 7000\n>>>>>>> feature\n');
    assert.match(run(sh, 'git status').out, /You have unmerged paths\.[\s\S]*Unmerged paths:\n {2}\(use "git add <file>\.\.\." to mark resolution\)\n\tboth modified: {3}settings\.py\n/);
    assert.match(run(sh, 'git commit -m x').err, /Committing is not possible because you have unmerged files/);
    run(sh, 'git merge --abort');
    assert.equal(run(sh, 'cat settings.py').out, 'DEBUG = True\nPORT = 9000\n');
    run(sh, 'git merge feature');
    runAll(sh, 'echo "DEBUG = True" > settings.py\necho "PORT = 8080" >> settings.py\ngit add settings.py\ngit commit');
    assert.match(run(sh, 'git log --oneline -n 1').out, /Merge branch 'feature'\n$/);
    assert.equal(run(sh, 'git status -s').out, '');
  });

  it('переключение с несохранёнными правками, которые бы потерялись', () => {
    const sh = gitShellFromSetup({
      ...HISTORY,
      commits: [...HISTORY.commits, { message: 'feature меняет README', branch: 'feature', files: { 'README.md': '# Shop 2\n' } }],
    });
    run(sh, 'echo "# Мой магазин" > README.md');
    assert.match(run(sh, 'git switch feature').err, /^error: Your local changes to the following files would be overwritten by checkout:\n\tREADME\.md\nPlease commit your changes or stash them before you switch branches\.\nAborting\n$/);
  });

  it('rebase переносит коммиты ветки на main', () => {
    const sh = gitShellFromSetup(HISTORY);
    run(sh, 'echo "x" > shipping.py && git add . && git commit -m "Доставка" && git switch feature');
    assert.equal(run(sh, 'git rebase main').out, 'Successfully rebased and updated refs/heads/feature.\n');
    assert.match(run(sh, 'git log --oneline').out, /\(HEAD -> feature\) Промокоды\n[0-9a-f]{7} \(main\) Доставка\n/);
    assert.match(run(sh, 'git rebase -i main').err, /не поддерживается/);
  });
});

describe('отмена', () => {
  it('reset --soft / --mixed / --hard и спасение через reflog', () => {
    const sh = gitShellFromSetup(HISTORY);
    run(sh, 'git reset --soft HEAD~1');
    assert.match(run(sh, 'git status -s').out, /^A {2}cart\.py\n$/);
    run(sh, 'git commit -m "Корзина снова"');
    run(sh, 'git reset HEAD~1');
    assert.equal(run(sh, 'git status -s').out, '?? cart.py\n');
    run(sh, 'git add . && git commit -m "Корзина"');
    assert.match(run(sh, 'git reset --hard HEAD~1').out, /^HEAD is now at [0-9a-f]{7} Каркас магазина\n$/);
    assert.ok(!sh.fs.exists(`${ROOT}/cart.py`));
    const reflog = run(sh, 'git reflog').out;
    assert.match(reflog, /HEAD@\{0\}: reset: moving to HEAD~1\n/);
    const lost = /([0-9a-f]{7}) HEAD@\{1\}: commit: Корзина/.exec(reflog)[1];
    run(sh, `git reset --hard ${lost}`);
    assert.ok(sh.fs.exists(`${ROOT}/cart.py`));
  });

  it('revert и cherry-pick', () => {
    const sh = gitShellFromSetup(HISTORY);
    assert.match(run(sh, 'git revert HEAD').out, /^\[main [0-9a-f]{7}\] Revert "Корзина"\n 1 file changed, 1 deletion\(-\)\n delete mode 100644 cart\.py\n$/);
    assert.match(run(sh, 'git log -n 1').out, /This reverts commit [0-9a-f]{40}\./);
    assert.match(run(sh, 'git cherry-pick feature').out, /^\[main [0-9a-f]{7}\] Промокоды\n/);
    assert.ok(sh.fs.exists(`${ROOT}/promo.py`));
  });

  it('stash: push, list, pop', () => {
    const sh = gitShellFromSetup(HISTORY);
    run(sh, 'echo "DEBUG = False" > settings.py');
    assert.match(run(sh, 'git stash').out, /^Saved working directory and index state WIP on main: [0-9a-f]{7} Корзина\n$/);
    assert.equal(run(sh, 'git status -s').out, '');
    assert.match(run(sh, 'git stash list').out, /^stash@\{0\}: WIP on main: [0-9a-f]{7} Корзина\n$/);
    const pop = run(sh, 'git stash pop').out;
    assert.match(pop, /modified: {3}settings\.py/);
    assert.match(pop, /Dropped refs\/stash@\{0\} \([0-9a-f]+\)\n$/);
    assert.equal(run(sh, 'cat settings.py').out, 'DEBUG = False\n');
    assert.equal(run(sh, 'git stash list').out, '');
  });
});

describe('история', () => {
  it('tag, log -S, --grep, blame, show', () => {
    const sh = gitShellFromSetup(HISTORY);
    run(sh, 'git tag v1.0');
    assert.match(run(sh, 'git log --oneline -n 1').out, /\(HEAD -> main, tag: v1\.0\) Корзина/);
    assert.match(run(sh, 'git log --oneline -S "items"').out, /^[0-9a-f]{7} \(HEAD -> main, tag: v1\.0\) Корзина\n$/);
    assert.match(run(sh, 'git log --oneline --grep=Каркас').out, /Каркас магазина\n$/);
    run(sh, 'echo "PORT = 9000" > settings.py');
    const blame = run(sh, 'git blame settings.py').out;
    assert.match(blame, /^00000000 \(Not Committed Yet .* 1\) PORT = 9000\n$/);
    run(sh, 'git restore settings.py');
    assert.match(run(sh, 'git blame settings.py').out, /^\^[0-9a-f]{7} \(Shop Developer \d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d{4} 1\) DEBUG = True\n/);
    assert.match(run(sh, 'git show HEAD').out, /new file mode 100644\n.*\n--- \/dev\/null\n\+\+\+ b\/cart\.py\n@@ -0,0 \+1 @@\n\+items = \[\]\n/);
  });

  it('setup: файл удалён в коммите (null) и незакоммиченные правки', () => {
    const sh = gitShellFromSetup({
      ...HISTORY,
      commits: [...HISTORY.commits, { message: 'Убрать README', files: { 'README.md': null } }],
      files: { [`${ROOT}/settings.py`]: 'DEBUG = False\n' },
    });
    assert.ok(!sh.fs.exists(`${ROOT}/README.md`));
    assert.equal(run(sh, 'git status -s').out, ' M settings.py\n');
  });
});
