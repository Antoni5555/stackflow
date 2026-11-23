"""Запуск кода ученика и тестов задачи Python.

Один и тот же файл выполняют:
- тренажёр в браузере (Pyodide загружает его в Web Worker);
- проверка контента content/_tools/check_tasks.py и тесты сайта (обычный Python).
Так эталон, прошедший проверку контента, гарантированно проходит и на сайте.

Правила — docs/content-format.md, раздел «Как выполняются тесты»:
1. выполняется inputs (входные данные), затем код ученика в том же пространстве имён;
   код ученика выполняется как главный модуль: __name__ == "__main__";
2. тестам доступны переменные ученика, output (вывод), source (код), run(**значения);
3. output — всё, что программа вывела в stdout и stderr (как в терминале): так видны
   и print, и сообщения logging;
4. каждый запуск — в новой пустой рабочей папке (она же в sys.path): файлы из inputs
   и созданные программой не переходят в следующий запуск, свои модули импортируются.
   Тесты задачи выполняются в папке основного запуска — им видны файлы программы;
5. настройки logging прошлого запуска сбрасываются: в браузере интерпретатор
   один на все запуски;
6. глубина рекурсии кода ученика и тестов — RECURSION_LIMIT (а не 1000, как обычно).

Тайм-аут здесь не реализован: в браузере зависшую программу останавливает
главная страница (перезапуском Web Worker), в check_tasks.py — signal.alarm через guard.
"""
import asyncio
import builtins
import contextlib
import errno
import importlib
import io
import linecache
import logging
import os
import shutil
import sys
import tempfile
import time
import traceback


STUDENT_FILE = 'main.py'
TIMEOUT_MESSAGE = 'Программа не завершилась'

# В браузере рекурсия через C-код Python (сеттер property, __setattr__, __repr__)
# тратит стек JS быстрее обычной: при глубине 1000 стек Web Worker кончается
# раньше, чем Python выбросит RecursionError, и Pyodide падает целиком.
# Замер в Chromium: сеттер выдерживает ~475 уровней — берём 300 с запасом
# для других браузеров. В check_tasks.py лимит тот же, чтобы задача, прошедшая
# проверку контента, не упала на сайте.
RECURSION_LIMIT = 300


@contextlib.contextmanager
def workdir():
    """Новая пустая рабочая папка на один запуск; после — удаляется.

    Папка становится текущей и первой в sys.path (импорт своих модулей из inputs).
    Модули, загруженные из неё, выгружаются — иначе следующий запуск получил бы
    старую версию модуля из кэша sys.modules.
    """
    old_cwd = os.getcwd()
    path = tempfile.mkdtemp(prefix='run-')
    modules_before = set(sys.modules)
    os.chdir(path)
    sys.path.insert(0, path)
    importlib.invalidate_caches()
    try:
        yield path
    finally:
        os.chdir(old_cwd)
        if path in sys.path:
            sys.path.remove(path)
        for name in set(sys.modules) - modules_before:
            module_file = getattr(sys.modules[name], '__file__', None) or ''
            if module_file.startswith(path):
                del sys.modules[name]
        shutil.rmtree(path, ignore_errors=True)


@contextlib.contextmanager
def recursion_limit():
    """Код внутри может уйти вглубь на RECURSION_LIMIT вызовов от текущего места.

    Python считает все кадры стека, включая вызовы runner.py и pytest, поэтому
    лимит — от текущей глубины: ученику доступно одинаково везде.
    После — прежний лимит (ученик мог поменять его сам).
    """
    depth, frame = 0, sys._getframe()
    while frame is not None:
        depth, frame = depth + 1, frame.f_back
    old_limit = sys.getrecursionlimit()
    sys.setrecursionlimit(depth + RECURSION_LIMIT)
    try:
        yield
    finally:
        sys.setrecursionlimit(old_limit)


def reset_logging():
    """Сбросить настройки logging: обработчики и уровни, оставшиеся от прошлого запуска.

    Иначе повторный logging.basicConfig() ничего не делает (корневой логгер уже
    настроен), а старый обработчик пишет в вывод прошлого запуска.
    """
    root = logging.getLogger()
    for handler in root.handlers[:]:
        root.removeHandler(handler)
    root.setLevel(logging.WARNING)
    for logger in logging.Logger.manager.loggerDict.values():
        if isinstance(logger, logging.Logger):
            logger.handlers.clear()
            logger.setLevel(logging.NOTSET)
            logger.propagate = True
            logger.disabled = False


