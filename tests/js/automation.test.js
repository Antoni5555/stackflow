// Раздел «Автоматизация»: часы и date, $(…), test/[ ], if/for, exit, $# $@, find -delete/-exec,
// crontab. Ожидаемые тексты сверены с bash 5.2, GNU coreutils и cron в Ubuntu 24.04 (LC_ALL=C).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VirtualFS } from '../../src/static/js/engines/linux/fs.js';
import { Shell } from '../../src/static/js/engines/linux/shell.js';
import { firstFailedRule, verifyTask } from '../../src/static/js/engines/linux/checker.js';

function shell(setup = {}) {
  return new Shell(VirtualFS.fromSetup(setup), setup.cwd ? { cwd: setup.cwd } : {});
}

function run(sh, line) {
  const { chunks, action } = sh.run(line);
  return {
    out: chunks.filter((c) => !c.err).map((c) => c.text).join(''),
    err: chunks.filter((c) => c.err).map((c) => c.text).join(''),
    all: chunks.map((c) => c.text).join(''),
    code: sh.status,
    action,
  };
}

const BACKUP = {
  cwd: '/srv/shop',
  now: '2026-11-23 03:00',
  dirs: { '/backups': { owner: 'shop' } },
  files: {
    '/srv/shop/media/a.jpg': 'jpg',
    '/backups/media-2026-11-10.tar.gz': { content: 'old', mtime: 13 },
    '/backups/media-2026-11-20.tar.gz': { content: 'new', mtime: 3 },
  },
};

describe('часы симулятора и date', () => {
  it('setup.now — одно «сейчас» для date, ls -l, touch и find -mtime', () => {
    const sh = shell(BACKUP);
    assert.match(run(sh, 'date').out, /^Mon Nov 23 03:00:0\d MSK 2026\n$/);
    assert.equal(run(sh, 'date +%F').out, '2026-11-23\n');
    assert.equal(run(sh, 'date +%Y%m%d_%H%M').out, '20261123_0300\n');
    assert.equal(run(sh, 'date +%d.%m.%Y').out, '23.11.2026\n');
    assert.match(run(sh, 'date +%s').out, /^17953920\d\d\n$/);
    assert.match(run(sh, 'ls -l /backups').out, /Nov 10 03:00 media-2026-11-10\.tar\.gz\n.*Nov 20 03:00 media/);
    run(sh, 'touch new.txt');
    assert.match(run(sh, 'ls -l new.txt').out, / Nov 23 03:00 new\.txt/);
    assert.equal(run(sh, 'find /backups -mtime +7').out, '/backups/media-2026-11-10.tar.gz\n');
    assert.equal(run(sh, 'date x').err, "date: invalid date 'x'\n");
  });
});

describe('$(…) — подстановка вывода команды', () => {
  it('в слове, в кавычках, в присваивании; разбиение по пробелам без кавычек', () => {
    const sh = shell(BACKUP);
    run(sh, 'NAME="media-$(date +%F).tar.gz"');
    assert.equal(run(sh, 'echo $NAME').out, 'media-2026-11-23.tar.gz\n');
    run(sh, 'tar -czf /backups/$NAME media');
    assert.ok(sh.fs.exists('/backups/media-2026-11-23.tar.gz'));
    assert.equal(run(sh, 'x=$(echo a   b); echo "$x"; echo $x').out, 'a b\na b\n');
    assert.equal(run(sh, 'echo "files: $(ls /backups | wc -l)"').out, 'files: 3\n');
    assert.equal(run(sh, 'cd $(dirname /srv/shop/media/a.jpg) && pwd').out, '/srv/shop/media\n');
    assert.equal(run(sh, 'echo `echo bq`').out, 'bq\n');
    const failed = run(sh, 'f=$(ls nope); echo "s=$?"');
    assert.deepEqual([failed.err, failed.out], ["ls: cannot access 'nope': No such file or directory\n", 's=2\n']);
    assert.equal(run(sh, 'echo $(echo a').err, "bash: unexpected EOF while looking for matching `)'\n");
  });

  it('dirname и basename', () => {
    const sh = shell();
    assert.equal(run(sh, 'dirname a/b/ /a //a/b/ x').out, 'a\n/\n//a\n.\n');
    assert.equal(run(sh, 'basename /backups/media.tar.gz .tar.gz').out, 'media\n');
  });
});

