"""Настройки production: проверяем в отдельном процессе, как на сервере.

В тестах уже загружены настройки test, поэтому production.py импортируем
в новом процессе Python с нужными переменными окружения.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest


SRC_DIR = Path(__file__).resolve().parent.parent / 'src'


def run_production(code, **env):
    """Выполняет code в процессе с настройками production, возвращает stdout."""
    environ = {
        **os.environ,
        'DJANGO_SETTINGS_MODULE': 'config.settings.production',
        'SECRET_KEY': 'test-production-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEF',
        'ALLOWED_HOSTS': 'example.com',
        **env,
    }
    result = subprocess.run(
        [sys.executable, '-c', code],
        cwd=SRC_DIR, env=environ, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


BACKEND = (
    'import django; django.setup(); '
    'from django.conf import settings; print(settings.EMAIL_BACKEND)'
)


@pytest.mark.parametrize(('email_host', 'backend'), [
    ('', 'django.core.mail.backends.console.EmailBackend'),
    ('smtp.example.com', 'django.core.mail.backends.smtp.EmailBackend'),
])
def test_email_backend(email_host, backend):
    """Без SMTP письма идут в лог (регистрация не падает), с SMTP — на почту."""
    assert run_production(BACKEND, EMAIL_HOST=email_host) == backend


def test_check_deploy():
    """manage.py check --deploy не находит проблем безопасности."""
    run_production(
        'from django.core.management import execute_from_command_line; '
        'execute_from_command_line(["manage.py", "check", "--deploy", '
        '"--fail-level", "WARNING"])',
    )


def test_collectstatic_rewrites_js_imports(tmp_path):
    """collectstatic как в образе: длинные цепочки import в JS (страница → терминал →
    учебный Docker) переписываются на файлы с хешем, а не падают на числе проходов."""
    code = (
        'import django; django.setup(); '
        'from django.conf import settings; '
        f'settings.STATIC_ROOT = {str(tmp_path)!r}; '
        'from django.core.management import call_command; '
        "call_command('collectstatic', '--noinput', verbosity=0); "
        'import pathlib; '
        f'root = pathlib.Path({str(tmp_path)!r}); '
        "loader = next(root.glob('js/engines/linux/docker-loader.*.js')); "
        'print(loader.read_text())'
    )
    loader = run_production(code)
    assert 'import("../docker/index.' in loader and '.js")' in loader
