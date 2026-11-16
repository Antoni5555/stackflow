"""Эталоны Django-задач: запускается отдельным процессом из tests/test_django_tasks.py.

runner.py настраивает Django своими settings.configure(), а в pytest Django уже
настроен настройками сайта, — поэтому проверка идёт в своём процессе.
Вход (stdin) — [{name, files, solution, setup?, settings?, check}],
выход — {name: [замечания]}.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'src' / 'static' / 'js' / 'engines' / 'django'))

import runner  # noqa: E402


def stage_error(result):
    return f"{result['stage']}: {result['error']}" if 'stage' in result else None


def verify_tests(task):
    """check.tests: эталон проходит все тесты, заготовка — хотя бы один нет."""
    check, settings = task['check'], task.get('settings')
    setup = task.get('setup') or ''
    problems = []
    reference = runner.check(
        {**task['files'], **task['solution']}, setup, check['tests'], settings)
    if error := stage_error(reference):
        problems.append(f'эталон не собрался — {error}')
    elif reference['failed']:
        detail = f" ({reference['error']})" if reference['error'] else ''
        problems.append(f"эталон не проходит тест: {reference['failed'][0]}{detail}")
    starter = runner.check(task['files'], setup, check['tests'], settings)
    if 'stage' not in starter and not starter['failed']:
        problems.append(
            'заготовка уже проходит все тесты — задача решается без изменений')
    return problems


def verify_mutants(task):
    """check.mutants: каждая сломанная версия собирается, эталонные тесты ловят каждую,
    заготовка tests.py не ловит хотя бы одну (или не проходит на коде задачи)."""
    check, settings = task['check'], task.get('settings')
    problems = []
    for number, mutant in enumerate(check['mutants'], start=1):
        built = runner.run({**task['files'], **mutant['files']}, settings=settings)
        if error := stage_error(built):
            problems.append(f'сломанная версия {number} не собирается — {error}')
    reference = runner.check_tests(
        {**task['files'], **task['solution']}, check['mutants'], settings)
    if error := stage_error(reference):
        problems.append(f'эталонные тесты не собрались — {error}')
    elif reference['failed'][:1] in ([runner.WRONG_TESTS], [runner.NO_TESTS]):
        problems.append(
            f"эталонные тесты: {reference['failed'][0]}\n{reference['output']}")
    else:
        # сломанная версия, которую эталон пропустил, ведёт себя как правильный код
        problems += [f'эталонные тесты не ловят сломанную версию: {fail}'
                     for fail in reference['failed']]
    starter = runner.check_tests(task['files'], check['mutants'], settings)
    if 'stage' not in starter and not starter['failed']:
        problems.append('заготовка tests.py уже ловит все сломанные версии')
    return problems


def verify(task):
    if 'mutants' in task['check']:
        return verify_mutants(task)
    return verify_tests(task)


if __name__ == '__main__':
    tasks = json.load(sys.stdin)
    found = {task['name']: verify(task) for task in tasks}
    print(json.dumps(found, ensure_ascii=False))
