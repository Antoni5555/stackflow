// Учебный systemd Linux-симулятора (src/static/js/engines/linux/system.js):
// процессы, сервисы, журнал, правила service/process; плюс unset, env, PATH, bash -c.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { verifyTask } from '../../src/static/js/engines/linux/checker.js';
import { VirtualFS } from '../../src/static/js/engines/linux/fs.js';
import { Shell } from '../../src/static/js/engines/linux/shell.js';

function shell(setup = {}) {
  return new Shell(VirtualFS.fromSetup(setup), setup.cwd ? { cwd: setup.cwd } : {});
}

function run(sh, line) {
  const { chunks } = sh.run(line);
  return {
    out: chunks.filter((c) => !c.err).map((c) => c.text).join(''),
    err: chunks.filter((c) => c.err).map((c) => c.text).join(''),
    code: sh.status,
  };
}

const UNIT = `[Unit]
Description=Gunicorn for shop

[Service]
User=www-data
WorkingDirectory=/srv/shop
ExecStart=/srv/shop/venv/bin/gunicorn --workers 2 --bind 127.0.0.1:8000 config.wsgi:application
Restart=on-failure

[Install]
WantedBy=multi-user.target
`;

const SERVER = {
  cwd: '/srv/shop',
  files: {
    '/etc/systemd/system/gunicorn.service': { content: UNIT, owner: 'root' },
    '/srv/shop/venv/bin/gunicorn': { content: '#!/srv/shop/venv/bin/python3\n', mode: '755' },
  },
  services: { nginx: { active: true, enabled: true }, gunicorn: { active: true, enabled: true } },
  // runserver на другом порту: 8000 занят gunicorn
  processes: [{ user: 'shop', command: 'python3 manage.py runserver 0.0.0.0:8001' }],
};

const pids = (sh, pattern) => run(sh, `pgrep -f '${pattern}'`).out.split('\n').filter(Boolean).map(Number);

describe('оболочка: unset, env, скрипты из PATH, bash -c', () => {
  it('свой скрипт из ~/bin запускается по имени после export PATH', () => {
    const sh = shell({ files: { '/home/shop/bin/deploy': { content: '#!/bin/bash\necho "deploy $1"\n', mode: '755' } } });
    assert.equal(run(sh, 'deploy prod').err, 'deploy: command not found\n');
    run(sh, 'export PATH="$HOME/bin:$PATH"');
    assert.equal(run(sh, 'deploy prod').out, 'deploy prod\n');
    assert.equal(run(sh, 'which deploy').out, '/home/shop/bin/deploy\n');
  });

  it('unset, env, env ИМЯ=значение команда, bash -c', () => {
    const sh = shell();
    run(sh, 'export SHOP_ENV=prod');
    assert.match(run(sh, 'env').out, /^SHOP_ENV=prod$/m);
    run(sh, 'unset SHOP_ENV');
    assert.equal(run(sh, 'echo "[$SHOP_ENV]"').out, '[]\n');
    assert.equal(run(sh, "env SHOP_ENV=test bash -c 'echo $SHOP_ENV'").out, 'test\n');
    assert.equal(run(sh, "bash -c 'cd /tmp && pwd; echo $0'").out, '/tmp\nbash\n');
    assert.equal(run(sh, 'pwd').out, '/home/shop\n');            // cd внутри bash -c — не здесь
  });
});

