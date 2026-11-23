// Учебная сеть Linux-симулятора: ss, curl, ping, hostname; ssh и scp — только теория.
// Сервер без выхода в интернет: отвечает только он сам (localhost, 127.0.0.1, server).
// Кто слушает порт — процессы из engines/linux/system.js (поле listen). curl к nginx
// идёт по его конфигам: proxy_pass — к gunicorn (не запущен — 502), иначе файлы из
// root/alias с правами www-data (403, 404); каждый запрос — строка в access.log.

import { FsError, normalize } from './fs.js';
import { parseAddress, systemState } from './system.js';

const ok = (out = '') => ({ out, err: '', code: 0 });
const fail = (err, code = 1) => ({ out: '', err, code });

const HOST = 'server';
const SERVER_IP = '10.0.0.5';
const LOCAL = new Map([
  ['localhost', '127.0.0.1'], ['127.0.0.1', '127.0.0.1'], ['0.0.0.0', '127.0.0.1'],
  [HOST, SERVER_IP], [SERVER_IP, SERVER_IP], ['[::1]', '::1'], ['::1', '::1'],
]);
const NGINX = 'nginx/1.24.0 (Ubuntu)';
const SERVICES = { 22: 'ssh', 53: 'domain', 80: 'http', 443: 'https', 5432: 'postgresql', 6379: 'redis', 8000: 'irdmi' };
const BACKLOG = { nginx: 511, gunicorn: 2048, postgres: 200, 'redis-server': 511, sshd: 4096, 'systemd-resolve': 4096, python3: 10 };

const pad = (n) => String(n).padStart(2, '0');

// --- ss ---

export const ss = {
  help: `ss — сетевые соединения и порты.
  ss -tlnp   какие программы слушают TCP-порты (t — TCP, l — слушают, n — числа, p — процессы)
  ss -tuln   TCP и UDP
Процессы чужих пользователей видно только с sudo.`,
  run(ctx) {
    const flags = ctx.args.filter((arg) => arg.startsWith('-')).join('').replace(/-/g, '');
    const want = {
      tcp: flags.includes('t') || !flags.includes('u'),
      udp: flags.includes('u'),
      listening: flags.includes('l') || flags.includes('a'),
      numeric: flags.includes('n'),
      processes: flags.includes('p'),
    };
    const state = systemState(ctx.fs);
    const rows = [];
    // UDP 53 — только systemd-resolved; TCP — все, у кого есть listen
    for (const proc of state.procs.filter((item) => item.listen?.length)) {
      for (const address of proc.listen) {
        const parsed = parseAddress(address);
        if (parsed.unix) continue;
        const udp = proc.comm === 'systemd-resolve';
        if (udp && want.udp) rows.push({ proto: 'udp', state: 'UNCONN', parsed, proc });
        if (want.tcp) rows.push({ proto: 'tcp', state: 'LISTEN', parsed, proc });
      }
    }
    const visible = want.listening ? rows : [];
    const host = (h) => {
      if (h === '[::]') return '*';
      if (want.numeric) return h === '127.0.0.53' ? '127.0.0.53%lo' : h;
      return { '127.0.0.1': 'localhost', '127.0.0.53': '127.0.0.53%lo' }[h] ?? h;
    };
    const port = (p) => (want.numeric ? String(p) : SERVICES[p] ?? String(p));
    const sharing = (proc) => state.procs.filter((item) => item.unit && item.unit === proc.unit
      && (item.listen || item.worker));
    const users = (proc) => {
      if (!want.processes) return '';
      if (ctx.fs.user !== 'root' && proc.user !== ctx.fs.user) return '';
      const owners = proc.unit ? sharing(proc).reverse() : [proc];
      return `users:(${owners.map((item) => `("${item.comm}",pid=${item.pid},fd=${proc.comm === 'nginx' ? 6 : 5})`).join(',')})`;
    };
    const table = visible
      .sort((a, b) => a.parsed.port - b.parsed.port || a.parsed.host.localeCompare(b.parsed.host))
      .map(({ proto, state: st, parsed, proc }) => [
        ...(want.udp ? [proto] : []), st, '0', String(BACKLOG[proc.comm] ?? 128),
        `${host(parsed.host)}:${port(parsed.port)}`, parsed.host === '[::]' ? '*:*' : '0.0.0.0:*', users(proc),
      ]);
    const head = [...(want.udp ? ['Netid'] : []), 'State', 'Recv-Q', 'Send-Q', 'Local Address:Port', 'Peer Address:Port', 'Process'];
    const all = [head, ...table];
    const widths = head.map((_, col) => Math.max(...all.map((row) => row[col].length)));
    const local = head.indexOf('Local Address:Port');
    const lines = all.map((row) => row.map((cell, col) => {
      if (col === row.length - 1) return cell;
      return col === local ? cell.padStart(widths[col]) : cell.padEnd(widths[col]);
    }).join(' ').trimEnd());
    return ok(`${lines.join('\n')}\n`);
  },
};

