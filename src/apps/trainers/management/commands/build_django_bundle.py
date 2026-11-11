"""Архив Django для тренажёра Django в браузере (Pyodide).

Берёт Django и его зависимости (asgiref, sqlparse) из установленных пакетов сайта —
та же версия, что у сайта, и без интернета. Убирает то, что в браузере не нужно:
переводы кроме en и ru (~5 МБ), статику админки, GIS и __pycache__.
Итог — ~1,7 МБ вместо 8,4 МБ колеса с PyPI.

Архив не хранится в git: собирается при сборке Docker-образа (до collectstatic)
и один раз локально: python manage.py build_django_bundle.
"""
import zipfile
from pathlib import Path

import asgiref
import django
import sqlparse
from django.conf import settings
from django.core.management.base import BaseCommand

PACKAGES = (django, asgiref, sqlparse)
TRANSLATIONS = ('/locale/en/', '/locale/ru/')


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


class Command(BaseCommand):
    help = 'Собрать облегчённый архив Django для тренажёра (static/vendor/django.zip).'

    def handle(self, *args, **options):
        target = bundle_path()
        target.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        archive = zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9)
        with archive:
            for package in PACKAGES:
                root = Path(package.__file__).parent
                for path in sorted(root.rglob('*')):
                    relative = path.relative_to(root.parent).as_posix()
                    if path.is_file() and not skip(relative):
                        archive.write(path, relative)
                        count += 1
        size = target.stat().st_size // 1024
        self.stdout.write(
            f'Django {django.get_version()}: {count} файлов, {size} КБ → {target}')
