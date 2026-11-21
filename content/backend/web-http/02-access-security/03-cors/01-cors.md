---
title: CORS
type: lesson
level: 2
reading_time: 12
---

## Теория
**Источник** (origin) — схема + домен + порт: `https://app.shop.example` и `https://shop.example` — разные источники, `http://` и `https://` — тоже, как и `:8000` и `:3000`.

Браузер соблюдает **политику одного источника** (same-origin policy): скрипт со страницы одного источника может **отправить** запрос на другой, но **прочитать ответ** — только если сервер это разрешил. Иначе любой сайт, который вы открыли, читал бы ваши заказы в магазине: браузер приложил бы к запросу cookie магазина.

**CORS** (Cross-Origin Resource Sharing) — способ, которым сервер разрешает чтение. Браузер добавляет к запросу с другого источника заголовок `Origin`, сервер отвечает:
- `Access-Control-Allow-Origin: https://app.shop.example` — этому источнику можно читать ответ;
- нет заголовка — браузер ответ скрипту не отдаст (в консоли — ошибка CORS), хотя сервер его отправил.

**Предварительный запрос** (preflight). Для «непростых» запросов — с методом кроме `GET`/`HEAD`/`POST`, с заголовком `Authorization` или с `Content-Type: application/json` — браузер сначала спрашивает разрешения запросом `OPTIONS` с заголовками `Access-Control-Request-Method` и `Access-Control-Request-Headers`. Сервер отвечает, что разрешено:
- `Access-Control-Allow-Methods` — методы;
- `Access-Control-Allow-Headers` — заголовки;
- `Access-Control-Max-Age` — сколько секунд помнить ответ, чтобы не спрашивать перед каждым запросом.

Не разрешил — основной запрос браузер даже не отправит.

Важно понимать, что CORS:
- **работает только в браузере**. `curl`, Python, мобильное приложение заголовки CORS не смотрят — **это не защита API**: доступ к данным по-прежнему решают токен и проверка прав;
- **ослабляет** политику одного источника, а не усиливает: каждая разрешённая запись — исключение из защиты браузера.

Поэтому источники перечисляют явно. `Access-Control-Allow-Origin: *` допустим для публичных данных без входа (каталог товаров); вместе с cookie (`Access-Control-Allow-Credentials: true`) звёздочку браузер не принимает. Сервер, который отвечает разными `Access-Control-Allow-Origin` в зависимости от `Origin`, ставит `Vary: Origin` — чтобы кэш не отдал ответ для одного источника другому.

В Django CORS настраивают пакетом `django-cors-headers`: `CORS_ALLOWED_ORIGINS = ["https://app.shop.example"]`.

## Наглядно
**Рисунок 1.** Предварительный запрос и основной запрос с другого источника.

![Рисунок 1. Страница app.shop.example хочет GET /api/orders/ с заголовком Authorization на api.shop.example. Браузер сначала отправляет OPTIONS с Origin и Access-Control-Request-Headers: authorization; сервер отвечает 204 с Allow-Origin, Allow-Methods, Allow-Headers, Max-Age 600. Затем браузер отправляет GET; ответ с Access-Control-Allow-Origin — скрипт его читает. Для evil.example сервер разрешений не дал — браузер GET не отправит](img/cors-preflight.svg)

**Таблица 1.** Заголовки CORS.

| Заголовок | Кто ставит | Смысл |
|---|---|---|
| `Origin` | браузер | откуда запрос |
| `Access-Control-Request-Method` / `-Headers` | браузер, в preflight | что собирается отправить |
| `Access-Control-Allow-Origin` | сервер | какому источнику можно читать ответ |
| `Access-Control-Allow-Methods` / `-Headers` | сервер, на preflight | разрешённые методы и заголовки |
| `Access-Control-Max-Age` | сервер, на preflight | сколько секунд помнить разрешение |
| `Access-Control-Allow-Credentials` | сервер | можно с cookie (тогда без `*`) |
| `Vary: Origin` | сервер | ответ зависит от `Origin` — для кэшей |

## На практике
Задача: мобильное веб-приложение магазина живёт на `https://app.shop.example` и ходит в API на другом домене. Учебный API разрешает только этот источник. `curl` сам `Origin` не ставит — добавляем его заголовком, как это сделал бы браузер; служебные заголовки убраны.

### Шаг 1. Простой запрос с разрешённого и чужого источника
С разрешённого:
```
$ curl -s -i http://localhost:8000/api/products/ -H 'Origin: https://app.shop.example'
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 70
Access-Control-Allow-Origin: https://app.shop.example
Vary: Origin

{"products": [{"id": 2, "name": "Беспроводная мышь"}]}
```
С чужого:
```
$ curl -s -i http://localhost:8000/api/products/ -H 'Origin: https://evil.example'
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 70

{"products": [{"id": 2, "name": "Беспроводная мышь"}]}
```
Сервер ответил обоим, и `curl` увидел тело. Разница — только в заголовке `Access-Control-Allow-Origin`: браузер на странице evil.example ответ скрипту не отдаст. CORS решает браузер, а не сервер.

