---
title: Удобные и массовые операции
type: lesson
level: 2
reading_time: 11
---

## Теория
**«Найди или создай»** — `get_or_create(условия, defaults={…})`. Ищет объект по условиям; нет — создаёт из условий + `defaults`. Возвращает **кортеж** `(объект, created)`: `created` — `True`, если объект только что создан. В условия кладут то, по чему объект однозначно находится (уникальное поле), а остальное — в `defaults`: иначе поиск не найдёт существующий объект, создание упрётся в `unique`, и будет `IntegrityError`.

**«Найди и обнови, или создай»** — `update_or_create(условия, defaults={…}, create_defaults={…})`. Нашёл — записывает `defaults`, не нашёл — создаёт с `create_defaults` (если не задан — с `defaults`). Удобно для импорта: прайс поставщика по `slug` обновляет цену и остаток.

Обе функции под капотом — `get()`: если условиям подходит несколько строк, будет `MultipleObjectsReturned`.

**Массовое создание** — `bulk_create(список объектов)`: один `INSERT` на пачку вместо запроса на объект. 1000 товаров циклом с `create()` — 1000 запросов, `bulk_create` — несколько. Пачку задаёт `batch_size`, а SQLite ещё и ограничивает число параметров в запросе — Django сам режет пачки мельче. Ограничения `bulk_create`: метод `save()` модели и сигналы не вызываются; `ignore_conflicts=True` пропускает строки, нарушающие `unique`.

**Массовое изменение** — `bulk_update(объекты, ["поля"])`: разные значения для разных строк одним `UPDATE … CASE WHEN id = … THEN …`. Список полей обязателен.

## Наглядно
**Таблица 1.** Удобные и массовые операции.

| Метод | Что делает | Возвращает |
|---|---|---|
| `get_or_create(slug=…, defaults={…})` | найти или создать | `(obj, created)` |
| `update_or_create(slug=…, defaults={…})` | найти и обновить, или создать | `(obj, created)` |
| `bulk_create(objs, batch_size=500)` | `INSERT` пачками | список объектов |
| `bulk_create(objs, ignore_conflicts=True)` | пропустить дубли по `unique` | список объектов |
| `bulk_update(objs, ["price"])` | `UPDATE … CASE WHEN` | число строк |
| `qs.update(…)` | одно значение для всех | число строк |

## На практике
Задача: категория из импорта, обновление прайса, загрузка тысячи товаров и скидка 10 % с разными ценами.

### Шаг 1. get_or_create
Файл `orm.py`:
```python
cat, created = Category.objects.get_or_create(name="Коврики")
print(cat, created)
cat, created = Category.objects.get_or_create(name="Коврики")
print(cat.pk, created)
```
Результат:
```
Коврики True
3 False
```
Второй вызов нашёл созданную категорию.

Цену положили в условия, а не в `defaults` — `get_or_create(slug="aster-14", price="59990.00", defaults={…})`: товара с такой парой нет, Django пытается создать второй `aster-14`:
```
django.db.utils.IntegrityError: UNIQUE constraint failed: shop_product.slug
```

### Шаг 2. update_or_create
Файл `orm.py`:
```python
p, created = Product.objects.update_or_create(
    slug="aster-14", defaults={"price": "59990.00", "stock": 5}
)
print(p.price, p.stock, created)
```
Результат:
```
59990.00 5 False
```
Нового товара в прайсе нет в базе — его создаст тот же вызов; поля для создания — в `create_defaults`:

Файл `orm.py`:
```python
mice = Category.objects.get(name="Мыши")
for _ in range(2):
    p, created = Product.objects.update_or_create(
        slug="mouse-pad",
        defaults={"stock": 10},
        create_defaults={"category": mice, "name": "Коврик",
                         "price": "490.00", "stock": 25},
    )
    print(p.stock, created)
```
Результат:
```
25 True
10 False
```
Первый раз — создан с `create_defaults`, второй — найден и обновлён `defaults`.

### Шаг 3. Тысяча товаров
Файл `orm.py`:
```python
from django.db import connection
from django.test.utils import CaptureQueriesContext
cat = Category.objects.get(name="Мыши")
rows = [
    Product(category=cat, name=f"Мышь {i}", slug=f"mouse-{i}", price="999.00")
    for i in range(1, 1001)
]
with CaptureQueriesContext(connection) as c:
    created = Product.objects.bulk_create(rows, batch_size=500)
print(len(created), len(c.captured_queries), created[0].pk)
print(Product.objects.count())
```
Результат:
```
1000 9 4
1003
```
9 запросов: `BEGIN`, 7 `INSERT` по 166 строк (последний — 4 строки) и `COMMIT`. 166 — предел SQLite по параметрам в одном запросе (6 колонок × 166 ≤ 999); в PostgreSQL такого предела нет — было бы 2 `INSERT` по 500. Циклом с `create()` только 100 товаров — уже 100 запросов.

