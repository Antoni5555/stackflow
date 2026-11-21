---
title: Документация API
type: lesson
level: 2
reading_time: 11
---

## Теория
Чтобы мобильный разработчик или партнёр начал работать с API магазина, ему нужно знать: какие есть адреса и методы, какие параметры и тело принимает каждый, что вернётся и с какими кодами, нужен ли токен. Описание в вики устаревает с первым же изменением кода. Поэтому API описывают в машиночитаемом формате — **OpenAPI** (раньше назывался Swagger).

**OpenAPI** — документ в JSON или YAML (обычно `openapi.json` на самом сервере), в котором:
- `info` — название и версия API;
- `paths` — адреса; внутри — методы (`get`, `post`…), у каждого:
  - `summary` — что делает;
  - `parameters` — параметры: `in: query` (в строке запроса), `in: path` (часть адреса), `in: header`;
  - `requestBody` — тело запроса и его схема;
  - `responses` — коды ответа и схемы тел;
  - `security` — нужна ли аутентификация;
- `components.schemas` — **схемы** данных (на JSON Schema): поля, типы, `required` (обязательные), `enum` (допустимые значения), ограничения (`maxLength`, `minimum`). На схему ссылаются через `$ref`, чтобы не повторять её в каждом методе;
- `components.securitySchemes` — способы входа, например Bearer-токен.

Из одного документа получается всё остальное:
- **Swagger UI** (или ReDoc) — интерактивная страница документации: список методов, схемы, кнопка «Try it out», которая отправляет настоящий запрос;
- клиентские библиотеки для приложений (генераторы кода по OpenAPI);
- проверка, что ответы сервера соответствуют описанию.

Откуда берётся документ: FastAPI строит его **сам** из аннотаций типов (`/docs` — Swagger UI, `/openapi.json` — документ), в DRF — пакет `drf-spectacular`. Пишут его и вручную — «сначала контракт, потом код» (design-first), когда API согласуют с другой командой до разработки.

## Наглядно
**Рисунок 1.** Как читать описание метода в OpenAPI.

![Рисунок 1. paths → /api/v1/orders/ → post: summary «Оформить заказ из корзины»; requestBody → $ref на схему OrderCreate (delivery обязателен, enum courier/pickup; address — строка, обязателен для courier; comment до 500 символов); responses 201 → Order, 401, 422 → Error; security → bearer (JWT)](img/openapi-read.svg)

**Таблица 1.** Где в OpenAPI ответ на вопрос разработчика.

| Вопрос | Где искать |
|---|---|
| какие адреса есть | `paths` |
| какие параметры у списка | `paths./…/.get.parameters` |
| что отправить в теле | `requestBody` → `$ref` → `components.schemas` |
| какие поля обязательны | `required` в схеме |
| какие значения допустимы | `enum`, `minimum`, `maxLength` |
| что вернётся и с каким кодом | `responses` |
| нужен ли токен | `security` и `components.securitySchemes` |

## На практике
Задача: по документации API магазина понять, как оформить заказ из корзины. Документ отдаёт сам учебный API — `GET /api/v1/openapi.json`; ниже нужные куски в YAML (тот же документ, YAML удобнее читать).

### Шаг 1. Найти метод
Описание `POST /api/v1/orders/`:
```yaml
paths:
  /api/v1/orders/:
    post:
      summary: Оформить заказ из корзины
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/OrderCreate'
      responses:
        '201':
          description: Заказ создан
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Order'
        '401':
          description: Нужен токен
        '422':
          description: Ошибка в полях
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
      security:
      - bearer: []
```
Из него: тело — JSON по схеме `OrderCreate`, нужен Bearer-токен (`security`), ответы — `201` с заказом, `401` без токена, `422` с ошибкой в едином формате (`Error`).

### Шаг 2. Прочитать схему тела
Схема по ссылке `$ref`:
```yaml
components:
  schemas:
    OrderCreate:
      type: object
      required:
      - delivery
      properties:
        delivery:
          type: string
          enum:
          - courier
          - pickup
        address:
          type: string
          description: Обязателен для courier
        comment:
          type: string
          maxLength: 500
```
Обязательно только `delivery`, и только `courier` или `pickup`. Условие «адрес обязателен для курьера» схема простым `required` не выражает — оно в `description`. Так и вышло в теме «Ошибки и версии API»: `{"delivery": "courier"}` без адреса получил `422` и `{"address": ["Нужен адрес для курьера"]}`. Значит, правильный запрос:
```
$ curl -s -i -X POST http://localhost:8000/api/v1/orders/ -H 'Content-Type: application/json' -d '{"delivery": "courier", "address": "Казань, ул. Баумана, 1"}'
HTTP/1.1 201 Created
Content-Type: application/json
Content-Length: 28

{"id": 126, "status": "new"}
```

