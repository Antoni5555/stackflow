"""Тренажёр Django: engines/django/runner.py в обычном Python и архив Django.

runner настраивает Django своими settings.configure(), а в pytest Django уже настроен
настройками сайта, — поэтому runner выполняется в отдельном процессе Python.
В браузере тот же файл выполняет Pyodide.
"""
import ast
import json
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest
from django.core.management import call_command

from apps.trainers.management.commands import build_django_bundle


ROOT = Path(__file__).resolve().parent.parent
RUNNER_DIR = ROOT / 'src' / 'static' / 'js' / 'engines' / 'django'

FILES = {
    'models.py': (
        'from django.db import models\n\n'
        'class Category(models.Model):\n'
        '    name = models.CharField(max_length=100)\n\n'
        'class Product(models.Model):\n'
        '    name = models.CharField(max_length=100)\n'
        '    category = models.ForeignKey(Category, on_delete=models.CASCADE)\n'
    ),
    'views.py': (
        'from django.shortcuts import render\n'
        'from .models import Product\n\n'
        'def product_list(request):\n'
        '    products = Product.objects.all()\n'
        '    return render(request, "shop/list.html", {"products": products})\n\n'
        'def broken(request):\n'
        '    return 1 / 0\n'
    ),
    'urls.py': (
        'from django.urls import path\n'
        'from . import views\n\n'
        'urlpatterns = [\n'
        '    path("products/", views.product_list),\n'
        '    path("broken/", views.broken),\n'
        ']\n'
    ),
    'templates/shop/list.html': (
        '{% for p in products %}'
        '<li>{{ p.name }} — {{ p.category.name }}</li>'
        '{% endfor %}'
    ),
}
SETUP = (
    'laptops = Category.objects.create(name="Ноутбуки")\n'
    'for n in range(3):\n'
    '    Product.objects.create(name=f"Ноутбук {n}", category=laptops)\n'
)


def run_all(*runs, action='run'):
    """Несколько запусков подряд в одном процессе — как в одном воркере браузера."""
    script = (
        'import json, sys\n'
        f'sys.path.insert(0, {str(RUNNER_DIR)!r})\n'
        'import runner\n'
        'runs = json.load(sys.stdin)\n'
        f'print(json.dumps([runner.{action}(**kwargs) for kwargs in runs]))\n'
    )
    result = subprocess.run(
        [sys.executable, '-c', script], input=json.dumps(runs),
        capture_output=True, text=True, check=True, timeout=60,
    )
    return json.loads(result.stdout)


def test_request_template_queries_and_orm():
    [result] = run_all({
        'files': FILES, 'setup': SETUP,
        'requests': [{'path': '/products/'}, {'path': '/broken/'}, {'path': '/nope/'}],
        'orm': 'print("всего:", Product.objects.count())\nProduct.objects.first().name',
    })
    page, broken, missing = result['requests']

    assert page['status'] == 200 and page['templates'] == ['shop/list.html']
    assert page['body'].count('<li>') == 3 and 'Ноутбук 0 — Ноутбуки' in page['body']
    # N+1: список товаров + по запросу категории на каждый товар
    assert len(page['queries']) == 4
    assert page['queries'][1]['sql'].startswith('SELECT "shop_category"')

    assert broken['status'] == 500
    # страница 500 — короткая: полная страница Django в Pyodide упирается в стек
    assert broken['body'].startswith('<h1>ZeroDivisionError at /broken/</h1>')
    assert 'site-packages' not in broken['body']
    assert broken['error'].endswith('ZeroDivisionError: division by zero')
    assert 'File "views.py", line 9, in broken' in broken['error']
    assert 'site-packages' not in broken['error']
    assert missing['status'] == 404

    assert result['orm']['output'] == "всего: 3\n'Ноутбук 0'\n"
    assert [m['name'] for m in result['models']] == ['Category', 'Product']
    category = result['models'][1]['fields'][2]
    assert category == {'name': 'category', 'type': 'ForeignKey', 'null': False,
                        'pk': False, 'to': 'Category'}


