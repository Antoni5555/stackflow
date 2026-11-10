// Linux-симулятор (src/static/js/engines/linux/): команды, права, конвейеры, скрипты.
// Запуск: node --test tests/js/

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VirtualFS } from '../../src/static/js/engines/linux/fs.js';
import { Shell } from '../../src/static/js/engines/linux/shell.js';

/** Оболочка над setup задачи; cwd — из setup или домашняя папка. */
function shell(setup = {}) {
  return new Shell(VirtualFS.fromSetup(setup), setup.cwd ? { cwd: setup.cwd } : {});
}

/** Выполнить строку: {out, err, code}. */
function run(sh, line) {
  const { chunks, action } = sh.run(line);
  return {
    out: chunks.filter((c) => !c.err).map((c) => c.text).join(''),
    err: chunks.filter((c) => c.err).map((c) => c.text).join(''),
    code: sh.status,
    action,
  };
}

const SHOP = {
  cwd: '/srv/shop',
  files: {
    '/srv/shop/config/settings.ini': 'DEBUG=False\nSECRET=abc\n',
    '/srv/shop/logs/app.log': 'INFO start\nERROR db down\nINFO ok\nERROR timeout\n',
    '/srv/shop/orders.csv': 'id,city,total\n1,Moscow,500\n2,Kazan,1200\n3,Moscow,90\n',
    '/srv/shop/.env': 'SECRET_KEY=x\n',
    '/var/log/big.log': { size: '6M', owner: 'root', mtime: 10 },
    '/var/log/small.log': { content: 'x\n', owner: 'root', mtime: 1 },
    '/etc/nginx/nginx.conf': { content: 'server {}\n', owner: 'root' },
  },
  dirs: ['/srv/shop/backup', { '/etc/nginx/sites-enabled': { owner: 'root' } }],
};

describe('навигация', () => {
  it('pwd, cd, cd -, cd ~ и приглашение', () => {
    const sh = shell(SHOP);
    assert.equal(run(sh, 'pwd').out, '/srv/shop\n');
    run(sh, 'cd config');
    assert.equal(sh.cwd, '/srv/shop/config');
    assert.equal(run(sh, 'cd -').out, '/srv/shop\n');
    run(sh, 'cd ~');
    assert.equal(sh.prompt(), 'shop@server:~$ ');
    assert.match(run(sh, 'cd /nope').err, /^bash: cd: \/nope: No such file or directory/);
    assert.match(run(sh, 'cd /srv/shop/orders.csv').err, /Not a directory/);
    assert.match(run(sh, 'cd /root').err, /Permission denied/);
  });

  it('ls: скрытые, флаги вместе, в конвейере — по строке', () => {
    const sh = shell(SHOP);
    assert.equal(run(sh, 'ls').out, 'backup  config  logs  orders.csv\n');
    assert.equal(run(sh, 'ls -a').out, '.  ..  .env  backup  config  logs  orders.csv\n');
    assert.equal(run(sh, 'ls | wc -l').out, '4\n');
    const long = run(sh, 'ls -la config').out;
    assert.match(long, /^total \d+\n/);
    assert.match(long, /-rw-r--r-- 1 shop shop \s*23 \w{3} [ \d]\d \d\d:\d\d settings\.ini/);
    assert.match(run(sh, 'ls -lh /var/log').out, /6\.0M .* big\.log/);
    assert.equal(run(sh, 'ls nope').err, "ls: cannot access 'nope': No such file or directory\n");
    assert.equal(sh.status, 2);
    assert.match(run(sh, 'ls -z').err, /invalid option -- 'z'/);
  });

  it('--help у команд — коротко по-русски', () => {
    const sh = shell();
    assert.match(run(sh, 'ls --help').out, /-l\s+подробно/);
    assert.match(run(sh, 'cp --help').out, /-r/);
  });
});

