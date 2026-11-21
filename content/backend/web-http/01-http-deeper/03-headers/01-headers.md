---
title: Заголовки
type: lesson
level: 2
reading_time: 12
---

## Теория
Заголовки — строки `Имя: значение` после стартовой строки запроса и ответа. В них — всё «о сообщении»: в каком формате тело, кто клиент, можно ли кэшировать. Имена заголовков **не зависят от регистра** (`content-type` и `Content-Type` — одно и то же). Главные для API:

**Формат тела:**
- **`Content-Type`** — в каком формате **это** тело: `application/json`, `application/x-www-form-urlencoded`, `multipart/form-data`, `text/html; charset=utf-8`. Есть и в запросе (что отправил клиент), и в ответе (что вернул сервер);
- **`Accept`** — в каком формате клиент **хочет** ответ: `application/json`. `curl` и браузер по умолчанию шлют `Accept: */*` — «что угодно».

**Кто и откуда:**
- **`Authorization`** — учётные данные: `Bearer <токен>` (раздел «Доступ и безопасность»);
- **`User-Agent`** — программа клиента: `curl/8.5.0`, браузер, мобильное приложение;
- **`Host`** — домен, к которому обращается клиент (Django сверяет с `ALLOWED_HOSTS`).

**Кэширование:**
- **`Cache-Control`** — можно ли и сколько хранить ответ: `max-age=60` — минуту, `no-store` — не хранить вовсе (личные данные);
- **`ETag`** — «отпечаток» версии ресурса. Клиент сохраняет его и в следующий раз присылает в **`If-None-Match`**; если ресурс не менялся, сервер отвечает **304 Not Modified** без тела — экономия трафика.

Частая беда: клиент ждёт JSON, а получает HTML. Причины: адрес с опечаткой (ответ — HTML-страница 404 сервера), ошибка 500/502 со страницей ошибки, редирект на страницу входа. Клиент, который сразу делает `json.loads(ответ)`, падает с непонятной ошибкой. Поэтому перед разбором проверяют **код и `Content-Type` ответа**.

## Наглядно
**Рисунок 1.** `ETag` и `If-None-Match`: второй запрос за неизменившимся товаром получает 304 без тела.

![Рисунок 1. Первый GET /api/products/2/ → 200, ETag "1499.00-40", тело 87 байт; клиент запоминает ETag. Второй GET с If-None-Match "1499.00-40" → 304 Not Modified, тела нет — клиент берёт сохранённую копию. Если цена или остаток изменятся, ETag станет другим и ответ будет 200 с новым телом](img/etag.svg)

**Таблица 1.** Заголовки, которые встречаются в каждом API.

| Заголовок | Где | Пример | Зачем |
|---|---|---|---|
| `Content-Type` | запрос и ответ | `application/json` | формат этого тела |
| `Accept` | запрос | `application/json` | какой формат ответа нужен |
| `Authorization` | запрос | `Bearer token-anna` | кто делает запрос |
| `User-Agent` | запрос | `curl/8.5.0` | какая программа |
| `Location` | ответ | `/api/orders/125/` | адрес созданного ресурса, цель редиректа |
| `Cache-Control` | ответ | `max-age=60` | правила кэширования |
| `ETag` / `If-None-Match` | ответ / запрос | `"1499.00-40"` | проверка версии, 304 |
| `Retry-After` | ответ | `30` | через сколько повторить (429, 503) |

## На практике
Задача: кэширование карточки товара и разбор ответа, в котором вместо JSON пришёл HTML. Запросы — `curl` к учебному API, служебные заголовки убраны.

### Шаг 1. ETag и 304
Первый запрос:
```
$ curl -s -i http://localhost:8000/api/products/2/
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: max-age=60
ETag: "1499.00-40"
Content-Length: 87

{"id": 2, "name": "Беспроводная мышь", "price": "1499.00", "stock": 40}
```
Повтор с сохранённым `ETag`:
```
$ curl -s -i http://localhost:8000/api/products/2/ -H 'If-None-Match: "1499.00-40"'
HTTP/1.1 304 Not Modified
ETag: "1499.00-40"
Content-Length: 0
```
В учебном API `ETag` строится из цены и остатка (декоратор Django `@etag`): изменится любое из них — изменится и `ETag`.

