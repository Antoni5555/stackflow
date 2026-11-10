"""SQL-задачи из content/: эталон проходит свою проверку в PGlite, заготовка — нет.

Решения проверяет браузер (src/static/js/engines/sql/checker.js), поэтому эталоны
прогоняет Node с PGlite из npm той же версии. Формат tables — как после load_content.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

from apps.courses.services.content_loader import load_sql_dataset, sql_tables


ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / 'content'
SCRIPT = ROOT / 'tests' / 'js' / 'verify-sql-tasks.js'

pytestmark = pytest.mark.skipif(
    not shutil.which('node') or not (ROOT / 'node_modules' / '@electric-sql').exists(),
    reason='нужен Node.js и npm ci (PGlite)',
)


def sql_courses():
    """Папки курсов с engine: sql: [(направление, курс)]."""
    found = []
    for path in sorted(CONTENT.glob('*/*/_course.yaml')):
        data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
        if data.get('engine') == 'sql':
            found.append((path.parent.parent, path.parent))
    return found


def task_spec(path, data):
    check = dict(data['check'])
    if 'tables' in check:
        check['tables'] = sql_tables(check['tables'], path)
    return {
        'name': str(path.relative_to(CONTENT)),
        'setup': data.get('setup') or '',
        'solution': data['solution'],
        'starter_code': data.get('starter_code') or '',
        'check': check,
    }


def verify(base, tasks):
    result = subprocess.run(
        ['node', str(SCRIPT)], input=json.dumps({'base': base, 'tasks': tasks}),
        capture_output=True, text=True, check=True, timeout=120,
    )
    return json.loads(result.stdout)


def test_example_task_is_verified():
    """Сам механизм: эталон проходит; заготовка, которая уже верна, — замечание."""
    base = 'CREATE TABLE users (id int PRIMARY KEY, city text);' \
        "INSERT INTO users VALUES (1, 'Москва'), (2, NULL);"
    task = {
        'setup': '', 'solution': 'SELECT id FROM users WHERE city IS NULL;',
        'starter_code': 'SELECT id FROM users WHERE city = NULL;',
        'check': {'type': 'result', 'order_matters': True},
    }
    result = verify(base, [
        {'name': 'good', **task},
        {'name': 'trivial', **task, 'starter_code': task['solution']},
    ])

    assert result['good'] == []
    assert result['trivial'] == [
        'заготовка уже проходит проверку — задача решается без изменений',
    ]


def test_content_sql_tasks_pass():
    problems = {}
    count = 0
    for track_dir, course_dir in sql_courses():
        tasks = []
        for path in sorted(course_dir.rglob('*.yaml')):
            if path.name.startswith('_'):
                continue
            data = yaml.safe_load(path.read_text(encoding='utf-8'))
            if isinstance(data, dict) and data.get('type') == 'exercise':
                tasks.append(task_spec(path, data))
        count += len(tasks)
        if tasks:
            found = verify(load_sql_dataset(track_dir), tasks)
            problems.update({name: items for name, items in found.items() if items})
    if not count:
        pytest.skip('в content/ пока нет SQL-задач')

    assert problems == {}
