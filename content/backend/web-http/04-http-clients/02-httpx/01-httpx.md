---
title: HTTP-клиент на Python
type: lesson
level: 3
reading_time: 13
---

## Теория
Магазину нужно ходить в чужие API: узнать стоимость доставки, создать платёж, получить пункты выдачи. В Python для этого — **`httpx`** (`pip install httpx`): тот же стиль, что у известной библиотеки `requests`, плюс асинхронный клиент и тайм-ауты по умолчанию.

Запрос — функция с именем метода, ответ — объект `Response`:
- `httpx.get(url, params={...})` — query-параметры словарём, `httpx` сам их кодирует (тема «Тело запроса»);
- `httpx.post(url, json={...})` — тело JSON, `Content-Type: application/json` ставится сам; `data={...}` — форма, `files={...}` — multipart;
- `headers={...}` — заголовки;
- `r.status_code`, `r.headers` (без учёта регистра имён), `r.text`, `r.json()`, `r.url`, `r.request` — что ушло.

**`httpx` не считает 4xx/5xx исключением**: `r` с кодом 404 — обычный ответ. Чтобы ошибка не прошла незамеченной, вызывают `r.raise_for_status()` — на 4xx/5xx он выбросит `httpx.HTTPStatusError` (в нём `e.response` и `e.request`). Ошибки сети — другие исключения: `httpx.ConnectError`, `httpx.ReadTimeout` и общий родитель `httpx.TransportError`.

**`httpx.Client`** — для нескольких запросов к одному сервису:
- `base_url` — дальше пишем только путь (`/v1/quote/`);
- общие `headers` — например, ключ API;
- `timeout` — тайм-аут для всех запросов;
- соединение переиспользуется (без повторного TCP- и TLS-рукопожатия на каждый запрос);
- закрывают через `with httpx.Client(...) as client:` или `client.close()`.

**Тайм-аут** у `httpx` по умолчанию — 5 секунд. Без тайм-аута зависшая служба доставки повесит view магазина, а за ним и воркер Gunicorn. Тайм-ауты разные: на соединение и на чтение — `httpx.Timeout(10.0, connect=2.0)`.

**Учебный сервис.** Из браузера настоящий запрос на чужой сервер не уйдёт (тема CORS), поэтому в уроках и задачах «службу доставки» заменяет функция-обработчик: `httpx.MockTransport(handler)` передаёт ей запрос, а она возвращает `httpx.Response`. Код клиента при этом такой же, как с настоящим сервером, — меняется только `transport=`. Так же `MockTransport` используют в тестах клиентов.

## Наглядно
**Рисунок 1.** Клиент службы доставки: что собирает `httpx` и что возвращает.

