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


def state_tasks():
    """Все задачи state из content/: {путь: задача для verifyTask}."""
    tasks = {}
    for path in sorted(CONTENT.rglob('*.yaml')):
        if path.name.startswith('_'):
            continue
        data = yaml.safe_load(path.read_text(encoding='utf-8'))
        check = data.get('check') if isinstance(data, dict) else None
        if isinstance(check, dict) and check.get('type') == 'state':
            tasks[str(path.relative_to(CONTENT))] = {
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


def test_content_state_tasks_pass_in_simulator():
    tasks = state_tasks()
    if not tasks:
        pytest.skip('в content/ пока нет задач в терминале')
    problems = {name: found for name, found in verify(tasks).items() if found}

    assert problems == {}