describe('файлы', () => {
  it('cp без -r пропускает папку, с -r копирует', () => {
    const sh = shell(SHOP);
    const result = run(sh, 'cp config backup/');
    assert.equal(result.err, "cp: -r not specified; omitting directory 'config'\n");
    assert.equal(result.code, 1);
    run(sh, 'cp -r config backup/');
    assert.equal(run(sh, 'cat backup/config/settings.ini').out, 'DEBUG=False\nSECRET=abc\n');
    assert.ok(sh.fs.exists('/srv/shop/config/settings.ini'));
  });

  it('mv переносит папку целиком и переименовывает файлы', () => {
    const sh = shell(SHOP);
    run(sh, 'mv config backup/');
    assert.equal(run(sh, 'cat backup/config/settings.ini').code, 0);
    assert.ok(!sh.fs.exists('/srv/shop/config'));
    run(sh, 'mv orders.csv orders_old.csv');
    assert.deepEqual(run(sh, 'ls').out, 'backup  logs  orders_old.csv\n');
    assert.equal(run(sh, 'mv nope x').err, "mv: cannot stat 'nope': No such file or directory\n");
  });

  it('mkdir -p, touch, rm, rm -rf, защита от rm -rf /', () => {
    const sh = shell(SHOP);
    assert.equal(run(sh, 'mkdir a/b').err, 'mkdir: cannot create directory ‘a/b’: No such file or directory\n');
    run(sh, 'mkdir -p a/b/c && touch a/b/c/file.txt');
    assert.ok(sh.fs.exists('/srv/shop/a/b/c/file.txt'));
    assert.equal(run(sh, 'mkdir a').err, 'mkdir: cannot create directory ‘a’: File exists\n');
    assert.equal(run(sh, 'rm a').err, "rm: cannot remove 'a': Is a directory\n");
    run(sh, 'rm -rf a');
    assert.ok(!sh.fs.exists('/srv/shop/a'));
    assert.equal(run(sh, 'rm -f nope').code, 0);
    assert.match(run(sh, 'rm -rf /').err, /dangerous to operate recursively on '\/'/);
  });

  it('ссылки: ln -s и жёсткая ln', () => {
    const sh = shell(SHOP);
    run(sh, 'ln -s /srv/shop/config/settings.ini current.ini');
    assert.match(run(sh, 'ls -l current.ini').out, /^lrwxrwxrwx .* current\.ini -> \/srv\/shop\/config\/settings\.ini/);
    assert.equal(run(sh, 'cat current.ini').out, 'DEBUG=False\nSECRET=abc\n');
    run(sh, 'ln orders.csv hard.csv && echo "4,Omsk,1" >> hard.csv');
    assert.match(run(sh, 'tail -n 1 orders.csv').out, /Omsk/);
    assert.match(run(sh, 'ls -l orders.csv').out, /^-rw-r--r-- 2 /);
    assert.match(run(sh, 'ln config c2').err, /hard link not allowed for directory/);
  });

  it('скрытые файлы не попадают в *, кавычки отключают *', () => {
    const sh = shell(SHOP);
    assert.equal(run(sh, 'echo *').out, 'backup config logs orders.csv\n');
    assert.equal(run(sh, "echo '*'").out, '*\n');
    assert.equal(run(sh, 'echo logs/*.log').out, 'logs/app.log\n');
    assert.equal(run(sh, 'echo *.txt').out, '*.txt\n');            // нет совпадений — как есть
  });
});

describe('перенаправления и конвейеры', () => {
  it('>, >>, 2>, 2>&1, /dev/null, <', () => {
    const sh = shell(SHOP);
    run(sh, 'echo "DEBUG=True" > .env && echo "PORT=8000" >> .env');
    assert.equal(run(sh, 'cat .env').out, 'DEBUG=True\nPORT=8000\n');
    run(sh, 'ls nope 2> err.txt');
    assert.match(run(sh, 'cat err.txt').out, /cannot access 'nope'/);
    assert.equal(run(sh, 'ls nope 2>/dev/null').err, '');
    run(sh, 'ls nope orders.csv > all.txt 2>&1');
    assert.match(run(sh, 'cat all.txt').out, /orders\.csv\n.*cannot access/s);
    assert.equal(run(sh, 'wc -l < orders.csv').out, '4\n');
    assert.equal(run(sh, 'echo x > /etc/hosts').err, 'bash: /etc/hosts: Permission denied\n');
    assert.equal(run(sh, 'echo x > nodir/file').err, 'bash: nodir/file: No such file or directory\n');
  });

  it('grep | sort | uniq -c | sort -nr и cut', () => {
    const sh = shell(SHOP);
    assert.equal(run(sh, 'grep ERROR logs/app.log').out, 'ERROR db down\nERROR timeout\n');
    assert.equal(run(sh, 'grep -c ERROR logs/app.log').out, '2\n');
    assert.equal(run(sh, 'grep -vn INFO logs/app.log').out, '2:ERROR db down\n4:ERROR timeout\n');
    assert.equal(run(sh, 'grep -i error logs/app.log | wc -l').out, '2\n');
    assert.equal(run(sh, 'grep -r SECRET .').out, '.env:SECRET_KEY=x\nconfig/settings.ini:SECRET=abc\n');
    assert.equal(run(sh, 'grep nothing logs/app.log').code, 1);
    assert.equal(
      run(sh, 'tail -n +2 orders.csv | cut -d , -f 2 | sort | uniq -c | sort -nr').out,
      '      2 Moscow\n      1 Kazan\n',
    );
    assert.equal(run(sh, 'sort -t, -n orders.csv').code, 2);
  });

  it('head и tail, -n N и -N', () => {
    const sh = shell(SHOP);
    assert.equal(run(sh, 'head -n 2 orders.csv').out, 'id,city,total\n1,Moscow,500\n');
    assert.equal(run(sh, 'tail -1 orders.csv').out, '3,Moscow,90\n');
    assert.match(run(sh, 'head nope').err, /head: cannot open 'nope' for reading: No such file or directory/);
  });

  it('&& и || по коду выхода, echo $?', () => {
    const sh = shell(SHOP);
    assert.equal(run(sh, 'ls nope 2>/dev/null && echo yes || echo no').out, 'no\n');
    run(sh, 'ls nope');
    assert.equal(run(sh, 'echo $?').out, '2\n');
    run(sh, 'foo');
    assert.equal(run(sh, 'echo $?').out, '127\n');
    assert.equal(run(sh, 'true; echo $?').out, '0\n');
  });
});

