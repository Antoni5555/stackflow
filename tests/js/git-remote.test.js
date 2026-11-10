// Git-симулятор: «GitHub» (remote, push, clone, fetch, pull), venv и pip, apt.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { gitShellFromSetup } from '../../src/static/js/engines/git/index.js';
import { repoAt } from '../../src/static/js/engines/git/repo.js';

const ROOT = '/home/shop/shop';
const URL = 'git@github.com:shop/shop.git';

function run(sh, line) {
  const { chunks } = sh.run(line);
  return {
    out: chunks.filter((c) => !c.err).map((c) => c.text).join(''),
    err: chunks.filter((c) => c.err).map((c) => c.text).join(''),
    code: sh.status,
  };
}

const HISTORY = {
  cwd: ROOT,
  commits: [
    { message: 'Каркас магазина', files: { 'settings.py': 'DEBUG = True\n' } },
    { message: 'Корзина', files: { 'cart.py': 'items = []\n' } },
  ],
};

describe('GitHub', () => {
  it('remote add, push -u, status, второй push', () => {
    const sh = gitShellFromSetup(HISTORY);
    assert.match(run(sh, 'git push').err, /No configured push destination/);
    run(sh, `git remote add origin ${URL}`);
    assert.equal(run(sh, 'git remote -v').out, `origin\t${URL} (fetch)\norigin\t${URL} (push)\n`);
    assert.match(run(sh, 'git push').err, /has no upstream branch\.\nTo push the current branch and set the remote as upstream, use\n\n {4}git push --set-upstream origin main/);
    assert.equal(run(sh, 'git push -u origin main').out,
      "To github.com:shop/shop.git\n * [new branch]      main -> main\nbranch 'main' set up to track 'origin/main'.\n");
    assert.match(run(sh, 'git status').out, /Your branch is up to date with 'origin\/main'\./);
    run(sh, 'echo x > a.txt && git add . && git commit -m "Ещё"');
    assert.match(run(sh, 'git status').out, /ahead of 'origin\/main' by 1 commit/);
    assert.match(run(sh, 'git push').out, /^To github\.com:shop\/shop\.git\n {3}[0-9a-f]{7}\.\.[0-9a-f]{7}  main -> main\n$/);
    assert.equal(run(sh, 'git push').out, 'Everything up-to-date\n');
    assert.equal(run(sh, 'git branch -a').out, '* main\n  remotes/origin/main\n');
  });

  it('clone на «другом компьютере», pull', () => {
    const sh = gitShellFromSetup(HISTORY);
    run(sh, `git remote add origin ${URL} && git push -u origin main`);
    run(sh, 'cd /tmp');
    assert.equal(run(sh, `git clone ${URL}`).out, "Cloning into 'shop'...\n");
    assert.equal(run(sh, 'cat /tmp/shop/cart.py').out, 'items = []\n');
    run(sh, 'cd /tmp/shop && echo "DEBUG = False" > settings.py && git commit -am "Прод" && git push');
    run(sh, `cd ${ROOT}`);
    const pull = run(sh, 'git pull');
    assert.match(pull.out, /^From github\.com:shop\/shop\n {3}[0-9a-f]{7}\.\.[0-9a-f]{7}  main {7}-> origin\/main\nUpdating [0-9a-f]{7}\.\.[0-9a-f]{7}\nFast-forward\n/);
    assert.equal(run(sh, 'cat settings.py').out, 'DEBUG = False\n');
  });

  it('setup.remote: чужие коммиты, отказ push, fetch, расхождение в pull', () => {
    const sh = gitShellFromSetup({
      ...HISTORY,
      remote: { url: URL, pushed: ['main'], commits: [{ message: 'Коллега: оплата', files: { 'pay.py': 'x\n' } }] },
    });
    assert.match(run(sh, 'git status').out, /up to date with 'origin\/main'/);   // ещё не знаем
    run(sh, 'echo y > mine.py && git add . && git commit -m "Моё"');
    const push = run(sh, 'git push');
    assert.equal(push.code, 1);
    assert.match(push.out, /! \[rejected\] {8}main -> main \(fetch first\)/);
    assert.match(push.err, /Updates were rejected because the remote contains work that you do not\nhint: have locally/);
    assert.match(run(sh, 'git fetch').out, /^From github\.com:shop\/shop\n {3}[0-9a-f]{7}\.\.[0-9a-f]{7}  main {7}-> origin\/main\n$/);
    assert.match(run(sh, 'git status').out, /have diverged,\nand have 1 and 1 different commits each/);
    assert.match(run(sh, 'git pull').err, /You have divergent branches[\s\S]*fatal: Need to specify how to reconcile divergent branches\.\n$/);
    assert.match(run(sh, 'git pull --no-rebase').out, /Merge made by the 'ort' strategy\./);
    assert.ok(sh.fs.exists(`${ROOT}/pay.py`));
    assert.match(run(sh, 'git push').out, /main -> main/);
  });

  it('push --tags и fetch новой ветки, switch на неё', () => {
    const sh = gitShellFromSetup({
      ...HISTORY,
      remote: { url: URL, pushed: ['main'], commits: [{ message: 'Фича коллеги', branch: 'promo', files: { 'promo.py': 'x\n' } }] },
    });
    run(sh, 'git tag v1.0');
    assert.match(run(sh, 'git push --tags').out, / \* \[new tag\] {9}v1\.0 -> v1\.0/);
    assert.match(run(sh, 'git fetch').out, / \* \[new branch\] {6}promo {6}-> origin\/promo/);
    assert.equal(run(sh, 'git switch promo').out, "branch 'promo' set up to track 'origin/promo'.\nSwitched to a new branch 'promo'\n");
    assert.ok(sh.fs.exists(`${ROOT}/promo.py`));
  });
});