describe('test и [ ]', () => {
  it('проверки файлов, строк и чисел', () => {
    const sh = shell(BACKUP);
    const code = (line) => run(sh, line).code;
    assert.equal(code('[ -d /backups ]'), 0);
    assert.equal(code('[ -f /backups ]'), 1);
    assert.equal(code('[ -e media/a.jpg ] && [ -s media/a.jpg ]'), 0);
    assert.equal(code('[ ! -d /nope ]'), 0);
    assert.equal(code('[ -w /etc ]'), 1);
    assert.equal(code('[ -z "" ] && [ -n x ]'), 0);
    assert.equal(code('[ abc = abc ] && [ a != b ]'), 0);
    assert.equal(code('[ 3 -lt 10 ] && [ 10 -ge 10 ]'), 0);
    assert.equal(code('test 1 -eq 1 -a 2 -eq 2'), 0);
    assert.equal(code('[ ]'), 1);
    assert.equal(code('[ "--help" = x ]'), 1);
  });

  it('ошибки дословно, как в bash', () => {
    const sh = shell();
    const err = (line) => run(sh, line).err;
    assert.equal(err('[ -f x'), "bash: [: missing `]'\n");
    assert.equal(err('[-f x]'), '[-f: command not found\n');
    assert.equal(err('x="a b"; [ $x = c ]'), 'bash: [: too many arguments\n');
    assert.equal(err('[ 1 -eq a ]'), 'bash: [: a: integer expression expected\n');
    assert.equal(err('[ a b ]'), 'bash: [: a: unary operator expected\n');
    assert.equal(err('[ a b c ]'), 'bash: [: b: binary operator expected\n');
    assert.equal(err('test a b'), 'bash: test: a: unary operator expected\n');
    assert.equal(sh.status, 2);
  });
});

describe('if и for', () => {
  it('одной строкой в терминале', () => {
    const sh = shell(BACKUP);
    assert.equal(run(sh, 'if [ -d /backups ]; then echo yes; else echo no; fi').out, 'yes\n');
    assert.equal(run(sh, 'if [ -f /x ]; then echo 1; elif [ -d /tmp ]; then echo 2; fi').out, '2\n');
    assert.equal(run(sh, 'if ! false; then echo neg; fi').out, 'neg\n');
    assert.equal(run(sh, 'for f in /backups/*.gz; do echo "[$f]"; done').out,
      '[/backups/media-2026-11-10.tar.gz]\n[/backups/media-2026-11-20.tar.gz]\n');
    assert.equal(run(sh, 'for f in *.zz; do echo "[$f]"; done').out, '[*.zz]\n');
    assert.equal(run(sh, 'for i in 1 2 3; do echo $i; done | wc -l').out, '3\n');
    run(sh, 'if true; then echo y; fi > o.txt');
    assert.equal(run(sh, 'cat o.txt').out, 'y\n');
    assert.equal(run(sh, 'for x in; do echo $x; done; echo ok').out, 'ok\n');
  });

  it('синтаксические ошибки как в bash', () => {
    const sh = shell();
    const err = (line) => run(sh, line).err;
    assert.equal(err('echo a; fi'), "bash: syntax error near unexpected token `fi'\n");
    assert.equal(err('if then fi'), "bash: syntax error near unexpected token `then'\n");
    assert.equal(err('if true; then fi'), "bash: syntax error near unexpected token `fi'\n");
    assert.equal(err('if true then echo x; fi'), "bash: syntax error near unexpected token `fi'\n");
    assert.equal(err('echo a )'), "bash: syntax error near unexpected token `)'\n");
    assert.equal(err('if true; then echo x'), 'bash: syntax error: unexpected end of file\n');
    assert.equal(err('for 1 in a; do :; done'), "bash: `1': not a valid identifier\n");
  });

  it('скрипт: многострочные if/for, строки до ошибки выполняются, line N', () => {
    const sh = shell({
      files: {
        '/home/shop/s1.sh': { content: 'echo one\nif true; then\n  echo two\nfi\nfi\necho three\n', mode: '755' },
        '/home/shop/s2.sh': { content: 'echo one\nif true; then\n  echo two\n\necho x\n', mode: '755' },
      },
    });
    assert.equal(run(sh, './s1.sh').all, "one\ntwo\n./s1.sh: line 5: syntax error near unexpected token `fi'\n./s1.sh: line 5: `fi'\n");
    assert.equal(sh.status, 2);
    assert.equal(run(sh, 'bash s2.sh').all, 'one\ns2.sh: line 6: syntax error: unexpected end of file\n');
  });

  it('скрипт бэкапа целиком', () => {
    const script = [
      '#!/bin/bash',
      'SRC=/srv/shop/media',
      'DEST=/backups',
      'NAME="media-$(date +%F).tar.gz"',
      'if [ ! -d "$DEST" ]; then',
      '  echo "нет папки $DEST"',
      '  exit 1',
      'fi',
      'tar -czf "$DEST/$NAME" -C /srv/shop media',
      'find "$DEST" -name "media-*.tar.gz" -mtime +7 -delete',
      'for f in $DEST/*.tar.gz; do',
      '  echo "есть: $(basename $f)"',
      'done',
    ].join('\n');
    const sh = shell({ ...BACKUP, files: { ...BACKUP.files, '/srv/shop/bin/backup.sh': { content: `${script}\n`, mode: '755' } } });
    assert.equal(run(sh, 'bin/backup.sh').out, 'есть: media-2026-11-20.tar.gz\nесть: media-2026-11-23.tar.gz\n');
    assert.equal(sh.status, 0);
    run(sh, 'sudo rm -r /backups');
    assert.equal(run(sh, 'bin/backup.sh').out, 'нет папки /backups\n');
    assert.equal(sh.status, 1);
  });
});

