"""Весь content/ загружается так же, как на сервере при деплое (load_content).

Без этого теста ошибку в контенте (например, `title: NULL` — YAML читает его как
пустое значение) видно только на шаге деплоя: тесты зелёные, а сайт не обновился.
"""
from pathlib import Path

import pytest

from apps.courses.services.content_loader import ContentError, ContentLoader


CONTENT = Path(__file__).resolve().parent.parent / 'content'


@pytest.mark.django_db
def test_whole_content_loads():
    try:
        report = ContentLoader(CONTENT).load()
    except ContentError as error:
        message = f'load_content не загрузит content/ на сервере:\n{error}'
        pytest.fail(message, pytrace=False)

    assert report.created