# --- asyncio.run() в браузере ---
# В Pyodide свой цикл событий (WebLoop) работает поверх JS, и asyncio.run() из обычного
# (не async) вызова падает: «Cannot stack switch…». Код ученика выполняется именно так,
# поэтому asyncio.run() подменяется циклом ниже: обычный цикл asyncio, у которого
# «ожидание событий» — просто пауза до ближайшего таймера. Настоящего ввода-вывода
# (сокетов) в тренажёре нет: сеть — через httpx.MockTransport, файлы — синхронно.

DEADLOCK = 'все задачи ждут друг друга, и разбудить их некому — программа зависла бы'


class _PauseSelector:
    """«Селектор» без сокетов: ждёт до ближайшего таймера и событий не возвращает."""

    def select(self, timeout):
        if timeout is None:
            raise RuntimeError(DEADLOCK)
        if timeout > 0:
            time.sleep(timeout)    # asyncio.sleep(1) идёт секунду — как в терминале
        return []

    def close(self):
        pass


class SyncLoop(asyncio.BaseEventLoop):
    """Цикл событий без ввода-вывода: run_until_complete работает из обычного кода."""

    def __init__(self):
        super().__init__()
        self._selector = _PauseSelector()

    def _process_events(self, event_list):
        pass

    def _write_to_self(self):
        pass


def run_coroutine(main, *, debug=None):
    """asyncio.run() на SyncLoop: те же правила — новый цикл, в конце отмена задач."""
    if not asyncio.iscoroutine(main):
        raise ValueError(f'a coroutine was expected, got {main!r}')
    loop = SyncLoop()
    if debug is not None:
        loop.set_debug(debug)
    # WebLoop Pyodide числится запущенным всегда — иначе свой цикл не стартует
    outer = asyncio.events._get_running_loop()
    asyncio.events._set_running_loop(None)
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(main)
    finally:
        try:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                cancelled = asyncio.gather(*pending, return_exceptions=True)
                loop.run_until_complete(cancelled)
            loop.run_until_complete(loop.shutdown_asyncgens())
        finally:
            asyncio.set_event_loop(None)
            loop.close()
            asyncio.events._set_running_loop(outer)


@contextlib.contextmanager
def sync_asyncio():
    """В браузере asyncio.run() — на SyncLoop; в обычном Python — как есть."""
    if sys.platform != 'emscripten':
        yield
        return
    saved = asyncio.run
    asyncio.run = run_coroutine
    try:
        yield
    finally:
        asyncio.run = saved


STDIN_EOF = 'EOF when reading a line — строки в поле «Ввод» закончились'
# Введённое значение в выводе — между этими символами: песочница покажет его серым,
# как набранное с клавиатуры, и отличит от того, что напечатала программа
INPUT_START, INPUT_END = '\x02', '\x03'


@contextlib.contextmanager
def stdin_lines(text):
    """input() берёт строки из поля «Ввод» песочницы по одной, как из клавиатуры.

    Подсказка и введённое значение попадают в вывод — как в терминале:
    «Сколько товаров? 3» (значение помечено INPUT_START/INPUT_END).
    Строки кончились — EOFError, как при конце ввода.
    """
    lines = iter(text.splitlines())

    def read_line(prompt=''):
        print(prompt, end='')
        try:
            value = next(lines)
        except StopIteration:
            print()
            raise EOFError(STDIN_EOF) from None
        print(f'{INPUT_START}{value}{INPUT_END}')
        return value

    saved = builtins.input
    builtins.input = read_line
    try:
        yield
    finally:
        builtins.input = saved