describe('exit, $#, $@, ( … )', () => {
  it('exit N в скрипте, $# и "$@"', () => {
    const sh = shell({
      files: { '/home/shop/s.sh': { content: 'echo "args=$# first=$1"\nfor a in "$@"; do echo "<$a>"; done\nfor a in $@; do echo "[$a]"; done\nfoo\nexit 3\necho never\n', mode: '755' } },
    });
    assert.equal(run(sh, "./s.sh 'a b' c").all,
      'args=2 first=a b\n<a b>\n<c>\n[a]\n[b]\n[c]\n./s.sh: line 4: foo: command not found\n');
    assert.equal(sh.status, 3);
  });

  it('exit в терминале, ( … ), коды exit', () => {
    const sh = shell();
    assert.equal(run(sh, 'echo a; (echo b; exit 4; echo c); echo $?').out, 'a\nb\n4\n');
    assert.equal(run(sh, 'exit 300').code, 44);
    assert.equal(run(sh, 'exit abc').err, 'bash: exit: abc: numeric argument required\n');
    assert.equal(sh.status, 2);
    assert.match(run(sh, 'exit 0').out, /^exit\n/);
  });
});

describe('>&2 и sed a/i/c с \n — сообщения об ошибках в скриптах', () => {
  it('>&2 и 1>&2 пишут в поток ошибок, слева направо, как bash', () => {
    const sh = shell({ files: { '/home/shop/s.sh': { content: '#!/bin/bash\necho one >&2\necho two\n', mode: '755' } } });
    assert.deepEqual(run(sh, 'echo x >&2'), { out: '', err: 'x\n', all: 'x\n', code: 0, action: null });
    assert.equal(run(sh, './s.sh').all, 'one\ntwo\n');
    assert.equal(run(sh, './s.sh 2>/dev/null').all, 'two\n');
    run(sh, './s.sh > out.txt');
    assert.equal(run(sh, 'cat out.txt').out, 'two\n');
    assert.equal(run(sh, 'echo x >&2 2>/dev/null').err, 'x\n');        // >&2 взял экран до 2>
    assert.equal(run(sh, 'echo y 2>/dev/null >&2').all, '');
    assert.deepEqual([run(sh, 'echo z 1>&2 | wc -c').out, run(sh, 'echo z 1>&2 | wc -c').err], ['0\n', 'z\n']);
    assert.equal(run(sh, '(echo w >&2) 2>&1 | wc -c').out, '2\n');
    assert.equal(run(sh, 'echo u 2>&1 >&2').out, 'u\n');        // после 2>&1 поток 2 — это вывод
    run(sh, 'echo v >&2 > o.txt');
    assert.equal(run(sh, 'cat o.txt').out, 'v\n');
  });

  it('sed a/i/c: \\n — перевод строки, \\t, \\&, a\\ с пробелами, -e a\\ -e текст', () => {
    const sh = shell({ files: { '/home/shop/f': '1\n2\n' } });
    const out = (line) => run(sh, line).out;
    assert.equal(out("sed '1a if [ -z \"$1\" ]; then\\n    exit 1\\nfi' f"), '1\nif [ -z "$1" ]; then\n    exit 1\nfi\n2\n');
    assert.equal(out("sed '1a a\\tb\\&c\\\\d\\qe' f"), '1\na\tb&c\\dqe\n2\n');
    assert.equal(out("sed '1i\\   lead' f"), '   lead\n1\n2\n');
    assert.equal(out("sed '1c x\\ny' f"), 'x\ny\n2\n');
    assert.equal(out("sed '1a\\' f"), '1\n2\n');
    assert.equal(out("sed -e '1a\\' -e 'foo' f"), '1\nfoo\n2\n');
    assert.equal(run(sh, "sed a f").err, "sed: -e expression #1, char 1: expected \\ after `a', `c' or `i'\n");
    run(sh, "sed -i '1a if [ -z \"$1\" ]; then\\n    exit 1\\nfi' f");
    assert.equal(out('cat f'), '1\nif [ -z "$1" ]; then\n    exit 1\nfi\n2\n');
  });
});

