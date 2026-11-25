// Вывод как у docker CLI: таблицы (text/tabwriter, отступ 3), «16 seconds ago», «642MB».

/**
 * Таблица как text/tabwriter docker CLI: колонка = самая длинная ячейка + 3 пробела, но не уже
 * minWidth (у ps, volume ls, network ls — 10). right — колонки с выравниванием вправо;
 * padLast — дополнять ли последнюю колонку пробелами (так у docker images).
 */
export function table(head, rows, { right = [], minWidth = 10, widths: fixed = {}, padLast = false } = {}) {
  const all = [head, ...rows];
  const widths = head.map((_, k) => Math.max(fixed[k] ?? 0, ...all.map((row) => row[k].length)));
  const line = (row) => row.map((cell, k) => {
    const text = right.includes(k) ? cell.padStart(widths[k]) : cell.padEnd(widths[k]);
    if (k === row.length - 1) return padLast ? text : text.trimEnd();
    return text.padEnd(Math.max(widths[k] + 3, minWidth));
  }).join('');
  return `${all.map((row) => line(row)).join('\n')}\n`;
}

/** go-units HumanDuration: «Less than a second», «About a minute», «3 hours», «2 weeks». */
export function humanDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 1) return 'Less than a second';
  if (seconds === 1) return '1 second';
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(ms / 60000);
  if (minutes === 1) return 'About a minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(ms / 3600000 + 0.5);
  if (hours === 1) return 'About an hour';
  if (hours < 48) return `${hours} hours`;
  if (hours < 24 * 7 * 2) return `${Math.floor(hours / 24)} days`;
  if (hours < 24 * 30 * 2) return `${Math.floor(hours / 24 / 7)} weeks`;
  if (hours < 24 * 365 * 2) return `${Math.floor(hours / 24 / 30)} months`;
  return `${Math.floor(hours / 24 / 365)} years`;
}

/**
 * go-units HumanSize: десятичные единицы. precision — значащие цифры: 3 у images и history
 * («642MB», «8.19kB»), 4 у prune и system df («4.096kB», «6.828GB»).
 */
export function humanSize(bytes, precision = 3) {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${Number(value.toPrecision(precision))}${units[unit]}`;
}

/** «642MB», «1.62GB», «45.5MB» → байты (размеры образов в каталоге и setup). */
export function parseHumanSize(text) {
  const match = /^([\d.]+)\s*(B|kB|KB|MB|GB)$/i.exec(String(text).trim());
  if (!match) throw new Error(`Неверный размер: ${text}`);
  const power = { b: 0, kb: 1, mb: 2, gb: 3 }[match[2].toLowerCase()];
  return Math.round(Number(match[1]) * 1000 ** power);
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** Время UTC (часовой пояс контейнеров) — части для логов. */
export function utcParts(ms) {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(), month: pad(d.getUTCMonth() + 1), day: pad(d.getUTCDate()),
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
    millis: pad(d.getUTCMilliseconds(), 3),
    monthName: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()],
  };
}

/** RFC 3339 с наносекундами, как в docker inspect: 2026-11-23T17:33:57.271294366Z. */
export function isoNano(ms) {
  return new Date(ms).toISOString().replace(/\.(\d{3})Z$/, (_, millis) => `.${millis}${String(ms % 997).padStart(3, '0')}${String(ms % 991).padStart(3, '0')}Z`);
}

/** Время по Москве с зоной — CreatedAt тома: 2026-11-23T20:34:18+03:00. */
export function localIso(ms) {
  const d = new Date(ms + 3 * 3600 * 1000);
  return `${d.toISOString().slice(0, 19)}+03:00`;
}