describe('venv и pip', () => {
  it('pip без venv — externally-managed-environment', () => {
    const sh = gitShellFromSetup(HISTORY);
    assert.match(run(sh, 'pip install django').err, /^error: externally-managed-environment\n\n× This environment is externally managed/);
    assert.equal(run(sh, 'which python').out, '');
    assert.equal(run(sh, 'which python3').out, '/usr/bin/python3\n');
    assert.match(run(sh, 'python app.py').err, /^Command 'python' not found/);
  });

  it('venv, activate, install с зависимостями, freeze, uninstall, deactivate', () => {
    const sh = gitShellFromSetup(HISTORY);
    run(sh, 'python3 -m venv venv');
    assert.equal(run(sh, './venv/bin/activate').err, 'bash: ./venv/bin/activate: Permission denied\n');
    run(sh, 'source venv/bin/activate');
    assert.equal(sh.prompt(), '(venv) shop@server:~/shop$ ');
    assert.equal(run(sh, 'which python').out, `${ROOT}/venv/bin/python\n`);
    const install = run(sh, 'pip install django==5.1.4');
    assert.match(install.out, /^Collecting django==5\.1\.4\n {2}Downloading Django-5\.1\.4-py3-none-any\.whl \(8\.3 MB\)\nCollecting asgiref \(from Django\)/);
    assert.match(install.out, /Successfully installed asgiref-3\.8\.1 Django-5\.1\.4 sqlparse-0\.5\.3\n$/);
    assert.ok(sh.fs.exists(`${ROOT}/venv/lib/python3.12/site-packages/django`));
    run(sh, 'pip freeze > requirements.txt');
    assert.equal(run(sh, 'cat requirements.txt').out, 'asgiref==3.8.1\nDjango==5.1.4\nsqlparse==0.5.3\n');
    assert.match(run(sh, 'pip install django').out, /^Requirement already satisfied: django/);
    assert.match(run(sh, 'pip install nosuchpkg').err, /No matching distribution found for nosuchpkg/);
    assert.match(run(sh, 'pip install django==9.9').err, /from versions: 4\.2\.17, 5\.0\.10, 5\.1\.4/);
    assert.match(run(sh, 'pip uninstall django').err, /добавьте -y/);
    assert.match(run(sh, 'pip uninstall -y django').out, /Successfully uninstalled Django-5\.1\.4/);
    assert.equal(run(sh, 'pip freeze').out, 'asgiref==3.8.1\nsqlparse==0.5.3\n');
    run(sh, 'deactivate');
    assert.equal(sh.prompt(), 'shop@server:~/shop$ ');
    assert.match(run(sh, 'pip install -r requirements.txt').err, /externally-managed-environment/);
    assert.match(run(sh, './venv/bin/pip install -r requirements.txt').out, /Successfully installed Django-5\.1\.4/);
    assert.match(run(sh, 'venv/bin/pip list').out, /^Package +Version\n-+ -+\nasgiref +3\.8\.1\nDjango +5\.1\.4\npip +24\.0\nsqlparse +0\.5\.3\n$/);
  });

  it('setup.venv — готовое окружение', () => {
    const sh = gitShellFromSetup({ ...HISTORY, venv: { path: 'venv', packages: { django: '5.1.4' } } });
    assert.equal(run(sh, 'venv/bin/pip freeze').out, 'asgiref==3.8.1\nDjango==5.1.4\nsqlparse==0.5.3\n');
  });
});