describe('поиск и место', () => {
  it('find: -name, -type, -size, -mtime', () => {
    const sh = shell(SHOP);
    assert.equal(run(sh, "find /var/log -name '*.log' -size +5M").out, '/var/log/big.log\n');
    assert.equal(run(sh, 'find /var/log -type f -mtime +7').out, '/var/log/big.log\n');
    assert.equal(run(sh, 'find /var/log -type f -mtime -7').out, '/var/log/small.log\n');
    assert.equal(run(sh, 'find . -type d').out, '.\n./backup\n./config\n./logs\n');
    assert.match(run(sh, 'find /root').err, /find: ‘\/root’: Permission denied/);
  });

  it('du -sh и df -h', () => {
    const sh = shell(SHOP);
    assert.match(run(sh, 'du -sh /var/log').out, /^6\.1M\t\/var\/log\n$/);
    assert.match(run(sh, 'df -h').out, /^Filesystem\s+Size\s+Used\s+Avail\s+Use%\s+Mounted on\n\/dev\/sda1\s+15G/);
  });
});

describe('права и пользователи', () => {
  it('shop не пишет в /etc, sudo — может', () => {
    const sh = shell(SHOP);
    assert.equal(run(sh, 'touch /etc/nginx/new.conf').err, "touch: cannot touch '/etc/nginx/new.conf': Permission denied\n");
    run(sh, 'sudo touch /etc/nginx/new.conf');
    assert.match(run(sh, 'ls -l /etc/nginx/new.conf').out, / root root /);
    assert.equal(run(sh, 'whoami').out, 'shop\n');
    assert.equal(run(sh, 'sudo whoami').out, 'root\n');
    assert.equal(run(sh, 'id').out, 'uid=1000(shop) gid=1000(shop) groups=1000(shop),27(sudo)\n');
  });

  it('chmod числом и буквами, chown только через sudo, chgrp', () => {
    const sh = shell(SHOP);
    run(sh, 'chmod 600 .env');
    assert.match(run(sh, 'ls -la .env').out, /^-rw------- /m);
    run(sh, 'chmod u+x,g+r orders.csv');
    assert.match(run(sh, 'ls -l orders.csv').out, /^-rwxr--r-- /);
    assert.equal(run(sh, 'chmod 644 /etc/nginx/nginx.conf').err,
      "chmod: changing permissions of '/etc/nginx/nginx.conf': Operation not permitted\n");
    assert.equal(run(sh, 'chown www-data config').err,
      "chown: changing ownership of 'config': Operation not permitted\n");
    run(sh, 'sudo chown -R www-data:www-data config');
    assert.match(run(sh, 'ls -l config').out, / www-data www-data .*settings\.ini/);
    assert.equal(run(sh, 'chown bob x').err, 'chown: invalid user: ‘bob’\n');
    run(sh, 'chgrp sudo orders.csv');
    assert.match(run(sh, 'ls -l orders.csv').out, / shop sudo /);
  });

  it('файл без права r не читается', () => {
    const sh = shell({ files: { '/home/shop/secret.txt': { content: 'x', owner: 'root', mode: '600' } } });
    assert.equal(run(sh, 'cat secret.txt').err, 'cat: secret.txt: Permission denied\n');
    assert.equal(run(sh, 'sudo cat secret.txt').out, 'x');
  });
});

