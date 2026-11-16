"""runner.py — запуск кода и тестов задач Python (тот же файл выполняет Pyodide).

Здесь он работает в обычном Python: правила те же, что в браузере.
Последний тест прогоняет все задачи из content/ — эталоны должны проходить на сайте.
"""
import builtins
import contextlib
import importlib.util
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
    """Все задачи exercise и predict из content/ (кроме служебных файлов)."""
    tasks = []
    for path in sorted(Path(settings.CONTENT_DIR).rglob('*.yaml')):
        if path.name.startswith('_'):
            continue
        task = yaml.safe_load(path.read_text(encoding='utf-8'))
        if task.get('type') in ('exercise', 'predict'):
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

    assert result == {'output': 'Имя? ab\nСколько? 2\nabab\n', 'error': ''}


def test_input_without_lines_is_eof():
    result = runner.run_program('input("Имя? ")\n', stdin='')

    assert result['output'] == 'Имя? \n'
    assert result['error'].endswith(f'EOFError: {runner.STDIN_EOF}')
    # после запуска input() снова прежний
    assert builtins.input is ORIGINAL_INPUT
