// Учебный Docker (engines/docker), шаг 1: образы, run/ps/logs/stop/start/rm/exec/inspect,
// порты и curl, тома, setup и правила. Тексты сверены с Docker Engine 29.10 (docker CLI).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VirtualFS } from '../../src/static/js/engines/linux/fs.js';
import { Shell } from '../../src/static/js/engines/linux/shell.js';
import { firstFailedRule, verifyTask } from '../../src/static/js/engines/linux/checker.js';
import { lineNeedsDocker, taskNeedsDocker } from '../../src/static/js/engines/linux/docker-loader.js';
import { humanDuration, humanSize, table } from '../../src/static/js/engines/docker/format.js';
import '../../src/static/js/engines/docker/index.js';

function shell(setup = {}) {
  return new Shell(VirtualFS.fromSetup(setup), setup.cwd ? { cwd: setup.cwd } : {});
}

function run(sh, line) {
  const { chunks, action } = sh.run(line);
  const result = {
    out: chunks.filter((c) => !c.err).map((c) => c.text).join(''),
    err: chunks.filter((c) => c.err).map((c) => c.text).join(''),
    code: sh.status,
  };
  if (action) result.action = action;
  return result;
}

/** Как терминал: строки, вход во вложенную оболочку и выход из неё. */
function terminal(sh) {
  const stack = [];
  let current = sh;
  return {
    run(line) {
      const result = run(current, line);
      current.machine?.afterCommand?.();
      if (result.action?.type === 'enter') {
        stack.push({ shell: current, onLeave: result.action.onLeave });
        current = result.action.shell;
      } else if (result.action?.type === 'leave') {
        const outer = stack.pop();
        current = outer.shell;
        outer.onLeave(result.action.code);
      }
      return result;
    },
    get prompt() {
      return current.prompt();
    },
  };
}

describe('формат вывода docker', () => {
  it('время и размеры как в docker CLI (go-units)', () => {
    assert.equal(humanDuration(400), 'Less than a second');
    assert.equal(humanDuration(16000), '16 seconds');
    assert.equal(humanDuration(70000), 'About a minute');
    assert.equal(humanDuration(13 * 3600000), '13 hours');
    assert.equal(humanDuration(14 * 24 * 3600000), '2 weeks');
    assert.equal(humanSize(642e6), '642MB');
    assert.equal(humanSize(74.5e6), '74.5MB');
    assert.equal(humanSize(1.62e9), '1.62GB');
  });

  it('таблица: колонка не уже 10 символов, отступ 3', () => {
    assert.equal(
      table(['CONTAINER ID', 'IMAGE', 'NAMES'], []),
      'CONTAINER ID   IMAGE     NAMES\n',
    );
  });
});

describe('ленивая загрузка', () => {
  it('docker нужен строкам со словом docker и задачам с docker в setup или правилах', () => {
    assert.equal(lineNeedsDocker('docker ps'), true);
    assert.equal(lineNeedsDocker('ls && docker images'), true);
    assert.equal(lineNeedsDocker('cat dockerfile'), false);
    assert.equal(taskNeedsDocker({ docker: { images: ['nginx:1.27'] } }, []), true);
    assert.equal(taskNeedsDocker({}, [{ docker: 'container', name: 'web' }]), true);
    assert.equal(taskNeedsDocker({ files: {} }, [{ path: '/a', exists: true }]), false);
  });
});

