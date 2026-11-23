---
title: "Слои приложения"
type: lesson
level: 3
reading_time: 14
---

## Теория
Оформление заказа нужно не только сайту: его вызывают из админки, из мобильного API и из фоновой задачи «повторить неоплаченные». Если проверка остатков и списание лежат прямо в обработчике HTTP-запроса (во **view** Django или в маршруте FastAPI), остальным приходится копировать код или притворяться браузером. А чтобы проверить правило «нельзя заказать больше, чем на складе», тест поднимает базу и шлёт запрос. Решение — разложить код по **слоям**, у каждого своя работа:

- **представление** (view, обработчик API) — говорит на языке HTTP: разбирает запрос, проверяет **формат** входа (число ли количество), вызывает сервис, превращает результат или ошибку в ответ со статусом. Бизнес-правил здесь нет;
- **сервисный слой** — бизнес-логика: «хватает ли товара», «списать остаток», «создать заказ». Ничего не знает про HTTP: не видит `request`, не возвращает `404` — при нарушении правила выбрасывает своё исключение (тема 7.07);
- **репозиторий** — доступ к данным: `get`, `add`, `list_available`. Скрывает, где лежат данные — в PostgreSQL, SQLite или в словаре. Сервис зависит от интерфейса репозитория, а не от базы (принцип D);
- **доменные объекты** — данные предметной области: `Product`, `Order` (часто `dataclass`, тема 7.11).

Зависимости направлены в одну сторону: представление → сервис → репозиторий. Нижние слои не знают о верхних. Поэтому один сервис работает и из view, и из фоновой задачи, а в тестах репозиторий в памяти заменяет базу.

В Django роль репозитория часто играют модели и менеджеры ORM (`Product.objects.filter(…)`), а сервисы кладут в модуль `services.py` приложения. Во FastAPI типичная раскладка — маршруты → сервисы → репозитории, а связывает их `Depends`.

## Наглядно
**Рисунок 1.** Запрос проходит слои сверху вниз; ошибка правила поднимается исключением и превращается в HTTP-статус только в представлении.

![Рисунок 1. Представление place_order_view: разбирает запрос, проверяет формат, отвечает 201, 400, 404 или 409. Ниже сервисный слой OrderService.place_order: проверяет остаток, списывает, создаёт заказ, выбрасывает OutOfStockError. Ниже репозитории ProductRepository и OrderRepository с методами get, save, add; их реализации — MemoryProductRepository для тестов и SqliteProductRepository для работы. Справа те же сервисы вызывают фоновая задача и админка](img/layers.svg)

**Таблица 1.** Что где лежит.

| Слой | Знает | Не знает | Пример |
|---|---|---|---|
| представление | HTTP: запрос, статусы, JSON | как хранятся данные, правила склада | `place_order_view(request, service)` |
| сервис | бизнес-правила, исключения приложения | HTTP, SQL | `OrderService.place_order(product_id, qty)` |
| репозиторий | где и как хранятся данные | правила и HTTP | `ProductRepository.get(id)`, `save(product)` |
| домен | поля и простое поведение объектов | всё остальное | `@dataclass class Product` |

**Таблица 2.** Признаки смешанных слоёв.

| Признак | Что не так |
|---|---|
| во view `if product.stock < qty` | бизнес-правило в представлении — не переиспользовать |
| сервис принимает `request` или возвращает `status=409` | сервис знает про HTTP |
| в сервисе `cursor.execute("SELECT …")` | сервис привязан к базе — тесту нужна БД |
| репозиторий решает, можно ли продать | правило в слое данных |

## На практике
Задача: переписать обработчик «оформить заказ», в котором смешано всё, на три слоя и проверить сервис без базы.

