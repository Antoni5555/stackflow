"""Задачи в терминале (check.type: state) из content/: эталон проходит в симуляторе.

Симулятор — JS (src/static/js/engines/linux/), поэтому эталоны прогоняет Node:
solution выполняется без ошибок и проходит все правила, нетронутый setup — нет.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / 'content'
SCRIPT = ROOT / 'tests' / 'js' / 'verify-state-tasks.js'

pytestmark = pytest.mark.skipif(not shutil.which('node'), reason='нужен Node.js')


def course_engine(path):
    """Движок курса задачи (content/<направление>/<курс>/…): linux или git."""
    course = CONTENT.joinpath(*path.relative_to(CONTENT).parts[:2], '_course.yaml')
    data = yaml.safe_load(course.read_text(encoding='utf-8')) if course.exists() else {}
    return (data or {}).get('engine') or 'linux'


def state_tasks():
    """Все задачи state из content/: {путь: задача для verifyTask}."""
    tasks = {}
    for path in sorted(CONTENT.rglob('*.yaml')):
        if path.name.startswith('_'):
            continue
        data = yaml.safe_load(path.read_text(encoding='utf-8'))
        check = data.get('check') if isinstance(data, dict) else None
        # state у SQL-задач — таблицы, их проверяет tests/test_sql_tasks.py
        if isinstance(check, dict) and check.get('type') == 'state' \
                and course_engine(path) != 'sql':
            tasks[str(path.relative_to(CONTENT))] = {
                'engine': course_engine(path),
                'setup': data['setup'], 'rules': check['expect'],
                'solution': data['solution'],
            }
    return tasks


def verify(tasks):
    """Прогнать задачи через симулятор: {имя: [проблемы]}."""
    payload = [{'name': name, **task} for name, task in tasks.items()]
    result = subprocess.run(
        ['node', str(SCRIPT)], input=json.dumps(payload), capture_output=True,
        text=True, check=True, timeout=60,
    )
    return json.loads(result.stdout)


def test_example_task_is_verified():
    """Сам механизм: хороший эталон проходит, плохой — нет."""
    task = {
        'setup': {'cwd': '/srv/shop', 'files': {'/srv/shop/config/a.ini': 'x\n'},
                  'dirs': ['/srv/shop/backup']},
        'rules': [{'path': '/srv/shop/backup/config/a.ini', 'exists': True,
                   'fail': 'Нужен cp -r.'}],
        'solution': 'cp -r config backup/\n',
    }
    result = verify({'good': task, 'bad': {**task, 'solution': 'cp config backup/\n'}})

    assert result['good'] == []
    assert any('кодом 1' in problem for problem in result['bad'])


def test_example_git_task_is_verified():
    """Задача Git: эталон в симуляторе с репозиторием, правила Git."""
    task = {
        'engine': 'git',
        'setup': {'cwd': '/home/shop/shop', 'commits': [
            {'message': 'Каркас', 'files': {'a.py': 'x\n'}},
        ]},
        'rules': [
            {'branch': 'promo', 'fail': 'Нет ветки promo.'},
            {'head': 'promo', 'fail': 'Переключитесь на promo.'},
        ],
        'solution': 'git switch -c promo\n',
    }
    result = verify({'good': task, 'bad': {**task, 'solution': 'git branch promo\n'}})

    assert result['good'] == []
    assert result['bad'] == ['эталон не проходит правило: Переключитесь на promo.']


def test_content_state_tasks_pass_in_simulator():
    tasks = state_tasks()
    if not tasks:
        pytest.skip('в content/ пока нет задач в терминале')
    problems = {name: found for name, found in verify(tasks).items() if found}

    assert problems == {}
