---
title: Производительность ORM
type: lesson
level: 3
reading_time: 12
---

## Теория
Медленная страница — почти всегда лишние запросы или лишние данные, а не «медленный Django». Порядок работы: сначала **измерить** (число запросов — журнал SQL, django-debug-toolbar; план запроса — `explain()`), потом исправлять.

**Лишние запросы и данные:**
- N+1 — `select_related`/`prefetch_related` (раздел «ORM: связи и N+1»);
- **`count()`** вместо `len(qs)`: `SELECT COUNT(*)` против загрузки всех строк в Python. Но если QuerySet всё равно будет выведен, `len()` после загрузки бесплатен — повторный запрос не нужен;
- **`exists()`** вместо `if qs:` — `SELECT 1 … LIMIT 1` против загрузки всех строк;
- **`values()`/`values_list()`/`only()`** — только нужные колонки (раздел «ORM: чтение данных»);
- подсчёты в базе — `aggregate`/`annotate` вместо циклов.

**Большие выгрузки.** `for order in Order.objects.all()` на 100 000 строк загружает все объекты в память и держит в кэше QuerySet. **`iterator(chunk_size=2000)`** отдаёт объекты по мере чтения и не кэширует их; в PostgreSQL — через серверный курсор порциями по `chunk_size`. Вместе с `values_list()` или `only()` — минимум памяти.

**План запроса.** `qs.explain()` показывает, как база будет выполнять запрос. Главное, что ищут:
- **полный перебор** таблицы — `SCAN` в SQLite, `Seq Scan` в PostgreSQL;
- **поиск по индексу** — `SEARCH … USING INDEX` в SQLite, `Index Scan` в PostgreSQL.

**Индексы** ускоряют поиск по колонке. Django сам создаёт их для первичного ключа, `ForeignKey`, `unique` и `db_index=True`; составные и частичные — в `Meta.indexes`. Индекс нужен колонкам, по которым часто ищут (`email` заказа, `slug`), но каждый индекс замедляет запись и занимает место — индекс «на всякий случай» не нужен. Подробно об индексах и `EXPLAIN` — курс SQL, раздел «Производительность и транзакции».

## Наглядно
**Таблица 1.** Что заменить.

| Медленно | Быстро | Почему |
|---|---|---|
| `len(Order.objects.filter(…))` | `.count()` | `COUNT(*)` вместо загрузки строк |
| `if Order.objects.filter(…):` | `.exists()` | `LIMIT 1` вместо всех строк |
| `for o in Order.objects.all()` (100 000) | `.iterator(chunk_size=2000)` | без кэша, порциями |
| `[o.email for o in Order.objects.all()]` | `values_list("email", flat=True)` | одна колонка, без объектов |
| поиск по колонке без индекса | `db_index=True` / `Meta.indexes` | `SEARCH … USING INDEX` вместо `SCAN` |
| цикл с суммой | `aggregate(Sum(…))` | считает база |

## На практике
Задача: ускорить поиск заказов по почте и выгрузку всех товаров. Модели и данные — как в прошлых темах.

### Шаг 1. План запроса
Файл `orm.py`:
```python
print(Order.objects.filter(email="anna@shop.example").explain())
print(Order.objects.filter(number="A-12").explain())
print(Product.objects.filter(category__name="Мыши").explain())
```
Результат:
```
2 0 0 SCAN shop_order
3 0 0 SEARCH shop_order USING INDEX sqlite_autoindex_shop_order_1 (number=?)
4 0 0 SCAN shop_category
8 0 0 SEARCH shop_product USING INDEX shop_product_category_id_14d7eea8 (category_id=?)
```
Это план SQLite в тренажёре; у PostgreSQL формат другой, но смысл тот же. По `email` — полный перебор (`SCAN`), по уникальному `number` и по `category_id` (индекс от `ForeignKey`) — поиск по индексу.

### Шаг 2. Индекс на email
Файл `models.py` (фрагмент):
```python
class Order(models.Model):
    # … поля

    class Meta:
        indexes = [models.Index(fields=["email"])]
```
Тот же `explain()`:
```
3 0 0 SEARCH shop_order USING INDEX shop_order_email_fa7dab_idx (email=?)
```
Имя индекса Django составил сам. В проекте после этого — `makemigrations` и `migrate`.

