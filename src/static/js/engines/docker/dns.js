// Адреса в сетях учебного Docker: имя контейнера (встроенный DNS — только в пользовательских
// сетях), IP, localhost внутри контейнера. Без зависимостей от других модулей Docker —
// иначе import зацикливаются (и collectstatic не может дать файлам хеш).

const LOCALHOST = new Set(['localhost', '127.0.0.1', '::1']);

/** Сети с встроенным DNS — все, кроме bridge по умолчанию (и host/none). */
const hasDns = (state, name) => !state.networks[name]?.builtin;

/**
 * Найти адрес host из контейнера self (или с сервера, self = null):
 * {container, ip} — нашли; {self: true} — localhost; null — имя не разрешается.
 */
export function resolve(state, self, host) {
  if (self && LOCALHOST.has(host)) return { container: self, ip: '127.0.0.1', self: true };
  const running = state.containers.filter((c) => c.status === 'running');
  // IP — доступен из любой общей сети (с сервера — любой контейнер на мосту)
  for (const c of running) {
    for (const [name, info] of Object.entries(c.networks)) {
      if (info.ip !== host) continue;
      if (!self || name in self.networks) return { container: c, ip: info.ip };
    }
  }
  if (!self) return null;
  for (const [name] of Object.entries(self.networks).filter(([net]) => hasDns(state, net))) {
    const found = running.find((c) => name in c.networks
      && (c.name === host || c.id.startsWith(host) && host.length >= 12 || (c.networks[name].aliases ?? []).includes(host)));
    if (found) return { container: found, ip: found.networks[name].ip };
  }
  return null;
}

