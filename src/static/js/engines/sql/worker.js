// Web Worker с PostgreSQL (PGlite): запросы ученика выполняются здесь, а не на странице.
// Тяжёлый запрос (или бесконечный рекурсивный WITH) не замораживает интерфейс —
// страница просто перезапустит воркер. statement_timeout в PGlite не работает.
//
// Сообщения от страницы: { id, action, ...данные } → { id, ok: true, result } или { id, ok: false, error }
// После загрузки:        { type: 'ready', restored } или { type: 'failed', error }
//
// База песочницы хранится в IndexedDB (dataDir = 'idb://…'): переживает перезагрузку.
// Без dataDir — в памяти (страницы задач: база всё равно создаётся заново на каждую проверку).

import { checkSolution } from './checker.js';
import { hasTables, prepareSession, resetDatabase, runScript, schemaOverview, snapshotTables, textParsers } from './session.js';

const params = new URL(self.location.href).searchParams;
const PGLITE_URL = params.get('pglite');     // dist/index.js пакета на CDN
const DATA_DIR = params.get('datadir');      // 'idb://…' или пусто

let db = null;
let parsers = null;
let base = '';
const reference = new Map();     // эталоны задач: считаются один раз на страницу

async function open(dataDir) {
  const { PGlite } = await import(PGLITE_URL);
  const instance = new PGlite(dataDir || undefined);
  await instance.waitReady;
  return instance;
}

async function boot() {
  try {
    db = await open(DATA_DIR);
  } catch (error) {
    // IndexedDB недоступна (приватное окно, запрет сайта) — работаем в памяти
    if (!DATA_DIR) throw error;
    console.warn(error);
    db = await open(null);
  }
  parsers = await textParsers(db);
  await prepareSession(db);
}

const actions = {
  /** Учебные данные; в пустую базу — загрузить. restored: true — база песочницы уже была. */
  async load({ sql }) {
    base = sql;
    if (await hasTables(db)) return { restored: true };
    await resetDatabase(db, base);
    return { restored: false };
  },
  /** Сбросить к учебным данным (+ setup задачи). */
  async reset({ setup = '' } = {}) {
    await resetDatabase(db, `${base}\n${setup}`);
    return {};
  },
  run: ({ sql }) => runScript(db, parsers, sql),
  /** Задача: каждый запуск — на свежей базе (учебные данные + setup). */
  async runFresh({ sql, setup = '' }) {
    await resetDatabase(db, `${base}\n${setup}`);
    return runScript(db, parsers, sql);
  },
  check: ({ task, code }) => checkSolution(db, parsers, base, task, code, reference),
  schema: () => schemaOverview(db),
  tables: ({ names = null } = {}) => snapshotTables(db, parsers, names),
};

const ready = boot().then(
  () => self.postMessage({ type: 'ready' }),
  (error) => self.postMessage({ type: 'failed', error: String(error) }),
);

// Запросы выполняются строго по очереди: следующий ждёт конца предыдущего
let queue = ready;

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      self.postMessage({ id: data.id, ok: true, result: await actions[data.action](data) });
    } catch (error) {
      self.postMessage({ id: data.id, ok: false, error: String(error?.message ?? error) });
    }
  });
};