describe('процессы: ps, pgrep, kill, pkill, top', () => {
  it('ps aux и ps -ef: сервисы, свой процесс, PPID у рабочих gunicorn', () => {
    const sh = shell(SERVER);
    const aux = run(sh, 'ps aux').out;
    assert.match(aux, /^USER {9}PID %CPU %MEM {4}VSZ {3}RSS TTY {6}STAT START {3}TIME COMMAND$/m);
    assert.match(aux, /^www-data .* \/srv\/shop\/venv\/bin\/python3 \/srv\/shop\/venv\/bin\/gunicorn --workers 2/m);
    assert.match(aux, /nginx: master process/);
    assert.match(aux, /^shop .* ps aux$/m);
    const [master, ...workers] = pids(sh, 'gunicorn');
    assert.equal(workers.length, 2);
    assert.match(run(sh, 'ps -ef').out, new RegExp(`^www-data +${workers[0]} +${master} `, 'm'));
  });

  it('ps aux | grep — grep тоже в списке (как в Ubuntu), grep -v grep его убирает', () => {
    const sh = shell(SERVER);
    assert.match(run(sh, 'ps aux | grep runserver').out, /^shop .* S\+ .* grep --color=auto runserver$/m);
    assert.equal(run(sh, 'ps aux | grep -v grep | grep -c runserver').out, '1\n');
  });

  it('kill: чужой процесс — нельзя, свой — можно, нет такого — No such process', () => {
    const sh = shell(SERVER);
    const [nginx] = pids(sh, 'nginx: master');
    assert.equal(run(sh, `kill ${nginx}`).err, `bash: kill: (${nginx}) - Operation not permitted\n`);
    assert.equal(run(sh, 'kill 99999').err, 'bash: kill: (99999) - No such process\n');
    const [runserver] = pids(sh, 'runserver');
    assert.equal(run(sh, `kill ${runserver}`).code, 0);
    assert.deepEqual(pids(sh, 'runserver'), []);
  });

  it('рабочий gunicorn убит — главный запускает новый; HUP — новые рабочие', () => {
    const sh = shell(SERVER);
    const [master, worker] = pids(sh, 'gunicorn');
    run(sh, `sudo kill -9 ${worker}`);
    const after = pids(sh, 'gunicorn');
    assert.equal(after.length, 3);
    assert.ok(!after.includes(worker) && after.includes(master));
    assert.match(run(sh, 'journalctl -u gunicorn -n 2').out,
      new RegExp(`Worker \\(pid:${worker}\\) was sent SIGKILL![\\s\\S]*Booting worker with pid: `));
    run(sh, `sudo kill -HUP ${master}`);
    assert.match(run(sh, 'journalctl -u gunicorn').out, /Handling signal: hup/);
    assert.equal(pids(sh, 'gunicorn')[0], master);
  });

  it('kill -9 главного: Restart=on-failure — systemd запускает заново; TERM — сервис остановлен', () => {
    const sh = shell(SERVER);
    const [master] = pids(sh, 'gunicorn');
    run(sh, `sudo kill -9 ${master}`);
    assert.equal(run(sh, 'systemctl is-active gunicorn').out, 'active\n');
    assert.notEqual(pids(sh, 'gunicorn')[0], master);
    assert.match(run(sh, 'journalctl -u gunicorn').out, /status=9\/KILL[\s\S]*Scheduled restart job, restart counter is at 1\./);
    run(sh, `sudo kill ${pids(sh, 'gunicorn')[0]}`);
    assert.equal(run(sh, 'systemctl is-active gunicorn').out, 'inactive\n');
  });

  it('pkill по имени и -f, top — один снимок, сверху самый занятый', () => {
    const sh = shell({ processes: [{ user: 'shop', command: 'python3 report.py', cpu: 97.5 }] });
    assert.match(run(sh, 'top').out, /%CPU {2}%MEM {5}TIME\+ COMMAND\n +\d+ shop .* 97\.5 /);
    assert.equal(run(sh, 'pkill -f report.py').code, 0);
    assert.equal(run(sh, 'pgrep -f report.py').code, 1);
    assert.equal(run(sh, 'pkill nosuch').code, 1);
  });
});

