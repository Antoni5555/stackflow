"""Django-задачи из content/: эталон проходит проверку, заготовка — нет.

Задачи выполняет тренажёр Django (src/static/js/engines/django/runner.py) — тот же файл
работает в обычном Python, поэтому эталоны прогоняются без браузера, в своём процессе
(tests/verify_django_tasks.py). Для задач «напиши тесты» ещё: каждая сломанная версия
собирается, и эталонные тесты ловят каждую.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / 'content'
SCRIPT = ROOT / 'tests' / 'verify_django_tasks.py'

FILES = {
    'models.py': (
        'from django.db import models\n\n'
        'class Product(models.Model):\n'
        '    name = models.CharField(max_length=100)\n'
    ),
    'views.py': (
        'from django.http import HttpResponse\n'
        'from .models import Product\n\n'
        'def product_list(request):\n'
        '    return HttpResponse(", ".join(p.name for p in Product.objects.all()))\n'
    ),
    'urls.py': (
        'from django.urls import path\nfrom . import views\n\n'
        'urlpatterns = [path("products/", views.product_list)]\n'
    ),
}
FIXED_VIEWS = FILES['views.py'].replace('.all()', '.order_by("name")')
TEST = {
    'code': 'Product.objects.create(name="Б")\nProduct.objects.create(name="А")\n'
            'assert client.get("/products/").content.decode() == "А, Б"',
    'fail': 'Товары — по алфавиту.',
}
STUDENT_TESTS = (
    'from django.test import TestCase\nfrom .models import Product\n\n'
    'class ListTests(TestCase):\n'
    '    def test_sorted(self):\n'
    '        Product.objects.create(name="Б")\n'
    '        Product.objects.create(name="А")\n'
    '        self.assertContains(self.client.get("/products/"), "А, Б")\n'
)


def verify(tasks):
    result = subprocess.run(
        [sys.executable, str(SCRIPT)], input=json.dumps(tasks),
        capture_output=True, text=True, check=True, timeout=300,
    )
    return json.loads(result.stdout)


def django_courses():
    """Папки курсов с engine: django."""
    found = []
    for path in sorted(CONTENT.glob('*/*/_course.yaml')):
        data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
        if data.get('engine') == 'django':
            found.append(path.parent)
    return found


def test_example_tasks_are_verified():
    """Сам механизм: годные задачи без замечаний, у негодных — понятная причина."""
    good = {'files': {**FILES, 'views.py': FILES['views.py']},
            'solution': {'views.py': FIXED_VIEWS},
            'check': {'type': 'django', 'tests': [TEST]}}
    mutant = {'files': {'views.py': FILES['views.py']}, 'fail': 'без сортировки'}
    code = {**FILES, 'views.py': FIXED_VIEWS,
            'tests.py': 'from django.test import TestCase\n'}
    tests_task = {'files': code, 'solution': {'tests.py': STUDENT_TESTS},
                  'check': {'type': 'django', 'mutants': [mutant]}}
    result = verify([
        {'name': 'good', **good},
        {'name': 'trivial', **good, 'files': {**FILES, 'views.py': FIXED_VIEWS}},
        {'name': 'broken', **good, 'solution': {'views.py': 'def product_list(\n'}},
        {'name': 'tests', **tests_task},
        # «сломанная» версия ведёт себя как правильный код — эталон её не ловит
        {'name': 'same', **tests_task, 'check': {'type': 'django', 'mutants': [
            {'files': {'views.py': FIXED_VIEWS.replace('"name"', '"name", "id"')},
             'fail': 'то же самое'}]}},
        {'name': 'syntax', **tests_task, 'check': {'type': 'django', 'mutants': [
            {'files': {'views.py': 'def product_list(\n'}, 'fail': 'не собирается'}]}},
    ])

    assert result['good'] == [] and result['tests'] == []
    assert result['trivial'] == [
        'заготовка уже проходит все тесты — задача решается без изменений']
    assert result['broken'][0].startswith('эталон не собрался — load:')
    assert result['same'] == ['эталонные тесты не ловят сломанную версию: то же самое']
    assert result['syntax'][0].startswith('сломанная версия 1 не собирается — load:')


def test_content_django_tasks_pass():
    tasks = []
    for course_dir in django_courses():
        for path in sorted(course_dir.rglob('*.yaml')):
            if path.name.startswith('_'):
                continue
            data = yaml.safe_load(path.read_text(encoding='utf-8'))
            if isinstance(data, dict) and data.get('type') == 'exercise':
                tasks.append({
                    'name': str(path.relative_to(CONTENT)),
                    **{key: data[key] for key in
                       ('files', 'solution', 'check', 'setup', 'settings')
                       if key in data},
                })
    if not tasks:
        pytest.skip('в content/ пока нет Django-задач')

    problems = {name: items for name, items in verify(tasks).items() if items}
    assert problems == {}
