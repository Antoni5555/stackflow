// Web Worker с Python (Pyodide), на страницах Django — ещё и Django. Код ученика выполняется здесь, а не на странице:
// даже бесконечный цикл не замораживает интерфейс — страница просто перезапустит воркер.
//
// Сообщения от страницы: { id, action: 'run' | 'check' | 'predict', ...данные }
// Ответ:                 { id, ok: true, result } или { id, ok: false, error }
// После загрузки:        { type: 'ready' } или { type: 'failed', error }

const params = new URL(self.location.href).searchParams;
const PYODIDE_URL = params.get('pyodide');   // папка Pyodide на CDN
const RUNNER_URL = params.get('runner');     // общий runner.py (тот же, что у check_tasks.py)
const HASH_SEED = params.get('hashseed');    // на страницах задач — '0', в песочнице — нет
// Только на страницах Django: облегчённый архив Django и его runner (engines/django/)
const DJANGO_URL = params.get('django');
const DJANGO_RUNNER_URL = params.get('djangorunner');

const RUNNER_MODULE = 'runner';
const DJANGO_MODULE = 'django_runner';

let runner = null;
let djangoRunner = null;

/** Django: sqlite3 из Pyodide + наш архив (django, asgiref, sqlparse) в site-packages. */
async function bootDjango(pyodide) {
  const [archive, source] = await Promise.all([
    fetch(DJANGO_URL).then((response) => response.arrayBuffer()),
    fetch(DJANGO_RUNNER_URL).then((response) => response.text()),
    pyodide.loadPackage('sqlite3'),
  ]);
  pyodide.unpackArchive(archive, 'zip', { extractDir: '/lib/python3.12/site-packages' });
  pyodide.FS.writeFile(`/home/pyodide/${DJANGO_MODULE}.py`, source);
  djangoRunner = pyodide.pyimport(DJANGO_MODULE);
  djangoRunner.configure();     // django.setup() — заранее, пока ученик читает условие
}


async function boot() {
  const { loadPyodide } = await import(`${PYODIDE_URL}pyodide.mjs`);
  // PYTHONHASHSEED фиксирует порядок set/dict из строк: ответ задачи «что выведет»
  // не зависит от случайности запуска. В песочнице не задаём — там случайность честная.
  const env = HASH_SEED === null ? {} : { PYTHONHASHSEED: HASH_SEED };
  const pyodide = await loadPyodide({ indexURL: PYODIDE_URL, env });

  const source = await (await fetch(RUNNER_URL)).text();
  pyodide.FS.writeFile(`/home/pyodide/${RUNNER_MODULE}.py`, source);


  // input() ждёт ввода с клавиатуры, а в тренажёре клавиатуры у программы нет
  pyodide.runPython(`
import builtins

def _no_input(prompt=''):
    raise RuntimeError('input() в тренажёре не работает: задайте значение переменной в коде')

builtins.input = _no_input
`);
  // Имя модуля — в константе, а не строкой в скобках: иначе collectstatic
  // принимает такой вызов за импорт JS-файла и ищет файл «runner»

  runner = pyodide.pyimport(RUNNER_MODULE);
  if (DJANGO_URL) await bootDjango(pyodide);

  self.pyodide = pyodide;
}

// Python-словарь → обычный объект JS
function toJs(proxy) {
  const value = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return value;
}

// База часовых поясов для zoneinfo (~200 КБ) — грузим, только если код её использует
let tzdataLoaded = false;

async function loadExtraPackages(data) {
  const text = [data.code, data.inputs, JSON.stringify(data.task || '')].join('\n');
  if (!tzdataLoaded && text.includes('zoneinfo')) {
    await self.pyodide.loadPackage('tzdata');
    tzdataLoaded = true;
  }
}

const actions = {
  run: ({ code, inputs }) => toJs(runner.run_program(code, inputs || '')),
  check: ({ code, task }) => {
    const pyTask = self.pyodide.toPy(task);
    try {
      return toJs(runner.check_exercise(code, pyTask));
    } finally {
      pyTask.destroy();
    }
  },
  predict: ({ code, answer }) => toJs(runner.check_predict(code, answer)),
  /** Django: { files, setup, requests, orm } → ответы, SQL, модели (engines/django/runner.py). */
  django: ({ files, setup, requests, orm, strictSetup = true, settings = null }) => {
    const pyFiles = self.pyodide.toPy(files);
    const pyRequests = self.pyodide.toPy(requests || []);
    const pySettings = self.pyodide.toPy(settings);
    try {
      return toJs(djangoRunner.run(
        pyFiles, setup || '', pyRequests, orm || '', strictSetup, pySettings,
      ));
    } finally {
      pyFiles.destroy();
      pyRequests.destroy();
      pySettings?.destroy?.();
    }
  },
  /** Django-задача: { files, setup, tests, settings } → { failed, total, error }. */
  djangoCheck: ({ files, setup, tests, settings = null }) => {
    const pyFiles = self.pyodide.toPy(files);
    const pyTests = self.pyodide.toPy(tests);
    const pySettings = self.pyodide.toPy(settings);
    try {
      return toJs(djangoRunner.check(pyFiles, setup || '', pyTests, pySettings));
    } finally {
      pyFiles.destroy();
      pyTests.destroy();
      pySettings?.destroy?.();
    }
  },
  /** Задача «напишите тесты»: tests.py ученика на коде задачи и на мутантах. */
  djangoCheckTests: ({ files, mutants, settings = null }) => {
    const pyFiles = self.pyodide.toPy(files);
    const pyMutants = self.pyodide.toPy(mutants);
    const pySettings = self.pyodide.toPy(settings);
    try {
      return toJs(djangoRunner.check_tests(pyFiles, pyMutants, pySettings));
    } finally {
      pyFiles.destroy();
      pyMutants.destroy();
      pySettings?.destroy?.();
    }
  },
};

const ready = boot().then(
  () => self.postMessage({ type: 'ready' }),
  (error) => self.postMessage({ type: 'failed', error: String(error) }),
);

self.onmessage = async ({ data }) => {
  await ready;
  try {
    await loadExtraPackages(data);
    self.postMessage({ id: data.id, ok: true, result: actions[data.action](data) });
  } catch (error) {
    self.postMessage({ id: data.id, ok: false, error: String(error) });
  }
};