describe('systemctl и journalctl', () => {
  it('status: running с деревом процессов; unknown — код 4', () => {
    const sh = shell(SERVER);
    const status = run(sh, 'systemctl status gunicorn');
    assert.equal(status.code, 0);
    assert.match(status.out, /^● gunicorn\.service - Gunicorn for shop\n {5}Loaded: loaded \(\/etc\/systemd\/system\/gunicorn\.service; enabled; preset: enabled\)\n {5}Active: active \(running\) since /);
    assert.match(status.out, /Main PID: \d+ \(gunicorn\)/);
    assert.match(status.out, /Listening at: http:\/\/127\.0\.0\.1:8000/);
    assert.equal(run(sh, 'systemctl status nope').err, 'Unit nope.service could not be found.\n');
  });

  it('без sudo управлять нельзя; stop, start, enable/disable — ссылка в wants', () => {
    const sh = shell(SERVER);
    assert.match(run(sh, 'systemctl restart gunicorn').err, /^Failed to restart gunicorn\.service: Interactive authentication required\./);
    run(sh, 'sudo systemctl stop gunicorn');
    assert.equal(run(sh, 'systemctl is-active gunicorn').out, 'inactive\n');
    assert.match(run(sh, 'sudo systemctl disable gunicorn').err, /^Removed "\/etc\/systemd\/system\/multi-user\.target\.wants\/gunicorn\.service"\.$/m);
    assert.equal(run(sh, 'systemctl is-enabled gunicorn').code, 1);
    assert.match(run(sh, 'sudo systemctl enable --now gunicorn').err, /^Created symlink .*gunicorn\.service → \/etc\/systemd\/system\/gunicorn\.service\.$/m);
    assert.equal(run(sh, 'systemctl is-active gunicorn').out, 'active\n');
  });

  it('правка unit без daemon-reload — предупреждение и старый ExecStart', () => {
    const sh = shell({ ...SERVER, files: { ...SERVER.files, '/srv/shop/gunicorn.service': UNIT.replace('--workers 2', '--workers 4') } });
    run(sh, 'sudo cp /srv/shop/gunicorn.service /etc/systemd/system/gunicorn.service');
    const restart = run(sh, 'sudo systemctl restart gunicorn');
    assert.match(restart.err, /changed on disk\. Run 'systemctl daemon-reload' to reload units\./);
    assert.equal(pids(sh, 'gunicorn').length, 3);                // всё ещё 2 рабочих
    run(sh, 'sudo systemctl daemon-reload');
    run(sh, 'sudo systemctl restart gunicorn');
    assert.equal(pids(sh, 'gunicorn').length, 5);
  });

  it('нет программы из ExecStart: simple — start молчит, status — 203/EXEC', () => {
    const sh = shell({
      ...SERVER, files: { '/etc/systemd/system/gunicorn.service': { content: UNIT, owner: 'root' } },
      dirs: ['/srv/shop'], services: {},
    });
    assert.equal(run(sh, 'sudo systemctl start gunicorn').code, 0);
    const status = run(sh, 'systemctl status gunicorn');
    assert.equal(status.code, 3);
    assert.match(status.out, /Active: failed \(Result: exit-code\)/);
    assert.match(status.out, /status=203\/EXEC/);
    assert.match(run(sh, 'journalctl -xeu gunicorn').out, /Unable to locate executable '\/srv\/shop\/venv\/bin\/gunicorn': No such file or directory/);
  });

  it('nginx: сломанный конфиг — reload и restart с ошибкой, причина в журнале', () => {
    const sh = shell({ services: { nginx: { active: true, enabled: true } } });
    run(sh, `sudo bash -c 'echo "server {" > /etc/nginx/sites-enabled/shop'`);
    const reload = run(sh, 'sudo systemctl reload nginx');
    assert.equal(reload.code, 1);
    assert.match(run(sh, 'journalctl -u nginx -n 3').out, /unexpected end of file, expecting "\}" in \/etc\/nginx\/sites-enabled\/shop:2/);
    assert.equal(run(sh, 'systemctl is-active nginx').out, 'active\n');   // reload не роняет nginx
    assert.match(run(sh, 'sudo systemctl restart nginx').err, /^Job for nginx\.service failed because the control process exited with error code\./);
    assert.equal(run(sh, 'systemctl is-active nginx').out, 'failed\n');
  });

  it('apt install nginx — сервис запущен и включён; journalctl без записей', () => {
    const sh = shell();
    assert.equal(run(sh, 'journalctl -u nginx').out, '-- No entries --\n');
    run(sh, 'sudo apt install nginx');
    assert.equal(run(sh, 'systemctl is-active nginx').out, 'active\n');
    assert.equal(run(sh, 'systemctl is-enabled nginx').out, 'enabled\n');
  });
});

