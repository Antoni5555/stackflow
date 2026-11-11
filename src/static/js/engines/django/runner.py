"""Запуск Django-проекта ученика: тренажёр Django в браузере и тесты сайта.

Один и тот же файл выполняют Pyodide в Web Worker (js/engines/django/) и pytest
в обычном Python — как runner.py тренажёра Python.

Проект ученика — одно приложение shop из файлов {имя: текст}: models.py, views.py,
urls.py (он же ROOT_URLCONF), forms.py, admin.py, templates/… — всё внутри shop/.
Настройки задаёт тренажёр (configure). Каждый запуск:
1. приложение собирается заново из файлов (старые модули и модели выгружаются);
2. база — новая SQLite в памяти, таблицы создаёт migrate --run-syncdb
   (у приложения ученика нет файлов миграций);
3. выполняется setup — учебные данные через ORM;
4. выполняются запросы через тестовый клиент Django (без сервера) и строка ORM;
   у каждого — SQL, которые ушли в базу.
Задача (check) вместо запросов выполняет тесты: assert + fail, как у задач Python.
Добавки задачи к настройкам (settings:) действуют только на время запуска.

Тайм-аут здесь не реализован: зависший запрос останавливает страница
(перезапуском Web Worker), как в тренажёре Python.
"""
import ast
import contextlib
import importlib
import io
import itertools
import linecache
import logging
import os
import shutil
import sys
import tempfile
import traceback

APP = 'shop'
BASE_APPS = [
    'django.contrib.admin',
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'django.contrib.sessions',
    'django.contrib.messages',
]
# Настройки, которые задача менять не может: тренажёр собирает проект на них.
# AUTH_USER_MODEL Django читает один раз при старте — тренажёр же пересобирает
# приложение на каждом запуске, поэтому своя модель пользователя не поддерживается.
FIXED_SETTINGS = {
    'INSTALLED_APPS', 'DATABASES', 'ROOT_URLCONF', 'AUTH_USER_MODEL', 'TEMPLATES',
}
MAX_BODY = 200_000        # символов тела ответа: страница ученика больше не бывает
PROJECT = tempfile.mkdtemp(prefix='django-project-')
APP_DIR = os.path.join(PROJECT, APP)

_loaded = False           # приложение ученика сейчас в реестре Django
_runs = itertools.count()


def configure():
    """Настройки проекта тренажёра — один раз на процесс (Pyodide или pytest)."""
    from django.conf import settings
    if settings.configured:
        return
    # В Pyodide всегда работает цикл asyncio, и Django считает каждый вызов
    # «асинхронным» и запрещает работу с базой. Поток один — защита не нужна.
    os.environ['DJANGO_ALLOW_ASYNC_UNSAFE'] = 'true'
    settings.configure(
        DEBUG=True,
        SECRET_KEY='trainer-not-secret',
        ALLOWED_HOSTS=['*'],
        INSTALLED_APPS=BASE_APPS,
        MIDDLEWARE=[
            'django.middleware.security.SecurityMiddleware',
            'django.contrib.sessions.middleware.SessionMiddleware',
            'django.middleware.common.CommonMiddleware',
            'django.middleware.csrf.CsrfViewMiddleware',
            'django.contrib.auth.middleware.AuthenticationMiddleware',
            'django.contrib.messages.middleware.MessageMiddleware',
        ],
        ROOT_URLCONF=f'{APP}.urls',
        # файл, а не :memory: — у Django база в памяти переживает закрытие соединения;
        # каждый запуск — свой файл (fresh_database), в Pyodide он тоже в памяти
        DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3',
                               'NAME': os.path.join(PROJECT, 'db.sqlite3')}},
        TEMPLATES=[{
            'BACKEND': 'django.template.backends.django.DjangoTemplates',
            'DIRS': [],
            'OPTIONS': {
                # без кэша шаблонов: ученик правит шаблон — следующий запуск видит новый
                'loaders': [
                    'django.template.loaders.filesystem.Loader',
                    'django.template.loaders.app_directories.Loader',
                ],
                'context_processors': [
                    'django.template.context_processors.request',
                    'django.contrib.auth.context_processors.auth',
                    'django.contrib.messages.context_processors.messages',
                ],
            },
        }],
        DEFAULT_AUTO_FIELD='django.db.models.BigAutoField',
        STATIC_URL='/static/',      # ссылки на CSS админки; файлов тренажёр не отдаёт
        LANGUAGE_CODE='ru',
        TIME_ZONE='Europe/Moscow',
        USE_TZ=True,
        PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],  # быстро
        # страница 500 при DEBUG — короткая (ShortErrorReporter): полная страница Django
        # собирает переменные всех кадров и в Pyodide упирается в стек браузера
        DEFAULT_EXCEPTION_REPORTER=f'{__name__}.ShortErrorReporter',
    )
    import django
    django.setup()
    from django.test.utils import setup_test_environment
    # response.templates и response.context у тестового клиента
    setup_test_environment(debug=True)
    # ошибки view ученик видит в ответе — печатать их ещё и в консоль не нужно
    logging.getLogger('django.request').setLevel(logging.CRITICAL)
    sys.path.insert(0, PROJECT)