def execute(code, inputs='', override=None, guard=contextlib.nullcontext, stdin=None):
    """Выполняет inputs, подменяет значения из override, затем код ученика.

    Возвращает (пространство имён, ошибка или None). Вывод — в ns['output'].
    Выполняет в текущей папке: пустую папку даёт workdir() (run_program, run_tests…).
    guard — контекст-менеджер вокруг выполнения (в check_tasks.py — тайм-аут).
    stdin — текст поля «Ввод» (песочница): тогда input() читает из него.
    """
    ns = {'__name__': '__main__'}
    reset_logging()
    # Код выполняется из строки, а не из файла: кладём его текст в linecache, чтобы
    # traceback (и logger.exception) показал строку кода и ^^^, как в терминале.
    # mtime = None — linecache не будет проверять «файл» на диске и не сотрёт запись.
    lines = code.splitlines(True)
    linecache.cache[STUDENT_FILE] = (len(code), None, lines, STUDENT_FILE)
    exec(inputs or '', ns)
    ns.update(override or {})
    buffer = io.StringIO()
    try:
        reader = stdin_lines(stdin) if stdin is not None else contextlib.nullcontext()
        with guard(), recursion_limit(), contextlib.redirect_stdout(buffer), \
                contextlib.redirect_stderr(buffer), reader, sync_asyncio():
            exec(compile(code, STUDENT_FILE, 'exec'), ns)
        error = None
    except BaseException as exc:  # нужна любая ошибка ученика, даже SystemExit
        error = exc
    ns['output'] = buffer.getvalue()
    return ns, error


# В браузере (Pyodide) нет потоков и процессов: threading.Thread.start(), to_thread,
# run_in_executor, ThreadPoolExecutor падают с «can't start new thread»,
# ProcessPoolExecutor и Pool — без модуля _multiprocessing, Process.start() — ENOSYS.
NO_THREADS = ('В браузере нет потоков и процессов: этот пример запускается '
              'на настоящем Python (в терминале на своём компьютере).')


def needs_threads(error):
    """Ошибка из-за того, что в браузере нельзя запустить поток или процесс."""
    if isinstance(error, ModuleNotFoundError):
        return error.name == '_multiprocessing'
    if isinstance(error, RuntimeError):
        return str(error) == "can't start new thread"
    if isinstance(error, OSError) and error.errno == errno.ENOSYS:
        frames = traceback.extract_tb(error.__traceback__)
        return any('multiprocessing' in frame.filename for frame in frames)
    return False


def format_error(error):
    """Ошибка ученика как в терминале, но только со строками его кода (main.py)."""
    if needs_threads(error):
        return f'{_format_error(error)}\n\n{NO_THREADS}'
    return _format_error(error)


def _format_error(error):
    if isinstance(error, TimeoutError):
        return TIMEOUT_MESSAGE
    if isinstance(error, SyntaxError):
        # у синтаксической ошибки нет стека — Python показывает строку и стрелку
        return ''.join(traceback.format_exception_only(error)).rstrip()
    summary = traceback.TracebackException.from_exception(error)
    summary.stack = traceback.StackSummary.from_list(
        [frame for frame in summary.stack if frame.filename == STUDENT_FILE]
    )
    return ''.join(summary.format()).rstrip()


def run_tests(code, task, guard=contextlib.nullcontext):
    """Прогоняет тесты задачи exercise.

    Возвращает (ns, error, failed): пространство имён первого запуска,
    ошибку кода ученика и список сообщений fail непройденных тестов.
    """
    inputs = task.get('inputs') or ''

    def run(**override):
        # повторный запуск — в своей пустой папке: файлы основного запуска не мешают
        with workdir():
            result, _ = execute(code, inputs, override, guard=guard)
        return result

    failed = []
    with workdir():
        ns, error = execute(code, inputs, guard=guard)
        for test in task['check']['tests']:
            env = {**ns, 'source': code, 'run': run}
            try:
                with guard(), recursion_limit(), sync_asyncio():
                    exec(test['code'], env)
            except TimeoutError:
                failed.append(TIMEOUT_MESSAGE)
            except Exception:
                failed.append(test['fail'])
    if error is not None and not failed:
        failed.append(f'код упал: {type(error).__name__}: {error}')
    return ns, error, failed


def run_program(code, inputs='', stdin=None):
    """Запуск в песочнице и кнопка «Запустить»: вывод и текст ошибки."""
    with workdir():
        ns, error = execute(code, inputs, stdin=stdin)
    return {
        'output': ns['output'],
        'error': format_error(error) if error is not None else '',
    }


