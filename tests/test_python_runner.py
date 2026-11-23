"""runner.py — запуск кода и тестов задач Python (тот же файл выполняет Pyodide).

Здесь он работает в обычном Python: правила те же, что в браузере.
Последний тест прогоняет все задачи из content/ — эталоны должны проходить на сайте.
"""
import builtins
import contextlib
import errno
import importlib.util
import io
import signal
import sys
from pathlib import Path

import pytest
import yaml
from django.conf import settings

RUNNER_PATH = Path(settings.BASE_DIR) / 'static/js/engines/python/runner.py'
spec = importlib.util.spec_from_file_location('runner', RUNNER_PATH)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
ORIGINAL_INPUT = builtins.input


@contextlib.contextmanager
def timeout_guard(seconds=2):
    """Тайм-аут как в браузере: зависшая программа → TimeoutError."""
    def stop(signum, frame):
        raise TimeoutError

    previous = signal.signal(signal.SIGALRM, stop)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


TASK = {
    'inputs': 'total = 2500\n',
    'check': {'tests': [
        {'code': 'assert delivery == 0', 'fail': 'Бесплатно от 2000.'},
        {'code': 'assert run(total=500)["delivery"] == 399', 'fail': 'До 2000 — 399.'},
        {'code': 'assert "print" in source', 'fail': 'Выведите результат.'},
    ]},
}
SOLUTION = 'delivery = 0 if total >= 2000 else 399\nprint(delivery)\n'


def test_inputs_then_student_code_and_run_overrides():
    result = runner.check_exercise(SOLUTION, TASK)

    assert result == {'output': '0\n', 'error': '', 'failed': [], 'total': 3}


def test_failed_tests_return_fail_messages_in_order():
    result = runner.check_exercise('delivery = 0\n', TASK)

    assert result['failed'] == ['До 2000 — 399.', 'Выведите результат.']


def test_crash_is_reported_with_student_lines_only():
    result = runner.check_exercise('x = 1\nprint(undefined)\n', TASK)

    # как в терминале: строка кода и указатель ^^^ (текст берётся из linecache)
    assert result['error'].splitlines() == [
        'Traceback (most recent call last):',
        '  File "main.py", line 2, in <module>',
        '    print(undefined)',
        '          ^^^^^^^^^',
        'NameError: name \'undefined\' is not defined',
    ]
    assert result['failed'][0] == 'Бесплатно от 2000.'


def test_crash_with_all_tests_passed_is_still_a_failure():
    task = {'check': {'tests': [{'code': 'assert x == 1', 'fail': '-'}]}}

    result = runner.check_exercise('x = 1\n1 / 0\n', task)

    assert result['failed'] == ['код упал: ZeroDivisionError: division by zero']


def test_syntax_error_shows_line_and_caret():
    result = runner.run_program('print("a"\n')

    assert 'SyntaxError' in result['error'] and 'line 1' in result['error']


def test_predict_compares_normalized_output():
    code = 'print(True + True)\nprint("a  ")\n'

    assert runner.check_predict(code, '2\na\n\n')['correct'] is True
    assert runner.check_predict(code, '1\na')['correct'] is False
    assert runner.check_predict(code, '2')['actual'] == '2\na  \n'


def test_timeout_message():
    task = {'check': {'tests': [{'code': 'assert True', 'fail': '-'}]}}

    _, error, _ = runner.run_tests(
        'while True:\n    pass\n', task, guard=lambda: timeout_guard(1),
    )

    assert isinstance(error, TimeoutError)
    assert runner.format_error(error) == 'Программа не завершилась'


def content_tasks():
    """Задачи Python из content/: exercise с тестами и predict (кроме служебных файлов).

    exercise других движков (HTML — check.type: dom) проверяются своими тестами.
    """
    tasks = []
    for path in sorted(Path(settings.CONTENT_DIR).rglob('*.yaml')):
        if path.name.startswith('_'):
            continue
        task = yaml.safe_load(path.read_text(encoding='utf-8'))
        is_python_exercise = (task.get('type') == 'exercise'
                              and task.get('check', {}).get('type') == 'tests')
        if is_python_exercise or task.get('type') == 'predict':
            name = str(path.relative_to(settings.CONTENT_DIR))
            tasks.append(pytest.param(task, id=name))
    return tasks


@pytest.mark.parametrize('task', content_tasks())
def test_content_task_works_in_runner(task):
    """Эталон проходит все тесты, заготовка — нет; ответ predict совпадает с выводом."""
    guard = timeout_guard
    if task['type'] == 'exercise':
        _, _, failed = runner.run_tests(task['solution'], task, guard=guard)
        assert failed == [], 'эталон не проходит тесты'
        _, _, failed = runner.run_tests(task['starter_code'], task, guard=guard)
        assert failed, 'заготовка проходит все тесты'
    else:
        result = runner.check_predict(task['code'], task['answer'])
        assert result['correct'], f'вывод: {result["actual"]!r}'