describe('скрипты', () => {
  const setup = {
    files: {
      '/home/shop/backup.sh': '#!/bin/bash\n# копия конфига\nNAME=backup\ncp -r conf "$NAME-$1"\necho "готово: $NAME-$1"\n',
      '/home/shop/conf/a.ini': 'a=1\n',
    },
  };

  it('./script.sh: без x — Permission denied, с chmod +x — работает, $1 и переменные', () => {
    const sh = shell(setup);
    assert.equal(run(sh, './backup.sh').err, 'bash: ./backup.sh: Permission denied\n');
    assert.equal(sh.status, 126);
    run(sh, 'chmod +x backup.sh');
    assert.equal(run(sh, './backup.sh mon').out, 'готово: backup-mon\n');
    assert.ok(sh.fs.exists('/home/shop/backup-mon/a.ini'));
    assert.equal(run(sh, 'echo "[$NAME]"').out, '[]\n');      // переменная скрипта не утекла
    assert.equal(run(sh, 'bash backup.sh tue').code, 0);
  });

  it('source оставляет переменные в текущей оболочке', () => {
    const sh = shell({ files: { '/home/shop/vars.sh': 'export MODE=prod\n' } });
    run(sh, 'source vars.sh');
    assert.equal(run(sh, 'echo $MODE').out, 'prod\n');
  });
});

describe('архивы', () => {
  it('tar -czf, tar -tzf, tar -xzf и gzip/gunzip', () => {
    const sh = shell(SHOP);
    run(sh, 'tar -czf backup/conf.tar.gz config');
    assert.equal(run(sh, 'tar -tzf backup/conf.tar.gz').out, 'config/\nconfig/settings.ini\n');
    run(sh, 'rm -r config && tar -xzf backup/conf.tar.gz');
    assert.equal(run(sh, 'cat config/settings.ini').out, 'DEBUG=False\nSECRET=abc\n');
    assert.match(run(sh, 'tar -xf backup/conf.tar.gz').err, /does not look like a tar archive/);
    run(sh, 'gzip orders.csv');
    assert.deepEqual([sh.fs.exists('/srv/shop/orders.csv'), sh.fs.exists('/srv/shop/orders.csv.gz')], [false, true]);
    run(sh, 'gunzip orders.csv.gz');
    assert.match(run(sh, 'cat orders.csv').out, /^id,city,total/);
  });
});

describe('интерфейс', () => {
  it('nano и clear — просьбы к терминалу', () => {
    const sh = shell(SHOP);
    assert.deepEqual(run(sh, 'nano .env').action, { type: 'edit', path: '/srv/shop/.env', name: '.env' });
    assert.deepEqual(run(sh, 'clear').action, { type: 'clear' });
  });

  it('снимок и разница: что изменила команда', () => {
    const sh = shell(SHOP);
    const before = sh.fs.snapshot('/srv/shop');
    run(sh, 'touch new.txt && echo x >> orders.csv && rm .env');
    const diff = VirtualFS.diff(before, sh.fs.snapshot('/srv/shop'));
    assert.deepEqual(diff, {
      added: ['/srv/shop/new.txt'], changed: ['/srv/shop/orders.csv'], removed: ['/srv/shop/.env'],
    });
  });

  it('неизвестная команда и Python', () => {
    const sh = shell();
    assert.equal(run(sh, 'foo').err, 'foo: command not found\n');
    assert.match(run(sh, 'python3 app.py').err, /тренажёр Python/);
    assert.equal(run(sh, 'which ls python3 cd').out, '/usr/bin/ls\n/usr/bin/python3\n');
  });
});

describe('разбор строки', () => {
  it('кавычки, экранирование, переменные, комментарии', () => {
    const sh = shell();
    assert.equal(run(sh, 'echo "a  b" \'$HOME\' c\\ d # комментарий').out, 'a  b $HOME c d\n');
    assert.equal(run(sh, 'echo "$HOME/x" ${USER}').out, '/home/shop/x shop\n');
    assert.equal(run(sh, 'GREETING=привет && echo $GREETING').out, 'привет\n');
    assert.equal(run(sh, 'echo -e "a\\nb"').out, 'a\nb\n');
    assert.match(run(sh, 'echo "abc').err, /unexpected EOF/);
    assert.match(run(sh, 'ls |').err, /syntax error/);
    assert.equal(run(sh, 'cd a b').err, 'bash: cd: too many arguments\n');
  });

  it('wc, cat -n, ls -R, history', () => {
    const sh = shell(SHOP);
    assert.equal(run(sh, 'wc -l orders.csv').out, '4 orders.csv\n');
    assert.equal(run(sh, 'wc orders.csv').out, ' 4  4 52 orders.csv\n');
    assert.equal(run(sh, 'cat -n config/settings.ini').out, '     1\tDEBUG=False\n     2\tSECRET=abc\n');
    assert.equal(run(sh, 'ls -R config').out, 'config:\nsettings.ini\n');
    assert.match(run(sh, 'history').out, /^\s+1  wc -l orders\.csv\n/);
  });
});