def test_every_run_is_fresh_project_and_database():
    """Второй запуск видит новые модели и шаблон; данные прошлого запуска не копятся."""
    changed = {
        **FILES,
        'models.py': FILES['models.py'] + (
            '\nclass Tag(models.Model):\n    name = models.CharField(max_length=30)\n'),
        'templates/shop/list.html': 'Товаров: {{ products|length }}',
    }
    first, second = run_all(
        {'files': FILES, 'setup': SETUP, 'requests': [{'path': '/products/'}]},
        {'files': changed, 'setup': SETUP, 'requests': [{'path': '/products/'}]},
    )

    assert first['requests'][0]['body'].count('<li>') == 3
    assert second['requests'][0]['body'] == 'Товаров: 3'
    assert [m['name'] for m in second['models']] == ['Category', 'Product', 'Tag']


def test_errors_in_student_files_then_recovery():
    syntax, checks, orm_error, recovered = run_all(
        {'files': {**FILES, 'views.py': 'def product_list(request:\n'}},
        {'files': {**FILES, 'models.py': FILES['models.py'] + (
            '\nclass Price(models.Model):\n    value = models.DecimalField()\n')}},
        {'files': FILES, 'orm': 'Product.objects.get(id=99)'},
        {'files': FILES, 'setup': SETUP, 'requests': [{'path': '/products/'}]},
    )

    assert syntax['stage'] == 'load'
    assert syntax['error'].startswith('  File "views.py", line 1')
    assert checks['stage'] == 'load'
    assert '(fields.E132)' in checks['error'] and 'Price.value' in checks['error']
    assert orm_error['orm']['error'].endswith(
        'Product.DoesNotExist: Product matching query does not exist.')
    assert 'Product.objects.get(id=99)' in orm_error['orm']['error']
    assert recovered['requests'][0]['status'] == 200


def test_post_and_setup_error():
    post, bad_setup, soft = run_all(
        {'files': FILES, 'requests': [{'method': 'POST', 'path': '/products/'}]},
        {'files': FILES, 'setup': 'Product.objects.create(name="без категории")'},
        # песочница: ошибка учебных данных — предупреждение, запросы выполняются
        {'files': FILES, 'setup': SETUP + 'Missing.objects.create()\n',
         'strict_setup': False, 'requests': [{'path': '/products/'}]},
    )

    assert post['requests'][0]['method'] == 'POST'
    assert post['requests'][0]['status'] == 200
    assert bad_setup['stage'] == 'setup'
    assert bad_setup['error'].startswith(
        'Учебные данные не загрузились: IntegrityError')
    assert soft['setup_error'].endswith("NameError: name 'Missing' is not defined")
    # недогруженные данные убраны — база пустая, страница открывается
    assert soft['requests'][0]['status'] == 200
    assert '<li>' not in soft['requests'][0]['body']


def check_all(*runs):
    return run_all(*runs, action='check')


def case(code, fail='не так'):
    return {'code': code, 'fail': fail}


def test_check_reports_failed_tests_in_order():
    tests = [
        case('assert client.get("/products/").status_code == 200', 'нет списка'),
        case('with max_queries(2):\n    client.get("/products/")', 'N+1'),
        case('assert templates_used(client.get("/products/")) == ["shop/list.html"]'),
        case('client.get("/broken/")', 'страница падает'),
        # тесты не видят данных друг друга: удаление откатилось
        case('Product.objects.all().delete()\nassert not Product.objects.exists()'),
        case('assert Product.objects.count() == 3', 'данные прошлого теста'),
    ]
    [result] = check_all({'files': FILES, 'setup': SETUP, 'tests': tests})

    assert result['total'] == 6
    assert result['failed'] == ['N+1', 'страница падает']
    # упал код ученика, а не assert, — traceback по его файлам
    assert 'File "views.py", line 9, in broken' in result['error']
    assert result['error'].endswith('ZeroDivisionError: division by zero')