# --- запуск как настоящей программы: __main__, stderr, файлы, модули, logging ---

def test_student_code_is_main_module():
    result = runner.run_program('if __name__ == "__main__":\n    print("main")\n')

    assert result['output'] == 'main\n'


def test_logging_goes_to_output_and_resets_between_runs():
    code = ('import logging\n'
            'logging.basicConfig(level=logging.INFO,\n'
            '                    format="%(levelname)s:%(message)s")\n'
            'logging.info("заказ принят")\n')

    first = runner.run_program(code)
    second = runner.run_program(code)        # basicConfig снова работает

    assert first['output'] == second['output'] == 'INFO:заказ принят\n'


def test_each_run_has_empty_workdir():
    code = ('from pathlib import Path\n'
            'with open("log.txt", "a") as f:\n    f.write("x")\n'
            'print(Path("log.txt").read_text())\n')

    assert runner.run_program(code)['output'] == 'x\n'
    assert runner.run_program(code)['output'] == 'x\n'   # файл не «накопился»


def test_tests_see_files_of_main_run_and_run_gets_own_dir():
    task = {
        'inputs': ('from pathlib import Path\n'
                   'Path("orders.csv").write_text("1\\n2\\n")\n'),
        'check': {'tests': [
            {'code': 'assert Path("report.txt").read_text() == "2"', 'fail': 'файл'},
            {'code': 'assert run()["output"] == "2\\n"', 'fail': 'повтор'},
        ]},
    }
    code = ('lines = Path("orders.csv").read_text().split()\n'
            'Path("report.txt").write_text(str(len(lines)))\n'
            'print(len(lines))\n')

    _, error, failed = runner.run_tests(code, task)

    assert error is None and failed == []


def test_import_own_module_created_in_inputs():
    inputs = ('from pathlib import Path\n'
              'Path("prices.py").write_text("VAT = {vat}\\n")\n')
    code = 'import prices\nprint(prices.VAT)\n'

    first = runner.run_program(code, inputs.replace('{vat}', '20'))
    second = runner.run_program(code, inputs.replace('{vat}', '10'))

    assert first['output'] == '20\n'
    assert second['output'] == '10\n'      # модуль не взят из кэша прошлого запуска


SETTER_RECURSION = '''class Product:
    @property
    def price(self):
        return 1

    @price.setter
    def price(self, value):
        self.price = value

Product().price = 5
'''


def test_recursion_limit_same_as_in_browser():
    """Глубина рекурсии ученика — RECURSION_LIMIT от места запуска, как в браузере.

    Иначе в обычном Python глубина 1000, а в браузере стек кончится раньше.
    """
    depth = 'def f(n):\n    return 0 if n == 0 else 1 + f(n - 1)\nprint(f({}))\n'

    assert runner.run_program(depth.format(runner.RECURSION_LIMIT - 10))['error'] == ''
    assert 'RecursionError' in runner.run_program(
        depth.format(runner.RECURSION_LIMIT + 10))['error']


def test_recursion_in_setter_is_reported_and_limit_restored():
    """Бесконечная рекурсия (сеттер присваивает сам себе) — обычный RecursionError.

    И в коде ученика, и в тестах задачи; после запуска лимит прежний.
    """
    limit_before = sys.getrecursionlimit()
    task = {'check': {'tests': [
        {'code': 'Product().price = 1', 'fail': 'Сеттер вызывает сам себя.'},
    ]}}

    result = runner.check_exercise(SETTER_RECURSION, task)

    assert result['error'].endswith('RecursionError: maximum recursion depth exceeded')
    assert result['failed'] == ['Сеттер вызывает сам себя.']
    assert sys.getrecursionlimit() == limit_before


def test_input_reads_stdin_field():
    """Песочница: input() берёт строки поля «Ввод», подсказка и значение — в выводе."""
    code = ('name = input("Имя? ")\n'
            'count = int(input("Сколько? "))\nprint(name * count)\n')
    result = runner.run_program(code, stdin='ab\n2\n')

    assert result == {
        'output': 'Имя? \x02ab\x03\nСколько? \x022\x03\nabab\n', 'error': ''}


def test_input_without_lines_is_eof():
    result = runner.run_program('input("Имя? ")\n', stdin='')

    assert result['output'] == 'Имя? \n'
    assert result['error'].endswith(f'EOFError: {runner.STDIN_EOF}')
    # после запуска input() снова прежний
    assert builtins.input is ORIGINAL_INPUT


