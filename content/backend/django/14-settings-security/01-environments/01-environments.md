---
title: Настройки по окружениям
type: lesson
level: 3
reading_time: 12
---

## Теория
`startproject` создаёт один `settings.py` для разработки: `DEBUG = True`, `SECRET_KEY` записан прямо в файле, `ALLOWED_HOSTS` пуст. На сервере всё должно быть наоборот. Держать два набора правок в одном файле и «не забыть поменять перед выкаткой» — путь к утечке. Решение — **настройки по окружениям** и **секреты в переменных окружения**.

Типичная схема — пакет `config/settings/`:
- `base.py` — общее: приложения, middleware, шаблоны, модели, язык;
- `dev.py` — `from .base import *` + `DEBUG = True`, простой ключ, локальные хосты;
- `prod.py` — `from .base import *` + `DEBUG = False`, ключ и хосты из окружения, HTTPS-настройки.

Какой файл использовать, говорит переменная **`DJANGO_SETTINGS_MODULE`**: `config.settings.dev` на машине разработчика, `config.settings.prod` на сервере. `manage.py`, `wsgi.py` и `asgi.py` ставят её по умолчанию через `os.environ.setdefault` — после перехода на пакет значение по умолчанию надо поправить. В `base.py` меняется и `BASE_DIR`: файл стал на уровень глубже — `.parent.parent.parent`.

Три настройки, от которых зависит безопасность:
- **`DEBUG`** — подробные страницы ошибок с кодом, настройками и SQL. На сервере только `False`, иначе любой посетитель увидит внутренности проекта;
- **`SECRET_KEY`** — ключ для подписей (сессии, CSRF, сброс пароля). Длинный, случайный (`get_random_secret_key()` — 50 символов), не в git, из окружения. Утёк — злоумышленник подделывает cookie сессий;
- **`ALLOWED_HOSTS`** — домены, на которые сайт отвечает. При `DEBUG = False` пустой список не допускается; запрос с чужим заголовком `Host` получает 400.

Секреты (`SECRET_KEY`, пароль базы, ключи почты и платёжки) читают через `os.environ["…"]`: при отсутствии переменной — `KeyError` сразу при старте, это лучше, чем тихо работать с пустым паролем. Локально переменные хранят в файле `.env` (в `.gitignore`) и загружают библиотекой `python-dotenv` или `django-environ`.

## Наглядно
**Рисунок 1.** Пакет настроек: общий `base.py` и два окружения.

![Рисунок 1. config/settings/base.py — INSTALLED_APPS, MIDDLEWARE, TEMPLATES, DATABASES из окружения; dev.py импортирует base, DEBUG True, ключ для разработки, localhost; prod.py импортирует base, DEBUG False, SECRET_KEY и ALLOWED_HOSTS из os.environ, HTTPS-настройки; выбор — DJANGO_SETTINGS_MODULE](img/settings-split.svg)

**Таблица 1.** Разработка и продакшен.

| Настройка | dev | prod |
|---|---|---|
| `DEBUG` | `True` | `False` |
| `SECRET_KEY` | любой, в файле | 50 случайных символов, `os.environ` |
| `ALLOWED_HOSTS` | `["localhost", "127.0.0.1"]` | домены сайта из окружения |
| база | локальная | пароль из окружения |
| `SECURE_SSL_REDIRECT`, `*_COOKIE_SECURE` | — | `True` |
| почта | консоль / Mailpit | SMTP, пароль из окружения |

## На практике
Задача: развести настройки магазина на разработку и продакшен. Вывод ниже — из настоящего проекта Django 5.2 (в тренажёре настройки задаёт он сам).

### Шаг 1. Пакет настроек
Файл `config/settings/dev.py`:
```python
from .base import *  # noqa: F403

DEBUG = True
SECRET_KEY = "dev-only-not-secret"
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
```
Файл `config/settings/prod.py`:
```python
import os

from .base import *  # noqa: F403

DEBUG = False
SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
ALLOWED_HOSTS = os.environ["DJANGO_ALLOWED_HOSTS"].split(",")

SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
```
Из `base.py` убраны `SECRET_KEY`, `DEBUG` и `ALLOWED_HOSTS`, `BASE_DIR` — на уровень выше, добавлен `STATIC_ROOT`.

