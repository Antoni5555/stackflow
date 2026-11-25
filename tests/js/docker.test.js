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

  it('--env-file: пробел в имени — ошибка, кавычки остаются в значении', () => {
    const sh = shell({ docker: { images: ['alpine:3.20'] }, files: { '/home/shop/.env': 'SPACED = 1\n', '/home/shop/ok.env': '# база\n  POSTGRES_PASSWORD="s3cr3t"\n' } });
    assert.deepEqual(run(sh, 'docker run --rm --env-file .env alpine:3.20 env'), {
      out: '', err: "docker: --env-file: invalid env file (.env): variable 'SPACED ' contains whitespaces\n\nRun 'docker run --help' for more information\n", code: 125,
    });
    assert.equal(run(sh, 'docker ps -aq').out, '');
    assert.match(run(sh, 'docker run --rm --env-file ok.env alpine:3.20 env').out, /^POSTGRES_PASSWORD="s3cr3t"$/m);
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

describe('сети и тома (шаг 3)', () => {
  it('network ls/create/connect/inspect/rm и ошибки', () => {
    const sh = shell({ docker: { images: ['postgres:16'] } });
    assert.match(run(sh, 'docker network ls').out, /^NETWORK ID {5}NAME {6}DRIVER {4}SCOPE\n[0-9a-f]{12} {3}bridge {4}bridge {4}local\n[0-9a-f]{12} {3}host {6}host {6}local\n[0-9a-f]{12} {3}none {6}null {6}local\n$/);
    assert.match(run(sh, 'docker network create shop').out, /^[0-9a-f]{64}\n$/);
    assert.equal(run(sh, 'docker network create shop').err, 'Error response from daemon: network with name shop already exists\n');
    run(sh, 'docker run -d --name shop-db -e POSTGRES_PASSWORD=shop postgres:16');
    assert.equal(run(sh, 'docker network connect shop shop-db').code, 0);
    assert.equal(run(sh, 'docker network connect shop shop-db').err, 'Error response from daemon: endpoint with name shop-db already exists in network shop\n');
    assert.equal(run(sh, "docker network inspect --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{end}}' shop").out, 'shop-db 172.18.0.2/16\n');
    assert.match(run(sh, 'docker network rm shop').err, /^Error response from daemon: error while removing network: network shop has active endpoints \(name:"shop-db" id:"[0-9a-f]{12}"\)\nexit status 1\n$/);
    assert.equal(run(sh, 'docker network rm bridge').err, 'Error response from daemon: bridge is a pre-defined network and cannot be removed\nexit status 1\n');
    assert.equal(run(sh, 'docker network connect nosuch shop-db').err, 'Error response from daemon: network nosuch not found\n');
    run(sh, 'docker rm -f shop-db');
    assert.equal(run(sh, 'docker network rm shop').out, 'shop\n');
  });

  it('DNS по имени — только в своей сети; localhost — сам контейнер', () => {
    const sh = shell({ docker: { images: ['postgres:16', 'alpine:3.20', 'nginx:1.27-alpine'] } });
    run(sh, 'docker run -d --name shop-db -e POSTGRES_PASSWORD=shop postgres:16');
    assert.deepEqual(run(sh, 'docker run --rm postgres:16 pg_isready -h shop-db'), { out: 'shop-db:5432 - no response\n', err: '', code: 2 });
    assert.deepEqual(run(sh, 'docker run --rm alpine:3.20 ping -c 1 shop-db'), { out: '', err: "ping: bad address 'shop-db'\n", code: 1 });
    run(sh, 'docker network create shop');
    run(sh, 'docker network connect shop shop-db');
    assert.deepEqual(run(sh, 'docker run --rm --network shop postgres:16 pg_isready -h shop-db'), { out: 'shop-db:5432 - accepting connections\n', err: '', code: 0 });
    assert.deepEqual(run(sh, 'docker run --rm --network shop postgres:16 pg_isready -h localhost'), { out: 'localhost:5432 - no response\n', err: '', code: 2 });
    assert.match(run(sh, 'docker run --rm --network shop alpine:3.20 ping -c 1 shop-db').out, /^PING shop-db \(172\.18\.0\.2\): 56 data bytes\n64 bytes from 172\.18\.0\.2: seq=0 ttl=64/);
    assert.equal(run(sh, 'docker exec shop-db pg_isready').out, '/var/run/postgresql:5432 - accepting connections\n');
    run(sh, 'docker run -d --name web --network shop nginx:1.27-alpine');
    assert.match(run(sh, 'docker exec web curl -s web').out, /Welcome to nginx!/);
    assert.equal(run(sh, 'docker exec web curl -s shop-db:5432').code, 52);
    assert.equal(run(sh, 'docker exec web curl -s nosuch').err, 'curl: (6) Could not resolve host: nosuch\n');
    assert.match(run(sh, 'curl -sI 172.18.0.3').out, /^HTTP\/1\.1 200 OK\nServer: nginx\/1\.27\.5/);
  });

  it('volume create/ls/inspect/rm и ошибки', () => {
    const sh = shell({ docker: { images: ['alpine:3.20'] } });
    assert.equal(run(sh, 'docker volume ls').out, 'DRIVER    VOLUME NAME\n');
    assert.equal(run(sh, 'docker volume create data').out, 'data\n');
    assert.equal(run(sh, 'docker volume create data').out, 'data\n');
    assert.equal(run(sh, 'docker volume ls').out, 'DRIVER    VOLUME NAME\nlocal     data\n');
    const [info] = JSON.parse(run(sh, 'docker volume inspect data').out);
    assert.deepEqual(Object.keys(info), ['CreatedAt', 'Driver', 'Labels', 'Mountpoint', 'Name', 'Options', 'Scope']);
    assert.equal(info.Mountpoint, '/var/lib/docker/volumes/data/_data');
    const id = run(sh, 'docker run -d --name box -v data:/data alpine:3.20 sleep 300').out.trim();
    assert.equal(run(sh, 'docker volume rm data').err, `Error response from daemon: remove data: volume is in use - [${id}]\n`);
    assert.equal(run(sh, 'docker volume rm nosuch').err, 'Error response from daemon: get nosuch: no such volume\n');
    assert.equal(JSON.parse(run(sh, "docker inspect -f '{{json .Mounts}}' box").out)[0].Mode, '');
    run(sh, 'docker rm -f box');
    assert.equal(run(sh, 'docker volume rm data').out, 'data\n');
  });

  it('volume prune: без -a — только анонимные, с -a — и именованные; без -f — вопрос', () => {
    const sh = shell({ docker: { images: ['postgres:16'] } });
    run(sh, 'docker run -d --name db -e POSTGRES_PASSWORD=x postgres:16');
    run(sh, 'docker volume create keep');
    assert.match(run(sh, 'docker volume prune').out, /^WARNING! This will remove anonymous local volumes not used by at least one container\.\nAre you sure you want to continue\? \[y\/N\] /);
    assert.equal(run(sh, 'docker volume prune -f').out, 'Total reclaimed space: 0B\n');   // том базы занят
    run(sh, 'docker rm -f db');
    assert.match(run(sh, 'docker volume prune -f').out, /^Deleted Volumes:\n[0-9a-f]{64}\n\nTotal reclaimed space: \S+MB\n$/);
    assert.equal(run(sh, 'docker volume ls -q').out, 'keep\n');
    assert.match(run(sh, 'echo y | docker volume prune -a').out, /Deleted Volumes:\nkeep\n/);
    assert.equal(run(sh, 'docker volume ls -q').out, '');
  });
});

describe('docker build, свой образ, реестр (шаг 4)', () => {
  const WSGI = 'def application(environ, start_response):\n    start_response("200 OK", [("Content-Type", "text/plain; charset=utf-8")])\n    return ["Магазин работает\\n".encode()]\n';
  const DOCKERFILE = 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["gunicorn", "--bind", "0.0.0.0:8000", "shop.wsgi"]\n';
  const project = (extra = {}) => shell({
    cwd: '/home/shop/shop',
    docker: { images: ['python:3.12-slim'] },
    files: {
      '/home/shop/shop/requirements.txt': 'gunicorn==23.0.0\n',
      '/home/shop/shop/shop/__init__.py': '',
      '/home/shop/shop/shop/wsgi.py': WSGI,
      '/home/shop/shop/Dockerfile': DOCKERFILE,
      ...extra,
    },
  });
  const steps = (text) => text.split('\n').filter((line) => /^#\d+ (\[|CACHED|DONE)/.test(line)).join('\n');

  it('первая сборка: шаги BuildKit, pip install, образ 193MB / 47.2MB', () => {
    const sh = project();
    const built = run(sh, 'docker build -t shop-web:1.0 .');
    assert.equal(built.code, 0);
    assert.equal(built.out, '');
    assert.match(built.err, /^#0 building with "default" instance using docker driver\n\n#1 \[internal\] load build definition from Dockerfile\n#1 transferring dockerfile: 175B done\n#1 DONE 0\.0s\n\n#2 \[internal\] load metadata for docker\.io\/library\/python:3\.12-slim\n/);
    assert.match(built.err, /#5 \[1\/5\] FROM docker\.io\/library\/python:3\.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b\n/);
    assert.match(built.err, /#8 \[4\/5\] RUN pip install --no-cache-dir -r requirements\.txt\n#8 \d\.\d{3} Collecting gunicorn==23\.0\.0 \(from -r requirements\.txt \(line 1\)\)\n/);
    assert.match(built.err, /Successfully installed packaging-26\.4 gunicorn-23\.0\.0\n#8 \d\.\d{3} WARNING: Running pip as the 'root' user/);
    assert.match(built.err, /#10 naming to docker\.io\/library\/shop-web:1\.0 done\n/);
    assert.match(run(sh, 'docker images shop-web').out, /^IMAGE {10}ID {13}DISK USAGE {3}CONTENT SIZE {3}EXTRA\nshop-web:1\.0 {3}[0-9a-f]{12} {8}193MB {9}47\.2MB {8}\n$/);
  });

  it('кэш: повтор — всё CACHED; правка кода — пересобирается только COPY . .', () => {
    const sh = project();
    run(sh, 'docker build -t shop-web:1.0 .');
    assert.equal(steps(run(sh, 'docker build -t shop-web:1.0 .').err).match(/CACHED/g).length, 4);
    run(sh, 'echo "# правка" >> shop/wsgi.py');
    const again = steps(run(sh, 'docker build -t shop-web:1.1 .').err);
    assert.match(again, /#8 \[4\/5\] RUN pip install --no-cache-dir -r requirements\.txt\n#8 CACHED\n#9 \[5\/5\] COPY \. \.\n#9 DONE 0\.1s/);
    // COPY . . до pip install — правка кода переустанавливает пакеты
    run(sh, `echo 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nRUN pip install --no-cache-dir -r requirements.txt' > Dockerfile.bad`);
    run(sh, 'docker build -f Dockerfile.bad -t shop-bad:1.0 .');
    run(sh, 'echo "# ещё правка" >> shop/wsgi.py');
    assert.match(run(sh, 'docker build -f Dockerfile.bad -t shop-bad:1.1 .').err, /#8 \[4\/4\] RUN pip install[^\n]*\n#8 \d\.\d{3} Collecting gunicorn/);
    assert.match(run(sh, 'docker build --no-cache -t shop-web:1.2 .').err, /#6 \[2\/5\] WORKDIR \/app\n#6 DONE/);
  });

  it('свой образ: CMD gunicorn, curl на порт, логи, history', () => {
    const sh = project();
    run(sh, 'docker build -t shop-web:1.0 .');
    assert.match(run(sh, 'docker run -d --name shop-web -p 58000:8000 shop-web:1.0').out, /^[0-9a-f]{64}\n$/);
    assert.equal(run(sh, 'curl -s localhost:58000').out, 'Магазин работает\n');
    assert.match(run(sh, 'docker logs shop-web').err, /^\[\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \+0000\] \[1\] \[INFO\] Starting gunicorn 23\.0\.0\n.*\[1\] \[INFO\] Listening at: http:\/\/0\.0\.0\.0:8000 \(1\)\n.*\[INFO\] Using worker: sync\n.*\[7\] \[INFO\] Booting worker with pid: 7\n$/);
    const history = run(sh, 'docker history shop-web:1.0').out.split('\n');
    assert.equal(history[0], 'IMAGE          CREATED                  CREATED BY                                      SIZE      COMMENT');
    assert.match(history[1], /^[0-9a-f]{12} {3}Less than a second ago   CMD \["gunicorn" "--bind" "0\.0\.0\.0:8000" "sho… {3}0B {8}buildkit\.dockerfile\.v0$/);
    assert.match(history[2], /COPY \. \. # buildkit {29}24\.6kB {4}/);
    assert.match(history[3], /RUN \/bin\/sh -c pip install --no-cache-dir -r… {3}11\.7MB {4}/);
    assert.match(history[4], /COPY requirements\.txt \. # buildkit {14}12\.3kB {4}/);
    assert.match(history[5], /WORKDIR \/app {36}8\.19kB {4}/);
    assert.match(run(sh, 'docker ps').out, /"gunicorn --bind 0\.0…"/);
  });

  it('127.0.0.1 в gunicorn — снаружи обрыв; нет модуля — Worker failed to boot', () => {
    const sh = project({ '/home/shop/shop/Dockerfile': DOCKERFILE.replace('0.0.0.0:8000', '127.0.0.1:8000') });
    run(sh, 'docker build -t local .');
    run(sh, 'docker run -d --name web -p 58000:8000 local');
    assert.equal(run(sh, 'curl -s localhost:58000').err, 'curl: (56) Recv failure: Connection reset by peer\n');
    const broken = project({ '/home/shop/shop/Dockerfile': DOCKERFILE.replace('shop.wsgi', 'store.wsgi') });
    run(broken, 'docker build -t broken .');
    run(broken, 'docker run -d --name web broken');
    assert.match(run(broken, 'docker logs web').err, /ModuleNotFoundError: No module named 'store'\n[\s\S]*Reason: Worker failed to boot\.\n$/);
    assert.match(run(broken, 'docker ps -a').out, /Exited \(3\)/);
  });

  it('.dockerignore: .env и venv не попадают в образ', () => {
    const sh = project({ '/home/shop/shop/.env': 'POSTGRES_PASSWORD=s3cr3t\n', '/home/shop/shop/venv/bin/python': 'x', '/home/shop/shop/.dockerignore': '.git\n.env\nvenv/\n__pycache__/\n*.pyc\n' });
    assert.match(run(sh, 'docker build -t shop-web:slim .').err, /#3 \[internal\] load \.dockerignore\n#3 transferring context: 35B done/);
    assert.equal(run(sh, 'docker run --rm shop-web:slim ls -a /app').out, '.\n..\n.dockerignore\nDockerfile\nrequirements.txt\nshop\n');
    assert.equal(run(sh, 'docker run --rm shop-web:slim cat /app/.env').err, 'cat: /app/.env: No such file or directory\n');
  });

  it('многоэтапная сборка, ARG/ENV, USER, ENTRYPOINT-скрипт', () => {
    const sh = project({
      '/home/shop/shop/entrypoint.sh': { content: '#!/bin/sh\necho "миграции применены"\nexec "$@"\n', mode: '755' },
      '/home/shop/shop/Dockerfile': `FROM python:3.12-slim AS build
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim
RUN useradd --create-home app
COPY --from=build /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /app
COPY --chown=app . .
ARG APP_VERSION=dev
ENV APP_VERSION=\${APP_VERSION}
USER app
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "shop.wsgi"]
`,
    });
    const built = run(sh, 'docker build --build-arg APP_VERSION=1.4.2 -t shop-web:multi .');
    assert.equal(built.code, 0, built.err);
    assert.match(built.err, /#\d+ \[build 1\/4\] FROM/);
    assert.match(built.err, /#\d+ \[stage-1 3\/5\] COPY --from=build \/opt\/venv \/opt\/venv/);
    run(sh, 'docker run -d --name web -p 58000:8000 shop-web:multi');
    assert.equal(run(sh, 'curl -s localhost:58000').out, 'Магазин работает\n');
    assert.match(run(sh, 'docker logs web').out, /^миграции применены\n$/);
    assert.equal(run(sh, 'docker exec web whoami').out, 'app\n');
    assert.match(run(sh, 'docker exec web env').out, /^APP_VERSION=1\.4\.2$/m);
    assert.equal(firstFailedRule([{ docker: 'image', ref: 'shop-web:multi', user_not_root: true, max_size_mb: 250, fail: 'x' }], sh), null);
  });

  it('ошибки сборки: нет файла для COPY, упавший RUN, нет контекста', () => {
    const sh = project({ '/home/shop/shop/Dockerfile': 'FROM python:3.12-slim\nWORKDIR /app\nCOPY config.ini .\n' });
    const missing = run(sh, 'docker build -t bad .');
    assert.equal(missing.code, 1);
    assert.match(missing.err, /------\n > \[3\/3\] COPY config\.ini \.:\n------\nDockerfile:3\n--------------------\n {3}1 \| {5}FROM python:3\.12-slim\n {3}2 \| {5}WORKDIR \/app\n {3}3 \| >>> COPY config\.ini \.\n--------------------\nERROR: failed to build: failed to solve: failed to compute cache key: failed to calculate checksum of ref [0-9a-f]+::[0-9a-f]+: "\/config\.ini": not found\n$/);
    run(sh, `echo 'FROM python:3.12-slim\nRUN nosuch' > Dockerfile`);
    const failed = run(sh, 'docker build -t bad .');
    assert.match(failed.err, /#6 \[2\/2\] RUN nosuch\n#6 \d\.\d{3} \/bin\/sh: 1: nosuch: not found\n#6 ERROR: process "\/bin\/sh -c nosuch" did not complete successfully: exit code: 127\n------\n > \[2\/2\] RUN nosuch:\n\d\.\d{3} \/bin\/sh: 1: nosuch: not found\n------\n/);
    assert.match(failed.err, /ERROR: failed to build: failed to solve: process "\/bin\/sh -c nosuch" did not complete successfully: exit code: 127\n$/);
    assert.equal(run(sh, 'docker build -t x').err, "ERROR: docker: 'docker buildx build' requires 1 argument\n\nUsage:  docker buildx build [OPTIONS] PATH | URL | -\n\nRun 'docker buildx build --help' for more information\n");
  });

  it('свой реестр registry:2: tag, push, API, pull; внешние реестры — login', () => {
    const sh = project();
    run(sh, 'docker build -t shop-web:1.4.2 .');
    run(sh, 'docker run -d --name registry -p 55000:5000 -v registry-data:/var/lib/registry registry:2');
    run(sh, 'docker tag shop-web:1.4.2 localhost:55000/shop/web:1.4.2');
    run(sh, 'docker tag shop-web:1.4.2 localhost:55000/shop/web:latest');
    assert.equal(run(sh, 'docker images localhost:55000/shop/web').out.split('\n').length, 4);
    assert.match(run(sh, 'docker push localhost:55000/shop/web:1.4.2').out, /^The push refers to repository \[localhost:55000\/shop\/web\]\n([0-9a-f]{12}: Pushed\n)+1\.4\.2: digest: sha256:[0-9a-f]{64} size: 856\n$/);
    assert.match(run(sh, 'docker push localhost:55000/shop/web:latest').out, /([0-9a-f]{12}: Layer already exists\n)+latest: digest/);
    assert.equal(run(sh, 'curl -s localhost:55000/v2/_catalog').out, '{"repositories":["shop/web"]}\n');
    assert.equal(run(sh, 'curl -s localhost:55000/v2/shop/web/tags/list').out, '{"name":"shop/web","tags":["latest","1.4.2"]}\n');
    run(sh, 'docker rmi localhost:55000/shop/web:1.4.2 localhost:55000/shop/web:latest');
    assert.match(run(sh, 'docker pull localhost:55000/shop/web:1.4.2').out, /^1\.4\.2: Pulling from shop\/web\nDigest: sha256:[0-9a-f]{64}\nStatus: Downloaded newer image for localhost:55000\/shop\/web:1\.4\.2\nlocalhost:55000\/shop\/web:1\.4\.2\n$/);
    assert.equal(run(sh, 'docker pull localhost:55000/shop/web:9.9.9').err, 'Error response from daemon: failed to resolve reference "localhost:55000/shop/web:9.9.9": localhost:55000/shop/web:9.9.9: not found\n');
    assert.equal(run(sh, 'docker push shop-web:1.4.2').err, 'denied: requested access to the resource is denied\n');
    run(sh, 'docker tag shop-web:1.4.2 ghcr.io/shop/web:1.4.2');
    assert.match(run(sh, 'docker push ghcr.io/shop/web:1.4.2').err, /^unauthorized/);
    assert.equal(run(sh, 'echo token | docker login ghcr.io -u shop --password-stdin').out, 'Login Succeeded\n');
    assert.equal(run(sh, 'docker push ghcr.io/shop/web:1.4.2').code, 0);
    assert.match(run(sh, 'cat ~/.docker/config.json').out, /"ghcr\.io": \{\n\t\t\t"auth": "c2hvcDp0b2tlbg=="/);
  });

  it('CMD в shell-форме работает (stop — 137), printenv, gunicorn --version, history --format, docker port', () => {
    const sh = project({ '/home/shop/shop/Dockerfile': DOCKERFILE.replace('CMD ["gunicorn", "--bind", "0.0.0.0:8000", "shop.wsgi"]', 'CMD gunicorn --bind 0.0.0.0:8000 shop.wsgi') });
    run(sh, 'docker build -t shop-web:sh .');
    run(sh, 'docker run -d --name web -p 58000:8000 shop-web:sh');
    assert.equal(run(sh, 'curl -s localhost:58000').out, 'Магазин работает\n');
    assert.match(run(sh, 'docker ps').out, /"\/bin\/sh -c 'gunicor…"/);
    run(sh, 'docker stop web');
    assert.match(run(sh, 'docker ps -a').out, /Exited \(137\)/);
    assert.equal(run(sh, 'docker run --rm shop-web:sh printenv PYTHON_VERSION').out, '3.12.16\n');
    assert.equal(run(sh, 'docker run --rm shop-web:sh gunicorn --version').out, 'gunicorn (version 23.0.0)\n');
    assert.equal(run(sh, "docker inspect -f '[{{.Config.User}}]' shop-web:sh").out, '[]\n');
    assert.match(run(sh, "docker history --format '{{.Size}}\t{{.CreatedBy}}' shop-web:sh").out, /^0B\tCMD \["\/bin\/sh" "-c" "gunicorn --bind 0\.0\.0\.0:8000 shop\.wsgi"\]\n24\.6kB\tCOPY \. \. # buildkit\n/);
    run(sh, 'docker run -d --name web2 -p 58001:8000 shop-web:sh');
    assert.equal(run(sh, 'docker port web2').out, '8000/tcp -> 0.0.0.0:58001\n8000/tcp -> [::]:58001\n');
    assert.equal(run(sh, 'docker exec web2 gunicorn --version').out, 'gunicorn (version 23.0.0)\n');
  });
});

const SETUP_CHECK = {"cwd": "/home/shop/shop", "docker": {"images": ["python:3.12-slim", "postgres:16"]}, "files": {"/home/shop/shop/requirements.txt": "gunicorn==23.0.0\npsycopg[binary]==3.2.12\n", "/home/shop/shop/shop/__init__.py": "", "/home/shop/shop/shop/wsgi.py": "def application(environ, start_response):\n    start_response(\"200 OK\", [(\"Content-Type\", \"text/plain; charset=utf-8\")])\n    return [\"Магазин работает\\n\".encode()]\n", "/home/shop/shop/Dockerfile": "FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD [\"gunicorn\", \"--bind\", \"0.0.0.0:8000\", \"shop.wsgi\"]\n", "/home/shop/shop/check_db.py": "import os\nimport psycopg\n\npsycopg.connect(f\"host={os.environ['DB_HOST']} user=postgres password={os.environ['DB_PASSWORD']}\").close()\nprint(\"база доступна\")\n", "/home/shop/shop/compose.yaml": "services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: shop\n  web:\n    build: .\n    command: [\"python\", \"check_db.py\"]\n    environment:\n      DB_HOST: db\n      DB_PASSWORD: shop\n    depends_on:\n      - db\n", "/home/shop/shop/compose2.yaml": "services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: shop\n    healthcheck:\n      test: [\"CMD-SHELL\", \"pg_isready -U postgres\"]\n      interval: 2s\n      timeout: 3s\n      retries: 10\n  web:\n    build: .\n    command: [\"python\", \"check_db.py\"]\n    environment:\n      DB_HOST: db\n      DB_PASSWORD: shop\n    depends_on:\n      db:\n        condition: service_healthy\n"}};
const SETUP_STACK = {"cwd": "/home/shop/shop", "docker": {"images": ["python:3.12-slim", "postgres:16", "nginx:1.27-alpine"]}, "files": {"/home/shop/shop/requirements.txt": "Django==5.2.8\ngunicorn==23.0.0\npsycopg[binary]==3.2.12\n", "/home/shop/shop/manage.py": "#!/usr/bin/env python\nimport os\nimport sys\n\n\ndef main():\n    os.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"config.settings\")\n    from django.core.management import execute_from_command_line\n    execute_from_command_line(sys.argv)\n\n\nif __name__ == \"__main__\":\n    main()\n", "/home/shop/shop/config/__init__.py": "", "/home/shop/shop/config/settings.py": "import os\nfrom pathlib import Path\n\nBASE_DIR = Path(__file__).resolve().parent.parent\nSECRET_KEY = os.environ[\"DJANGO_SECRET_KEY\"]\nDEBUG = False\nALLOWED_HOSTS = os.environ.get(\"DJANGO_ALLOWED_HOSTS\", \"\").split(\",\")\nDATABASES = {\n    \"default\": {\n        \"ENGINE\": \"django.db.backends.postgresql\",\n        \"NAME\": os.environ.get(\"POSTGRES_DB\", \"shop\"),\n        \"USER\": \"postgres\",\n        \"PASSWORD\": os.environ[\"POSTGRES_PASSWORD\"],\n        \"HOST\": os.environ.get(\"DB_HOST\", \"db\"),\n        \"PORT\": \"5432\",\n    }\n}\nSTATIC_URL = \"static/\"\nSTATIC_ROOT = BASE_DIR / \"staticfiles\"\n", "/home/shop/shop/config/wsgi.py": "import os\nfrom django.core.wsgi import get_wsgi_application\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"config.settings\")\napplication = get_wsgi_application()\n", "/home/shop/shop/shop/__init__.py": "", "/home/shop/shop/shop/views.py": "from django.contrib.auth.models import User\nfrom django.http import HttpResponse\n\n\ndef home(request):\n    return HttpResponse(f\"Магазин работает, пользователей: {User.objects.count()}\\n\")\n", "/home/shop/shop/Dockerfile": "FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nRUN python manage.py collectstatic --noinput\nCMD [\"gunicorn\", \"--bind\", \"0.0.0.0:8000\", \"--workers\", \"2\", \"config.wsgi\"]\n", "/home/shop/shop/nginx.conf": "server {\n    listen 80;\n\n    location /static/ {\n        alias /static/;\n    }\n\n    location / {\n        proxy_pass http://web:8000;\n        proxy_set_header Host $host;\n    }\n}\n", "/home/shop/shop/shop.env": "POSTGRES_PASSWORD=s3cr3t\nPOSTGRES_DB=shop\nDJANGO_SECRET_KEY=change-me-on-server\nDJANGO_ALLOWED_HOSTS=localhost\n", "/home/shop/shop/compose.yaml": "services:\n  db:\n    image: postgres:16\n    env_file: shop.env\n    volumes:\n      - pgdata:/var/lib/postgresql/data\n    healthcheck:\n      test: [\"CMD-SHELL\", \"pg_isready -U postgres\"]\n      interval: 2s\n      retries: 10\n    restart: unless-stopped\n\n  web:\n    build: .\n    env_file: shop.env\n    volumes:\n      - static:/app/staticfiles\n    depends_on:\n      db:\n        condition: service_healthy\n    restart: unless-stopped\n\n  nginx:\n    image: nginx:1.27-alpine\n    ports:\n      - \"58080:80\"\n    volumes:\n      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro\n      - static:/static:ro\n    depends_on:\n      - web\n    restart: unless-stopped\n\nvolumes:\n  pgdata:\n  static:\n"}};

describe('docker compose (шаг 5)', async () => {
  const { setPGliteLoader } = await import('../../src/static/js/engines/docker/psql.js');
  setPGliteLoader(async () => (await import('@electric-sql/pglite')).PGlite);
  const WSGI = 'def application(environ, start_response):\n    start_response("200 OK", [("Content-Type", "text/plain; charset=utf-8")])\n    return ["Магазин работает\\n".encode()]\n';
  const BASE = {
    '/home/shop/shop/requirements.txt': 'gunicorn==23.0.0\n',
    '/home/shop/shop/shop/__init__.py': '',
    '/home/shop/shop/shop/wsgi.py': WSGI,
    '/home/shop/shop/Dockerfile': 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["gunicorn", "--bind", "0.0.0.0:8000", "shop.wsgi"]\n',
  };
  const project = (files) => shell({ cwd: '/home/shop/shop', docker: { images: ['python:3.12-slim', 'postgres:16', 'nginx:1.27-alpine'] }, files: { ...BASE, ...files } });
  const COMPOSE = `services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: shop
      POSTGRES_DB: shop
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      retries: 10
  web:
    build: .
    ports:
      - "58000:8000"
    environment:
      DB_HOST: db
    depends_on:
      db:
        condition: service_healthy
volumes:
  pgdata:
`;

  it('up -d: сборка, сеть, том, Waiting/Healthy; ps, logs, exec psql, config', async () => {
    const sh = project({ '/home/shop/shop/compose.yaml': COMPOSE });
    const up = run(sh, 'docker compose up -d');
    assert.equal(up.code, 0);
    const steps = up.err.split('\n').filter((item) => item.startsWith(' ')).join('\n');
    assert.equal(steps, [' Image shop-web Building ', ' Image shop-web Built ', ' Network shop_default Creating ', ' Network shop_default Created ',
      ' Volume shop_pgdata Creating ', ' Volume shop_pgdata Created ', ' Container shop-db-1 Creating ', ' Container shop-db-1 Created ',
      ' Container shop-web-1 Creating ', ' Container shop-web-1 Created ', ' Container shop-db-1 Starting ', ' Container shop-db-1 Started ',
      ' Container shop-db-1 Waiting ', ' Container shop-db-1 Healthy ', ' Container shop-web-1 Starting ', ' Container shop-web-1 Started '].join('\n'));
    assert.match(up.err, /^#1 \[internal\] load local bake definitions\n/m);
    assert.match(up.err, /resolving provenance for metadata file/);
    const ps = run(sh, 'docker compose ps').out.split('\n');
    assert.equal(ps[0], 'NAME         IMAGE         COMMAND                  SERVICE   CREATED                  STATUS                            PORTS');
    assert.match(ps[1], /^shop-db-1 {4}postgres:16 {3}"docker-entrypoint\.s…" {3}db {7}.*Up Less than a second \(healthy\) {3}5432\/tcp$/);
    assert.match(ps[2], /^shop-web-1 {3}shop-web {6}"gunicorn --bind 0\.0…" {3}web .*0\.0\.0\.0:58000->8000\/tcp, \[::\]:58000->8000\/tcp$/);
    assert.equal(run(sh, 'curl -s localhost:58000').out, 'Магазин работает\n');
    assert.match(run(sh, 'docker compose logs web').out, /^web-1 {2}\| \[[^\]]+\] \[1\] \[INFO\] Starting gunicorn 23\.0\.0\n/);
    const { pending } = sh.run('docker compose exec db psql -U postgres -d shop -c "SELECT 1;"');
    assert.equal((await pending).chunks.map((c) => c.text).join(''), ' ?column? \n----------\n        1\n(1 row)\n\n');
    assert.match(run(sh, 'docker network ls --filter name=shop').out, /shop_default {3}bridge {4}local/);
    const config = run(sh, 'docker compose config').out;
    assert.match(config, /^name: shop\nservices:\n  db:\n    environment:\n      POSTGRES_DB: shop\n      POSTGRES_PASSWORD: shop\n    image: postgres:16\n    networks:\n      default: null\n    volumes:\n      - type: volume\n        source: pgdata\n        target: \/var\/lib\/postgresql\/data\n        volume: \{\}\n    healthcheck:\n      test:\n        - CMD-SHELL\n        - pg_isready -U postgres\n      interval: 2s\n      retries: 10\n/);
    assert.match(config, /    depends_on:\n      db:\n        condition: service_healthy\n        required: true\n    ports:\n      - mode: ingress\n        target: 8000\n        published: "58000"\n        protocol: tcp\nnetworks:\n  default:\n    name: shop_default\nvolumes:\n  pgdata:\n    name: shop_pgdata\n$/);
  });

  it('down — контейнеры и сеть; том остаётся; down -v — и том', () => {
    const sh = project({ '/home/shop/shop/compose.yaml': COMPOSE });
    run(sh, 'docker compose up -d');
    assert.equal(run(sh, 'docker compose down').err, [' Container shop-web-1 Stopping ', ' Container shop-web-1 Stopped ', ' Container shop-web-1 Removing ',
      ' Container shop-web-1 Removed ', ' Container shop-db-1 Stopping ', ' Container shop-db-1 Stopped ', ' Container shop-db-1 Removing ',
      ' Container shop-db-1 Removed ', ' Network shop_default Removing ', ' Network shop_default Removed ', ''].join('\n'));
    assert.equal(run(sh, 'docker volume ls --filter label=com.docker.compose.project=shop').out, 'DRIVER    VOLUME NAME\nlocal     shop_pgdata\n');
    assert.equal(run(sh, 'docker compose down -v').err, ' Volume shop_pgdata Removing \n Volume shop_pgdata Removed \n');
  });

  it('depends_on без healthcheck — web падает на неготовой базе; с healthcheck — ждёт', () => {
    const sh = shell(SETUP_CHECK);
    const up = run(sh, 'docker compose up');
    assert.match(up.out, /^Attaching to db-1, web-1\n/);
    assert.match(up.out, /web-1 {2}\| psycopg\.OperationalError: connection failed: connection to server at "172\.18\.0\.2", port 5432 failed: Connection refused\n/);
    assert.match(up.out, /web-1 {2}\| \tIs the server running on that host/);
    assert.match(up.out, /web-1 exited with code 1\n/);
    run(sh, 'docker compose down -v');
    run(sh, 'docker compose -f compose2.yaml up -d');
    assert.match(run(sh, 'docker compose -f compose2.yaml ps -a').out, /\(healthy\)[\s\S]*Exited \(0\)/);
    assert.equal(run(sh, "docker inspect --format '{{.State.Health.Status}}' shop-db-1").out, 'healthy\n');
    assert.equal(run(sh, 'docker compose -f compose2.yaml logs web').out, 'web-1  | база доступна\n');
  });

  it('.env, env_file, предупреждения, ошибки файла, override и профиль', () => {
    const sh = project({
      '/home/shop/shop/db.env': 'POSTGRES_PASSWORD="s3cr3t"\nPOSTGRES_DB=shop\n',
      '/home/shop/shop/.env': 'WEB_PORT=58000\nTAG=1.4.2\n',
      '/home/shop/shop/compose.yaml': 'services:\n  db:\n    image: postgres:16\n    env_file: db.env\n  web:\n    build: .\n    image: shop-web:${TAG}\n    ports:\n      - "${WEB_PORT}:8000"\n  tools:\n    image: alpine:3\n    command: ["sleep", "3600"]\n    profiles: ["tools"]\n',
      '/home/shop/shop/compose.override.yaml': 'services:\n  web:\n    command: ["gunicorn", "--bind", "0.0.0.0:8000", "--reload", "shop.wsgi"]\n    volumes:\n      - ./shop:/app/shop\n',
      '/home/shop/shop/bad.yaml': 'services:\n  web:\n    image: nginx\n     ports:\n      - "80:80"\n',
      '/home/shop/shop/bad2.yaml': 'services:\n  web:\n    image: nginx\n    ports: "58000:80"\n',
    });
    const config = run(sh, 'docker compose config').out;
    assert.match(config, /POSTGRES_PASSWORD: s3cr3t\n/);
    assert.match(config, /image: shop-web:1\.4\.2\n/);
    assert.match(config, /  web:\n    command:\n      - gunicorn\n      - --bind\n      - 0\.0\.0\.0:8000\n      - --reload\n      - shop\.wsgi\n/);
    assert.doesNotMatch(config, /tools/);
    assert.doesNotMatch(run(sh, 'docker compose -f compose.yaml config').out, /--reload/);
    assert.equal(run(sh, 'docker compose --env-file /dev/null config').err, 'WARN[0000] The "TAG" variable is not set. Defaulting to a blank string. \nWARN[0000] The "WEB_PORT" variable is not set. Defaulting to a blank string. \n');
    assert.equal(run(sh, 'docker compose -f bad.yaml config').err, 'yaml: line 4: mapping values are not allowed in this context\n');
    assert.equal(run(sh, 'docker compose -f bad2.yaml config').err, 'validating /home/shop/shop/bad2.yaml: services.web.ports must be a array\n');
    run(sh, 'docker compose up -d --build');
    run(sh, "sed -i 's/Магазин работает/Магазин работает — новая версия/' shop/wsgi.py");
    assert.equal(run(sh, 'curl -s localhost:58000').out, 'Магазин работает — новая версия\n');
    assert.match(run(sh, 'docker compose logs web').out, /Worker reloading: \/app\/shop\/wsgi\.py modified/);
    assert.match(run(sh, 'docker compose --profile tools up -d').err, / Container shop-web-1 Running \n[\s\S]* Container shop-tools-1 Started /);
  });

  it('стек: nginx → Django, 500 до миграций, run --rm migrate, статика из тома, restart после kill 1', () => {
    const sh = shell(SETUP_STACK);
    assert.equal(run(sh, 'docker compose up -d --build').code, 0);
    assert.equal(run(sh, "curl -s -o /dev/null -w '%{http_code}\\n' localhost:58080/").out, '500\n');
    const migrate = run(sh, 'docker compose run --rm web python manage.py migrate');
    assert.match(migrate.err, /^ Container shop-db-1 Running \n Container shop-db-1 Waiting \n Container shop-db-1 Healthy \n Container shop-web-run-[0-9a-f]{12} Creating \n/);
    assert.match(migrate.out, /^Operations to perform:\n  Apply all migrations: admin, auth, contenttypes, sessions\nRunning migrations:\n  Applying contenttypes\.0001_initial\.\.\. OK\n/);
    assert.equal(run(sh, 'curl -s localhost:58080/').out, 'Магазин работает, пользователей: 0\n');
    assert.match(run(sh, 'curl -sI localhost:58080/static/admin/css/base.css').out, /^HTTP\/1\.1 200 OK\nServer: nginx\/1\.27\.5\nDate: [^\n]+\nContent-Type: text\/css\nContent-Length: 22120\nLast-Modified: /);
    run(sh, 'docker compose exec web sh -c "kill 1"');
    assert.equal(run(sh, "docker inspect -f '{{.RestartCount}}' shop-web-1").out, '1\n');
    assert.match(run(sh, 'docker compose ps').out, /shop-web-1 .* Up /);
    assert.equal(run(sh, 'docker compose stop web').err, ' Container shop-web-1 Stopping \n Container shop-web-1 Stopped \n');
    assert.equal(run(sh, "curl -s -o /dev/null -w '%{http_code}\\n' localhost:58080/").out, '502\n');
    assert.equal(firstFailedRule([{ docker: 'compose', service: 'web', fail: 'web' }], sh).fail, 'web');
    assert.equal(firstFailedRule([{ docker: 'compose', service: 'nginx', project: 'shop', fail: 'nginx' }], sh), null);
  });

  it('DB_HOST=localhost — connection refused (localhost внутри контейнера — он сам)', () => {
    const setup = structuredClone(SETUP_STACK);
    setup.files['/home/shop/shop/config/settings.py'] = setup.files['/home/shop/shop/config/settings.py'].replace('"db")', '"localhost")');
    const sh = shell(setup);
    run(sh, 'docker compose up -d --build');
    const migrate = run(sh, 'docker compose run --rm web python manage.py migrate');
    assert.equal(migrate.code, 1);
    assert.match(migrate.err, /django\.db\.utils\.OperationalError: connection failed: connection to server at "127\.0\.0\.1", port 5432 failed: Connection refused\n/);
  });
});