describe('задачи: правила service и process', () => {
  it('эталон перезапускает упавший gunicorn и включает его', () => {
    const task = {
      setup: {
        ...SERVER,
        services: { gunicorn: { active: false, enabled: false } },
      },
      solution: 'sudo systemctl enable --now gunicorn\nsudo pkill -f runserver',
      rules: [
        { service: 'gunicorn', active: true, fail: 'gunicorn не запущен.' },
        { service: 'gunicorn', enabled: true, fail: 'После перезагрузки gunicorn не поднимется.' },
        { process: 'manage.py runserver', running: false, fail: 'runserver всё ещё работает.' },
      ],
    };
    assert.deepEqual(verifyTask(task), []);
    assert.match(verifyTask({ ...task, solution: 'sudo systemctl start gunicorn' }).join('\n'), /После перезагрузки/);
  });
});

describe('сеть: ss, curl через nginx, ping, ssh', () => {
  const SITE = `server {
    listen 80 default_server;
    server_name _;

    location /static/ {
        alias /srv/shop/static/;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
    }
}
`;
  const WEB = {
    ...SERVER,
    files: {
      ...SERVER.files,
      '/etc/nginx/sites-available/shop': { content: SITE, owner: 'root' },
      '/srv/shop/static/app.css': 'body {}\n',
      '/srv/shop/static/secret.css': { content: 'x', mode: '600' },
    },
    links: { '/etc/nginx/sites-enabled/shop': '/etc/nginx/sites-available/shop' },
    services: { nginx: { active: true, enabled: true }, gunicorn: { active: true, enabled: true } },
    processes: [],
  };

  it('ss -tlnp: порты сервисов; процессы чужих — только с sudo', () => {
    const sh = shell(WEB);
    const plain = run(sh, 'ss -tlnp').out;
    assert.match(plain, /^State {2}Recv-Q Send-Q Local Address:Port Peer Address:Port Process$/m);
    assert.match(plain, /^LISTEN 0 +511 +0\.0\.0\.0:80 /m);
    assert.match(plain, /^LISTEN 0 +2048 +127\.0\.0\.1:8000 0\.0\.0\.0:\*$/m);      // без sudo — без процесса
    assert.match(run(sh, 'sudo ss -tlnp').out, /127\.0\.0\.1:8000 0\.0\.0\.0:\* +users:\(\("gunicorn",pid=\d+/);
    assert.match(run(sh, 'ss -tl').out, /localhost:irdmi/);                      // без -n — имена
  });

  it('curl через nginx: приложение, статика, 403 без прав, 502 без gunicorn', () => {
    const sh = shell(WEB);
    assert.match(run(sh, 'curl -s localhost/').out, /<h1>Магазин<\/h1>/);
    assert.equal(run(sh, 'curl -s localhost/static/app.css').out, 'body {}\n');
    assert.equal(run(sh, 'curl -s -o /dev/null -w "%{http_code}" localhost/static/secret.css').out, '403');
    assert.match(run(sh, 'curl -I localhost/').out, /^HTTP\/1\.1 200 OK\nServer: nginx\/1\.24\.0 \(Ubuntu\)\n/);
    run(sh, 'sudo systemctl stop gunicorn');
    assert.match(run(sh, 'curl -s localhost/').out, /<title>502 Bad Gateway<\/title>/);
    const errors = run(sh, 'sudo cat /var/log/nginx/error.log').out;
    assert.match(errors, /open\(\) "\/srv\/shop\/static\/secret\.css" failed \(13: Permission denied\)/);
    assert.match(errors, /connect\(\) failed \(111: Connection refused\) while connecting to upstream/);
    assert.match(run(sh, 'tail -1 /var/log/nginx/access.log').out, /"GET \/ HTTP\/1\.1" 502 \d+ "-" "curl\/8\.5\.0"$/m);
  });

  it('curl: никто не слушает — (7), чужой сайт — (6), -L по редиректам, -f', () => {
    const sh = shell(WEB);
    assert.equal(run(sh, 'curl localhost:9000').err, "curl: (7) Failed to connect to localhost port 9000 after 0 ms: Couldn't connect to server\n");
    assert.equal(run(sh, 'curl example.com').code, 6);
    assert.match(run(sh, 'curl -sIL localhost:8000/admin').out, /301 Moved Permanently[\s\S]*302 Found[\s\S]*200 OK/);
    assert.equal(run(sh, 'curl -sf localhost:8000/nope').code, 22);
  });

  it('порт занят runserver — gunicorn не стартует; правило port', () => {
    const sh = shell({ ...WEB, services: { gunicorn: { active: false } },
      processes: [{ user: 'shop', command: 'python3 manage.py runserver' }] });
    run(sh, 'sudo systemctl start gunicorn');
    assert.equal(run(sh, 'systemctl is-active gunicorn').out, 'failed\n');
    assert.match(run(sh, 'journalctl -u gunicorn').out, /\[ERROR\] Connection in use: \('127\.0\.0\.1', 8000\)/);
    const task = {
      setup: { ...WEB, services: { gunicorn: { active: false } }, processes: [{ user: 'shop', command: 'python3 manage.py runserver' }] },
      solution: 'pkill -f runserver\nsudo systemctl start gunicorn',
      rules: [
        { service: 'gunicorn', active: true, fail: 'gunicorn не запущен.' },
        { port: 8000, listening: true, fail: 'Порт 8000 никто не слушает.' },
      ],
    };
    assert.deepEqual(verifyTask(task), []);
  });

  it('сайт выбирается по server_name раньше default_server; Host из -H; страница по умолчанию', () => {
    const site = 'server {\n    listen 80;\n    server_name shop.example localhost;\n    root /srv/shop/public;\n}\n';
    const sh = shell({
      files: { '/etc/nginx/sites-available/shop': { content: site, owner: 'root' }, '/srv/shop/public/index.html': '<h1>Shop</h1>\n' },
      links: { '/etc/nginx/sites-enabled/shop': '/etc/nginx/sites-available/shop' },
      services: { nginx: { active: true } },
    });
    assert.equal(run(sh, 'curl -s localhost').out, '<h1>Shop</h1>\n');
    assert.equal(run(sh, 'curl -s -H "Host: shop.example" 127.0.0.1').out, '<h1>Shop</h1>\n');
    // Host: 127.0.0.1 ни с кем не совпал — отвечает default_server (сайт default из пакета)
    assert.match(run(sh, 'curl -sI 127.0.0.1').out, /^Content-Length: 615$/m);
    assert.match(run(sh, 'curl -s 127.0.0.1').out, /<title>Welcome to nginx!<\/title>/);
  });

  it('ping, hostname, ssh — теория', () => {
    const sh = shell();
    // localhost в Ubuntu 24.04 — сначала IPv6
    assert.match(run(sh, 'ping -c 2 localhost').out, /^PING localhost \(::1\) 56 data bytes\n64 bytes from localhost \(::1\): icmp_seq=1 [\s\S]*2 packets transmitted, 2 received, 0% packet loss/);
    assert.match(run(sh, 'ping -c 1 127.0.0.1').out, /^PING 127\.0\.0\.1 \(127\.0\.0\.1\) 56\(84\) bytes of data\.\n64 bytes from 127\.0\.0\.1: /);
    assert.equal(run(sh, 'ping -c 1 example.com').err, 'ping: example.com: Temporary failure in name resolution\n');
    assert.equal(run(sh, 'hostname').out, 'server\n');
    assert.equal(run(sh, 'ssh deploy@1.2.3.4').code, 255);
  });
});