// --- HTTP: кто ответит ---

/** Процесс, который слушает адрес (TCP host:port или unix-сокет), или null. */
function listenerFor(state, target) {
  return state.procs.find((proc) => (proc.listen ?? []).some((address) => {
    const own = parseAddress(address);
    if (target.unix || own.unix) return own.unix === target.unix;
    if (own.port !== target.port) return false;
    const v6 = target.ip === '::1';
    if (own.host === '[::]') return v6 || own.port === 22;
    if (v6) return false;
    return own.host === '0.0.0.0' || own.host === target.ip;
  })) ?? null;
}

const STATUS_TEXT = { 200: 'OK', 301: 'Moved Permanently', 302: 'Found', 403: 'Forbidden', 404: 'Not Found', 502: 'Bad Gateway' };

function nginxPage(code) {
  const title = `${code} ${STATUS_TEXT[code]}`;
  return `<html>\n<head><title>${title}</title></head>\n<body>\n<center><h1>${title}</h1></center>\n<hr><center>${NGINX}</center>\n</body>\n</html>\n`;
}

const httpDate = () => new Date().toUTCString();

/** Ответ Django-приложения (gunicorn или runserver). */
function appResponse(proc, path) {
  const server = proc.comm === 'gunicorn' ? 'gunicorn' : 'WSGIServer/0.2 CPython/3.12.3';
  const headers = (type, length) => [['Server', server], ['Date', httpDate()], ['Content-Type', type], ['Content-Length', String(length)]];
  const redirect = (code, location) => ({
    code, body: '',
    headers: [['Server', server], ['Date', httpDate()], ['Content-Type', 'text/html; charset=utf-8'], ['Location', location], ['Content-Length', '0']],
  });
  // APPEND_SLASH: /admin → /admin/; админка без входа — на страницу входа
  if (path === '/admin') return redirect(301, '/admin/');
  if (path === '/admin/') return redirect(302, '/admin/login/?next=/admin/');
  if (path.startsWith('/admin/login/')) {
    const body = '<!DOCTYPE html>\n<html lang="ru">\n<head><title>Войти | Административный сайт Django</title></head>\n<body><h1>Администрирование Django</h1></body>\n</html>\n';
    return { code: 200, headers: headers('text/html; charset=utf-8', new TextEncoder().encode(body).length), body };
  }
  if (path === '/health/') {
    const body = '{"status": "ok"}';
    return { code: 200, headers: headers('application/json', body.length), body };
  }
  if (path === '/') {
    const body = '<!doctype html>\n<html lang="ru">\n<head><meta charset="utf-8"><title>Магазин</title></head>\n<body><h1>Магазин</h1></body>\n</html>\n';
    return { code: 200, headers: headers('text/html; charset=utf-8', new TextEncoder().encode(body).length), body };
  }
  // Django без DEBUG: статику не раздаёт (это работа nginx), чужие адреса — 404
  const body = '\n<!doctype html>\n<html lang="en">\n<head>\n  <title>Not Found</title>\n</head>\n<body>\n  <h1>Not Found</h1><p>The requested resource was not found on this server.</p>\n</body>\n</html>\n';
  return { code: 404, headers: headers('text/html; charset=utf-8', body.length), body };
}

function nginxLog(fs, file, line) {
  fs.as('root', () => {
    fs.mkdirAs('/var/log/nginx', 'root');
    fs.writeFile(`/var/log/nginx/${file}`, `${line}\n`, { append: true });
  });
}

