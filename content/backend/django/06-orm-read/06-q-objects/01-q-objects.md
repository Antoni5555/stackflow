---
title: Q-объекты
type: lesson
level: 2
reading_time: 10
---

## Теория
Все условия в `filter(a=…, b=…)` соединяются через **И**. Но поиску магазина нужно **ИЛИ**: «мышь в названии **или** в описании». Цепочкой `filter().filter()` этого не выразить — она тоже даёт И. Для сложных условий есть **`Q`** из `django.db.models`: условие, завёрнутое в объект, которое можно соединять операторами:
- **`Q(a) | Q(b)`** — ИЛИ (`OR`);
- **`Q(a) & Q(b)`** — И (`AND`), то же, что запятая;
- **`~Q(a)`** — НЕ (`NOT`);
- скобки работают как в SQL: `(Q(a) | Q(b)) & ~Q(c)`.

`Q` передают в `filter`, `exclude`, `get` первыми аргументами; обычные условия — после них: `filter(Q(price__lt=1000) | Q(stock=0), is_active=True)` — «(дешевле 1000 или нет в наличии) и активен». Наоборот — `filter(is_active=True, Q(…))` — синтаксическая ошибка Python: позиционный аргумент не может идти после именованного.

`Q` удобно собирать по шагам — например, из нескольких слов поиска: `query = Q()` (пустое условие, не меняет запрос) и `query &= Q(name__icontains=word)` для каждого слова.

## Наглядно
**Таблица 1.** Q и SQL.

| ORM | SQL |
|---|---|
| `filter(Q(a=1) \| Q(b=2))` | `WHERE (a = 1 OR b = 2)` |
| `filter(Q(a=1) & Q(b=2))`, `filter(a=1, b=2)` | `WHERE (a = 1 AND b = 2)` |
| `filter(~Q(a=1))`, `exclude(a=1)` | `WHERE NOT (a = 1)` |
| `filter(Q(a=1) \| Q(b=2), c=3)` | `WHERE ((a = 1 OR b = 2) AND c = 3)` |
| `query = Q(); query &= Q(…)` | условия добавляются по одному |

## На практике
Задача: поиск по названию и описанию, распродажа «дешёвые или закончившиеся среди активных» и все товары, кроме мышей.

### Шаг 1. Запросы
Файл `orm.py`:
```python
from django.db.models import Q
print(Product.objects.filter(Q(name__icontains="мышь") | Q(description__icontains="мышь")))
print(Product.objects.filter(Q(price__lt=1000) | Q(stock=0), is_active=True))
print(Product.objects.filter(~Q(category__name="Мыши")))
```
Результат:
```
<QuerySet [<Product: Беспроводная мышь>, <Product: Проводная мышь>, <Product: Игровая мышь>]>
<QuerySet [<Product: Ноутбук Nimbus Air>, <Product: Коврик для мыши>]>
<QuerySet [<Product: Ноутбук Aster 14>, <Product: Ноутбук Nimbus Air>, <Product: Коврик для мыши>]>
```

### Шаг 2. SQL
Колонки сокращены:
```
SELECT … FROM "shop_product" WHERE ("shop_product"."name" LIKE '%мышь%' ESCAPE '\' OR "shop_product"."description" LIKE '%мышь%' ESCAPE '\') LIMIT 21
SELECT … FROM "shop_product" WHERE (("shop_product"."price" < '1000' OR "shop_product"."stock" = 0) AND "shop_product"."is_active") LIMIT 21
SELECT … FROM "shop_product" INNER JOIN "shop_category" ON ("shop_product"."category_id" = "shop_category"."id") WHERE NOT ("shop_category"."name" = 'Мыши') LIMIT 21
```
Во втором запросе `OR` в скобках, а `is_active` — через `AND`: проводная мышь дешевле 1000, но неактивна и не попала.