### Шаг 2. Запуск с нужными настройками
Проверка с настройками разработки:
```bash
DJANGO_SETTINGS_MODULE=config.settings.dev python manage.py check
```
Вывод:
```
System check identified no issues (0 silenced).
```
Те же настройки `prod` без переменных окружения:
```
KeyError: 'DJANGO_SECRET_KEY'
```
Проект не стартует — сразу видно, чего не хватает.

### Шаг 3. Новый ключ
Случайный ключ генерирует сам Django:
```bash
python -c "from django.core.management.utils import get_random_secret_key as g; print(g())"
```
Ключ — 50 случайных символов; его кладут в переменную `DJANGO_SECRET_KEY` на сервере (в `.env` вне git, в секреты CI).

Пустой ключ обычный `check` пропускает, но первое же обращение к нему падает:
```
django.core.exceptions.ImproperlyConfigured: The SECRET_KEY setting must not be empty.
```

### Шаг 4. DEBUG выключен, хостов нет
Настройки с `DEBUG = False` и `ALLOWED_HOSTS = []` — `runserver` отказывается стартовать:
```
CommandError: You must set settings.ALLOWED_HOSTS if DEBUG is False.
```
Когда хосты заданы, запрос с чужим `Host` (например, `evil.example`) получает **400 Bad Request**.

## Частые ошибки
- **`SECRET_KEY` в git.** Он навсегда в истории репозитория. Ключ из окружения, а утёкший — сменить (все сессии станут недействительными).
- **`DEBUG = True` на сервере.** Страница ошибки показывает код, переменные, настройки (часть скрыта, но не всё) и SQL.
- **`ALLOWED_HOSTS = ["*"]`.** Отключает проверку заголовка `Host` — открывает подмену ссылок в письмах сброса пароля. Перечисляйте домены.
- **`os.environ.get("SECRET_KEY", "")`.** Тихий пустой ключ вместо ошибки при старте. Для обязательных секретов — `os.environ["…"]`.
- **Забыли `DJANGO_SETTINGS_MODULE` в `wsgi.py`.** Сервер запустится с `setdefault`-значением — возможно, с настройками разработки.
- **`BASE_DIR` после переноса в пакет.** Остался `.parent.parent` — пути к шаблонам, статике и базе смотрят не туда.

## Итог
**Окружения**
- `settings/base.py` + `dev.py` + `prod.py` (`from .base import *`); выбор — `DJANGO_SETTINGS_MODULE`.

**Секреты и безопасность**
- `SECRET_KEY`, пароли — `os.environ["…"]`, `.env` вне git.
- В продакшене: `DEBUG = False`, `ALLOWED_HOSTS` — домены сайта, HTTPS-настройки.

## Вопросы на собеседовании
<details><summary>Как организовать настройки Django для разных окружений?</summary>

Общие настройки — в `base.py`, отличия — в `dev.py`/`prod.py`, которые импортируют базу и переопределяют значения; модуль выбирается переменной `DJANGO_SETTINGS_MODULE`. Секреты и всё, что меняется между серверами, — из переменных окружения (12-factor app), локально — через `.env` и `python-dotenv`/`django-environ`.
</details>

<details><summary>Зачем нужен `SECRET_KEY` и что будет при утечке?</summary>

Им подписываются cookie сессий (при `signed_cookies`), CSRF-токены, ссылки сброса пароля, `signing.dumps`. Зная ключ, можно подделать подписанные данные и, например, войти под чужой сессией. При утечке ключ меняют; `SECRET_KEY_FALLBACKS` позволяет сменить его плавно.
</details>

<details><summary>Для чего `ALLOWED_HOSTS`?</summary>

Защита от подмены заголовка `Host` (HTTP Host header attack): Django строит абсолютные ссылки (сброс пароля, письма) по `Host`, и злоумышленник мог бы подставить свой домен. При `DEBUG = False` список обязателен; запрос с неразрешённым хостом получает 400 (`DisallowedHost`).
</details>

## Глубже
Остальные настройки безопасности и `check --deploy` — следующая тема. Переменные окружения в Docker и на сервере — курсы «Docker» и «Nginx и деплой».
