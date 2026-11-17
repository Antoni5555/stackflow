"""Архив Django для тренажёра Django в браузере (Pyodide).

Берёт Django и его зависимости (asgiref, sqlparse) из установленных пакетов сайта —
та же версия, что у сайта, и без интернета. Убирает то, что в браузере не нужно:
переводы кроме en и ru (~5 МБ), статику админки, GIS и __pycache__.

Модули .py кладутся сразу байт-кодом (.pyc без исходника): иначе Pyodide при каждом
открытии страницы компилирует Django заново (~0,6 с из ~3 с старта). Архив от этого
вырастает с ~1,7 до ~3 МБ, но скачивается один раз. Байт-код зависит от версии Python:
собирать нужно на 3.12 — той же, что внутри Pyodide 0.27. Исходников Django в браузере
нет, но тренажёру они и не нужны: traceback показывает только файлы ученика.

Архив не хранится в git: собирается при сборке Docker-образа (до collectstatic)
и один раз локально: python manage.py build_django_bundle.
"""
import importlib.util
import marshal
import sys
import zipfile
from pathlib import Path

import asgiref
import django
import sqlparse
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

PACKAGES = (django, asgiref, sqlparse)
TRANSLATIONS = ('/locale/en/', '/locale/ru/')
PYODIDE_PYTHON = (3, 12)     # Python внутри Pyodide 0.27: байт-код должен совпадать


def bundle_path():
    return Path(settings.BASE_DIR) / 'static' / 'vendor' / 'django.zip'


def skip(relative):
    """Что не нужно тренажёру: путь внутри site-packages (django/contrib/...)."""
    path = f'/{relative}'
    if '/__pycache__/' in path or path.endswith('.pyc'):
        return True
    if path.endswith(('.po', '.mo')) and not any(lang in path for lang in TRANSLATIONS):
        return True
    return '/static/' in path or '/contrib/gis/' in path


def bytecode(source, relative):
    """Текст модуля → содержимое .pyc (заголовок + байт-код), как пишет сам Python.

    В заголовке нет времени и размера исходника: .pyc без .py Python не сверяет с ним.
    """
    code = compile(source, relative, 'exec', dont_inherit=True)
    header = importlib.util.MAGIC_NUMBER + bytes(12)   # флаги, время, размер — нули
    return header + marshal.dumps(code)


class Command(BaseCommand):
    help = 'Собрать облегчённый архив Django для тренажёра (static/vendor/django.zip).'

    def handle(self, *args, **options):
        if sys.version_info[:2] != PYODIDE_PYTHON:
            version = '.'.join(map(str, PYODIDE_PYTHON))
            raise CommandError(
                f'Нужен Python {version}, как внутри Pyodide: '
                'байт-код другой версии браузер не загрузит')
        target = bundle_path()
        target.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        archive = zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9)
        with archive:
            for package in PACKAGES:
                root = Path(package.__file__).parent
                for path in sorted(root.rglob('*')):
                    relative = path.relative_to(root.parent).as_posix()
                    if not path.is_file() or skip(relative):
                        continue
                    if relative.endswith('.py'):
                        source = path.read_bytes()
                        archive.writestr(f'{relative}c', bytecode(source, relative))
                    else:
                        archive.write(path, relative)
                    count += 1
        size = target.stat().st_size // 1024
        self.stdout.write(
            f'Django {django.get_version()}: {count} файлов, {size} КБ → {target}')
