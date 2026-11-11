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
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'django.contrib.sessions',
    'django.contrib.messages',
]
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
        LANGUAGE_CODE='ru',
        TIME_ZONE='Europe/Moscow',
        USE_TZ=True,
        PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],  # быстро
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


def run(files, setup='', requests=(), orm=''):
    """Полный запуск: запросы, ORM, модели; ошибка в файлах ученика — {'error'}."""
    configure()
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
    if setup:
        try:
            exec(compile(setup, 'setup.py', 'exec'), ns)
        except Exception as error:
            message = f'Учебные данные не загрузились: {type(error).__name__}: {error}'
            return {'error': message, 'stage': 'setup'}
    result = {
        'requests': [make_request(spec) for spec in requests],
        'models': describe_models(),
    }
    if orm.strip():
        result['orm'] = run_orm(orm, ns)
    return result