describe('apt', () => {
  it('без sudo — ошибка блокировки, через sudo — ставит', () => {
    const sh = gitShellFromSetup(HISTORY);
    const result = run(sh, 'apt install nginx');
    assert.equal(result.code, 100);
    assert.match(result.err, /^E: Could not open lock file \/var\/lib\/dpkg\/lock-frontend - open \(13: Permission denied\)\nE: Unable to acquire the dpkg frontend lock/);
    assert.match(run(sh, 'sudo apt install nginx').out, /Setting up nginx \(1\.24\.0-2ubuntu7\.1\) \.\.\.\n$/);
    assert.equal(run(sh, 'which nginx').out, '/usr/sbin/nginx\n');
    assert.match(run(sh, 'ls -l /etc/nginx/sites-enabled').out, /default -> \/etc\/nginx\/sites-available\/default/);
    assert.match(run(sh, 'sudo apt install nginx').out, /nginx is already the newest version/);
    assert.match(run(sh, 'sudo apt install nope').err, /E: Unable to locate package nope/);
  });
});

describe('сохранение', () => {
  it('репозиторий и GitHub переживают JSON (тренажёр в браузере)', async () => {
    const { VirtualFS } = await import('../../src/static/js/engines/linux/fs.js');
    const { Shell } = await import('../../src/static/js/engines/linux/shell.js');
    const sh = gitShellFromSetup(HISTORY);
    run(sh, `git remote add origin ${URL} && git push -u origin main && git switch -c dev`);
    const copy = new Shell(VirtualFS.fromJSON(JSON.parse(JSON.stringify(sh.fs))), { cwd: ROOT });
    assert.equal(run(copy, 'git branch').out, '* dev\n  main\n');
    assert.ok(repoAt(copy.fs, ROOT).remoteHeads['origin/main']);
    assert.match(run(copy, 'git log --oneline').out, /\(HEAD -> dev, origin\/main, main\) Корзина/);
  });
});

describe('задачи Git: правила', async () => {
  const { firstFailedGitRule, verifyGitTask } = await import('../../src/static/js/engines/git/checker.js');
  const setup = {
    ...HISTORY,
    remote: { url: URL, pushed: ['main'] },
    files: { [`${ROOT}/.env`]: 'SECRET=1\n' },
  };

  it('эталон «убрать .env из репозитория» проходит, setup — нет', () => {
    const task = {
      setup: { ...setup, commits: [...HISTORY.commits, { message: 'Случайно .env', files: { '.env': 'SECRET=1\n' } }] },
      rules: [
        { tracked: '.env', exists: false, fail: '.env всё ещё в репозитории.' },
        { path: `${ROOT}/.env`, exists: true, fail: 'Файл .env удалён с диска — нужен --cached.' },
        { commit_count: { branch: 'main', count: 4 }, fail: 'Нужен ровно один новый коммит.' },
        { clean: true, fail: 'Остались незакоммиченные изменения.' },
      ],
      solution: 'git rm --cached .env\necho ".env" > .gitignore\ngit add .gitignore\ngit commit -m "Убрать .env"\n',
    };
    assert.deepEqual(verifyGitTask(task), []);
    assert.match(verifyGitTask({ ...task, solution: 'git rm .env\necho ".env" > .gitignore\ngit add .gitignore\ngit commit -m x\n' }).join('\n'), /--cached/);
  });

  it('branch, tag, staged, head, commit_in, merged, pushed, config, stash_count, pip_package', () => {
    const sh = gitShellFromSetup(setup);
    run(sh, 'git switch -c promo && echo x > p.py && git add p.py && git commit -m "Промокоды" && git switch main');
    run(sh, 'git merge promo && git push && git tag v1 && echo y >> README.md && git add . ');
    run(sh, 'git config user.email anna@shop.example && echo z >> cart.py && git stash');
    run(sh, 'python3 -m venv venv && venv/bin/pip install django==5.0.10');
    const ok = (rule) => firstFailedGitRule([{ fail: 'x', ...rule }], sh, setup) === null;
    assert.ok(ok({ branch: 'promo' }) && ok({ branch: 'nope', exists: false }) && !ok({ branch: 'nope' }));
    assert.ok(ok({ tag: 'v1' }));
    assert.ok(ok({ head: 'main' }) && !ok({ head: 'promo' }));
    assert.ok(ok({ commit_in: { branch: 'main', message: '^Промокоды$' } }));
    assert.ok(ok({ merged: { from: 'promo', into: 'main' } }));
    assert.ok(ok({ pushed: 'main' }) && !ok({ pushed: 'promo' }));
    assert.ok(ok({ config: { key: 'user.email', value: '@shop\\.example$' } }));
    assert.ok(ok({ stash_count: 1 }));
    assert.ok(ok({ staged: 'README.md', exists: false }));      // ушло в stash
    assert.ok(ok({ pip_package: { name: 'Django', version: '5.0.10' } }) && !ok({ pip_package: { name: 'django', version: '5.1.4' } }));
    assert.ok(ok({ pip_package: { name: 'sqlparse' } }));
    run(sh, 'cd /tmp');                                         // правила смотрят в репозиторий задачи
    assert.ok(ok({ branch: 'promo' }));
  });
});