describe('tar -C при создании архива', () => {
  it('файлы — от папки -C, архив — от текущей, пути в архиве — от -C', () => {
    const sh = shell({ cwd: '/home/shop', files: { '/srv/shop/static/css/main.css': 'body{}\n' } });
    const made = run(sh, 'tar -czvf /home/shop/a.tgz -C /srv/shop static');
    assert.deepEqual([made.out, made.err, made.code], ['static/\nstatic/css/\nstatic/css/main.css\n', '', 0]);
    assert.equal(run(sh, 'tar -tzf a.tgz').out, 'static/\nstatic/css/\nstatic/css/main.css\n');
    assert.equal(run(sh, 'tar -czf b.tgz -C /nope static').err,
      'tar: /nope: Cannot open: No such file or directory\ntar: Error is not recoverable: exiting now\n');
    assert.ok(sh.fs.exists('/home/shop/b.tgz'));        // GNU tar успевает создать файл архива
    assert.equal(run(sh, 'tar -czf c.tgz -C /srv/shop nope').err,
      'tar: nope: Cannot stat: No such file or directory\ntar: Exiting with failure status due to previous errors\n');
    run(sh, 'mkdir out && tar -xzf a.tgz -C out');
    assert.equal(run(sh, 'cat out/static/css/main.css').out, 'body{}\n');
  });
});

describe('find -delete и -exec', () => {
  it('удаление старых бэкапов, -exec … \\; и {} +', () => {
    const sh = shell(BACKUP);
    assert.equal(run(sh, "find /backups -name '*.tar.gz' -mtime +7 -exec echo rm {} \\;").out,
      'rm /backups/media-2026-11-10.tar.gz\n');
    assert.equal(run(sh, "find /backups -name '*.gz' -exec echo X {} +").out,
      'X /backups/media-2026-11-10.tar.gz /backups/media-2026-11-20.tar.gz\n');
    run(sh, "find /backups -name '*.tar.gz' -type f -mtime +7 -delete");
    assert.equal(run(sh, 'ls /backups').out, 'media-2026-11-20.tar.gz\n');
    run(sh, 'mkdir -p d/e && touch d/e/c');
    assert.equal(run(sh, 'find . -name d -delete').err, 'find: cannot delete ‘./d’: Directory not empty\n');
    assert.equal(run(sh, 'find . -exec').err, "find: missing argument to `-exec'\n");
  });
});