### Шаг 1. Всё в одном обработчике
Запрос — словарь, «база» — глобальный словарь, ответ — пара (статус, тело):
```python
PRODUCTS = {1: {"name": "Чайник", "stock": 3}}
ORDERS = []


def place_order_view(request):
    qty = request.get("qty")
    if not isinstance(qty, int) or qty <= 0:
        return 400, {"error": "qty — целое больше нуля"}
    product = PRODUCTS.get(request["product_id"])
    if product is None:
        return 404, {"error": "товар не найден"}
    if product["stock"] < qty:
        return 409, {"error": "не хватает на складе"}
    product["stock"] -= qty
    ORDERS.append({"product_id": request["product_id"], "qty": qty})
    return 201, {"order_id": len(ORDERS)}


print(place_order_view({"product_id": 1, "qty": 2}))
print(place_order_view({"product_id": 1, "qty": 2}))
```
Результат:
```
(201, {'order_id': 1})
(409, {'error': 'не хватает на складе'})
```
Работает, но правило «не больше остатка» живёт внутри HTTP-обработчика: фоновая задача должна собрать фальшивый `request`, а тест — разбирать статусы.

### Шаг 2. Домен и репозитории
Данные — `dataclass`, доступ к ним — репозитории. Здесь — в памяти:
```python
from dataclasses import dataclass


@dataclass
class Product:
    id: int
    name: str
    stock: int


class ShopError(Exception):
    pass


class ProductNotFoundError(ShopError):
    pass


class OutOfStockError(ShopError):
    pass


class MemoryProductRepository:
    def __init__(self, products):
        self.products = {p.id: p for p in products}

    def get(self, product_id):
        if product_id not in self.products:
            raise ProductNotFoundError(product_id)
        return self.products[product_id]

    def save(self, product):
        self.products[product.id] = product


class MemoryOrderRepository:
    def __init__(self):
        self.orders = []

    def add(self, product_id, qty):
        self.orders.append((product_id, qty))
        return len(self.orders)
```
Репозиторий отвечает только за «найти» и «сохранить». Ненайденный товар — исключение приложения, а не `404`: про HTTP этот слой не знает.

### Шаг 3. Сервис — бизнес-правила
Сервис получает репозитории в конструкторе (внедрение зависимостей) и ничего не знает про HTTP:
```python
class OrderService:
    def __init__(self, products, orders):
        self.products = products
        self.orders = orders

    def place_order(self, product_id, qty):
        product = self.products.get(product_id)
        if product.stock < qty:
            raise OutOfStockError(f"{product.name}: есть {product.stock}, нужно {qty}")
        product.stock -= qty
        self.products.save(product)
        return self.orders.add(product_id, qty)


service = OrderService(MemoryProductRepository([Product(1, "Чайник", 3)]), MemoryOrderRepository())
print(service.place_order(1, 2))
try:
    service.place_order(1, 2)
except OutOfStockError as e:
    print("ошибка:", e)
```
Результат:
```
1
ошибка: Чайник: есть 1, нужно 2
```
Правило проверено без HTTP и без базы. Тот же вызов `service.place_order(...)` подходит фоновой задаче и админке.

### Шаг 4. Тонкое представление
View проверяет формат, вызывает сервис и переводит исключения в статусы:
```python
def place_order_view(request, service):
    qty = request.get("qty")
    if not isinstance(qty, int) or qty <= 0:
        return 400, {"error": "qty — целое больше нуля"}
    try:
        order_id = service.place_order(request["product_id"], qty)
    except ProductNotFoundError:
        return 404, {"error": "товар не найден"}
    except OutOfStockError as e:
        return 409, {"error": str(e)}
    return 201, {"order_id": order_id}


service = OrderService(MemoryProductRepository([Product(1, "Чайник", 3)]), MemoryOrderRepository())
print(place_order_view({"product_id": 1, "qty": 2}, service))
print(place_order_view({"product_id": 1, "qty": 5}, service))
print(place_order_view({"product_id": 9, "qty": 1}, service))
print(place_order_view({"product_id": 1, "qty": "2"}, service))
```
Результат:
```
(201, {'order_id': 1})
(409, {'error': 'Чайник: есть 1, нужно 5'})
(404, {'error': 'товар не найден'})
(400, {'error': 'qty — целое больше нуля'})
```
Формат входа (`"2"` вместо числа) — забота представления, правило склада — сервиса. Отображение «исключение → статус» живёт в одном месте.

