---
title: REST и CRUD
type: lesson
level: 2
reading_time: 12
---

## Теория
Страницы Django отдают HTML для человека: `/cart/`, `/cart/add/7/`, форма с кнопкой «Удалить». API отдаёт данные программе, и его адреса строят по-другому — по стилю **REST**:
- всё, с чем работает API, — **ресурсы**: товар, корзина, позиция корзины, заказ. У каждого — свой адрес;
- адрес — **существительное**: что за ресурс (`/api/v1/cart/items/8/`), а не что сделать (`/api/addToCart`);
- **действие** выражает метод HTTP, **итог** — код ответа (раздел «HTTP подробнее»);
- сервер не помнит клиента между запросами (**stateless**): каждый запрос несёт всё нужное — токен, параметры. Состояние (корзина) хранится как ресурс на сервере, а не в «сессии разговора».

Ресурсы бывают двух видов: **коллекция** (`/api/v1/products/` — список товаров) и **элемент** (`/api/v1/products/2/` — один товар). Вложенность показывает принадлежность: позиции корзины — `/api/v1/cart/items/`.

**CRUD** — четыре операции с данными (Create, Read, Update, Delete). В REST они ложатся на пары «метод + адрес».

**Таблица 1.** CRUD в REST.

| CRUD | Метод и адрес | Успех |
|---|---|---|
| Create | `POST /items/` (коллекция) | `201` + `Location` |
| Read | `GET /items/` или `GET /items/8/` | `200` |
| Update | `PATCH /items/8/` (часть) или `PUT /items/8/` (целиком) | `200` |
| Delete | `DELETE /items/8/` | `204` |

Пять адресов-шаблонов вместо десятка «глаголов» — и любой разработчик, знакомый с REST, угадает API без документации.

Правила оформления адресов: множественное число коллекций (`/products/`, не `/product/`), строчные буквы и дефисы (`/order-items/`), без расширений (`.json`) и без глаголов. Действия, которые не сводятся к CRUD (оплатить заказ, повторить), оформляют ресурсом-действием: `POST /api/v1/orders/126/payment/`.

## Наглядно
**Рисунок 1.** API корзины: ресурсы, методы и коды ответа.

![Рисунок 1. Ресурс-коллекция /api/v1/cart/items/ — POST создаёт позицию: 201 и Location /api/v1/cart/items/8/. Ресурс-элемент /api/v1/cart/items/8/ — GET читает (200), PATCH меняет количество (200), DELETE удаляет (204). Корзина целиком — GET /api/v1/cart/ с позициями и суммой. Страницы Django для сравнения: /cart/add/3/, /cart/remove/8/ — действия в адресе](img/cart-api.svg)

**Таблица 2.** Страницы Django и REST API для одной корзины.

| Действие | Страницы Django | REST API |
|---|---|---|
| показать корзину | `GET /cart/` → HTML | `GET /api/v1/cart/` → JSON |
| добавить товар | `POST /cart/add/3/` → редирект | `POST /api/v1/cart/items/` + JSON → `201` |
| изменить количество | `POST /cart/update/8/` (форма) | `PATCH /api/v1/cart/items/8/` → `200` |
| удалить | `POST /cart/remove/8/` | `DELETE /api/v1/cart/items/8/` → `204` |
| ошибка в данных | форма с ошибками, `200` | `422` + JSON с ошибками полей |

## На практике
Задача: API корзины для мобильного приложения магазина. Запросы — `curl` к учебному API магазина, служебные заголовки убраны. В корзине уже лежит позиция 7 — беспроводная мышь.

### Шаг 1. Прочитать и добавить
Корзина:
```
$ curl -s -i http://localhost:8000/api/v1/cart/
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 91

{"items": [{"id": 7, "product": 2, "quantity": 1, "price": "1499.00"}], "total": "1499.00"}
```
Добавить клавиатуру (товар 3) — `POST` в коллекцию:
```
$ curl -s -i -X POST http://localhost:8000/api/v1/cart/items/ -H 'Content-Type: application/json' -d '{"product": 3, "quantity": 1}'
HTTP/1.1 201 Created
Content-Type: application/json
Location: /api/v1/cart/items/8/
Content-Length: 58

{"id": 8, "product": 3, "quantity": 1, "price": "3990.00"}
```
Новая позиция получила адрес `/api/v1/cart/items/8/` — дальше клиент работает с ним.

### Шаг 2. Изменить и удалить
Две клавиатуры:
```
$ curl -s -i -X PATCH http://localhost:8000/api/v1/cart/items/8/ -H 'Content-Type: application/json' -d '{"quantity": 2}'
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 58

{"id": 8, "product": 3, "quantity": 2, "price": "3990.00"}
```
Сумма корзины пересчиталась — `1499 + 2 × 3990`:
```
$ curl -s http://localhost:8000/api/v1/cart/
{"items": [{"id": 7, "product": 2, "quantity": 1, "price": "1499.00"}, {"id": 8, "product": 3, "quantity": 2, "price": "3990.00"}], "total": "9479.00"}
```
Удалить позицию:
```
$ curl -s -i -X DELETE http://localhost:8000/api/v1/cart/items/8/
HTTP/1.1 204 No Content
Content-Type: text/html; charset=utf-8
```