![Рисунок 1. httpx.Client с base_url https://delivery.example, общим заголовком Authorization: Bearer delivery-key и timeout 5. client.post("/v1/quote/", json={...}) превращается в POST https://delivery.example/v1/quote/ с Content-Type application/json и телом. Ответ Response: status_code 200, json() → {"price": "340.00", "days": 2}. На 404 raise_for_status() выбрасывает HTTPStatusError, на зависание — ReadTimeout](img/httpx-client.svg)

**Таблица 1.** Запрос и ответ в `httpx`.

| Что | Как |
|---|---|
| query-параметры | `params={"city": "Казань"}` |
| тело JSON | `json={"weight_kg": 1.2}` |
| форма / файлы | `data={...}` / `files={"photo": open(...)}` |
| заголовки | `headers={"Authorization": "Bearer …"}` |
| код и тело ответа | `r.status_code`, `r.json()`, `r.text` |
| ошибка на 4xx/5xx | `r.raise_for_status()` → `HTTPStatusError` |
| ошибки сети | `ConnectError`, `ReadTimeout` → `TransportError` |
| общий адрес, заголовки, тайм-аут | `httpx.Client(base_url=…, headers=…, timeout=…)` |

## На практике
Задача: клиент API службы доставки для магазина — пункты выдачи в городе и стоимость доставки посылки. Служба отвечает на `GET /v1/points/?city=…` и `POST /v1/quote/` (нужен ключ API).

### Шаг 1. Учебная служба и клиент
Обработчик-«служба доставки» и клиент к ней:
```python
import json

import httpx


def delivery_api(request):
    if request.url.path == "/v1/points/":
        city = request.url.params.get("city")
        if city != "Казань":
            return httpx.Response(200, json={"city": city, "points": []})
        points = ["ул. Баумана, 1", "пр. Победы, 141"]
        return httpx.Response(200, json={"city": city, "points": points})
    if request.url.path == "/v1/quote/":
        if request.headers.get("Authorization") != "Bearer delivery-key":
            return httpx.Response(401, json={"error": "Нужен ключ API"})
        data = json.loads(request.content)
        price = 290 + 50 * round(data["weight_kg"])
        return httpx.Response(200, json={"price": f"{price}.00", "days": 2})
    return httpx.Response(404, json={"error": "Нет такого адреса"})


client = httpx.Client(
    base_url="https://delivery.example",
    headers={"Authorization": "Bearer delivery-key"},
    timeout=5.0,
    transport=httpx.MockTransport(delivery_api),
)
```
Клиенту безразлично, кто отвечает: с настоящей службой строки `transport=` просто не было бы.

### Шаг 2. GET с параметрами и POST с JSON
Продолжение того же кода:
```python
r = client.get("/v1/points/", params={"city": "Казань"})
print(r.status_code, r.url)
print(r.json()["points"])

r = client.post("/v1/quote/", json={"city": "Казань", "weight_kg": 1.2})
print(r.status_code, r.json())
print(r.request.headers["Content-Type"], r.request.content)
```
Результат:
```
200 https://delivery.example/v1/points/?city=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C
['ул. Баумана, 1', 'пр. Победы, 141']
200 {'price': '340.00', 'days': 2}
application/json b'{"city":"\xd0\x9a\xd0\xb0\xd0\xb7\xd0\xb0\xd0\xbd\xd1\x8c","weight_kg":1.2}'
```
`params=` закодировал кириллицу в адресе, `json=` собрал тело (компактно, в UTF-8) и поставил `Content-Type`; заголовок `Authorization` пришёл из клиента.

### Шаг 3. Ошибка HTTP — не исключение
Опечатка в адресе:
```python
r = client.get("/v1/quotes/")
print(r.status_code, r.json())
try:
    r.raise_for_status()
except httpx.HTTPStatusError as e:
    print("HTTPStatusError:", e.response.status_code, e.request.url)
```
Результат:
```
404 {'error': 'Нет такого адреса'}
HTTPStatusError: 404 https://delivery.example/v1/quotes/
```
Без `raise_for_status()` код пошёл бы дальше и упал бы на `r.json()["price"]` с непонятным `KeyError`. В коде магазина `raise_for_status()` вызывают сразу после запроса, а `HTTPStatusError` ловят там, где понятно, что делать: показать «доставка недоступна» или повторить (следующая тема).

## Частые ошибки
- **Не проверять код ответа.** `r.json()["price"]` на ответе 401 — `KeyError` вместо понятной ошибки. `raise_for_status()` или проверка `r.status_code`.
- **`timeout=None`.** Зависшая служба повесит view и воркер Gunicorn. Тайм-аут — всегда; для медленных служб — больше, но конечный.
- **Новый клиент на каждый запрос.** `httpx.get(...)` в цикле открывает соединение заново каждый раз. Один `httpx.Client` на сервис.
- **Склеивать адрес и тело строками.** `f"/v1/points/?city={city}"` ломается на пробелах и `&`; `json.dumps` вручную забывает `Content-Type`. `params=` и `json=`.
- **Ключ API в коде.** `headers={"Authorization": "Bearer delivery-key"}` в репозитории — утечка. Ключ — из настроек (`.env`, курс Django, раздел «Настройки и безопасность»).
- **Ловить `Exception`.** Скрывает ошибки в своём коде. Ловят `httpx.HTTPStatusError` и `httpx.TransportError`.

## Итог
**Запрос**
- `client.get/post/...`; `params=`, `json=`, `data=`, `files=`, `headers=`.

**Ответ**
- `status_code`, `json()`, `headers`; 4xx/5xx — не исключение, нужен `raise_for_status()`.
- Ошибки сети — `TransportError` (`ConnectError`, `ReadTimeout`).

**Клиент**
- `httpx.Client(base_url, headers, timeout)` — один на сервис, тайм-аут всегда.
- `MockTransport(handler)` — учебный сервис и тесты.

## Вопросы на собеседовании
<details><summary>Чем `httpx` отличается от `requests`?</summary>

API похож, но `httpx` поддерживает и синхронный, и асинхронный клиент (`AsyncClient`), HTTP/2, строгие тайм-ауты по умолчанию (5 с; у `requests` по умолчанию тайм-аута нет) и подмену транспорта (`MockTransport`, `ASGITransport` для тестов приложений без сети).
</details>

<details><summary>Зачем использовать `Client`, а не `httpx.get`?</summary>

`Client` хранит пул соединений и переиспользует их: нет повторных TCP- и TLS-рукопожатий, запросы быстрее. Ещё в нём общие настройки — `base_url`, заголовки, тайм-ауты, cookies. Функции модуля (`httpx.get`) создают и закрывают клиент на каждый вызов.
</details>

<details><summary>Как обработать ошибки при вызове внешнего API?</summary>

Разделить: сетевые ошибки и тайм-ауты (`httpx.TransportError`) — сервис недоступен, можно повторить; ответы 5xx/429 — тоже временные; 4xx — ошибка нашего запроса, повтор не поможет. После запроса — `raise_for_status()`, в обработчике — запись в журнал и понятный ответ пользователю, а не 500.
</details>

## Глубже
Тайм-ауты, повторы и защита от двойного списания при повторе — следующая тема. Тесты Django-кода, который вызывает внешний API, — `MockTransport` или `unittest.mock` (курс Django, раздел «Тесты в Django»).