### Шаг 3. Поиск по словам
Покупатель ищет «мышь игровая» — нужны товары, где есть **оба** слова:

Файл `queries.py` (фрагмент):
```python
from django.db.models import Q

from .models import Product


def search(text):
    query = Q()
    for word in text.split():
        query &= Q(name__icontains=word) | Q(description__icontains=word)
    return Product.objects.filter(query)
```
Для пустой строки `Q()` ничего не добавляет — вернутся все товары; обычно перед этим проверяют, что запрос не пустой.

### Шаг 4. Отрицание и NULL
У товаров есть необязательное поле `promo` (код акции, может быть `NULL`). В SQL `NOT (promo = 'SALE')` не нашёл бы строки с `NULL` — сравнение с `NULL` не даёт истины (курс SQL, «NULL»). Django это учитывает: для поля с `null=True` он сам дописывает проверку.

Файл `orm.py`:
```python
print(Product.objects.filter(~Q(promo="SALE")).query)
```
Результат (колонки сокращены):
```
SELECT … FROM "shop_product" WHERE NOT ("shop_product"."promo" = SALE AND "shop_product"."promo" IS NOT NULL)
```
Товары без акции попадают в ответ. (Кавычек вокруг `SALE` нет: `.query` показывает запрос приблизительно, значения в базу уходят отдельно.) В сыром SQL такую проверку пишут сами.

## Частые ошибки
- **Ждать ИЛИ от цепочки.** `filter(a).filter(b)` — это И; ИЛИ — только `Q(a) | Q(b)`.
- **Именованный аргумент перед Q.** `filter(is_active=True, Q(…))` — `SyntaxError: positional argument follows keyword argument`. Сначала `Q`, потом именованные.
- **Скобки при смешивании `|` и `&`.** В Python `&` сильнее `|`: `Q(a) | Q(b) & Q(c)` — это `a OR (b AND c)`. Ставьте скобки явно.
- **`|=` вместо `&=` при сборке условия.** Поиск «мышь игровая» с `query |= …` найдёт всё, где есть хоть одно слово, а не оба. Для «все слова» — `&=`.
- **Строка вместо Q.** `filter("price < 1000")` — не работает: ORM не принимает SQL-строки, условия — только именованные аргументы и `Q`.

## Итог
**Q**
- `Q(условие)`; `|` — ИЛИ, `&` — И, `~` — НЕ; скобки — как в SQL.
- В `filter` сначала `Q`, потом именованные условия (они через И).

**Динамические условия**
- `query = Q()` и `query &= …` / `query |= …` — собрать условие по частям.

## Вопросы на собеседовании
<details><summary>Как в Django ORM написать условие с OR?</summary>

С объектами `Q`: `Product.objects.filter(Q(name__icontains=q) | Q(description__icontains=q))`. Обычные именованные аргументы и цепочки `filter` соединяются только через AND. `Q` можно комбинировать `|`, `&`, `~` и вкладывать.
</details>

<details><summary>Чем `exclude(a=1, b=2)` отличается от `filter(~Q(a=1), ~Q(b=2))`?</summary>

`exclude(a=1, b=2)` — `NOT (a = 1 AND b = 2)`: исключить строки, где выполнены оба условия. `filter(~Q(a=1), ~Q(b=2))` — `NOT a = 1 AND NOT b = 2`: исключить строки, где выполнено хоть одно. По закону де Моргана это разные условия.
</details>

<details><summary>Как собрать фильтр из переменного числа условий?</summary>

Начать с пустого `Q()` и добавлять части `query &= Q(…)` (или `|=`) в цикле по словам поиска, выбранным фильтрам и т. п. Пустой `Q()` не меняет запрос. Для простых И-условий хватает и цепочки `qs = qs.filter(…)`.
</details>

## Глубже
Сравнение полей одной строки и обновление «от текущего значения» — следующая тема «F-выражения». Подсчёты и группировки — раздел «ORM: агрегация».