### Шаг 5. Другой репозиторий — тот же сервис
Репозиторий на SQLite (в памяти) с теми же методами `get` и `save`. Сервис не меняется:
```python
import sqlite3


class SqliteProductRepository:
    def __init__(self, conn):
        self.conn = conn

    def get(self, product_id):
        row = self.conn.execute(
            "SELECT id, name, stock FROM products WHERE id = ?", (product_id,)
        ).fetchone()
        if row is None:
            raise ProductNotFoundError(product_id)
        return Product(*row)

    def save(self, product):
        self.conn.execute(
            "UPDATE products SET stock = ? WHERE id = ?", (product.stock, product.id)
        )


conn = sqlite3.connect(":memory:")
conn.execute("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, stock INTEGER)")
conn.execute("INSERT INTO products VALUES (1, 'Чайник', 3)")
service = OrderService(SqliteProductRepository(conn), MemoryOrderRepository())
service.place_order(1, 2)
print(conn.execute("SELECT stock FROM products WHERE id = 1").fetchone())
```
Результат:
```
(1,)
```
Остаток списан в базе, а код сервиса — тот же, что работал со словарём. Для проверки правил тесты используют репозиторий в памяти и работают за миллисекунды; репозиторий на базе проверяют отдельными тестами.

## Частые ошибки
- **Бизнес-правила во view.** `if product.stock < qty` в обработчике — правило нельзя вызвать из фоновой задачи и проверить без HTTP. Правила — в сервисе.
- **Сервис знает про HTTP.** Принимает `request`, возвращает `(409, …)` или `JsonResponse`. Сервис выбрасывает исключения приложения; статусы — в представлении.
- **SQL в сервисе.** `conn.execute(...)` рядом с правилами — тесту нужна база, смена хранилища — переписывание сервиса. Доступ к данным — в репозитории.
- **Репозиторий с логикой.** `products.sell(id, qty)` сам проверяет остаток — правило спряталось в слое данных. Репозиторий: найти, сохранить, выбрать.
- **Слои ради слоёв.** Для страницы «О магазине» сервис и репозиторий не нужны. Слои окупаются там, где есть правила и несколько точек входа.
- **Ошибка формата в сервисе, ошибка правила во view.** «qty — не число» — формат запроса (представление); «на складе меньше» — правило (сервис).

## Итог
**Слои**
- Представление — HTTP и формат входа; сервис — бизнес-правила; репозиторий — данные; домен — объекты предметной области.
- Зависимости сверху вниз; нижние слои не знают о верхних.

**Связь между слоями**
- Сервис получает репозитории в конструкторе и выбрасывает исключения приложения.
- Представление переводит исключения в HTTP-статусы.

**Польза**
- Один сервис — для сайта, API, админки и фоновых задач.
- Тесты правил — с репозиторием в памяти, без базы и HTTP.

## Вопросы на собеседовании
<details><summary>Зачем нужен сервисный слой?</summary>

Чтобы бизнес-логика жила отдельно от способа доступа к приложению. Тогда одно правило вызывается из view, API, команды управления и фоновой задачи без копирования, а тесты проверяют его напрямую, без HTTP. Представление при этом остаётся тонким: разобрать запрос, вызвать сервис, вернуть ответ.
</details>

<details><summary>Что такое паттерн «Репозиторий»?</summary>

Объект, который скрывает хранилище за методами предметной области: `get`, `add`, `list_available`. Сервис работает с интерфейсом репозитория и не знает, PostgreSQL там, файл или словарь. Это упрощает тесты (репозиторий в памяти) и замену хранилища (принципы D и L: все реализации ведут себя одинаково для вызывающего кода).
</details>

<details><summary>Где в Django писать бизнес-логику?</summary>

Есть два подхода. «Толстые модели» — логика в методах моделей и менеджеров, view тонкие. «Сервисный слой» — функции или классы в `services.py`, которые используют ORM и вызываются из view, команд и задач Celery. В обоих случаях логику не пишут во view: оно только принимает запрос и отдаёт ответ.
</details>

## Глубже
Внутри репозитория на базе нужны транзакции: списание остатка и создание заказа должны пройти вместе или не пройти вовсе — курс SQL, тема «Транзакции». В Django сервис оборачивают в `transaction.atomic()`. Подход целиком описан в книге «Паттерны разработки на Python: TDD, DDD и событийно-ориентированная архитектура» (Персиваль, Грегори).