### Шаг 3. Метод, которого нет, и адрес, которого нет
`PUT` для позиции в этом API не сделан:
```
$ curl -s -i -X PUT http://localhost:8000/api/v1/cart/items/7/ -H 'Content-Type: application/json' -d '{"quantity": 2}'
HTTP/1.1 405 Method Not Allowed
Content-Type: application/json
Allow: GET, PATCH, DELETE
Content-Length: 100

{"error": {"code": "method_not_allowed", "message": "Метод не поддерживается"}}
```
Опечатка в адресе:
```
$ curl -s -i http://localhost:8000/api/v1/carts/
HTTP/1.1 404 Not Found
Content-Type: application/json
Content-Length: 77

{"error": {"code": "not_found", "message": "Ресурс не найден"}}
```
405 — ресурс есть, метода нет (и `Allow` подсказывает, какие есть); 404 — нет самого ресурса. Так выбирает и маршрутизатор API — упрощённо:
```python
import re

ROUTES = [
    ("GET", r"/api/v1/cart/", "показать корзину"),
    ("POST", r"/api/v1/cart/items/", "добавить позицию"),
    ("GET", r"/api/v1/cart/items/(\d+)/", "показать позицию"),
    ("PATCH", r"/api/v1/cart/items/(\d+)/", "изменить позицию"),
    ("DELETE", r"/api/v1/cart/items/(\d+)/", "удалить позицию"),
]


def resolve(method, path):
    allowed = []
    for m, pattern, action in ROUTES:
        match = re.fullmatch(pattern, path)
        if match:
            if m == method:
                return 200, action, match.groups()
            allowed.append(m)
    if allowed:
        return 405, "Allow: " + ", ".join(allowed), ()
    return 404, "нет ресурса", ()


print(resolve("POST", "/api/v1/cart/items/"))
print(resolve("PATCH", "/api/v1/cart/items/8/"))
print(resolve("PUT", "/api/v1/cart/items/8/"))
print(resolve("GET", "/api/v1/carts/"))
```
Результат:
```
(200, 'добавить позицию', ())
(200, 'изменить позицию', ('8',))
(405, 'Allow: GET, PATCH, DELETE', ())
(404, 'нет ресурса', ())
```
Адрес выбирает ресурс, метод — действие над ним. В Django REST framework то же делают `ViewSet` и роутер: пять действий на два адреса.

## Частые ошибки
- **Глаголы в адресе.** `/api/getProducts`, `/api/cart/deleteItem/8` — действие уже есть в методе. `GET /api/v1/products/`, `DELETE /api/v1/cart/items/8/`.
- **Всё через `POST`.** `POST /api/v1/cart/items/8/` для изменения и удаления: клиент не знает, можно ли повторить запрос, кэши и инструменты не понимают смысла.
- **`200` на создание.** Клиенту нужен `201` и `Location` нового ресурса.
- **Единственное и множественное вперемешку.** `/api/product/2/` и `/api/orders/` в одном API. Коллекции — во множественном числе.
- **Глубокая вложенность.** `/api/users/1/orders/124/items/3/product/` — достаточно `/api/v1/orders/124/items/3/`; товар — свой ресурс со своим адресом.
- **Состояние «разговора» на сервере.** «Шаг 2 оформления» в памяти сервера ломается при повторе и на нескольких воркерах. Черновик заказа — ресурс.

## Итог
**REST**
- Ресурсы с адресами-существительными; коллекция и элемент; действие — метод, итог — код.
- Без состояния между запросами: всё нужное — в запросе.

**CRUD**
- `POST` коллекция → `201` + `Location`; `GET` → `200`; `PATCH`/`PUT` элемент → `200`; `DELETE` → `204`.
- 404 — нет ресурса, 405 + `Allow` — нет метода.

## Вопросы на собеседовании
<details><summary>Что такое REST?</summary>

Архитектурный стиль для API поверх HTTP: данные представлены ресурсами с уникальными URL, операции над ними — стандартные методы HTTP, результат — коды ответа, сервер не хранит состояние клиента между запросами, ответы можно кэшировать. REST — набор принципов, а не протокол или формат; на практике под «REST API» понимают JSON по HTTP с адресами-ресурсами.
</details>

<details><summary>Как спроектировать URL для заказов пользователя и их позиций?</summary>

Коллекция заказов — `/api/v1/orders/` (текущий пользователь — из токена, `user_id` в адрес не нужен), заказ — `/api/v1/orders/124/`, позиции — `/api/v1/orders/124/items/`. Множественное число, существительные, вложенность не глубже одного уровня; действия вне CRUD — ресурсом-действием (`POST /api/v1/orders/124/cancel/`).
</details>

<details><summary>Чем REST API отличается от страниц Django?</summary>

Страницы отдают HTML для браузера, используют формы (только `GET`/`POST`), редиректы после изменений и cookie-сессии. API отдаёт JSON для программ, использует все методы HTTP, коды ответа вместо страниц с ошибками и обычно токены. Логика (модели, ORM) общая — меняется представление.
</details>

## Глубже
Как отдавать длинные списки товаров по частям, с фильтрами и сортировкой, — следующая тема. ViewSet и роутеры DRF — курс DRF (этап 2).