describe('образы: pull, images, rmi, tag', () => {
  it('pull из учебного реестра, images в формате Docker 29', () => {
    const sh = shell();
    const pulled = run(sh, 'docker pull postgres:16');
    assert.match(pulled.out, /^16: Pulling from library\/postgres\n([0-9a-f]{12}: Pulling fs layer\n){14}([0-9a-f]{12}: Download complete\n[0-9a-f]{12}: Pull complete\n){14}Digest: sha256:[0-9a-f]{64}\nStatus: Downloaded newer image for postgres:16\ndocker\.io\/library\/postgres:16\n$/);
    assert.match(run(sh, 'docker pull postgres:16').out, /Status: Image is up to date for postgres:16/);
    run(sh, 'docker pull nginx:1.27-alpine');
    const lines = run(sh, 'docker images').out.split('\n');
    assert.equal(lines[0], 'IMAGE               ID             DISK USAGE   CONTENT SIZE   EXTRA');
    assert.match(lines[1], /^nginx:1\.27-alpine   [0-9a-f]{12}       74\.5MB         21\.9MB        $/);
    assert.match(lines[2], /^postgres:16         [0-9a-f]{12}        642MB          166MB        $/);
    assert.match(run(sh, 'docker pull nginx').out, /^Using default tag: latest\nlatest: Pulling from library\/nginx\n/);
  });

  it('docker run: загрузка образа — в stderr, в конвейер идёт только вывод контейнера', () => {
    const sh = shell();
    assert.equal(run(sh, 'docker run --rm alpine:3.20 echo hi | wc -l').out, '1\n');
    const first = run(shell(), 'docker run --rm alpine:3.20 echo hi');
    assert.equal(first.out, 'hi\n');
    assert.match(first.err, /^Unable to find image 'alpine:3\.20' locally\n3\.20: Pulling from library\/alpine\n/);
  });

  it('ошибки реестра: нет репозитория, нет тега', () => {
    const sh = shell();
    assert.deepEqual(run(sh, 'docker pull nosuch-image-xyz:1'), {
      out: '', err: "Error response from daemon: pull access denied for nosuch-image-xyz, repository does not exist or may require 'docker login'\n", code: 1,
    });
    assert.equal(run(sh, 'docker pull nginx:9.9').err, 'Error response from daemon: manifest for nginx:9.9 not found: manifest unknown: manifest unknown\n');
    assert.equal(run(sh, 'docker run nosuch-image-xyz:1').err, "Unable to find image 'nosuch-image-xyz:1' locally\ndocker: Error response from daemon: pull access denied for nosuch-image-xyz, repository does not exist or may require 'docker login'\n\nRun 'docker run --help' for more information\n");
    assert.equal(sh.status, 125);
  });

  it('tag и rmi: занятый контейнером образ — conflict, свободный — Untagged и Deleted', () => {
    const sh = shell();
    run(sh, 'docker pull nginx:1.27-alpine');
    assert.equal(run(sh, 'docker tag nginx:1.27-alpine shop/nginx:v1').code, 0);
    assert.equal(run(sh, 'docker rmi shop/nginx:v1').out, 'Untagged: shop/nginx:v1\n');
    assert.equal(run(sh, 'docker tag nosuch x').err, 'Error response from daemon: No such image: nosuch:latest\n');
    run(sh, 'docker run -d --name web nginx:1.27-alpine');
    run(sh, 'docker stop web');
    assert.match(run(sh, 'docker rmi nginx:1.27-alpine').err, /^Error response from daemon: conflict: unable to delete nginx:1\.27-alpine \(must be forced\) - container [0-9a-f]{12} is using its referenced image [0-9a-f]{12}\n$/);
    run(sh, 'docker rm web');
    assert.match(run(sh, 'docker rmi nginx:1.27-alpine').out, /^Untagged: nginx:1\.27-alpine\nDeleted: sha256:[0-9a-f]{64}\n$/);
    assert.equal(run(sh, 'docker rmi nosuch:1').err, 'Error response from daemon: No such image: nosuch:1\n');
  });
});