### Шаг 2. Предварительный запрос
Перед `GET /api/orders/` с `Authorization` браузер спрашивает разрешения:
```
$ curl -s -i -X OPTIONS http://localhost:8000/api/orders/ -H 'Origin: https://app.shop.example' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization'
HTTP/1.1 204 No Content
Content-Type: text/html; charset=utf-8
Access-Control-Allow-Origin: https://app.shop.example
Vary: Origin
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Max-Age: 600
```
От evil.example:
```
$ curl -s -i -X OPTIONS http://localhost:8000/api/orders/ -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization'
HTTP/1.1 204 No Content
Content-Type: text/html; charset=utf-8
```
Без разрешений браузер основной `GET` не отправит. Следующие 600 секунд app.shop.example preflight для этого адреса повторять не будет.

### Шаг 3. Решение сервера в коде
Как учебный API выбирает заголовки — упрощённо:
```python
ALLOWED_ORIGINS = {"https://app.shop.example"}


def cors_headers(origin, preflight=False):
    if origin not in ALLOWED_ORIGINS:
        return {}
    headers = {"Access-Control-Allow-Origin": origin, "Vary": "Origin"}
    if preflight:
        headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE"
        headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        headers["Access-Control-Max-Age"] = "600"
    return headers


print(cors_headers("https://app.shop.example"))
print(cors_headers("https://evil.example"))
print(cors_headers("http://app.shop.example"))
```
Результат:
```
{'Access-Control-Allow-Origin': 'https://app.shop.example', 'Vary': 'Origin'}
{}
{}
```
`http://` вместо `https://` — другой источник, разрешения нет. Источник сравнивают целиком со списком, а не проверяют «содержит ли строка `shop.example`»: `https://shop.example.evil.example` содержит.

## Частые ошибки
- **Считать CORS защитой API.** `curl` и скрипты на сервере CORS игнорируют. Данные защищают токен и проверка прав.
- **Чинить ошибку CORS на клиенте.** Ошибку в консоли браузера исправляют настройкой сервера (`CORS_ALLOWED_ORIGINS`), а не заголовками в запросе.
- **Отражать любой `Origin`.** `Access-Control-Allow-Origin: <что пришло>` вместе с `Allow-Credentials: true` разрешает любому сайту читать ответы с cookie пользователя. Только явный список.
- **Проверять источник подстрокой.** `"shop.example" in origin` пропустит `https://shop.example.evil.example`. Сравнивать целиком.
- **Забыть про preflight.** `OPTIONS` упирается в проверку токена и получает 401 — браузер не отправит основной запрос. Preflight обрабатывают до аутентификации (так делает `django-cors-headers`).
- **`Vary: Origin` нет.** Кэш отдаёт ответ с `Allow-Origin` одного источника другому.

## Итог
**Политика одного источника**
- Источник — схема + домен + порт. Браузер не даёт скрипту читать ответ другого источника без разрешения.

**CORS**
- Сервер разрешает чтение: `Access-Control-Allow-Origin`; для непростых запросов — preflight `OPTIONS` с `Allow-Methods`/`Allow-Headers`/`Max-Age`.
- Только браузер; доступ к данным — токены и права.
- Источники — явным списком, `*` — только для публичных данных без cookie, `Vary: Origin`.

## Вопросы на собеседовании
<details><summary>Что такое CORS и зачем он нужен?</summary>

Механизм, которым сервер с помощью заголовков `Access-Control-Allow-*` разрешает браузеру отдавать ответ скриптам с других источников. Без него действует политика одного источника: страница не может читать ответы чужих сайтов, иначе любой сайт читал бы данные пользователя с другого сайта, используя его cookie.
</details>

<details><summary>Когда браузер отправляет preflight-запрос?</summary>

Перед «непростым» запросом с другого источника: метод кроме `GET`/`HEAD`/`POST`, нестандартные заголовки (`Authorization`, свои `X-…`) или `Content-Type` кроме `text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`. Браузер отправляет `OPTIONS` с `Origin`, `Access-Control-Request-Method` и `-Headers`; при отказе основной запрос не уходит. Ответ кэшируется на `Access-Control-Max-Age`.
</details>

<details><summary>Защищает ли CORS API от чужих клиентов?</summary>

Нет. CORS соблюдает только браузер; `curl`, серверный код и приложения отправляют любые запросы и читают ответы. CORS защищает пользователя браузера от чужих страниц, а API защищают аутентификация, авторизация и лимиты.
</details>

## Глубже
Атаки на сам API — перебор id, лишние поля, подбор пароля — следующая тема. Настройка `django-cors-headers` — курс DRF (этап 2).