### Шаг 2. HTML вместо JSON
Опечатка в адресе — `product` вместо `products`:
```
$ curl -s -i http://localhost:8000/api/product/2/
HTTP/1.1 404 Not Found
Content-Type: text/html; charset=utf-8
Content-Length: 179

<!doctype html>
<html lang="en">
<head>
  <title>Not Found</title>
</head>
<body>
  <h1>Not Found</h1><p>The requested resource was not found on this server.</p>
</body>
</html>
```
Маршрута нет — ответил не view API, а сам Django своей HTML-страницей 404. `Content-Type: text/html` сразу говорит, что JSON здесь не ждать.

### Шаг 3. Тело без Content-Type
`curl -d` без заголовка отправляет данные как форму — `Content-Type: application/x-www-form-urlencoded`, хотя внутри JSON:
```
$ curl -s -i -X POST http://localhost:8000/api/orders/ -d '{"product": 2, "quantity": 1}'
HTTP/1.1 415 Unsupported Media Type
Content-Type: application/json
Content-Length: 62

{"error": "Ожидается Content-Type: application/json"}
```
API смотрит на заголовок, а не угадывает формат по содержимому. С `-H 'Content-Type: application/json'` заказ создаётся.

### Шаг 4. Разобрать заголовок в Python
Значение `Content-Type` может содержать параметры (`charset`); разбирать его по `split(";")` вручную не нужно:
```python
from email.message import Message
m = Message()
m["Content-Type"] = "application/json; charset=utf-8"
print(m.get_content_type(), m.get_param("charset"))
print(m["content-type"])
```
Результат:
```
application/json utf-8
application/json; charset=utf-8
```
Имя заголовка сработало в нижнем регистре — регистр не важен.

## Частые ошибки
- **`json.loads()` без проверки ответа.** HTML-страница ошибки даёт `JSONDecodeError` вместо понятного «404». Сначала код и `Content-Type`.
- **JSON без `Content-Type: application/json`.** `curl -d` и формы шлют `application/x-www-form-urlencoded` — сервер не поймёт или ответит 415.
- **Путать `Accept` и `Content-Type`.** `Accept` — какой ответ хочу, `Content-Type` — что в этом теле.
- **`Cache-Control: max-age` на личных данных.** Прокси или браузер отдадут заказ другому человеку на общем компьютере; для личного — `no-store` или `private`.
- **Сравнивать имена заголовков с учётом регистра.** HTTP/2 передаёт их строчными; в Django — `request.headers["content-type"]` работает так же, как `["Content-Type"]`.

## Итог
**Формат**
- `Content-Type` — формат тела; `Accept` — желаемый формат ответа.

**Доступ и клиент**
- `Authorization: Bearer …`, `User-Agent`, `Host`.

**Кэш**
- `Cache-Control` (`max-age`, `no-store`); `ETag` + `If-None-Match` → 304 без тела.

## Вопросы на собеседовании
<details><summary>Чем `Accept` отличается от `Content-Type`?</summary>

`Content-Type` описывает формат тела сообщения, в котором стоит (в запросе — что отправил клиент, в ответе — что вернул сервер). `Accept` — заголовок запроса со списком форматов, которые клиент готов принять; по нему сервер выбирает формат ответа (content negotiation) или отвечает 406.
</details>

<details><summary>Как работает `ETag`?</summary>

Сервер отдаёт с ресурсом его версию-отпечаток в `ETag`. Клиент при повторном запросе присылает её в `If-None-Match`; если версия не изменилась, сервер отвечает 304 Not Modified без тела, и клиент использует сохранённую копию. Для изменения ресурса есть парный `If-Match` — защита от перезаписи чужих изменений (412 Precondition Failed).
</details>

<details><summary>Почему API может вернуть HTML вместо JSON?</summary>

Запрос не дошёл до view API: опечатка в URL (HTML-страница 404), исключение при `DEBUG` или 500 со страницей ошибки, 502/504 от Nginx, редирект на HTML-страницу входа. Клиент должен проверять код и `Content-Type` до разбора тела, а API — возвращать ошибки в JSON (свой `handler404`/`handler500` для `/api/`).
</details>

## Глубже
Форматы тела запроса — JSON, форма, multipart — следующая тема. `Authorization` и токены — раздел «Доступ и безопасность».
