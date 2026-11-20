---
title: Middleware
type: lesson
level: 3
reading_time: 11
---

## Теория
Между «пришёл HTTP-запрос» и «вызван view» запрос проходит через цепочку **middleware** — классов, каждый из которых может посмотреть или изменить запрос, а на обратном пути — ответ. Список и порядок — в настройке **`MIDDLEWARE`**:
```
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]
```
Запрос идёт **сверху вниз**, ответ возвращается **снизу вверх** — как матрёшка: первый в списке оборачивает всех остальных.

Что делают встроенные:
- **`SecurityMiddleware`** — заголовки безопасности (`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`), редирект на HTTPS (`SECURE_SSL_REDIRECT`), HSTS;
- **`SessionMiddleware`** — читает cookie `sessionid` и даёт `request.session`, после view сохраняет сессию;
- **`CommonMiddleware`** — `APPEND_SLASH` (`/catalog` → `/catalog/`), запрет по `DISALLOWED_USER_AGENTS`;
- **`CsrfViewMiddleware`** — проверяет CSRF-токен у POST и других небезопасных методов, иначе 403;
- **`AuthenticationMiddleware`** — кладёт в `request.user` пользователя из сессии;
- **`MessageMiddleware`** — одноразовые сообщения (`messages`).

Порядок не случаен: `AuthenticationMiddleware` берёт пользователя **из сессии**, поэтому стоит после `SessionMiddleware`; иначе — ошибка при первом же запросе. `SecurityMiddleware` — первым, чтобы редирект на HTTPS срабатывал до любой работы. Новый проект (`startproject`) получает правильный порядок, плюс `XFrameOptionsMiddleware` (`X-Frame-Options: DENY` — запрет показывать сайт во фрейме).

## Наглядно
**Рисунок 1.** Запрос проходит middleware сверху вниз, ответ — снизу вверх.

![Рисунок 1. Запрос → Security → Session (request.session) → Common → Csrf (проверка токена) → Authentication (request.user) → Message → view → ответ обратно через Message, Authentication, Csrf, Common, Session (сохранение сессии, cookie), Security (заголовки)](img/middleware-chain.svg)

**Таблица 1.** Что пропадёт без middleware.

| Убрать | Что сломается |
|---|---|
| `SessionMiddleware` | `request.session`; и вход — `AuthenticationMiddleware` требует сессию |
| `AuthenticationMiddleware` | `request.user` — `AttributeError` в view |
| `CsrfViewMiddleware` | защита от CSRF: POST без токена проходит |
| `MessageMiddleware` | `messages.success(…)` — ошибка |
| `SecurityMiddleware` | заголовки безопасности и редирект на HTTPS |

## На практике
Задача: посмотреть, какие middleware работают в тренажёре, что они добавляют к ответу и что ломается, если убрать или переставить нужные. Менять `MIDDLEWARE` на время запроса будем через `override_settings`, с новым тестовым клиентом.

### Шаг 1. Список и заголовки
Файл `orm.py`:
```python
from django.conf import settings
from django.test import Client
for m in settings.MIDDLEWARE:
    print(m)
r = Client().get("/page/")
for k, v in r.items():
    print(k, ":", v)
```
Результат:
```
django.middleware.security.SecurityMiddleware
django.contrib.sessions.middleware.SessionMiddleware
django.middleware.common.CommonMiddleware
django.middleware.csrf.CsrfViewMiddleware
django.contrib.auth.middleware.AuthenticationMiddleware
django.contrib.messages.middleware.MessageMiddleware
Content-Type : text/html; charset=utf-8
Content-Length : 2
X-Content-Type-Options : nosniff
Referrer-Policy : same-origin
Cross-Origin-Opener-Policy : same-origin
```
View `/page/` вернул только `HttpResponse("ok")`; три нижних заголовка добавил `SecurityMiddleware` на обратном пути.

### Шаг 2. Без сессий
Файл `orm.py`:
```python
from django.conf import settings
from django.test import Client, override_settings
mw = [m for m in settings.MIDDLEWARE if "SessionMiddleware" not in m]
with override_settings(MIDDLEWARE=mw):
    Client(raise_request_exception=True).get("/page/")
```
Первый же запрос:
```
django.core.exceptions.ImproperlyConfigured: The Django authentication middleware requires session middleware to be installed. Edit your MIDDLEWARE setting to insert 'django.contrib.sessions.middleware.SessionMiddleware' before 'django.contrib.auth.middleware.AuthenticationMiddleware'.
```
Та же ошибка, если `SessionMiddleware` есть, но стоит **после** `AuthenticationMiddleware`.

Без `AuthenticationMiddleware` (и зависящего от неё `MessageMiddleware`) view входа, которое после `login()` обращается к `request.user`, падает:
```
AttributeError: 'WSGIRequest' object has no attribute 'user'
```

### Шаг 3. Без CSRF
Файл `orm.py`:
```python
from django.conf import settings
from django.test import Client, override_settings
print(Client(enforce_csrf_checks=True).post("/page/").status_code)
mw = [m for m in settings.MIDDLEWARE if "CsrfViewMiddleware" not in m]
with override_settings(MIDDLEWARE=mw):
    print(Client(enforce_csrf_checks=True).post("/page/").status_code)
```
Результат:
```
403
200
```
POST без токена прошёл — защита от подделки запросов выключена для всего сайта.

## Частые ошибки
- **`AuthenticationMiddleware` раньше `SessionMiddleware`.** `ImproperlyConfigured … requires session middleware`. Порядок из `startproject` менять без причины не нужно.
- **Удалить `CsrfViewMiddleware`, «потому что мешает».** Сайт открыт для CSRF. Для отдельного view (вебхук платёжной системы) — `@csrf_exempt` и своя проверка подписи.
- **Своё middleware в начало списка.** Оно не увидит `request.user` и `request.session` — их ещё нет. Middleware, которому нужен пользователь, ставят после `AuthenticationMiddleware`.
- **Тяжёлая работа в middleware.** Она выполняется на **каждый** запрос, включая статику в разработке и проверки здоровья.
- **Забыть, что ответ идёт в обратном порядке.** Заголовок, который поставило нижнее middleware, верхнее может перезаписать.

## Итог
**Цепочка**
- `MIDDLEWARE` — порядок: запрос сверху вниз, ответ снизу вверх.

**Встроенные**
- Security (заголовки, HTTPS), Session (`request.session`), Common (`APPEND_SLASH`), Csrf (токен), Authentication (`request.user`, после Session), Message.

## Вопросы на собеседовании
<details><summary>Что такое middleware в Django и в каком порядке оно выполняется?</summary>

Слой между сервером и view: каждый класс из `MIDDLEWARE` получает запрос до view и ответ после. Запрос проходит список сверху вниз, ответ — снизу вверх; любой слой может вернуть ответ сам и не пустить запрос дальше.
</details>

<details><summary>Почему `AuthenticationMiddleware` стоит после `SessionMiddleware`?</summary>

`AuthenticationMiddleware` находит пользователя по id из сессии, а сессию (`request.session`) создаёт `SessionMiddleware`. В обратном порядке сессии ещё нет — Django сообщает `ImproperlyConfigured`.
</details>

<details><summary>Что делает `SecurityMiddleware`?</summary>

Добавляет заголовки безопасности: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, при настройке — `Strict-Transport-Security` (HSTS); перенаправляет HTTP на HTTPS при `SECURE_SSL_REDIRECT = True`. Стоит первым, чтобы редирект происходил до остальной обработки.
</details>

## Глубже
Своё middleware — следующая тема. Настройки HTTPS, HSTS и cookie — раздел «Настройки и безопасность».