# --- pytest: тесты ученика (песочница и задачи «напишите тесты») ---

CART = {
    'cart.py': 'def total(prices, discount=0):\n'
               '    return sum(prices) * (100 - discount) // 100\n',
}
GOOD_TESTS = ('from cart import total\n\n'
              'def test_total():\n    assert total([100, 200]) == 300\n\n'
              'def test_discount():\n    assert total([100], 10) == 90\n')
MUTANTS = [
    {'files': {'cart.py': 'def total(prices, discount=0):\n    return sum(prices)\n'},
     'fail': 'Скидка не учитывается.'},
    {'files': {'cart.py': 'def total(:\n'}, 'fail': 'Не импортируется.'},
]


def check(tests):
    return runner.check_tests({**CART, 'test_cart.py': tests}, 'test_cart.py', MUTANTS)


def test_student_tests_pass_and_catch_every_mutant():
    result = check(GOOD_TESTS)

    assert result['failed'] == [] and result['total'] == 2
    assert 'test_cart.py::test_discount PASSED' in result['output']
    assert '2 passed' in result['output']


def test_student_tests_messages():
    weak = 'from cart import total\n\ndef test_total():\n    assert total([1]) == 1\n'
    # не импортирующаяся версия поймана, а без скидки — нет
    assert check(weak)['failed'] == ['Скидка не учитывается.']
    assert check('x = 1\n')['failed'] == [runner.NO_TESTS.format(file='test_cart.py')]
    wrong = check('def test_a():\n    assert 1 == 2\n')
    assert wrong['failed'] == [runner.WRONG_TESTS]
    assert 'assert 1 == 2' in wrong['output']
    # ошибка в самом файле тестов — тоже «не проходят на правильном коде»
    assert check('def test_a(:\n')['failed'] == [runner.WRONG_TESTS]


def test_sandbox_tests_output_like_terminal():
    code = ('def add(a, b):\n    return a + b\n\n'
            'def test_add():\n    assert add(2, 2) == 5\n')
    output = runner.run_sandbox_tests(code)['output']

    assert 'test_main.py::test_add FAILED' in output
    assert 'E       assert 4 == 5' in output and '+  where 4 = add(2, 2)' in output
    assert '1 failed' in output


def pytest_tasks():
    """Задачи «напишите тесты» (check.type: pytest) из content/."""
    tasks = []
    for path in sorted(Path(settings.CONTENT_DIR).rglob('*.yaml')):
        if path.name.startswith('_'):
            continue
        task = yaml.safe_load(path.read_text(encoding='utf-8'))
        check_type = task.get('check', {}).get('type')
        if task.get('type') == 'exercise' and check_type == 'pytest':
            name = str(path.relative_to(settings.CONTENT_DIR))
            tasks.append(pytest.param(task, id=name))
    return tasks or [pytest.param(None, marks=pytest.mark.skip('нет задач с pytest'))]


@pytest.mark.parametrize('task', pytest_tasks())
def test_content_pytest_task(task):
    """Эталонные тесты проходят на коде задачи и ловят каждую сломанную версию,
    заготовка ловит не все; сломанная версия — рабочий Python (ловится по поведению)."""
    test_file = next(iter(task['solution']))
    mutants = task['check']['mutants']
    for number, mutant in enumerate(mutants, start=1):
        for name, text in mutant['files'].items():
            # SyntaxError — «сломанная версия» не собирается, а не ловится тестами
            compile(text, name, 'exec')
    reference = runner.check_tests(
        {**task['files'], **task['solution']}, test_file, mutants, guard=timeout_guard)
    assert reference['failed'] == [], reference['output']
    starter = runner.check_tests(
        {test_file: '', **task['files']}, test_file, mutants, guard=timeout_guard)
    assert starter['failed'], 'заготовка тестов ловит все сломанные версии'


# --- asyncio.run() и httpx: в браузере asyncio.run() идёт на SyncLoop ---

SHOP_API = (
    'import httpx\n\n'
    'def handler(request):\n'
    '    if request.url.path == "/products/1":\n'
    '        return httpx.Response(200, json={"id": 1, "name": "Чайник"})\n'
    '    return httpx.Response(404, json={"detail": "Not found"})\n\n'
    'transport = httpx.MockTransport(handler)\n'
    'URL = "https://api.shop.test"\n'
)


@pytest.fixture
def browser(monkeypatch):
    """Как в Pyodide: sync_asyncio подменяет asyncio.run на run_coroutine."""
    monkeypatch.setattr(runner.sys, 'platform', 'emscripten')


