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
import builtins
import contextlib
import importlib
import io
import linecache
import logging
import os
import shutil
import sys
import tempfile
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


STDIN_EOF = 'EOF when reading a line — строки в поле «Ввод» закончились'


@contextlib.contextmanager
def stdin_lines(text):
    """input() берёт строки из поля «Ввод» песочницы по одной, как из клавиатуры.

    Подсказка и введённое значение попадают в вывод — как в терминале:
    «Сколько товаров? 3». Строки кончились — EOFError, как при конце ввода.
    """
    lines = iter(text.splitlines())

    def read_line(prompt=''):
        print(prompt, end='')
        try:
            value = next(lines)
        except StopIteration:
            print()
            raise EOFError(STDIN_EOF) from None
        print(value)
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
                contextlib.redirect_stderr(buffer), reader:
            exec(compile(code, STUDENT_FILE, 'exec'), ns)
        error = None
    except BaseException as exc:  # нужна любая ошибка ученика, даже SystemExit
        error = exc
    ns['output'] = buffer.getvalue()
    return ns, error


def format_error(error):
    """Ошибка ученика как в терминале, но только со строками его кода (main.py)."""
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
                with guard(), recursion_limit():
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