def check_exercise(code, task):
    """Кнопка «Проверить» у задачи exercise: вывод, ошибка, результаты тестов."""
    ns, error, failed = run_tests(code, task)
    return {
        'output': ns['output'],
        'error': format_error(error) if error is not None else '',
        'failed': failed,
        'total': len(task['check']['tests']),
    }


# --- pytest: тесты ученика (песочница и задачи «напишите тесты») ---
# В браузере pytest грузится по требованию (worker.js); в обычном Python — из окружения.

SANDBOX_TEST_FILE = 'test_main.py'
# Как в терминале: pytest -v — по строке на тест; без шапки с путями временной папки
PYTEST_ARGS = [
    '-v', '--no-header', '--color=no', '-p', 'no:cacheprovider', '--capture=sys',
]
NO_TESTS = 'В {file} нет ни одного теста: функций с именем test_….'
WRONG_TESTS = 'Ваши тесты не проходят на правильном коде задачи — ошибка в тестах.'
# коды выхода pytest.main: 0 — всё прошло, 1 — есть упавшие, 5 — тестов не нашлось
PYTEST_OK, PYTEST_NO_TESTS = 0, 5


def run_pytest(files, test_file, guard=contextlib.nullcontext):
    """files — в пустую рабочую папку, pytest на test_file → (код выхода, вывод).

    Сторонние плагины окружения (pytest-django в тестах сайта) не подключаются:
    у всех тот же голый pytest, что в браузере.
    """
    import pytest

    saved = os.environ.get('PYTEST_DISABLE_PLUGIN_AUTOLOAD')
    os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] = '1'
    buffer = io.StringIO()
    try:
        with workdir() as path:
            for name, text in files.items():
                os.makedirs(os.path.dirname(name) or '.', exist_ok=True)
                with open(name, 'w', encoding='utf-8') as file:
                    file.write(text)
            reset_logging()
            with guard(), contextlib.redirect_stdout(buffer), \
                    contextlib.redirect_stderr(buffer), sync_asyncio():
                code = pytest.main([*PYTEST_ARGS, f'--rootdir={path}', test_file])
    except TimeoutError:
        return None, TIMEOUT_MESSAGE
    finally:
        if saved is None:
            os.environ.pop('PYTEST_DISABLE_PLUGIN_AUTOLOAD', None)
        else:
            os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] = saved
    return int(code), buffer.getvalue()


def run_sandbox_tests(code):
    """Кнопка «Запустить тесты» в песочнице: код — файл test_main.py, вывод pytest."""
    _, output = run_pytest({SANDBOX_TEST_FILE: code}, SANDBOX_TEST_FILE)
    return {'output': output, 'error': ''}


def check_tests(files, test_file, mutants=(), guard=contextlib.nullcontext):
    """Задача «напишите тесты»: файл тестов ученика test_file — в files.

    Тесты должны пройти на коде задачи (files) и упасть на каждой «сломанной»
    версии (mutant: {files — заменённые модули, fail}). Сломанная версия, которая
    даже не импортируется, тоже считается пойманной.
    → {'failed', 'total' (число сломанных версий), 'output' (pytest на коде задачи)}.
    """
    code, output = run_pytest(files, test_file, guard)
    result = {'failed': [], 'total': len(mutants), 'output': output}
    if code == PYTEST_NO_TESTS:
        result['failed'].append(NO_TESTS.format(file=test_file))
    elif code != PYTEST_OK:
        result['failed'].append(WRONG_TESTS)
    else:
        for mutant in mutants:
            code, _ = run_pytest({**files, **mutant['files']}, test_file, guard)
            if code == PYTEST_OK:
                result['failed'].append(mutant['fail'])
    return result


def normalize_output(text):
    """Вывод для сравнения в predict.

    Без пробелов в конце строк и без пустых строк в конце.
    """
    return '\n'.join(line.rstrip() for line in text.rstrip().splitlines())


def check_predict(code, answer):
    """Задача predict: запускает код и сравнивает его вывод с ответом ученика."""
    with workdir():
        ns, error = execute(code)
    actual = ns['output']
    if error is not None:
        actual += format_error(error) + '\n'
    return {
        'actual': actual,
        'correct': normalize_output(actual) == normalize_output(answer),
    }