describe('терминал: Tab и сохранение', () => {
  it('дополнение команд и путей', () => {
    const sh = shell(SHOP);
    assert.deepEqual(sh.complete('mkd'), { line: 'mkdir ', options: [] });
    assert.deepEqual(sh.complete('cat con'), { line: 'cat config/', options: [] });
    assert.deepEqual(sh.complete('cat config/se'), { line: 'cat config/settings.ini ', options: [] });
    assert.deepEqual(sh.complete('ls '), { line: 'ls ', options: ['backup/', 'config/', 'logs/', 'orders.csv'] });
    assert.deepEqual(sh.complete('ls .e'), { line: 'ls .env ', options: [] });
    assert.deepEqual(sh.complete('c'), { line: 'c', options: ['cat', 'cd', 'chgrp', 'chmod', 'chown', 'clear', 'cp', 'cut'] });
  });

  it('ФС → JSON → ФС без потерь', () => {
    const sh = shell(SHOP);
    run(sh, 'chmod 600 .env && mkdir x && ln -s orders.csv o');
    const copy = new Shell(VirtualFS.fromJSON(JSON.parse(JSON.stringify(sh.fs))), { cwd: '/srv/shop' });
    assert.equal(run(copy, 'ls -la').out.replace(/\d\d:\d\d/g, ''), run(sh, 'ls -la').out.replace(/\d\d:\d\d/g, ''));
    assert.equal(run(copy, 'cat o').out, run(sh, 'cat orders.csv').out);
  });
});

describe('задачи: правила состояния', async () => {
  const { firstFailedRule, verifyTask } = await import('../../src/static/js/engines/linux/checker.js');
  const task = {
    setup: {
      cwd: '/srv/shop',
      files: { '/srv/shop/config/settings.ini': 'DEBUG=False\n' },
      dirs: { '/srv/shop/backup': {} },
    },
    rules: [
      { path: '/srv/shop/backup/config/settings.ini', exists: true, fail: 'Нужен cp -r.' },
      { path: '/srv/shop/config/settings.ini', exists: true, fail: 'Нужен cp, а не mv.' },
    ],
    solution: 'cp -r config backup/\n',
  };

  it('эталон проходит, setup — нет', () => {
    assert.deepEqual(verifyTask(task), []);
  });

  it('ошибки эталона видны', () => {
    assert.match(verifyTask({ ...task, solution: 'mv config backup/' }).join('\n'), /Нужен cp, а не mv/);
    assert.match(verifyTask({ ...task, solution: 'cp config backup/' }).join('\n'), /кодом 1/);
    assert.match(verifyTask({ ...task, rules: [task.rules[1]] }).join('\n'), /нечего решать/);
  });

  it('contains, mode, owner, link_to, output_matches', () => {
    const sh = shell(SHOP);
    run(sh, 'chmod 600 .env && echo "PORT=8000" >> .env && sudo chown www-data orders.csv');
    run(sh, 'ln -s config/settings.ini current.ini && grep -c ERROR logs/app.log');
    const ok = (rule) => firstFailedRule([{ fail: 'x', ...rule }], sh) === null;
    assert.ok(ok({ path: '/srv/shop/.env', contains: '^PORT=8000$' }));
    assert.ok(ok({ path: '/srv/shop/.env', mode: '600' }));
    assert.ok(!ok({ path: '/srv/shop/.env', mode: '644' }));
    assert.ok(ok({ path: '/srv/shop/orders.csv', owner: 'www-data' }));
    assert.ok(ok({ path: '/srv/shop/current.ini', link_to: '/srv/shop/config/settings.ini' }));
    assert.ok(!ok({ path: '/srv/shop/orders.csv', link_to: '/srv/shop/config/settings.ini' }));
    assert.ok(ok({ output_matches: '^2$' }));
    assert.ok(ok({ path: '/srv/shop/nope', exists: false }));
    assert.ok(!ok({ path: '/srv/shop/nope', contains: 'x' }));
  });
});