describe('docker run и жизненный цикл контейнера', () => {
  it('postgres без POSTGRES_PASSWORD падает с настоящей ошибкой, с паролем — работает', () => {
    const sh = shell({ docker: { images: ['postgres:16'] } });
    const failed = run(sh, 'docker run --name db postgres:16');
    assert.match(failed.err, /^Error: Database is uninitialized and superuser password is not specified\.\n/);
    assert.equal(failed.code, 1);
    assert.match(run(sh, 'docker ps -a').out, /Exited \(1\) Less than a second ago\s+db\n/);
    assert.match(run(sh, 'docker run -d --name db2 -e POSTGRES_PASSWORD=secret postgres:16').out, /^[0-9a-f]{64}\n$/);
    const logs = run(sh, 'docker logs db2');
    assert.match(logs.out, /PostgreSQL init process complete; ready for start up\./);
    assert.match(logs.out, /UTC \[1\] LOG: {2}database system is ready to accept connections\n$/);
    assert.match(logs.err, /initdb: warning: enabling "trust" authentication/);
    assert.match(run(sh, 'docker logs --tail 1 db2').out, /^\S+ \S+ UTC \[1\] LOG: {2}database system is ready to accept connections\n$/);
  });

  it('ps: колонки, обрезанная команда, порты', () => {
    const sh = shell({ docker: { images: ['postgres:16', 'nginx:1.27-alpine'] } });
    run(sh, 'docker run -d --name db -e POSTGRES_PASSWORD=x postgres:16');
    run(sh, 'docker run -d --name web -p 8080:80 nginx:1.27-alpine');
    const [head, web, db] = run(sh, 'docker ps').out.split('\n');
    assert.equal(head, 'CONTAINER ID   IMAGE               COMMAND                  CREATED                  STATUS                  PORTS                                     NAMES');
    assert.match(web, /^[0-9a-f]{12}   nginx:1\.27-alpine   "\/docker-entrypoint\.…"   Less than a second ago   Up Less than a second   0\.0\.0\.0:8080->80\/tcp, \[::\]:8080->80\/tcp   web$/);
    assert.match(db, /"docker-entrypoint\.s…" .* 5432\/tcp {34}db$/);
    assert.equal(run(sh, 'docker ps -q').out.split('\n').filter(Boolean).length, 2);
  });

  it('имя занято, порт занят, контейнер остаётся Created', () => {
    const sh = shell({ docker: { images: ['nginx:1.27-alpine'] } });
    const first = run(sh, 'docker run -d --name web -p 8080:80 nginx:1.27-alpine').out.trim();
    assert.equal(run(sh, 'docker run -d --name web nginx:1.27-alpine').err,
      `docker: Error response from daemon: Conflict. The container name "/web" is already in use by container "${first}". You have to remove (or rename) that container to be able to reuse that name.\n\nRun 'docker run --help' for more information\n`);
    const busy = run(sh, 'docker run -d --name web2 -p 8080:80 nginx:1.27-alpine');
    assert.match(busy.out, /^[0-9a-f]{64}\n$/);
    assert.match(busy.err, /^docker: Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint web2 \([0-9a-f]{64}\): Bind for 0\.0\.0\.0:8080 failed: port is already allocated\n\nRun 'docker run --help' for more information\n$/);
    assert.equal(busy.code, 125);
    assert.match(run(sh, 'docker ps -a').out, /Created {2,}web2\n/);
  });

  it('порт хоста занят обычным процессом (nginx на сервере)', () => {
    const sh = shell({ services: { nginx: { active: true } }, docker: { images: ['nginx:1.27'] } });
    assert.match(run(sh, 'ss -tln').out, /:80 /);
    const result = run(sh, 'docker run -d --name web -p 80:80 nginx:1.27');
    assert.match(result.err, /driver failed programming external connectivity on endpoint web \([0-9a-f]{64}\): failed to bind host port 0\.0\.0\.0:80\/tcp: address already in use\n/);
    assert.equal(result.code, 125);
  });

  it('stop, start, restart, rm: вывод — имена, ошибки — как у демона', () => {
    const sh = shell({ docker: { images: ['nginx:1.27-alpine'] } });
    run(sh, 'docker run -d --name web nginx:1.27-alpine');
    assert.equal(run(sh, 'docker rm web').err, 'Error response from daemon: cannot remove container "web": container is running: stop the container before removing or force remove\n');
    assert.equal(run(sh, 'docker stop web').out, 'web\n');
    assert.equal(run(sh, 'docker stop web').out, 'web\n');
    assert.match(run(sh, 'docker ps -a').out, /Exited \(0\) Less than a second ago/);
    assert.match(run(sh, 'docker logs web').err, /signal 3 \(SIGQUIT\) received, shutting down/);
    assert.equal(run(sh, 'docker start web').out, 'web\n');
    assert.match(run(sh, 'docker logs web').out, /10-listen-on-ipv6-by-default\.sh: info: IPv6 listen already enabled/);
    assert.equal(run(sh, 'docker restart web').out, 'web\n');
    assert.equal(run(sh, 'docker stop nosuch').err, 'Error response from daemon: No such container: nosuch\n');
    assert.equal(sh.status, 1);
    assert.equal(run(sh, 'docker start nosuch').err, 'Error response from daemon: No such container: nosuch\nfailed to start containers: nosuch\n');
    assert.equal(run(sh, 'docker rm -f web').out, 'web\n');
    assert.equal(run(sh, 'docker ps -aq').out, '');
  });

  it('команда после образа, --rm, -e и env, нет программы — код 127', () => {
    const sh = shell({ docker: { images: ['alpine:3.20'] } });
    assert.deepEqual(run(sh, 'docker run --rm alpine:3.20 echo hi'), { out: 'hi\n', err: '', code: 0 });
    assert.equal(run(sh, 'docker ps -aq').out, '');
    const env = run(sh, 'docker run --rm -e A=1 -e B alpine:3.20 env').out;
    assert.match(env, /^PATH=\/usr\/local\/sbin:[^\n]*\nHOSTNAME=[0-9a-f]{12}\nA=1\nHOME=\/root\n$/);
    const missing = run(sh, 'docker run alpine:3.20 nosuch');
    assert.equal(missing.err, 'docker: Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: exec: "nosuch": executable file not found in $PATH\n\nRun \'docker run --help\' for more information\n');
    assert.equal(missing.code, 127);
  });

  it('python в образах python: --version и простые -c', () => {
    const sh = shell({ docker: { images: ['python:3.12-slim', 'python:3.12'] } });
    assert.equal(run(sh, 'docker run --rm python:3.12-slim python --version').out, 'Python 3.12.16\n');
    assert.equal(run(sh, 'docker run --rm python:3.12 python3 --version').out, 'Python 3.12.16\n');
    assert.equal(run(sh, 'docker run --rm python:3.12-slim python -c "print(2490 * 2)"').out, '4980\n');
    assert.equal(run(sh, `docker run --rm python:3.12-slim python -c "print(7 / 2, -2 ** 2, 10 // 3, 'ok')"`).out, '3.5 -4 3 ok\n');
    assert.equal(run(sh, 'docker run --rm python:3.12-slim python -c "import os"').code, 1);
    assert.equal(run(sh, 'docker run --rm python:3.12-slim').code, 0);
  });

  it('разбор флагов: нет образа, неизвестный флаг, неверный порт и имя', () => {
    const sh = shell();
    assert.deepEqual(run(sh, 'docker run -it'), {
      out: '', err: "docker: 'docker run' requires at least 1 argument\n\nUsage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]\n\nSee 'docker run --help' for more information\n", code: 1,
    });
    assert.equal(run(sh, 'docker run --nosuchflag alpine').err, "unknown flag: --nosuchflag\n\nUsage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]\n\nRun 'docker run --help' for more information\n");
    assert.equal(sh.status, 125);
    assert.equal(run(sh, 'docker run -p abc:80 alpine:3.20').err, "docker: invalid hostPort: abc\n\nRun 'docker run --help' for more information\n");
    assert.equal(run(sh, 'docker run --name x alpine:3.20').err, "docker: Error response from daemon: invalid container name (x): name must be at least 2 characters\n\nRun 'docker run --help' for more information\n");
    assert.equal(run(sh, "docker create --name 'my web' alpine:3.20").err, 'Error response from daemon: invalid container name (my web): only [a-zA-Z0-9][a-zA-Z0-9_.-] are allowed\n');
    assert.equal(run(sh, 'docker logs').err, "docker: 'docker logs' requires 1 argument\n\nUsage:  docker logs [OPTIONS] CONTAINER\n\nRun 'docker logs --help' for more information\n");
    assert.equal(run(sh, 'docker nosuchcmd').err, "docker: unknown command: docker nosuchcmd\n\nRun 'docker --help' for more information\n");
    assert.equal(run(sh, 'docker --version').out, 'Docker version 29.10.0, build fdd4b8e\n');
  });
});