def test_check_stops_on_broken_project():
    broken, bad_settings = check_all(
        {'files': {**FILES, 'views.py': 'def product_list(request:\n'},
         'tests': [case('1')]},
        {'files': FILES, 'tests': [case('1')],
         'settings': {'AUTH_USER_MODEL': 'shop.User'}},
    )
    assert broken['stage'] == 'load' and 'views.py' in broken['error']
    assert bad_settings['error'] == (
        'settings: настройки AUTH_USER_MODEL задача менять не может')


def test_settings_middleware_and_context_processor():
    files = {
        **FILES,
        'middleware.py': (
            'class Version:\n'
            '    def __init__(self, get_response):\n'
            '        self.get_response = get_response\n'
            '    def __call__(self, request):\n'
            '        response = self.get_response(request)\n'
            '        response["X-Shop"] = "1"\n'
            '        return response\n'
        ),
        'context.py': 'def shop_name(request):\n    return {"shop_name": "Lumo"}\n',
        'templates/shop/list.html': '{{ shop_name }}',
    }
    settings = {'MIDDLEWARE': ['shop.middleware.Version'],
                'CONTEXT_PROCESSORS': ['shop.context.shop_name'],
                'LOGIN_URL': '/enter/'}
    tests = [
        case('response = client.get("/products/")\n'
             'assert response["X-Shop"] == "1"\nassert response.content == b"Lumo"'),
        case('from django.conf import settings\n'
             'assert settings.LOGIN_URL == "/enter/"'),
    ]
    with_settings, missing, without = check_all(
        {'files': files, 'tests': tests, 'settings': settings},
        {'files': FILES, 'tests': tests, 'settings': settings},
        # следующий запуск — снова настройки тренажёра
        {'files': files, 'tests': tests},
    )
    assert with_settings['failed'] == []
    assert missing['stage'] == 'load'
    assert "No module named 'shop.middleware'" in missing['error']
    assert len(without['failed']) == 2


def test_admin_and_csrf_client():
    files = {
        **FILES,
        'admin.py': 'from django.contrib import admin\nfrom .models import Product\n\n'
                    'admin.site.register(Product)\n',
        'urls.py': 'from django.contrib import admin\n' + FILES['urls.py'].replace(
            'urlpatterns = [\n',
            'urlpatterns = [\n    path("admin/", admin.site.urls),\n'),
    }
    tests = [
        case('admin = User.objects.create_superuser("admin", "a@shop.ru", "x")\n'
             'client.force_login(admin)\n'
             'response = client.get("/admin/shop/product/")\n'
             'assert response.status_code == 200\n'
             'assert "Product object (3)" in response.content.decode()', 'админка'),
        # обычный клиент CSRF не проверяет, csrf_client — проверяет
        case('assert client.post("/products/").status_code == 200'),
        case('assert csrf_client.post("/products/").status_code == 403', 'csrf'),
    ]
    with_admin, without_admin = check_all(
        {'files': files, 'setup': SETUP, 'tests': tests},
        # следующий запуск без admin.py: модель снята с регистрации
        {'files': {**files, 'admin.py': ''}, 'setup': SETUP, 'tests': tests},
    )
    assert with_admin['failed'] == []
    assert without_admin['failed'] == ['админка']


