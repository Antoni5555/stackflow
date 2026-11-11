// Движок Python для страницы: запускает Pyodide в Web Worker и общается с ним.
// Интерфейс как у всех движков тренажёров: init(), run(code), check(code, exercise), reset().
//
// Тайм-аут: если программа не ответила вовремя (бесконечный цикл), воркер
// останавливается и запускается заново — Pyodide второй раз берётся из кэша браузера.
// Так же — если Pyodide упал целиком (кончился стек браузера): после такой ошибки
// он не работает, поэтому воркер перезапускается.
// В обоих случаях run() и check() возвращают { aborted: 'текст для ученика' }.

const RUN_TIMEOUT = 2500;      // 2 секунды на программу + запас на передачу данных
const CHECK_TIMEOUT = 8000;    // проверка запускает код несколько раз (тесты с run())

const TIMEOUT_MESSAGE = 'Программа не завершилась за 2 секунды — возможно, бесконечный цикл.';
const CRASH_MESSAGE = 'RecursionError: программа ушла в слишком глубокую рекурсию — '
  + 'возможно, функция или метод вызывает сам себя без конца. Среда Python перезапущена.';

export class PythonEngine {
  /**
   * @param {object} urls — { worker, runner, pyodide, hashSeed?, django?, djangoRunner? }
   *   (из data-атрибутов страницы); django — архив Django: воркер загрузит и его
   * @param {function} onStatus — 'loading' | 'ready' | 'busy' | 'failed'
   */
  constructor(urls, onStatus = () => {}) {
    this.urls = urls;
    this.onStatus = onStatus;
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.readyPromise = null;
  }

  init() {
    if (this.readyPromise) return this.readyPromise;
    this.onStatus('loading');

    const url = new URL(this.urls.worker, location.href);
    url.searchParams.set('pyodide', this.urls.pyodide);
    url.searchParams.set('runner', new URL(this.urls.runner, location.href).href);
    if (this.urls.hashSeed !== undefined) url.searchParams.set('hashseed', this.urls.hashSeed);
    if (this.urls.django) {
      url.searchParams.set('django', new URL(this.urls.django, location.href).href);
      url.searchParams.set('djangorunner', new URL(this.urls.djangoRunner, location.href).href);
    }
    this.worker = new Worker(url, { type: 'module' });

    this.readyPromise = new Promise((resolve, reject) => {
      this.worker.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          this.onStatus('ready');
          resolve();
        } else if (data.type === 'failed') {
          this.onStatus('failed');
          reject(new Error(data.error));
        } else {
          this.finish(data);
        }
      };
    });
    return this.readyPromise;
  }

  finish({ id, ok, result, error }) {
    const request = this.pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(id);
    if (ok) {
      this.onStatus('ready');
      request.resolve(result);
      return;
    }
    // Ошибки Python runner.py возвращает в result; сюда доходит только
    // падение самого Pyodide
    console.error(error);
    this.reset();
    request.resolve({ aborted: CRASH_MESSAGE });
  }

  async request(action, data, timeout, timeoutMessage = TIMEOUT_MESSAGE) {
    await this.init();
    this.onStatus('busy');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.reset();
        resolve({ aborted: timeoutMessage });
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, action, ...data });
    });
  }

  /** Запустить программу: { output, error } */
  run(code, inputs = '') {
    return this.request('run', { code, inputs }, RUN_TIMEOUT);
  }

  /** Проверить решение задачи по её типу (exercise — тесты, predict — ответ). */
  check(code, exercise) {
    if (exercise.type === 'predict') {
      return this.request('predict', { code: exercise.code, answer: code }, RUN_TIMEOUT);
    }
    return this.request('check', { code, task: exercise }, CHECK_TIMEOUT);
  }

  /** Остановить воркер и запустить заново (после зависания или по кнопке). */
  reset() {
    if (this.worker) this.worker.terminate();
    for (const request of this.pending.values()) clearTimeout(request.timer);
    this.pending.clear();
    this.readyPromise = null;
    this.worker = null;
    return this.init();
  }
}