describe('docker exec и ФС контейнера', () => {
  it('exec: своя ФС и окружение; не запущен — ошибка; нет программы — OCI', () => {
    const sh = shell({ docker: { images: ['nginx:1.27-alpine', 'postgres:16'] } });
    run(sh, 'docker run -d --name web nginx:1.27-alpine');
    assert.match(run(sh, 'docker exec web cat /etc/os-release').out, /^NAME="Alpine Linux"\n/);
    assert.equal(run(sh, 'docker exec web ls /usr/share/nginx/html').out, '50x.html\nindex.html\n');
    assert.match(run(sh, 'docker exec web cat /etc/nginx/conf.d/default.conf').out, /listen {2}\[::\]:80;/);
    assert.equal(run(sh, 'docker exec web nosuchcmd').out, 'OCI runtime exec failed: exec failed: unable to start container process: exec: "nosuchcmd": executable file not found in $PATH\n');
    assert.equal(sh.status, 127);
    assert.equal(run(sh, 'docker exec web bash').code, 127);            // в alpine нет bash
    const id = run(sh, 'docker inspect -f {{.Id}} web').out.trim();
    run(sh, 'docker stop web');
    assert.equal(run(sh, 'docker exec web ls').err, `Error response from daemon: container ${id} is not running\n`);
    run(sh, 'docker run -d --name db -e POSTGRES_PASSWORD=secret postgres:16');
    assert.match(run(sh, 'docker exec db env').out, /^PATH=[^\n]*\/usr\/lib\/postgresql\/16\/bin\nHOSTNAME=[0-9a-f]{12}\nPOSTGRES_PASSWORD=secret\nGOSU_VERSION=1\.19\n/);
    assert.match(run(sh, 'docker exec db ps aux').out, /^postgres +1 .* postgres\n/m);
  });

  it('изменения в контейнере сохраняются, у другого контейнера — своя ФС', () => {
    const sh = shell({ docker: { images: ['ubuntu:24.04'] } });
    run(sh, 'docker run -d --name box1 ubuntu:24.04 sleep 300');
    run(sh, 'docker run -d --name box2 ubuntu:24.04 sleep 300');
    run(sh, "docker exec box1 sh -c 'echo note > /root/a.txt'");
    assert.equal(run(sh, 'docker exec box1 cat /root/a.txt').out, 'note\n');
    assert.equal(run(sh, 'docker exec box2 cat /root/a.txt').err, 'cat: /root/a.txt: No such file or directory\n');
    // после сохранения в браузере и загрузки — то же самое
    const restored = new Shell(VirtualFS.fromJSON(JSON.parse(JSON.stringify(sh.fs))));
    assert.equal(run(restored, 'docker exec box1 cat /root/a.txt').out, 'note\n');
    assert.match(run(restored, 'docker ps').out, /sleep 300/);
  });

  it('docker exec -it bash — вложенная оболочка с приглашением контейнера, exit — назад', () => {
    const sh = shell({ docker: { images: ['postgres:16'] } });
    const term = terminal(sh);
    term.run('docker run -d --name db -e POSTGRES_PASSWORD=x postgres:16');
    const entered = term.run('docker exec -it db bash');
    assert.equal(entered.action.type, 'enter');
    assert.match(term.prompt, /^root@[0-9a-f]{12}:\/# $/);
    assert.equal(term.run('echo $PGDATA').out, '/var/lib/postgresql/data\n');
    assert.equal(term.run('nosuch').err, 'bash: nosuch: command not found\n');
    term.run('cd /tmp && touch inside.txt');
    assert.equal(term.run('exit').out, 'exit\n');
    assert.equal(term.prompt, 'shop@server:~$ ');
    assert.equal(run(sh, 'docker exec db ls /tmp').out, 'inside.txt\n');
    assert.match(run(sh, 'docker ps').out, /Up/);
  });

  it('docker run -it ubuntu — оболочка в новом контейнере, exit останавливает его', () => {
    const sh = shell();
    const term = terminal(sh);
    const result = term.run('docker run -it --name box ubuntu:24.04');
    assert.equal(result.action.type, 'enter');
    assert.match(term.prompt, /^root@[0-9a-f]{12}:\/# $/);
    assert.match(term.run('cat /etc/os-release').out, /Ubuntu 24\.04/);
    term.run('exit 3');
    assert.match(run(sh, 'docker ps -a').out, /Exited \(3\) Less than a second ago\s+box\n/);
    const alpine = terminal(shell());
    alpine.run('docker run -it --rm alpine:3.20 sh');
    assert.equal(alpine.prompt, '/ # ');
    assert.equal(alpine.run('nosuch').err, 'sh: nosuch: not found\n');
    alpine.run('exit');
  });
});

describe('порты, curl и тома', () => {
  it('curl на опубликованный порт: страница nginx из контейнера, docker-proxy в ss', () => {
    const sh = shell({ docker: { images: ['nginx:1.27-alpine', 'postgres:16'] } });
    run(sh, 'docker run -d --name web -p 8080:80 nginx:1.27-alpine');
    assert.match(run(sh, 'curl -s localhost:8080').out, /<title>Welcome to nginx!<\/title>/);
    assert.match(run(sh, 'curl -sI localhost:8080').out, /^HTTP\/1\.1 200 OK\nServer: nginx\/1\.27\.5\n/);
    assert.match(run(sh, 'docker logs web').out, /"GET \/ HTTP\/1\.1" 200 615 "-" "curl\/8\.5\.0" "-"\n/);
    assert.match(run(sh, 'ss -tln').out, /0\.0\.0\.0:8080/);
    assert.equal(run(sh, 'curl -s localhost:8081').code, 7);
    run(sh, 'docker run -d --name db -p 5432:5432 -e POSTGRES_PASSWORD=x postgres:16');
    assert.equal(run(sh, 'curl -s localhost:5432').code, 52);
    run(sh, 'docker run -d --name wrong -p 9000:8000 nginx:1.27-alpine');
    assert.equal(run(sh, 'curl -s localhost:9000').err, 'curl: (56) Recv failure: Connection reset by peer\n');
    run(sh, 'docker stop web');
    assert.equal(run(sh, 'curl -s localhost:8080').code, 7);
  });

  it('bind mount: файлы хоста видны в контейнере и nginx отдаёт их', () => {
    const sh = shell({ docker: { images: ['nginx:1.27'] }, files: { '/home/shop/site/index.html': '<h1>Магазин</h1>\n' } });
    run(sh, 'docker run -d --name web -p 80:80 -v ./site:/usr/share/nginx/html nginx:1.27');
    assert.equal(run(sh, 'curl -s localhost').out, '<h1>Магазин</h1>\n');
    run(sh, "docker exec web sh -c 'echo new > /usr/share/nginx/html/new.html'");
    assert.equal(run(sh, 'cat site/new.html').out, 'new\n');
    assert.match(run(sh, 'curl -s localhost/nope.html').out, /404 Not Found/);
  });

  it('именованный том переживает rm контейнера: postgres не инициализирует базу второй раз', () => {
    const sh = shell({ docker: { images: ['postgres:16'] } });
    run(sh, 'docker run -d --name db -e POSTGRES_PASSWORD=x -v pgdata:/var/lib/postgresql/data postgres:16');
    assert.match(run(sh, 'docker exec db ls /var/lib/postgresql/data').out, /PG_VERSION/);
    run(sh, 'docker rm -f db');
    run(sh, 'docker run -d --name db -v pgdata:/var/lib/postgresql/data postgres:16');
    const logs = run(sh, 'docker logs db').out;
    assert.match(logs, /PostgreSQL Database directory appears to contain a database; Skipping initialization/);
    assert.doesNotMatch(logs, /init process complete/);
    assert.match(run(sh, 'docker ps').out, /Up/);
  });

  it('без -v у postgres — анонимный том; rm -v его удаляет', () => {
    const sh = shell({ docker: { images: ['postgres:16'] } });
    run(sh, 'docker run -d --name db -e POSTGRES_PASSWORD=x postgres:16');
    const mounts = JSON.parse(run(sh, "docker inspect -f '{{json .Mounts}}' db").out);
    assert.equal(mounts[0].Destination, '/var/lib/postgresql/data');
    assert.match(mounts[0].Name, /^[0-9a-f]{64}$/);
    assert.ok(sh.fs.root.docker.volumes[mounts[0].Name]);
    run(sh, 'docker rm -f -v db');
    assert.equal(sh.fs.root.docker.volumes[mounts[0].Name], undefined);
  });
});

describe('inspect', () => {
  it('JSON с отступом 4, -f с полями, json и range; нет объекта — [] и ошибка', () => {
    const sh = shell({ docker: { images: ['nginx:1.27-alpine'] } });
    run(sh, 'docker run -d --name web -p 8080:80 nginx:1.27-alpine');
    const data = JSON.parse(run(sh, 'docker inspect web').out);
    assert.equal(data[0].Name, '/web');
    assert.equal(data[0].State.Status, 'running');
    assert.deepEqual(data[0].HostConfig.PortBindings, { '80/tcp': [{ HostIp: '', HostPort: '8080' }] });
    assert.match(run(sh, 'docker inspect web').out, /"maintainer": "NGINX Docker Maintainers \\u003cdocker-maint@nginx\.com\\u003e"/);
    assert.equal(run(sh, "docker inspect -f '{{.State.Status}}' web").out, 'running\n');
    assert.equal(run(sh, "docker inspect --format '{{.Config.Image}} {{.NetworkSettings.Ports}}' web").out,
      'nginx:1.27-alpine map[80/tcp:[{0.0.0.0 8080} {:: 8080}]]\n');
    assert.equal(run(sh, "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' web").out, '172.17.0.2\n');
    assert.deepEqual(run(sh, 'docker inspect nosuch'), { out: '[]\n', err: 'error: no such object: nosuch\n', code: 1 });
    assert.match(run(sh, 'docker inspect nginx:1.27-alpine').out, /"Id": "sha256:[0-9a-f]{64}"/);
  });
});

describe('setup и правила задач', () => {
  const SETUP = {
    docker: {
      images: ['nginx:1.27'],
      volumes: ['pgdata'],
      containers: [
        { name: 'db', image: 'postgres:16', env: { POSTGRES_PASSWORD: 'secret' }, volumes: ['pgdata:/var/lib/postgresql/data'] },
        { name: 'old', image: 'nginx:1.27', running: false },
      ],
    },
  };

  it('setup: образы, тома и контейнеры (запущенные и нет)', () => {
    const sh = shell(SETUP);
    const ps = run(sh, 'docker ps -a').out;
    assert.match(ps, /postgres:16 .* Up .* db\n/);
    assert.match(ps, /nginx:1\.27 .* Created .* old\n/);
    assert.match(run(sh, 'docker images').out, /nginx:1\.27 /);
  });

  it('правила: контейнер, порт, том, образ', () => {
    const sh = shell(SETUP);
    const rules = [
      { docker: 'container', name: 'web', status: 'running', fail: 'web не запущен' },
      { docker: 'port', container: 'web', host: 8080, port: 80, fail: 'порт' },
      { docker: 'volume', name: 'pgdata', mounted_in: 'db', fail: 'том' },
      { docker: 'container', name: 'old', status: 'absent', fail: 'old остался' },
      { docker: 'image', ref: 'nginx:1.27', max_size_mb: 300, fail: 'образ' },
    ];
    assert.equal(firstFailedRule(rules, sh).fail, 'web не запущен');
    run(sh, 'docker run -d --name web -p 8080:80 nginx:1.27');
    assert.equal(firstFailedRule(rules, sh).fail, 'old остался');
    run(sh, 'docker rm old');
    assert.equal(firstFailedRule(rules, sh), null);
    assert.equal(firstFailedRule([{ docker: 'image', ref: 'nginx:1.27', user_not_root: true, fail: 'root' }], sh).fail, 'root');
  });

  it('эталон задачи проходит проверку verifyTask', () => {
    const task = {
      setup: { docker: { images: ['nginx:1.27-alpine'] } },
      solution: 'docker run -d --name web -p 8080:80 nginx:1.27-alpine\ncurl -s localhost:8080',
      rules: [{ docker: 'container', name: 'web', fail: 'web' }, { output_matches: 'Welcome to nginx', fail: 'curl' }],
    };
    assert.deepEqual(verifyTask(task), []);
  });
});

describe('psql в контейнере postgres (PGlite)', async () => {
  const { setPGliteLoader, forgetVolume } = await import('../../src/static/js/engines/docker/psql.js');
  const { verifyTaskAsync } = await import('../../src/static/js/engines/linux/checker.js');
  setPGliteLoader(async () => (await import('@electric-sql/pglite')).PGlite);

  /** Строка с выводом, который приходит позже. */
  async function runAsync(sh, line) {
    const { chunks, pending, action } = sh.run(line);
    const all = pending ? [...chunks, ...(await pending).chunks] : chunks;
    const result = {
      out: all.filter((c) => !c.err).map((c) => c.text).join(''),
      err: all.filter((c) => c.err).map((c) => c.text).join(''),
      code: sh.status,
    };
    if (action) result.action = action;
    return result;
  }

  const DB = 'docker run -d --name shop-db -e POSTGRES_PASSWORD=shop -e POSTGRES_DB=shop -v pgdata:/var/lib/postgresql/data postgres:16';

  it('-c: таблица результата, версия и имя базы как у настоящего сервера', async () => {
    forgetVolume('pgdata');
    const sh = shell({ docker: { images: ['postgres:16'] } });
    run(sh, DB);
    const result = await runAsync(sh, 'docker exec shop-db psql -U postgres -d shop -c "SELECT current_database(), version();"');
    assert.equal(result.out, ` current_database |                                                       version                                                        
------------------+----------------------------------------------------------------------------------------------------------------------
 shop             | PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
(1 row)

`);
    assert.equal((await runAsync(sh, 'docker exec shop-db psql -U postgres -d shop -c "SELECT 1;"')).out, ' ?column? \n----------\n        1\n(1 row)\n\n');
  });

  it('команды, теги, ошибки с LINE и ^, роли и базы', async () => {
    forgetVolume('pgdata');
    const sh = shell({ docker: { images: ['postgres:16'] } });
    run(sh, DB);
    const psql = (sql, extra = '-d shop') => runAsync(sh, `docker exec shop-db psql -U postgres ${extra} -c "${sql}"`);
    assert.equal((await psql("CREATE TABLE products (id serial PRIMARY KEY, name text); INSERT INTO products (name) VALUES ('Чайник'), ('Кружка');")).out, 'CREATE TABLE\nINSERT 0 2\n');
    assert.equal((await psql("UPDATE products SET name = upper(name) WHERE id = 1;")).out, 'UPDATE 1\n');
    assert.equal((await psql('SELECT * FROM products ORDER BY id;')).out, ' id |  name  \n----+--------\n  1 | ЧАЙНИК\n  2 | Кружка\n(2 rows)\n\n');
    assert.deepEqual(await psql('select nosuch'), { out: '', err: 'ERROR:  column "nosuch" does not exist\nLINE 1: select nosuch\n               ^\n', code: 1 });
    assert.match((await psql("INSERT INTO products VALUES (1, 'x');")).err, /^ERROR: {2}duplicate key value violates unique constraint "products_pkey"\nDETAIL: {2}Key \(id\)=\(1\) already exists\.\n$/);
    assert.equal((await psql('\\dt')).out, '          List of relations\n Schema |   Name   | Type  |  Owner   \n--------+----------+-------+----------\n public | products | table | postgres\n(1 row)\n\n');
    assert.match((await psql('\\l', '')).out, /^ {54}List of databases\n {3}Name {4}\| {2}Owner {3}\|/);
    assert.deepEqual(await runAsync(sh, 'docker exec shop-db psql -U bob -c "select 1"'), {
      out: '', err: 'psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  role "bob" does not exist\n', code: 2,
    });
    assert.match((await runAsync(sh, 'docker exec shop-db psql -c "select 1"')).err, /role "root" does not exist/);
    assert.match((await psql('select 1', '-d nosuch')).err, /FATAL: {2}database "nosuch" does not exist/);
    assert.equal((await psql('CREATE DATABASE test;', '')).out, 'CREATE DATABASE\n');
    assert.equal((await psql('SELECT current_database();', '-d test')).out, ' current_database \n------------------\n test\n(1 row)\n\n');
  });

  it('данные в томе переживают rm контейнера и перезагрузку страницы', async () => {
    forgetVolume('pgdata');
    const sh = shell({ docker: { images: ['postgres:16'] } });
    run(sh, DB);
    await runAsync(sh, `docker exec shop-db psql -U postgres -d shop -c "CREATE TABLE products (id serial, name text); INSERT INTO products (name) VALUES ('Чайник');"`);
    run(sh, 'docker rm -f shop-db');
    run(sh, 'docker run -d --name shop-db -v pgdata:/var/lib/postgresql/data postgres:16');
    // браузер перезагрузили: ФС — из сохранения, PGlite — новый, данные — из журнала тома
    const restored = new Shell(VirtualFS.fromJSON(JSON.parse(JSON.stringify(sh.fs))));
    forgetVolume('pgdata');
    assert.equal((await runAsync(restored, 'docker exec shop-db psql -U postgres -d shop -c "SELECT count(*) FROM products;"')).out, ' count \n-------\n     1\n(1 row)\n\n');
  });

  it('POSTGRES_USER=shop — суперпользователь shop, роли postgres нет', async () => {
    forgetVolume('shopdata');
    const sh = shell({ docker: { images: ['postgres:16'] } });
    run(sh, 'docker run -d --name db2 -e POSTGRES_PASSWORD=x -e POSTGRES_USER=shop -v shopdata:/var/lib/postgresql/data postgres:16');
    assert.match((await runAsync(sh, 'docker exec db2 psql -U postgres -c "select 1"')).err, /role "postgres" does not exist/);
    assert.equal((await runAsync(sh, 'docker exec db2 psql -U shop -c "select current_user"')).out, ' current_user \n--------------\n shop\n(1 row)\n\n');
  });

  it('docker exec -it db psql — интерактивный psql: приглашение shop=#, многострочный запрос, \\q', async () => {
    forgetVolume('pgdata');
    const sh = shell({ docker: { images: ['postgres:16'] } });
    run(sh, DB);
    const entered = run(sh, 'docker exec -it shop-db psql -U postgres -d shop');
    assert.equal(entered.action.type, 'enter');
    assert.match(entered.out, /^psql \(16\.15 \(Debian 16\.15-1\.pgdg13\+2\)\)\nType "help" for help\.\n\n$/);
    const session = entered.action.shell;
    assert.equal(session.prompt(), 'shop=# ');
    assert.deepEqual(session.run('SELECT 1 +').chunks, []);
    assert.equal(session.prompt(), 'shop-# ');
    const done = await session.run('1 AS two;').pending;
    assert.equal(done.chunks[0].text, ' two \n-----\n   2\n(1 row)\n\n');
    assert.equal(session.prompt(), 'shop=# ');
    assert.equal(session.run('\\q').action.type, 'leave');
  });

  it('вывод psql в файл и в конвейер', async () => {
    forgetVolume('pgdata');
    const sh = shell({ docker: { images: ['postgres:16'] } });
    run(sh, DB);
    await runAsync(sh, 'docker exec shop-db psql -U postgres -c "SELECT 42 AS answer" > out.txt');
    assert.match(run(sh, 'cat out.txt').out, /answer \n--------\n {5}42\n/);
    assert.match((await runAsync(sh, 'docker exec shop-db psql -U postgres -c "SELECT 1" | wc -l')).err, /не передаётся по конвейеру/);
  });

  it('эталон с psql проходит verifyTaskAsync', async () => {
    forgetVolume('pgdata');
    const task = {
      setup: { docker: { images: ['postgres:16'] } },
      solution: `${DB}\ndocker exec shop-db psql -U postgres -d shop -c "CREATE TABLE t (id int); INSERT INTO t VALUES (1);"\ndocker exec shop-db psql -U postgres -d shop -c "SELECT count(*) FROM t;"`,
      rules: [{ docker: 'container', name: 'shop-db', fail: 'нет базы' }, { output_matches: '^ +1$', fail: 'count' }],
    };
    assert.deepEqual(await verifyTaskAsync(task), []);
  });
});