### Шаг 3. Обзор API программой
Документ — обычный JSON, его читает любой код. Список методов из `paths` (сокращённый документ):
```python
spec = {
    "paths": {
        "/api/v1/orders/": {
            "post": {
                "summary": "Оформить заказ из корзины",
                "responses": {"201": {}, "401": {}, "422": {}},
                "security": [{"bearer": []}],
            }
        },
        "/api/v1/products/": {
            "get": {
                "summary": "Список товаров",
                "parameters": [
                    {"name": "category", "in": "query"},
                    {"name": "sort", "in": "query"},
                    {"name": "page", "in": "query"},
                ],
                "responses": {"200": {}},
            }
        },
    }
}

for path, methods in spec["paths"].items():
    for method, op in methods.items():
        params = [p["name"] for p in op.get("parameters", [])]
        auth = "токен" if op.get("security") else "без токена"
        codes = ", ".join(op["responses"])
        print(method.upper(), path, "—", op["summary"])
        print("   ", auth, "| параметры:", params, "| коды:", codes)
```
Результат:
```
POST /api/v1/orders/ — Оформить заказ из корзины
    токен | параметры: [] | коды: 201, 401, 422
GET /api/v1/products/ — Список товаров
    без токена | параметры: ['category', 'sort', 'page'] | коды: 200
```
Так же Swagger UI строит страницу документации, а генераторы — код клиента: всё из одного документа.

## Частые ошибки
- **Документация отдельно от кода.** Вики и README расходятся с API через месяц. Документ генерируют из кода (FastAPI, `drf-spectacular`) или проверяют код по документу в тестах.
- **Описаны только успешные ответы.** Клиент не знает, что бывает `422` и в каком формате. В `responses` — и ошибки.
- **Нет `required` и `enum`.** «`delivery`: string» — какие строки? Ограничения — в схеме, а не в устном знании.
- **Документация внутреннего API открыта всем.** Карта всех адресов и полей упрощает поиск дыр. Документацию API для партнёров публикуют, а внутреннего (админского) — закрывают входом.
- **Пример в документации не работает.** Примеры (`example`) проверяют запуском, как в этом курсе — `curl`.

## Итог
**OpenAPI**
- Машиночитаемое описание API: `paths` → методы → `parameters`, `requestBody`, `responses`, `security`; схемы — в `components.schemas`, ссылки — `$ref`.
- Обязательные поля — `required`, допустимые значения — `enum` и ограничения.

**Из документа**
- Swagger UI / ReDoc, клиентские библиотеки, проверки ответов.
- FastAPI строит документ сам, в DRF — `drf-spectacular`.

## Вопросы на собеседовании
<details><summary>Что такое OpenAPI и чем он отличается от Swagger?</summary>

OpenAPI — спецификация формата описания HTTP API (JSON/YAML): адреса, методы, параметры, тела, ответы, схемы данных, аутентификация. Swagger — исходное название спецификации (до версии 3.0) и набор инструментов вокруг неё: Swagger UI, Swagger Editor, генераторы кода.
</details>

<details><summary>Code-first или design-first?</summary>

Code-first: документ генерируется из кода (FastAPI, drf-spectacular) — всегда соответствует реализации, удобно для одной команды. Design-first: сначала согласуют OpenAPI-документ (контракт), потом пишут сервер и клиентов параллельно — удобно, когда API делают и используют разные команды. В обоих случаях документ должен проверяться автоматически.
</details>

<details><summary>Зачем в OpenAPI `$ref` и `components`?</summary>

Чтобы описывать схемы один раз и переиспользовать: схема `Order` нужна в ответе списка, детали и создания, схема `Error` — во всех ошибках. `$ref` ссылается на `components.schemas.<Имя>`; генераторы кода превращают такие схемы в классы.
</details>

## Глубже
Как вызывать API из Python — `httpx`, тайм-ауты, повторы, асинхронные запросы — следующий раздел «HTTP-клиенты». Автоматический OpenAPI в FastAPI — курс FastAPI (этап 2).