### Шаг 3. count, len и exists
Файл `orm.py`:
```python
from django.db import connection
from django.test.utils import CaptureQueriesContext
qs = Product.objects.filter(stock__gt=0)
with CaptureQueriesContext(connection) as c:
    n1 = qs.count()
    n2 = len(qs)
    n3 = qs.count()
    n4 = len(Product.objects.filter(stock__gt=0))
print(n1, n2, n3, n4)
for q in c.captured_queries:
    print(q["sql"][:70])
```
Результат:
```
3 3 3 3
SELECT COUNT(*) AS "__count" FROM "shop_product" WHERE "shop_product".
SELECT "shop_product"."id", "shop_product"."category_id", "shop_produc
SELECT "shop_product"."id", "shop_product"."category_id", "shop_produc
```
Три запроса на четыре вызова: `count()` после `len()` взял число из кэша уже загруженного QuerySet. `exists()` даёт `SELECT 1 AS "a" FROM "shop_order" WHERE "shop_order"."email" = 'anna@shop.example' LIMIT 1`, а `bool(qs)` — `SELECT` всех колонок всех подходящих строк.

### Шаг 4. Выгрузка без кэша
Добавим 5000 товаров (`bulk_create`) и пройдём по всем:

Файл `orm.py`:
```python
from django.db import connection
from django.test.utils import CaptureQueriesContext
cat = Category.objects.first()
Product.objects.bulk_create(
    [Product(category=cat, name=f"P{i}", slug=f"p-{i}", price="1.00") for i in range(5000)]
)
with CaptureQueriesContext(connection) as c:
    total = 0
    for p in Product.objects.only("id", "price").iterator(chunk_size=2000):
        total += 1
print(total, len(c.captured_queries))
qs = Product.objects.all()
for p in qs.iterator():
    break
print(qs._result_cache is None)
```
Результат:
```
5004 1
True
```
Один запрос, объекты не накапливаются в кэше QuerySet. В PostgreSQL тот же код читает строки серверным курсором по 2000.

## Частые ошибки
- **Оптимизировать без замера.** Сначала число запросов и `explain()`, потом правка.
- **`len(qs)` только ради числа.** Загружает все строки; нужно `count()`. Но если строки всё равно выводятся, `len()` после загрузки — без запроса.
- **`if qs:` для проверки.** Загружает всё; `exists()`.
- **Огромная выгрузка через `.all()`.** Память растёт со строками; `iterator()` + `values_list()`/`only()`.
- **Индекс на каждую колонку.** Каждый индекс замедляет `INSERT`/`UPDATE` и занимает место; индексируют то, по чему ищут.
- **`prefetch_related` с `iterator()` без `chunk_size`.** `ValueError: chunk_size must be provided when using QuerySet.iterator() after prefetch_related().` — предзагрузка идёт порциями, размер порции нужен.

## Итог
**Измерить**
- Журнал SQL / django-debug-toolbar; `explain()`: `SCAN`/`Seq Scan` — перебор, `SEARCH … USING INDEX`/`Index Scan` — индекс.

**Ускорить**
- `count()`, `exists()`, `values_list()`/`only()`, `aggregate`/`annotate`, `select_related`/`prefetch_related`.
- Большие выгрузки — `iterator(chunk_size=…)`; поиск — индекс (`db_index`, `Meta.indexes`).

## Вопросы на собеседовании
<details><summary>Чем отличаются `count()` и `len()` у QuerySet?</summary>

`count()` выполняет `SELECT COUNT(*)` и не загружает строки; если QuerySet уже вычислен, берёт длину кэша без запроса. `len()` вычисляет QuerySet целиком — загружает все строки в объекты. Нужно только число — `count()`; строки всё равно понадобятся — `len()` после загрузки бесплатен.
</details>

<details><summary>Как выгрузить 100 000 заказов, не съев всю память?</summary>

`Order.objects.values_list(...)` или `only(...)` с `.iterator(chunk_size=2000)`: строки читаются порциями (в PostgreSQL — серверным курсором) и не кэшируются в QuerySet. Запись в файл — потоково; для HTTP-ответа — `StreamingHttpResponse`.
</details>

<details><summary>Как понять, что запросу нужен индекс?</summary>

`qs.explain()` (или `EXPLAIN ANALYZE` в PostgreSQL): полный перебор (`Seq Scan`) по большой таблице для условия с высокой избирательностью — повод добавить индекс на колонки условия (`db_index=True`, `Meta.indexes`, составной — в порядке условий). После — снова `explain()` и замер.
</details>

## Глубже
Индексы, `EXPLAIN ANALYZE` и планировщик PostgreSQL — курс SQL, раздел «Производительность и транзакции». Кэширование страниц и запросов — курс «Redis» (этап 2).
