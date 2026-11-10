// Движок SQL для страницы: запускает PGlite в Web Worker и общается с ним.
// Интерфейс как у движка Python: init(), run(sql), reset(); плюс schema() и tables().
//
// Тайм-аут: если запрос не ответил вовремя, воркер останавливается и запускается
// заново. База песочницы в IndexedDB при этом остаётся — пропадает только
// незавершённая транзакция, как при обрыве соединения с настоящим PostgreSQL.

const RUN_TIMEOUT = 5000;
const CHECK_TIMEOUT = 12000;      // проверка выполняет эталон и решение, каждое — на свежей базе

const TIMEOUT_MESSAGE = 'Запрос выполнялся дольше 5 секунд и был остановлен — '
  + 'возможно, рекурсивный WITH без условия выхода или соединение огромных таблиц. '
  + 'База перезапущена; незавершённая транзакция отменена.';

export class SqlEngine {
  /**
   * @param {object} options — { worker, pglite, base, dataDir? }: адреса из data-атрибутов
   *   страницы, base — учебные данные (schema.sql + seed.sql), dataDir — 'idb://…' для песочницы
   * @param {function} onStatus — 'loading' | 'ready' | 'busy' | 'failed'
   */
  constructor(options, onStatus = () => {}) {
    this.options = options;
    this.onStatus = onStatus;
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.readyPromise = null;
    this.restored = false;
    this.loaded = false;
  }

  init() {
    if (this.readyPromise) return this.readyPromise;
    this.onStatus('loading');

    const url = new URL(this.options.worker, location.href);
    url.searchParams.set('pglite', this.options.pglite);
    if (this.options.dataDir) url.searchParams.set('datadir', this.options.dataDir);
    this.worker = new Worker(url, { type: 'module' });
    this.worker.onmessage = ({ data }) => this.receive(data);

    const booted = new Promise((resolve, reject) => {
      this.boot = { resolve, reject };
    });
    this.readyPromise = booted
      .then(() => this.send('load', { sql: this.options.base ?? '' }, RUN_TIMEOUT * 2))
      .then(({ restored }) => {
        this.restored = restored;
        this.loaded = true;
        this.onStatus('ready');
      })
      .catch((error) => {
        this.onStatus('failed');
        throw error;
      });
    return this.readyPromise;
  }

  receive(data) {
    if (data.type === 'ready') return this.boot.resolve();
    if (data.type === 'failed') return this.boot.reject(new Error(data.error));
    const request = this.pending.get(data.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(data.id);
    if (data.ok) request.resolve(data.result);
    else request.reject(new Error(data.error));
  }

  send(action, data, timeout) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.restart().catch(() => {});
        resolve({ aborted: TIMEOUT_MESSAGE });
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, action, ...data });
    });
  }

  async request(action, data = {}, timeout = RUN_TIMEOUT) {
    await this.init();
    this.onStatus('busy');
    try {
      return await this.send(action, data, timeout);
    } finally {
      if (this.loaded) this.onStatus('ready');
    }
  }

  /**
   * Выполнить текст: массив результатов по запросам (см. session.runScript)
   * или { aborted: 'текст для ученика' } после тайм-аута.
   */
  run(sql) {
    return this.request('run', { sql });
  }

  /** Задача: выполнить текст на свежей базе (учебные данные + setup). */
  runFresh(sql, setup = '') {
    return this.request('runFresh', { sql, setup }, RUN_TIMEOUT * 2);
  }

  /** Проверить решение задачи: { ok, message, error, panel, log } (engines/sql/checker.js). */
  check(task, code) {
    return this.request('check', { task, code }, CHECK_TIMEOUT);
  }

  /** Сбросить базу к учебным данным (+ setup задачи). */
  reset(setup = '') {
    return this.request('reset', { setup }, RUN_TIMEOUT * 2);
  }

  /** Таблицы и ограничения — для полосы «Схема». */
  schema() {
    return this.request('schema');
  }

  /** Таблицы целиком (или только names). */
  tables(names = null) {
    return this.request('tables', { names });
  }

  /** Остановить воркер и запустить заново (после зависания). */
  restart() {
    if (this.worker) this.worker.terminate();
    for (const request of this.pending.values()) clearTimeout(request.timer);
    this.pending.clear();
    this.worker = null;
    this.readyPromise = null;
    this.loaded = false;
    return this.init();
  }
}
