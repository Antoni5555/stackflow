// Часы симулятора — одно «сейчас» для date, ls -l, touch, find -mtime, журналов и git.
// Задача может задать начало (setup.now: "2026-11-23 03:00", время Москвы), дальше часы
// идут как настоящие. Без setup.now — настоящее время. Время показываем по Москве (MSK,
// UTC+3 без перехода на летнее), как на нашем сервере, — независимо от пояса браузера.

export const MSK_OFFSET = 3 * 3600 * 1000;

let shift = 0;

/** Текущее время симулятора, мс. */
export const now = () => Date.now() + shift;

/** «2026-11-23 03:00[:00]» (MSK) → мс; null — не дата. */
export function parseNow(text) {
  const match = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?$/.exec(String(text).trim());
  if (!match) return null;
  const [, y, mo, d, h = 0, mi = 0, s = 0] = match.map((part) => (part === undefined ? undefined : Number(part)));
  return Date.UTC(y, mo - 1, d, h, mi, s) - MSK_OFFSET;
}

/** Поставить часы: start — строка setup.now или null (настоящее время). */
export function setClock(start) {
  const ms = start == null ? null : parseNow(start);
  shift = ms === null ? 0 : ms - Date.now();
}

/** Дата, у которой getUTC*() дают московское время. */
export const mskDate = (ms) => new Date(ms + MSK_OFFSET);