function logTime(withZone) {
  const d = new Date();
  if (!withZone) return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${pad(d.getDate())}/${months[d.getMonth()]}/${d.getFullYear()}:${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} +0300`;
}

/** Ответ nginx по снимку его конфигов (master.nginx). */
function nginxResponse(fs, state, master, request) {
  const servers = (master.nginx ?? []).filter((server) => server.listen.some((address) => parseAddress(address).port === request.port));
  // как nginx: совпадение server_name важнее default_server, без совпадений — default_server
  // (если его нет — первый сайт на этом порту); Host — без порта
  const host = request.hostHeader ?? request.host;
  const server = servers.find((item) => (item.names ?? []).includes(host))
    ?? servers.find((item) => item.isDefault) ?? servers[0];
  const worker = state.procs.find((proc) => proc.unit === 'nginx' && proc.worker) ?? master;
  const errorLog = (text) => nginxLog(fs, 'error.log', `${logTime(false)} [error] ${worker.pid}#${worker.pid}: *1 ${text}, client: 127.0.0.1, server: ${server?.names?.[0] || '_'}, request: "${request.method} ${request.path} HTTP/1.1", host: "${request.host}"`);
  let response;
  if (!server) {
    response = { code: 404, body: nginxPage(404) };
  } else {
    const location = server.locations
      .filter((item) => request.path.startsWith(item.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (location?.proxy) {
      const upstream = location.proxy.replace(/^http:\/\//, '').replace(/\/$/, '');
      const target = upstream.startsWith('unix:')
        ? { unix: upstream.slice(5).replace(/:$/, '') }
        : { ip: LOCAL.get(parseAddress(upstream).host) ?? parseAddress(upstream).host, port: parseAddress(upstream).port };
      const app = listenerFor(state, target);
      if (!app) {
        const why = target.unix
          ? `connect() to unix:${target.unix} failed (2: No such file or directory)`
          : 'connect() failed (111: Connection refused)';
        errorLog(`${why} while connecting to upstream, upstream: "${location.proxy.replace(/\/$/, '')}${request.path}"`);
        response = { code: 502, body: nginxPage(502) };
      } else {
        const answer = appResponse(app, request.path);
        response = { code: answer.code, body: answer.body, type: answer.headers.find(([name]) => name === 'Content-Type')?.[1], location: answer.headers.find(([name]) => name === 'Location')?.[1] };
      }
    } else {
      // файлы: alias заменяет путь location, root — дописывается спереди
      let file;
      if (location?.alias) file = normalize(location.alias + request.path.slice(location.path.length));
      else file = normalize((location?.root ?? server.root) + request.path);
      if (request.path.endsWith('/')) {
        const index = server.index.map((name) => normalize(name, file))
          .find((path) => fs.as('root', () => fs.exists(path)));
        file = index ?? normalize(server.index[0], file);
      }
      try {
        const body = fs.as('www-data', () => fs.readFile(file));
        response = { code: 200, body, type: file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' };
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        const denied = e.code === 'EACCES';
        errorLog(`open() "${file}" failed (${denied ? '13: Permission denied' : '2: No such file or directory'})`);
        response = { code: denied ? 403 : 404, body: nginxPage(denied ? 403 : 404) };
      }
    }
  }
  const bytes = new TextEncoder().encode(response.body).length;
  nginxLog(fs, 'access.log', `127.0.0.1 - - [${logTime(true)}] "${request.method} ${request.path} HTTP/1.1" ${response.code} ${request.method === 'HEAD' ? 0 : bytes} "-" "curl/8.5.0"`);
  const headers = [
    ['Server', NGINX], ['Date', httpDate()], ['Content-Type', response.type ?? 'text/html'],
    ['Content-Length', String(bytes)], ['Connection', 'keep-alive'],
    ...(response.location ? [['Location', response.location]] : []),
  ];
  return { code: response.code, headers, body: response.body };
}

/** Запрос к адресу: {code, headers, body} или {error: [номер, текст]}. */
function request(fs, target, method, path) {
  const state = systemState(fs);
  const proc = listenerFor(state, target);
  const where = target.unix ? target.unix : `${target.host} port ${target.port}`;
  if (!proc) {
    return { error: target.unix
      ? [7, `Failed to connect to ${target.host} port ${target.port} after 0 ms: Could not connect to server`]
      : [7, `Failed to connect to ${where} after 0 ms: Couldn't connect to server`] };
  }
  if (proc.comm === 'nginx') return nginxResponse(fs, state, proc, { ...target, method, path });
  if (proc.comm === 'gunicorn' || /runserver/.test(proc.cmd)) return appResponse(proc, path);
  if (proc.comm === 'postgres') return { error: [52, 'Empty reply from server'] };
  return { error: [1, 'Received HTTP/0.9 when not allowed'] };
}

// --- curl ---

export const curl = {
  help: `curl адрес — HTTP-запрос (учебный сервер: только он сам, без интернета).
  curl http://localhost/           тело ответа
  curl -I http://localhost/        только заголовки
  curl -i …   заголовки и тело;  -v  подробно;  -s  тихо;  -L  идти по редиректам
  curl -o файл …   сохранить тело в файл;  -w '%{http_code}'  вывести код ответа
  curl --unix-socket /run/gunicorn.sock http://localhost/   через unix-сокет`,
  run(ctx) {
    const opts = { method: 'GET', head: false, include: false, verbose: false, follow: false, fail: false };
    let url = null;
    let output = null;
    let write = null;
    let socket = null;
    let hostHeader = null;
    const args = [...ctx.args];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '-I' || arg === '--head') opts.head = true;
      else if (arg === '-i' || arg === '--include') opts.include = true;
      else if (arg === '-v' || arg === '--verbose') opts.verbose = true;
      else if (arg === '-L' || arg === '--location') opts.follow = true;
      else if (arg === '-f' || arg === '--fail') opts.fail = true;
      else if (arg === '-o' || arg === '--output') output = args[(i += 1)];
      else if (arg === '-w' || arg === '--write-out') write = args[(i += 1)];
      else if (arg === '-X' || arg === '--request') opts.method = (args[(i += 1)] ?? 'GET').toUpperCase();
      else if (arg === '-H' || arg === '--header') {
        // Host: shop.example — для выбора сайта nginx по server_name
        const header = /^\s*host\s*:\s*(\S+)/i.exec(args[(i += 1)] ?? '');
        if (header) hostHeader = header[1].replace(/:\d+$/, '');
      } else if (arg === '-d' || arg === '--data' || arg === '-A') i += 1;
      else if (arg === '--unix-socket') socket = args[(i += 1)];
      else if (/^-[sSfLiIvk]+$/.test(arg)) {
        if (arg.includes('I')) opts.head = true;
        if (arg.includes('i')) opts.include = true;
        if (arg.includes('L')) opts.follow = true;
        if (arg.includes('f')) opts.fail = true;
        if (arg.includes('v')) opts.verbose = true;
      } else if (arg.startsWith('-')) return fail(`curl: option ${arg}: is unknown\ncurl: try 'curl --help' or 'curl --manual' for more information\n`, 2);
      else url = arg;
    }
    if (!url) return fail("curl: try 'curl --help' or 'curl --manual' for more information\n", 2);
    if (opts.head) opts.method = 'HEAD';
    let err = '';
    let out = '';
    let current = url;
    for (let hop = 0; hop < 5; hop += 1) {
      const match = /^(?:(https?):\/\/)?([^/:]+|\[[^\]]+\])(?::(\d+))?(\/.*)?$/.exec(current);
      if (!match) return fail(`curl: (3) URL rejected: Malformed input to a URL function\n`, 3);
      const [, scheme = 'http', host, portText, path = '/'] = match;
      const port = Number(portText ?? (scheme === 'https' ? 443 : 80));
      const ip = LOCAL.get(host);
      if (!socket && !ip) return { out, err: `${err}curl: (6) Could not resolve host: ${host}\n`, code: 6 };
      const target = socket ? { unix: socket, host, port, hostHeader } : { host, ip, port, hostHeader };
      if (opts.verbose) err += `*   Trying ${socket ?? `${ip}:${port}`}...\n`;
      if (scheme === 'https' && !socket) {
        const answer = request(ctx.fs, target, opts.method, path);
        if (answer.error) return { out, err: `${err}curl: (${answer.error[0]}) ${answer.error[1]}\n`, code: answer.error[0] };
        return { out, err: `${err}curl: (35) OpenSSL/3.0.13: error:0A00010B:SSL routines::wrong version number\n`, code: 35 };
      }
      const answer = request(ctx.fs, target, opts.method, path);
      if (answer.error) return { out, err: `${err}curl: (${answer.error[0]}) ${answer.error[1]}\n`, code: answer.error[0] };
      const status = `HTTP/1.1 ${answer.code} ${STATUS_TEXT[answer.code] ?? ''}`.trimEnd();
      const headerText = [status, ...answer.headers.map(([name, value]) => `${name}: ${value}`)].join('\n');
      if (opts.verbose) {
        err += `* Connected to ${host} (${socket ?? ip}) port ${port}\n> ${opts.method} ${path} HTTP/1.1\n> Host: ${host}${port === 80 ? '' : `:${port}`}\n> User-Agent: curl/8.5.0\n> Accept: */*\n>\n`;
        err += `${headerText.split('\n').map((line) => `< ${line}`).join('\n')}\n<\n`;
      }
      const location = answer.headers.find(([name]) => name === 'Location')?.[1];
      if (opts.follow && location && answer.code >= 300 && answer.code < 400) {
        if (opts.include || opts.head) out += `${headerText}\n\n`;
        current = location.startsWith('/') ? `${scheme}://${host}${portText ? `:${portText}` : ''}${location}` : location;
        continue;
      }
      if (opts.fail && answer.code >= 400) {
        return { out, err: `${err}curl: (22) The requested URL returned error: ${answer.code}\n`, code: 22 };
      }
      let body = opts.method === 'HEAD' ? '' : answer.body;
      if (opts.head || opts.include) body = `${headerText}\n\n${body}`;
      if (output) {
        try {
          ctx.fs.writeFile(normalize(output, ctx.sh.cwd), body);
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          return { out, err: `${err}curl: (23) Failure writing output to destination\n`, code: 23 };
        }
      } else {
        out += body;
      }
      if (write) out += write.replace(/%\{http_code\}/g, String(answer.code)).replace(/\\n/g, '\n');
      if (opts.verbose) err += `* Connection #0 to host ${host} left intact\n`;
      return { out, err, code: 0 };
    }
    return { out, err: `${err}curl: (47) Maximum (5) redirects followed\n`, code: 47 };
  },
};

// --- ping, hostname, ssh, scp ---

export const ping = {
  help: `ping -c N адрес — проверить, отвечает ли машина (N пакетов).
Учебный сервер без интернета: отвечает только он сам.`,
  run(ctx) {
    let count = null;
    let host = null;
    for (let i = 0; i < ctx.args.length; i += 1) {
      const arg = ctx.args[i];
      if (arg === '-c') count = Number(ctx.args[(i += 1)]);
      else if (/^-c\d+$/.test(arg)) count = Number(arg.slice(2));
      else if (!arg.startsWith('-')) host = arg;
    }
    if (!host) return fail('ping: usage error: Destination address required\n', 1);
    const note = count === null ? 'ping без -c шёл бы, пока не нажмёте Ctrl+C; в тренажёре — 4 пакета (пишите ping -c 4)\n' : '';
    count ??= 4;
    // в Ubuntu 24.04 localhost — сначала IPv6 (::1): ping идёт по нему
    const ip = host === 'localhost' ? '::1' : LOCAL.get(host) ?? (/^\d+(\.\d+){3}$/.test(host) ? host : null);
    if (!ip) return fail(`ping: ${host}: Temporary failure in name resolution\n`, 2);
    const shown = host === ip ? ip : `${host} (${ip})`;
    const size = ip.includes(':') ? '56 data bytes' : '56(84) bytes of data.';
    let out = `PING ${host} (${ip}) ${size}\n`;
    const reachable = LOCAL.has(host) || [...LOCAL.values()].includes(ip) || ip.startsWith('127.');
    if (reachable) {
      for (let seq = 1; seq <= count; seq += 1) out += `64 bytes from ${shown}: icmp_seq=${seq} ttl=64 time=0.0${30 + seq * 3} ms\n`;
    }
    out += `\n--- ${host} ping statistics ---\n`;
    out += `${count} packets transmitted, ${reachable ? count : 0} received, ${reachable ? 0 : 100}% packet loss, time ${(count - 1) * 1003}ms\n`;
    if (reachable) out += 'rtt min/avg/max/mdev = 0.033/0.041/0.052/0.007 ms\n';
    return { out, err: note, code: reachable ? 0 : 1 };
  },
};

export const hostname = {
  help: 'hostname — имя сервера; hostname -I — его IP-адреса.',
  run: ({ args }) => ok(args.includes('-I') ? `${SERVER_IP}\n` : `${HOST}\n`),
};

const theory = (name) => ({
  help: `${name} — подключение к другому серверу. В тренажёре один сервер, поэтому ${name} разбирается в теории и задачах-вопросах.`,
  run: () => fail(`${name}: в тренажёре нет второго сервера — ${name} разбирается в теории и задачах-вопросах\n`, 255),
});

export const ssh = theory('ssh');
export const scp = theory('scp');