STUDENT_TESTS = (
    'from django.test import TestCase\n'
    'from .models import Category, Product\n\n'
    'class ProductListTests(TestCase):\n'
    '    @classmethod\n'
    '    def setUpTestData(cls):\n'
    '        laptops = Category.objects.create(name="Ноутбуки")\n'
    '        Product.objects.create(name="Ноутбук 0", category=laptops)\n\n'
    '    def test_list_shows_product(self):\n'
    '        response = self.client.get("/products/")\n'
    '        self.assertContains(response, "Ноутбук 0")\n\n'
    '    def test_template(self):\n'
    '        response = self.client.get("/products/")\n'
    '        self.assertTemplateUsed(response, "shop/list.html")\n'
)
MUTANTS = [
    # список пустой — тест на содержимое страницы это замечает
    {'files': {'views.py': FILES['views.py'].replace(
        'Product.objects.all()', 'Product.objects.none()')}, 'fail': 'пустой список'},
    # другой шаблон с тем же текстом — замечает только assertTemplateUsed
    {'files': {
        'views.py': FILES['views.py'].replace('shop/list.html', 'shop/other.html'),
        'templates/shop/other.html': FILES['templates/shop/list.html'],
    }, 'fail': 'другой шаблон'},
]


def runner_text(name):
    """Сообщение ученику из runner.py (константа модуля)."""
    source = (RUNNER_DIR / 'runner.py').read_text(encoding='utf-8')
    return ast.literal_eval(source.split(f'\n{name} = ', 1)[1].split('\n', 1)[0])


def check_tests_all(*runs):
    return run_all(*runs, action='check_tests')


def test_student_tests_catch_mutants():
    only_content = STUDENT_TESTS.split('    def test_template')[0]
    wrong_name = STUDENT_TESTS.replace('Ноутбук 0")\n\n', 'Ноутбук 9")\n\n')
    full, weak, wrong, empty, broken = check_tests_all(
        {'files': {**FILES, 'tests.py': STUDENT_TESTS}, 'mutants': MUTANTS},
        {'files': {**FILES, 'tests.py': only_content}, 'mutants': MUTANTS},
        {'files': {**FILES, 'tests.py': wrong_name}, 'mutants': MUTANTS},
        {'files': {**FILES, 'tests.py': ''}, 'mutants': MUTANTS},
        {'files': {**FILES, 'tests.py': 'from .models import Nope\n'},
         'mutants': MUTANTS},
    )

    assert full['failed'] == [] and full['total'] == 2
    assert ('test_template (shop.tests.ProductListTests.test_template) ... ok'
            in full['output'])
    # тест только на содержимое не замечает подмену шаблона
    assert weak['failed'] == ['другой шаблон']
    assert wrong['failed'] == [runner_text('WRONG_TESTS')]
    assert 'FAIL: test_list_shows_product' in wrong['output']
    assert 'File "tests.py", line 12, in test_list_shows_product' in wrong['output']
    assert 'site-packages' not in wrong['output']
    assert empty['failed'] == [runner_text('NO_TESTS')]
    assert broken['stage'] == 'load' and "cannot import name 'Nope'" in broken['error']


def test_bundle_has_code_and_only_needed_translations(tmp_path, monkeypatch):
    target = tmp_path / 'django.zip'
    monkeypatch.setattr(build_django_bundle, 'bundle_path', lambda: target)
    call_command('build_django_bundle', stdout=open('/dev/null', 'w'))

    names = set(zipfile.ZipFile(target).namelist())
    packages = {'django/__init__.py', 'asgiref/__init__.py', 'sqlparse/__init__.py'}
    assert packages <= names
    assert 'django/conf/locale/ru/LC_MESSAGES/django.mo' in names
    assert 'django/conf/locale/de/formats.py' in names       # форматы нужны всем языкам
    assert not any(name.endswith('.mo') and '/locale/de/' in name for name in names)
    assert not any('/static/' in name or 'contrib/gis' in name for name in names)
    assert not any('__pycache__' in name for name in names)
    assert target.stat().st_size < 2_500_000


@pytest.mark.parametrize('path, skipped', [
    ('django/contrib/admin/static/admin/css/base.css', True),
    ('django/contrib/gis/db/models/fields.py', True),
    ('django/conf/locale/fr/LC_MESSAGES/django.po', True),
    ('django/conf/locale/ru/LC_MESSAGES/django.po', False),
    ('django/db/models/base.py', False),
])
def test_bundle_skips(path, skipped):
    assert build_django_bundle.skip(path) is skipped