# --- Приложение ученика ---

def unload_app():
    """Выгрузить приложение прошлого запуска: модули, модели, кэши URL и шаблонов."""
    global _loaded
    from django.apps import apps
    if _loaded:
        apps.unset_installed_apps()
        _loaded = False
    apps.all_models.pop(APP, None)
    from django.contrib import admin
    for model in [m for m in admin.site._registry if m._meta.app_label == APP]:
        del admin.site._registry[model]
    for name in list(sys.modules):
        if name == APP or name.startswith(f'{APP}.'):
            del sys.modules[name]
    from django.template.utils import get_app_template_dirs
    from django.urls import clear_url_caches
    clear_url_caches()
    get_app_template_dirs.cache_clear()
    apps.clear_cache()


def write_files(files):
    shutil.rmtree(APP_DIR, ignore_errors=True)
    os.makedirs(APP_DIR)
    for name, text in {'__init__.py': '', **files}.items():
        path = os.path.join(APP_DIR, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as file:
            file.write(text)
    importlib.invalidate_caches()


def load_app(files):
    """Собрать приложение shop из файлов. Ошибка в models.py и т. п. — исключение."""
    global _loaded
    from django.apps import apps
    unload_app()
    write_files(files)
    try:
        apps.set_installed_apps([*BASE_APPS, APP])
    except BaseException:
        apps.unset_installed_apps()       # реестр как был: следующий запуск сможет
        raise
    _loaded = True
    # admin.py Django ищет при старте (autodiscover), а приложение появляется позже
    if 'admin.py' in files:
        importlib.import_module(f'{APP}.admin')
    # urls.py (а с ним views.py) — сразу: ошибка в них видна при сборке, а не падением
    # страницы ошибки Django во время запроса
    if 'urls.py' in files:
        importlib.import_module(f'{APP}.urls')


def fresh_database():
    """Новая пустая база (новый файл) и таблицы всех моделей."""
    from django.core.management import call_command
    from django.db import connections
    connections.close_all()
    old = connections['default'].settings_dict['NAME']
    name = os.path.join(PROJECT, f'db-{next(_runs)}.sqlite3')
    connections['default'].settings_dict['NAME'] = name
    with contextlib.suppress(FileNotFoundError):
        os.remove(old)
    call_command('migrate', run_syncdb=True, verbosity=0, interactive=False)


def task_settings(extra):
    """settings: задачи → аргументы override_settings.

    MIDDLEWARE и CONTEXT_PROCESSORS добавляются в конец списков тренажёра,
    остальное (LOGIN_URL, LOGIN_REDIRECT_URL…) заменяет значение целиком.
    """
    from django.conf import settings
    extra = dict(extra or {})
    fixed = sorted(FIXED_SETTINGS & set(extra))
    if fixed:
        raise ValueError(f'настройки {", ".join(fixed)} задача менять не может')
    if 'MIDDLEWARE' in extra:
        extra['MIDDLEWARE'] = [*settings.MIDDLEWARE, *extra['MIDDLEWARE']]
    processors = extra.pop('CONTEXT_PROCESSORS', None)
    if processors:
        templates = [{**engine, 'OPTIONS': {**engine['OPTIONS']}}
                     for engine in settings.TEMPLATES]
        options = templates[0]['OPTIONS']
        options['context_processors'] = [*options['context_processors'], *processors]
        extra['TEMPLATES'] = templates
    return extra


def import_extra(extra):
    """Middleware и контекст-процессоры ученика — импорт при сборке: ошибка сразу."""
    from django.utils.module_loading import import_string
    for path in [*extra.get('MIDDLEWARE', ()), *extra.get('CONTEXT_PROCESSORS', ())]:
        import_string(path)


class CheckFailed(Exception):
    """Системные проверки Django нашли ошибки в моделях или urls ученика."""


def system_checks():
    """Как manage.py check: ошибки моделей (нет max_digits и т. п.) — до запуска."""
    from django.apps import apps
    from django.core import checks
    found = [
        message for message in checks.run_checks(app_configs=[apps.get_app_config(APP)])
        if message.level >= checks.ERROR
    ]
    if found:
        raise CheckFailed('\n'.join(
            f'{message.obj}: ({message.id}) {message.msg}'.replace(f'{APP}.', '', 1)
            + (f'\n\tПОДСКАЗКА: {message.hint}' if message.hint else '')
            for message in found
        ))


# --- Ошибки ---

def student_path(filename):
    """Путь файла ученика для traceback (views.py, templates/…) или None."""
    if filename.startswith(APP_DIR + os.sep):
        return os.path.relpath(filename, APP_DIR).replace(os.sep, '/')
    return None


def format_error(error):
    """Ошибка как в терминале, но со строками только из файлов ученика."""
    if isinstance(error, CheckFailed):
        return f'SystemCheckError: Django нашёл ошибки:\n{error}'

    if isinstance(error, SyntaxError) and error.filename:
        error.filename = student_path(error.filename) or error.filename
        return ''.join(traceback.format_exception_only(error)).rstrip()
    summary = traceback.TracebackException.from_exception(error)
    frames = []
    for frame in summary.stack:
        name = student_path(frame.filename)
        if name:
            frame.filename = name
            frames.append(frame)
    summary.stack = traceback.StackSummary.from_list(frames)
    text = ''.join(summary.format()).rstrip()
    if not frames:      # ошибка внутри Django из-за кода ученика: только её текст
        text = ''.join(traceback.format_exception_only(error)).rstrip()
    return text


def short_error_page(error, request):
    """Страница 500 в тренажёре: тип ошибки, адрес, traceback по файлам ученика."""
    from django.utils.html import escape
    path = escape(request.path) if request is not None else ''
    return (
        f'<h1>{escape(type(error).__name__)} at {path}</h1>'
        f'<p>{escape(str(error))}</p>'
        f'<pre>{escape(format_error(error))}</pre>'
        '<p>Это страница ошибки при DEBUG = True. На сервере с DEBUG = False '
        'пользователь увидел бы только «Server Error (500)».</p>'
    )


def _reporter_class():
    from django.views.debug import ExceptionReporter

    class ShortErrorReporter(ExceptionReporter):
        def get_traceback_html(self):
            return short_error_page(self.exc_value, self.request)

        def get_traceback_text(self):
            return format_error(self.exc_value)

    return ShortErrorReporter


def __getattr__(name):
    # класс создаётся лениво: при импорте runner Django ещё не настроен
    if name == 'ShortErrorReporter':
        return _reporter_class()
    raise AttributeError(name)


# --- Запросы и ORM ---

@contextlib.contextmanager
def capture_queries(into):
    """SQL, ушедшие в базу внутри блока: [{sql, ms}]."""
    from django.db import connection
    from django.test.utils import CaptureQueriesContext
    with CaptureQueriesContext(connection) as context:
        try:
            yield
        finally:
            into.extend(
                {'sql': query['sql'], 'ms': round(float(query['time']) * 1000, 1)}
                for query in context.captured_queries
            )


def body_text(response):
    content_type = response.get('Content-Type', '')
    if getattr(response, 'streaming', False):
        return '(потоковый ответ)'
    if not content_type.startswith(('text/', 'application/json')):
        return f'({len(response.content)} байт, {content_type})'
    text = response.content.decode(response.charset or 'utf-8', errors='replace')
    return text[:MAX_BODY]


def make_request(spec):
    """Запрос через тестовый клиент: {method, path, data?} → ответ и SQL."""
    from django.test import Client
    client = Client(raise_request_exception=False)
    method = (spec.get('method') or 'GET').lower()
    queries = []
    with capture_queries(queries):
        send = getattr(client, method)
        response = send(spec.get('path') or '/', spec.get('data') or {})
    result = {
        'method': method.upper(),
        'path': spec.get('path') or '/',
        'status': response.status_code,
        'reason': response.reason_phrase,
        'headers': dict(response.items()),
        'body': body_text(response),
        'templates': [t.name for t in response.templates if t.name],
        'queries': queries,
    }
    exc_info = getattr(response, 'exc_info', None)
    if exc_info:
        result['error'] = format_error(exc_info[1])
    return result


def namespace():
    """Пространство имён для setup и строки ORM: модели ученика и частые помощники."""
    from django.apps import apps
    from django.db import models
    ns = {'__name__': '__orm__'}
    for name in ('Q', 'F', 'Count', 'Sum', 'Avg', 'Min', 'Max', 'Prefetch', 'Value'):
        ns[name] = getattr(models, name)
    for model in apps.get_app_config(APP).get_models():
        ns[model.__name__] = model
    from django.contrib.auth.models import User
    ns.setdefault('User', User)
    return ns


def run_orm(code, ns):
    """Код ORM как в shell: вывод print, значение последнего выражения, SQL."""
    buffer = io.StringIO()
    queries = []
    result = {'output': '', 'queries': queries}
    # текст — в linecache: traceback покажет строку кода, как в терминале
    linecache.cache['orm.py'] = (len(code), None, code.splitlines(True), 'orm.py')
    try:
        tree = ast.parse(code, filename='orm.py')
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = tree.body.pop()
        with contextlib.redirect_stdout(buffer), capture_queries(queries):
            exec(compile(tree, 'orm.py', 'exec'), ns)
            if last is not None:
                value = eval(compile(ast.Expression(last.value), 'orm.py', 'eval'), ns)
                if value is not None:
                    print(repr(value))
    except Exception as error:   # ошибка ученика — в ответ, а не наружу
        summary = traceback.TracebackException.from_exception(error)
        summary.stack = traceback.StackSummary.from_list(
            [frame for frame in summary.stack if frame.filename == 'orm.py'])
        result['error'] = ''.join(summary.format()).rstrip()
    result['output'] = buffer.getvalue()
    return result


def describe_models():
    """Модели для полосы «Модели»: поля, тип, null, на какую модель ссылается."""
    from django.apps import apps
    described = []
    for model in apps.get_app_config(APP).get_models():
        fields = []
        for field in model._meta.get_fields():
            if field.auto_created and not field.concrete:
                continue                  # обратные связи (product_set) — не колонки
            fields.append({
                'name': field.name,
                'type': field.get_internal_type(),
                'null': getattr(field, 'null', False),
                'pk': getattr(field, 'primary_key', False),
                'to': field.related_model.__name__ if field.related_model else None,
            })
        described.append({
            'name': model.__name__, 'table': model._meta.db_table, 'fields': fields,
        })
    return described


def prepare(files, setup, strict_setup=True):
    """Сборка, проверки, база и setup. → (ns, setup_error) или {'error', 'stage'}."""
    try:
        load_app(files)
        system_checks()
    except Exception as error:
        return {'error': format_error(error), 'stage': 'load'}
    try:
        fresh_database()
    except Exception as error:
        return {'error': format_error(error), 'stage': 'migrate'}
    ns = namespace()
    setup_error = None
    if setup:
        try:
            exec(compile(setup, 'setup.py', 'exec'), ns)
        except Exception as error:
            name = type(error).__name__
            setup_error = f'Учебные данные не загрузились: {name}: {error}'
            if strict_setup:
                return {'error': setup_error, 'stage': 'setup'}
            fresh_database()      # недогруженные данные — не в базе
            ns = namespace()
    return ns, setup_error


@contextlib.contextmanager
def with_settings(extra):
    """settings: задачи — на время запуска; ошибка в них — {'error'} вместо запуска."""
    from django.test.utils import override_settings
    try:
        overrides = task_settings(extra)
    except ValueError as error:
        yield {'error': f'settings: {error}', 'stage': 'load'}
        return
    with override_settings(**overrides):
        yield None


def run(files, setup='', requests=(), orm='', strict_setup=True, settings=None):
    """Полный запуск: запросы, ORM, модели; ошибка в файлах ученика — {'error'}.

    strict_setup=False (песочница): ошибка учебных данных — предупреждение setup_error,
    запуск продолжается (ученик мог переименовать модель, на которую рассчитан setup).
    """
    configure()
    with with_settings(settings) as failed:
        if failed:
            return failed
        prepared = prepare(files, setup, strict_setup)
        if isinstance(prepared, dict):
            return prepared
        ns, setup_error = prepared
        try:
            import_extra(settings or {})
        except Exception as error:
            return {'error': format_error(error), 'stage': 'load'}
        result = {
            'requests': [make_request(spec) for spec in requests],
            'models': describe_models(),
        }
        if setup_error:
            result['setup_error'] = setup_error
        if orm.strip():
            result['orm'] = run_orm(orm, ns)
        return result


# --- Проверка задачи ---

@contextlib.contextmanager
def max_queries(limit):
    """В тестах задачи: не больше limit SQL-запросов внутри блока."""
    queries = []
    with capture_queries(queries):
        yield queries
    if len(queries) > limit:
        raise AssertionError(f'{len(queries)} SQL-запросов, а можно не больше {limit}')


def templates_used(response):
    """В тестах задачи: имена шаблонов, которыми собран ответ (с базовыми и include)."""
    return [template.name for template in response.templates if template.name]


def test_namespace(ns):
    """Имена для тестов задачи: модели и помощники setup + клиенты и проверки."""
    from django.test import Client
    from django.urls import reverse
    return {
        **ns,
        'client': Client(),
        'csrf_client': Client(enforce_csrf_checks=True),
        'max_queries': max_queries,
        'templates_used': templates_used,
        'reverse': reverse,
    }


def check(files, setup='', tests=(), settings=None):
    """Кнопка «Проверить»: тесты задачи по порядку.

    → {'failed': [fail непройденных], 'total', 'error'} — error: traceback первого
    непройденного теста, если упал код ученика (а не assert). Каждый тест — в своей
    транзакции, которая откатывается: тесты не видят данных друг друга, только setup.
    Ошибка сборки, базы или setup — {'error', 'stage'}, как у run().
    """
    from django.db import transaction
    configure()
    with with_settings(settings) as failed:
        if failed:
            return failed
        prepared = prepare(files, setup)
        if isinstance(prepared, dict):
            return prepared
        ns, _ = prepared
        try:
            import_extra(settings or {})
        except Exception as error:
            return {'error': format_error(error), 'stage': 'load'}
        result = {'failed': [], 'total': len(tests), 'error': ''}
        for number, test in enumerate(tests, 1):
            env = test_namespace(ns)
            name = f'test {number}'
            lines = test['code'].splitlines(True)
            linecache.cache[name] = (len(test['code']), None, lines, name)
            try:
                with transaction.atomic():
                    try:
                        exec(compile(test['code'], name, 'exec'), env)
                    finally:
                        transaction.set_rollback(True)
            except AssertionError:
                result['failed'].append(test['fail'])
            except Exception as error:
                result['failed'].append(test['fail'])
                if not result['error']:
                    result['error'] = format_error(error)
        return result


# --- Тесты ученика (раздел «Тесты в Django») ---

WRONG_TESTS = 'Ваши тесты не проходят на правильном коде задачи — ошибка в тестах.'
NO_TESTS = 'В tests.py нет ни одного теста: методов TestCase с именем test_….'


def run_student_tests():
    """unittest для shop/tests.py, как manage.py test → (число тестов, успех, вывод)."""
    import unittest
    from django.test.utils import override_settings

    class Result(unittest.TextTestResult):
        def _exc_info_to_string(self, err, test):
            return format_error(err[1])      # traceback только по файлам ученика

    module = importlib.import_module(f'{APP}.tests')
    suite = unittest.defaultTestLoader.loadTestsFromModule(module)
    stream = io.StringIO()
    runner = unittest.TextTestRunner(
        stream=stream, verbosity=2, resultclass=Result)
    # manage.py test выключает DEBUG — тесты видят то же, что сервер
    with override_settings(DEBUG=False), contextlib.redirect_stdout(stream):
        result = runner.run(suite)
    return result.testsRun, result.wasSuccessful(), stream.getvalue()


def check_tests(files, mutants=(), settings=None):
    """Задача «напишите тесты»: tests.py ученика — в files.

    Тесты должны пройти на коде задачи (files) и упасть на каждой «сломанной»
    версии (mutant: {files — заменённые файлы, fail}). База — пустая, как у
    manage.py test: данные тесты создают сами (setUpTestData, setUp).
    → {'failed', 'total' (число мутантов), 'error', 'output'} или {'error', 'stage'}.
    """
    configure()
    with with_settings(settings) as failed:
        if failed:
            return failed

        def attempt(project):
            prepared = prepare(project, '')
            if isinstance(prepared, dict):
                return prepared
            try:
                import_extra(settings or {})
                return run_student_tests()
            except Exception as error:     # ошибка в tests.py (импорт, синтаксис)
                return {'error': format_error(error), 'stage': 'load'}

        first = attempt(files)
        if isinstance(first, dict):
            return first
        count, ok, output = first
        result = {'failed': [], 'total': len(mutants), 'error': '', 'output': output}
        if not count:
            result['failed'].append(NO_TESTS)
            return result
        if not ok:
            result['failed'].append(WRONG_TESTS)
            return result
        for mutant in mutants:
            outcome = attempt({**files, **mutant['files']})
            # сломанный код не собрался — тесты его тоже «поймали»
            if not isinstance(outcome, dict) and outcome[1]:
                result['failed'].append(mutant['fail'])
        return result