### Шаг 4. Разные цены одним запросом
Файл `orm.py`:
```python
from decimal import Decimal
from django.db import connection
from django.test.utils import CaptureQueriesContext
products = list(Product.objects.order_by("id"))
for p in products:
    p.price = p.price * Decimal("0.9")
with CaptureQueriesContext(connection) as c:
    n = Product.objects.bulk_update(products, ["price"])
print(n, len(c.captured_queries))
print(list(Product.objects.order_by("id").values_list("price", flat=True)))
```
Результат:
```
3 3
[Decimal('58491.00'), Decimal('1349.10'), Decimal('3141.00')]
```
Запросы — `BEGIN`, один `UPDATE` и `COMMIT`:
```
UPDATE "shop_product" SET "price" = (CAST(CASE WHEN ("shop_product"."id" = 1) THEN (CAST('58491.000' AS NUMERIC)) WHEN ("shop_product"."id" = 2) THEN (CAST('1349.100' AS NUMERIC)) WHEN ("shop_product"."id" = 3) THEN (CAST('3141.000' AS NUMERIC)) ELSE NULL END AS NUMERIC)) WHERE "shop_product"."id" IN (1, 2, 3)
```
Здесь хватило бы `update(price=F("price") * Decimal("0.9"))` без загрузки; `bulk_update` нужен, когда новые значения считает Python — например, из файла поставщика.

## Частые ошибки
- **Поле для поиска в `defaults` и наоборот.** Условия — то, по чему ищут (уникальное поле), `defaults` — что записать. Изменяемое поле в условиях — новый объект или `IntegrityError`.
- **Забыть распаковать кортеж.** `p = Product.objects.get_or_create(…)` — в `p` кортеж, `p.name` — `AttributeError: 'tuple' object has no attribute 'name'`.
- **Неуникальные условия.** `get_or_create(category__name="Мыши")` — `MultipleObjectsReturned: get() returned more than one Product -- it returned 2!`.
- **Ждать `save()` от `bulk_create`.** Переопределённый `save()` и сигналы не вызываются — то, что они заполняют (`slug`), заполните сами.
- **`bulk_update` без полей.** `bulk_update(objs, [])` — `ValueError: Field names must be given to bulk_update().`
- **`bulk_update` на десятки тысяч строк одним вызовом.** Огромный `CASE` медленный; задайте `batch_size`.

## Итог
**Найти или создать**
- `get_or_create` / `update_or_create` → `(obj, created)`; условия — уникальное, остальное — `defaults` (`create_defaults` — только для создания).

**Массово**
- `bulk_create` — `INSERT` пачками, без `save()` и сигналов; `ignore_conflicts` — пропустить дубли.
- `bulk_update(objs, ["поля"])` — разные значения одним `UPDATE … CASE`.

## Вопросы на собеседовании
<details><summary>Как работает `get_or_create` и в чём его подвох?</summary>

Делает `get()` по переданным условиям; если `DoesNotExist` — `create()` из условий и `defaults`. Возвращает `(объект, created)`. Подвохи: в условиях должно быть то, что однозначно определяет объект, иначе дубликат или `IntegrityError`; при одновременных запросах без `unique` на поле возможна гонка и два объекта.
</details>

<details><summary>Чем `bulk_create` отличается от цикла с `create()`?</summary>

`bulk_create` вставляет объекты пачками в несколько `INSERT` вместо запроса на каждый объект — на порядки быстрее. Цена: не вызываются `save()` модели и сигналы `pre_save`/`post_save`; `pk` объектов заполняется на базах с `RETURNING` (PostgreSQL, SQLite).
</details>

<details><summary>Когда `bulk_update`, а когда `update()`?</summary>

`update()` — одно значение (или выражение `F`) для всех строк, без загрузки объектов. `bulk_update` — у каждого объекта своё значение, посчитанное в Python; Django строит `UPDATE … SET поле = CASE WHEN id = … THEN … END`.
</details>

## Глубже
Импорт в транзакции, чтобы ошибка в середине не оставила половину данных, — раздел «Продвинутый ORM», тема «Транзакции». Данные от пользователя — следующая тема «Формы».