def test_sync_loop_runs_tasks_timers_and_cancels_the_rest():
    import asyncio

    async def work(n, delay):
        await asyncio.sleep(delay)
        print(n)
        return n

    async def main():
        asyncio.create_task(asyncio.sleep(10))      # не дождались — отменится
        return await asyncio.gather(work(1, 0.03), work(2, 0.01))

    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert runner.run_coroutine(main()) == [1, 2]
    assert output.getvalue() == '2\n1\n'           # раньше проснулась короткая пауза

    async def stuck():
        await asyncio.get_running_loop().create_future()

    with pytest.raises(RuntimeError, match='разбудить их некому'):
        runner.run_coroutine(stuck())


def test_asyncio_run_in_browser_and_httpx_mock_transport(browser):
    import asyncio
    original = asyncio.run
    code = (
        'import asyncio\n\n'
        'async def main():\n'
        '    async with httpx.AsyncClient(transport=transport, base_url=URL) as c:\n'
        '        found, missing = await asyncio.gather(\n'
        '            c.get("/products/1"), c.get("/products/2"))\n'
        '    print(found.json()["name"], missing.status_code)\n\n'
        'asyncio.run(main())\n'
        'with httpx.Client(transport=transport, base_url=URL) as c:\n'
        '    c.get("/products/2").raise_for_status()\n'
    )
    result = runner.run_program(code, SHOP_API)

    assert result['output'] == 'Чайник 404\n'
    assert result['error'].splitlines()[-2].startswith('httpx.HTTPStatusError')
    assert 'File "main.py", line 11' in result['error']
    assert asyncio.run is original          # подмена — только на время запуска


ASYNC_TOOLS = '''\
import asyncio, contextlib, time

async def fail(n):
    await asyncio.sleep(0.01)
    raise ValueError(n)

async def ticks(n):
    for i in range(n):
        await asyncio.sleep(0)
        yield i

@contextlib.asynccontextmanager
async def opened():
    print("open")
    try:
        yield "c"
    finally:
        print("close")

async def worker(q, done):
    while True:
        item = await q.get()
        await asyncio.sleep(0.01)
        done.append(item)
        q.task_done()

async def main():
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(fail(1))
            tg.create_task(fail(2))
    except* ValueError as group:
        print(sorted(str(e) for e in group.exceptions))
    try:
        async with asyncio.timeout(0.02):
            await asyncio.sleep(1)
    except TimeoutError:
        print("timeout")
    try:
        await asyncio.wait_for(asyncio.sleep(1), 0.02)
    except TimeoutError:
        print("wait_for")
    task = asyncio.create_task(asyncio.sleep(10))
    await asyncio.sleep(0)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        print("cancelled")
    q, done = asyncio.Queue(), []
    workers = [asyncio.create_task(worker(q, done)) for _ in range(3)]
    for i in range(6):
        await q.put(i)
    await q.join()
    for w in workers:
        w.cancel()
    print(sorted(done))
    event, lock, sem = asyncio.Event(), asyncio.Lock(), asyncio.Semaphore(2)
    async def wait():
        async with lock, sem:
            await event.wait()
    waiting = asyncio.create_task(wait())
    await asyncio.sleep(0.01)
    event.set()
    await waiting
    print([i async for i in ticks(3)])
    async with opened() as c:
        print(c)
    start = asyncio.get_running_loop().time()
    await asyncio.gather(*(asyncio.sleep(0.1) for _ in range(3)))
    print(asyncio.get_running_loop().time() - start < 0.2)

asyncio.run(main())
'''


def test_asyncio_tools_in_browser_loop(browser):
    """То, что разбирает раздел «Конкурентность и async», работает на SyncLoop."""
    result = runner.run_program(ASYNC_TOOLS)

    assert result['error'] == ''
    assert result['output'].splitlines() == [
        "['1', '2']", 'timeout', 'wait_for', 'cancelled', '[0, 1, 2, 3, 4, 5]',
        '[0, 1, 2]', 'open', 'c', 'close', 'True',
    ]


@pytest.mark.parametrize('error', [
    RuntimeError("can't start new thread"),
    ModuleNotFoundError("No module named '_multiprocessing'", name='_multiprocessing'),
])
def test_threads_and_processes_explained(error):
    """В Pyodide нет потоков и процессов — к ошибке добавляется понятное объяснение."""
    text = runner.format_error(error)

    assert text.endswith(runner.NO_THREADS)
    assert type(error).__name__ in text
    assert runner.NO_THREADS not in runner.format_error(RuntimeError('другая'))
    other = OSError(errno.ENOSYS, 'не из multiprocessing')
    assert runner.NO_THREADS not in runner.format_error(other)
