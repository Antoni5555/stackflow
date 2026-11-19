---
title: Lookups
type: lesson
level: 2
reading_time: 11
---

## Теория
`filter(price=1499)` — это проверка на равенство. Для остальных сравнений после имени поля через двойное подчёркивание пишут **lookup** — вид сравнения: `filter(price__lt=1000)` — «цена меньше 1000». Каждый lookup превращается в знакомое из курса SQL условие:
- **сравнения**: `__gt`, `__gte`, `__lt`, `__lte` (`>`, `>=`, `<`, `<=`); `__exact` — то же, что без lookup;
- **диапазон** `__range=(a, b)` — `BETWEEN a AND b`, границы включены;
- **список** `__in=[…]` — `IN (…)`; список может быть и QuerySet — тогда это подзапрос;
- **строки**: `__icontains` — содержит без учёта регистра (`ILIKE '%…%'`), `__contains` — с учётом; `__startswith`, `__endswith` (и `i…`-варианты), `__iexact` — равно без учёта регистра;
- **`__isnull=True`** — `IS NULL`; для строки без `null=True` пустое значение — `""`, и его ищут `filter(description="")`;
- **даты**: `__date` (дата от `DateTimeField`), `__year`, `__month`, `__day`, а потом ещё сравнение: `created_at__date__gte="2026-04-01"`. Django учитывает часовой пояс сайта: «2025 год» — это год по московскому времени;
- **через связь**: `category__name__icontains="мыш"` — сначала путь по связям, последним — lookup.

Значения для дат и чисел можно передавать строками (`"2026-04-01"`, `"1000"`) — Django приведёт их к типу поля.

В тренажёре база — SQLite: в ней `icontains` по-прежнему `LIKE` и не различает регистр только у латиницы. В PostgreSQL на сайте — `UPPER(…) LIKE UPPER(…)`, и регистр не важен для любых букв.

## Наглядно
**Таблица 1.** Lookups и SQL.

| Lookup | Пример | SQL |
|---|---|---|
| `__lt`, `__gte` | `price__lt=1000` | `price < 1000` |
| `__range` | `price__range=("1000", "5000")` | `price BETWEEN 1000 AND 5000` |
| `__in` | `slug__in=["aster-14", "mouse-pad"]` | `slug IN ('aster-14', 'mouse-pad')` |
| `__icontains` | `name__icontains="мышь"` | `name LIKE '%мышь%'` (SQLite), `UPPER(name) LIKE UPPER('%мышь%')` (PostgreSQL) |
| `__startswith` | `slug__startswith="nimbus"` | `slug LIKE 'nimbus%'` |
| `__isnull` | `paid_at__isnull=True` | `paid_at IS NULL` |
| `__year` | `created_at__year=2025` | `created_at BETWEEN '2024-12-31 21:00:00' AND '2025-12-31 20:59:59.999999'` |
| `__date__gte` | `created_at__date__gte="2026-04-01"` | дата по часовому поясу сайта `>= '2026-04-01'` |
| через связь | `category__name="Мыши"` | `JOIN shop_category … WHERE shop_category.name = 'Мыши'` |

## На практике
Задача: фильтры каталога — дешевле 1000, от 1000 до 5000, поиск «мышь», товары из подборки, товары 2025 года и новинки с апреля.

### Шаг 1. Запросы
Файл `orm.py`:
```python
print(Product.objects.filter(price__lt=1000))
print(Product.objects.filter(price__range=("1000", "5000")))
print(Product.objects.filter(name__icontains="мышь"))
print(Product.objects.filter(slug__in=["aster-14", "mouse-pad"]))
print(Product.objects.filter(created_at__year=2025))
print(Product.objects.filter(created_at__date__gte="2026-04-01"))
```
Результат:
```
<QuerySet [<Product: Проводная мышь>, <Product: Коврик для мыши>]>
<QuerySet [<Product: Беспроводная мышь>, <Product: Игровая мышь>]>
<QuerySet [<Product: Беспроводная мышь>, <Product: Проводная мышь>, <Product: Игровая мышь>]>
<QuerySet [<Product: Ноутбук Aster 14>, <Product: Коврик для мыши>]>
<QuerySet [<Product: Проводная мышь>, <Product: Коврик для мыши>]>
<QuerySet [<Product: Ноутбук Nimbus Air>, <Product: Игровая мышь>]>
```
«Коврик для мыши» не нашёлся по «мышь»: в названии «мыши».