describe('crontab', () => {
  const RULE = { crontab: 'shop', matches: '^0 3 \\* \\* \\* /srv/shop/bin/backup\\.sh$', fail: 'Нет строки бэкапа.' };

  /** crontab -e → «записать в nano и выйти» → вывод после выхода. */
  function edit(sh, text) {
    const { action } = sh.run('crontab -e');
    sh.fs.as('root', () => sh.fs.writeFile(action.path, text));
    return action.onClose().map((c) => c.text).join('');
  }

  it('-l, -r, чужой crontab, хранение недоступно ученику', () => {
    const sh = shell({ crontab: { 'www-data': '*/5 * * * * echo hi' } });
    assert.deepEqual([run(sh, 'crontab -l').err, sh.status], ['no crontab for shop\n', 1]);
    assert.equal(run(sh, 'crontab -r').err, 'no crontab for shop\n');
    assert.equal(run(sh, 'cat /var/spool/cron/crontabs/www-data').err,
      'cat: /var/spool/cron/crontabs/www-data: Permission denied\n');
    assert.equal(run(sh, 'crontab -u www-data -l').err, 'must be privileged to use -u\n');
    assert.equal(run(sh, 'sudo crontab -u www-data -l').out, '*/5 * * * * echo hi\n');
    assert.match(run(sh, 'crontab').err, /^crontab: usage error: file name must be specified for replace\n/);
  });

  it('-e: шаблон в первый раз, проверка строк, установка', () => {
    const sh = shell();
    const { err, action } = run(sh, 'crontab -e');
    assert.equal(err, 'no crontab for shop - using an empty one\n');
    assert.match(sh.fs.as('root', () => sh.fs.readFile(action.path)), /^# Edit this file to introduce tasks.*# m h {2}dom mon dow {3}command\n$/s);
    assert.equal(action.onClose().map((c) => c.text).join(''), 'crontab: no changes made to crontab\n');
    assert.match(edit(sh, '61 3 * * * x\n'),
      /^crontab: installing new crontab\n"\/tmp\/crontab\.\w+\/crontab":0: bad minute\nerrors in crontab file, can't install\.\n/);
    assert.equal(run(sh, 'crontab -l').code, 1);
    assert.match(edit(sh, '0 3 * * * /srv/shop/bin/backup.sh'), /missing newline before EOF, can't install/);
    assert.equal(edit(sh, '0 3 * * * /srv/shop/bin/backup.sh\n'), 'crontab: installing new crontab\n');
    assert.equal(run(sh, 'crontab -l').out, '0 3 * * * /srv/shop/bin/backup.sh\n');
    assert.equal(firstFailedRule([RULE], sh), null);
  });

  it('crontab ФАЙЛ и crontab - (добавить строку без редактора)', () => {
    const sh = shell({ crontab: { shop: '0 3 * * * /srv/shop/bin/backup.sh\n' } });
    run(sh, '(crontab -l; echo "*/10 * * * * date >> /tmp/d") | crontab -');
    assert.equal(run(sh, 'crontab -l').out, '0 3 * * * /srv/shop/bin/backup.sh\n*/10 * * * * date >> /tmp/d\n');
    run(sh, 'echo "0 25 * * * x" > c.txt');
    assert.equal(run(sh, 'crontab c.txt').err, '"c.txt":0: bad hour\nerrors in crontab file, can\'t install.\n');
    assert.equal(run(sh, 'echo "0 3 * *" | crontab -').err, '"-":1: bad day-of-week\nerrors in crontab file, can\'t install.\n');
    assert.equal(run(sh, 'echo "0 3 * * mon-fri x" | crontab -').code, 0);
    assert.equal(run(sh, 'echo "@daily x" | crontab -').code, 0);
    // как cron 3.0pl1: строки с нуля, комментарии и пустые считаются, только первая ошибка,
    // не хватило полей — номер на 1 больше; строка без команды допустима
    const check = (text) => run(sh, `echo -ne '${text}' | crontab -n -`);
    assert.equal(check('# c\\n0 3 * * * /x\\n60 3 * * * /y\\n').err, '"-":2: bad minute\nerrors in crontab file, can\'t install.\n');
    assert.equal(check('0 3 * * * /x\\n60 3 * * * /y\\n0 99 * * * /z\\n').err, '"-":1: bad minute\nerrors in crontab file, can\'t install.\n');
    assert.equal(check('@foo x\\n').err, '"-":0: bad time specifier\nerrors in crontab file, can\'t install.\n');
    assert.deepEqual([check('0 3 * * *\\n').out, sh.status], ['The syntax of the crontab file was successfully checked.\n', 0]);
    assert.equal(check('0 3 * * 8 x\\n').err, '"-":0: bad day-of-week\nerrors in crontab file, can\'t install.\n');
    assert.equal(run(sh, 'crontab -r; crontab -l').err, 'no crontab for shop\n');
  });

  it('правило crontab и эталон задачи', () => {
    const task = {
      setup: { cwd: '/home/shop' },
      rules: [RULE],
      solution: 'echo "0 3 * * * /srv/shop/bin/backup.sh" | crontab -\n',
    };
    assert.deepEqual(verifyTask(task), []);
    const commented = shell({ crontab: { shop: '# 0 3 * * * /srv/shop/bin/backup.sh\n' } });
    assert.equal(firstFailedRule([RULE], commented), RULE);       // закомментированная — не в счёт
    assert.equal(firstFailedRule([{ crontab: 'shop', exists: false, fail: '-' }], shell()), null);
  });
});
