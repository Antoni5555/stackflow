"""Задачи на вёрстку из content/: эталон проходит все правила, заготовка — нет.

Стили считает только браузер, поэтому check_tasks.py их не проверит: задачи
прогоняет Chromium без окна (Playwright, tests/js/verify-html-tasks.js) через тот же
код, что на сайте (engines/html/checker.js). Вручную — /dev/html-check/ при DEBUG.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / 'content'
SCRIPT = ROOT / 'tests' / 'js' / 'verify-html-tasks.js'

pytestmark = pytest.mark.skipif(
    not shutil.which('node') or not (ROOT / 'node_modules' / 'playwright').exists(),
    reason='нужен Node.js и npm ci (Playwright) + npx playwright install chromium',
)


def dom_tasks():
    """Задачи check.type: dom из курсов с engine: html."""
    tasks = []
    for course in sorted(CONTENT.glob('*/*/_course.yaml')):
        data = yaml.safe_load(course.read_text(encoding='utf-8')) or {}
        if data.get('engine') != 'html':
            continue
        for path in sorted(course.parent.rglob('*.yaml')):
            if path.name.startswith('_'):
                continue
            task = yaml.safe_load(path.read_text(encoding='utf-8'))
            check = task.get('check') if isinstance(task, dict) else None
            if (check or {}).get('type') == 'dom':
                tasks.append({
                    'name': str(path.relative_to(CONTENT)),
                    'files': task['files'],
                    'solution': task['solution'],
                    'rules': check['rules'],
                })
    return tasks


def verify(tasks):
    result = subprocess.run(
        ['node', str(SCRIPT)], input=json.dumps({'tasks': tasks}),
        capture_output=True, text=True, check=True, timeout=300,
    )
    return json.loads(result.stdout)


def test_example_task_is_verified():
    """Сам механизм: вычисленный стиль и @media считаются, плохие задачи замечены."""
    css = 'p { color: red; } @media (max-width: 500px) { p { color: blue; } }'
    page = '<link rel="stylesheet" href="style.css"><p>Цена</p>'
    task = {
        'files': {'index.html': '<p>Цена</p>', 'style.css': css},
        'solution': {'index.html': page},
        'rules': [
            {'selector': 'p', 'style': {'color': 'rgb(255, 0, 0)'}, 'fail': 'красный'},
            {'selector': 'p', 'style': {'color': 'rgb(0, 0, 255)'}, 'width': 375,
             'fail': 'синий на телефоне'},
        ],
    }
    result = verify([
        {'name': 'good', **task},
        {'name': 'wrong', **task, 'solution': {'index.html': '<p>Цена</p>'}},
        {'name': 'trivial', **task, 'files': {**task['files'], 'index.html': page}},
    ])

    assert result['good'] == []
    assert result['wrong'] == ['эталон не проходит: красный']
    assert result['trivial'] == [
        'заготовка проходит все правила — задачу нечего решать',
    ]


def test_content_html_tasks_pass():
    tasks = dom_tasks()
    if not tasks:
        pytest.skip('в content/ пока нет задач на вёрстку')

    problems = {name: items for name, items in verify(tasks).items() if items}
    assert problems == {}