### Шаг 2. Что ушло в базу
SQL (колонки товара сокращены):
```
SELECT … FROM "shop_product" WHERE "shop_product"."price" < '1000' LIMIT 21
SELECT … FROM "shop_product" WHERE "shop_product"."price" BETWEEN '1000' AND '5000' LIMIT 21
SELECT … FROM "shop_product" WHERE "shop_product"."name" LIKE '%мышь%' ESCAPE '\' LIMIT 21
SELECT … FROM "shop_product" WHERE "shop_product"."slug" IN ('aster-14', 'mouse-pad') LIMIT 21
SELECT … FROM "shop_product" WHERE "shop_product"."created_at" BETWEEN '2024-12-31 21:00:00' AND '2025-12-31 20:59:59.999999' LIMIT 21
SELECT … FROM "shop_product" WHERE django_datetime_cast_date("shop_product"."created_at", 'Europe/Moscow', 'UTC') >= '2026-04-01' LIMIT 21
```
`__year=2025` Django превратил в диапазон по UTC — от московской полуночи 1 января до конца года. Так запрос может использовать индекс по `created_at`. `__date` — перевод каждой строки в дату по Москве: удобно, но индекс по колонке уже не поможет.

### Шаг 3. NULL и пустая строка
У описания нет `null=True`, поэтому пустых значений `NULL` нет совсем:

Файл `orm.py`:
```python
print(Product.objects.filter(description__isnull=True).count())
print(Product.objects.filter(description="").count())
```
Результат:
```
0
6
```
Для строк «не заполнено» — `""`; `__isnull` нужен для дат, чисел и связей.

## Частые ошибки
- **Опечатка в lookup.** `price__lessthan=1000` — `FieldError: Unsupported lookup 'lessthan' for DecimalField or join on the field not permitted.`. Список lookup'ов — в документации; самые нужные — в таблице выше.
- **`__range` с датами для `DateTimeField`.** `created_at__range=("2026-04-01", "2026-04-30")` — до полуночи 30 апреля, весь последний день не войдёт. Для дат — `__date__range` или `__lt` на следующий день.
- **`__isnull` для пустой строки.** У `CharField`/`TextField` без `null` пустое — `""`, `isnull=True` ничего не найдёт.
- **`__icontains` по большой таблице.** `LIKE '%…%'` не использует обычный индекс — на миллионах строк это медленно. Для поиска есть полнотекстовые индексы (курс SQL, «Виды индексов»).
- **Сравнение строки-числа.** `filter(price__gt="1 000")` — `ValidationError` при приведении; число из адреса сначала проверяют во view.

## Итог
**Lookup**
- `поле__lookup=значение`; без lookup — `exact`.
- Сравнения `gt/gte/lt/lte`, `range` (включительно), `in`, строки `icontains/startswith/iexact`, `isnull`.

**Даты**
- `__date`, `__year`, `__month` — по часовому поясу сайта; `__year` даёт диапазон (индекс работает), `__date` — функцию над колонкой.

**Связи**
- `связь__поле__lookup` — `JOIN` и условие на связанной таблице.

## Вопросы на собеседовании
<details><summary>Что такое lookup в Django ORM?</summary>

Способ сравнения в условиях `filter`/`exclude`/`get`: суффикс после двойного подчёркивания — `price__lt`, `name__icontains`, `created_at__year`. Django превращает его в SQL-условие для конкретной базы. Lookups можно сочетать с путём по связям (`category__name__iexact`) и писать свои.
</details>

<details><summary>Чем `contains` отличается от `icontains`?</summary>

`contains` — вхождение подстроки с учётом регистра, `icontains` — без учёта. В PostgreSQL `icontains` — `UPPER(поле) LIKE UPPER('%…%')`. Оба вида не используют обычный B-tree индекс из-за `%` в начале шаблона.
</details>

<details><summary>Почему `created_at__year=2025` быстрее, чем `created_at__date__year`?</summary>

`__year` по `DateTimeField` Django переводит в `BETWEEN` начала и конца года (с учётом часового пояса) — по такой границе работает индекс. `__date` применяет функцию к каждой строке (перевод в дату по поясу сайта), и обычный индекс по колонке не используется.
</details>

## Глубже
Сортировка, срезы и постраничный вывод — следующая тема. Условия с «или» и «не» — тема «Q-объекты». Сравнение двух полей одной строки — тема «F-выражения».
