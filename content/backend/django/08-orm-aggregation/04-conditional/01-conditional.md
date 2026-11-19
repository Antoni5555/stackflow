---
title: Условные выражения
type: lesson
level: 2
reading_time: 10
---

## Теория
Метка «дёшево / средне / дорого», «в наличии / нет», «сначала новые заказы» — это условие на каждую строку. Его можно считать в базе выражением **`Case`** (в SQL — `CASE WHEN … THEN … ELSE … END`):
```
Case(
    When(price__lt=2000, then=Value("дёшево")),
    When(price__lt=10000, then=Value("средне")),
    default=Value("дорого"),
)
```
- **`When(условие, then=…)`** — условие пишут как в `filter()` (`price__lt=2000`, `Q(…)`, через связи);
- ветки проверяются **по порядку**, срабатывает первая подходящая;
- **`default`** — если не подошла ни одна; без него — `None` (`ELSE NULL`);
- `then` и `default` — выражения: строку или число оборачивают в **`Value(…)`**. Голая строка в `then` — это **имя поля**, как в `F("…")`.

`Case` используют в `annotate` (метка у каждого товара), в `order_by` (свой порядок сортировки), внутри агрегата (`Sum(Case(…))`) и в `update` (разная новая цена для разных строк).

**`Coalesce(a, b, …)`** — первое значение, которое не `NULL`: средняя оценка товара без отзывов — `Coalesce(Avg("reviews__rating"), Value(0.0))`. Типы аргументов должны совпадать; иначе Django просит `output_field`.

## Наглядно
**Таблица 1.** Метка по цене: как `Case` проверяет ветки.

| Товар | Цена | `price < 2000` | `price < 10000` | Метка |
|---|---|---|---|---|
| Коврик для мыши | 490 | да | — | дёшево |
| Беспроводная мышь | 1499 | да | — | дёшево |
| Подставка для ноутбука | 2190 | нет | да | средне |
| Игровая мышь | 3490 | нет | да | средне |
| Ноутбук Aster 14 | 64990 | нет | нет | дорого (`default`) |

Вторая ветка проверяется, только если первая не подошла, поэтому условие «средне» можно писать без `price__gte=2000`.

## На практике
Задача: метки цены и наличия в каталоге, рейтинг для сортировки и новые заказы в начале списка.

### Шаг 1. Метка цены
Файл `orm.py`:
```python
from django.db.models import Case, Value, When
qs = Product.objects.annotate(
    band=Case(
        When(price__lt=2000, then=Value("дёшево")),
        When(price__lt=10000, then=Value("средне")),
        default=Value("дорого"),
    )
).order_by("price")
for p in qs:
    print(p.name, p.band)
```
Результат:
```
Коврик для мыши дёшево
Беспроводная мышь дёшево
Подставка для ноутбука средне
Игровая мышь средне
Ноутбук Aster 14 дорого
```
SQL метки:
```
CASE WHEN "shop_product"."price" < '2000' THEN 'дёшево' WHEN "shop_product"."price" < '10000' THEN 'средне' ELSE 'дорого' END AS "band"
```

### Шаг 2. Порядок веток
Те же ветки в обратном порядке:

Файл `orm.py`:
```python
from django.db.models import Case, Value, When
qs = Product.objects.annotate(
    band=Case(
        When(price__lt=10000, then=Value("средне")),
        When(price__lt=2000, then=Value("дёшево")),
        default=Value("дорого"),
    )
).order_by("price")
print([(p.name, p.band) for p in qs])
```
Результат:
```
[('Коврик для мыши', 'средне'), ('Беспроводная мышь', 'средне'), ('Подставка для ноутбука', 'средне'), ('Игровая мышь', 'средне'), ('Ноутбук Aster 14', 'дорого')]
```
Коврик дешевле 10000 — сработала первая ветка, до «дёшево» дело не дошло. Узкие условия пишут первыми.

### Шаг 3. Строка без Value
`When(price__lt=2000, then="дёшево")`:
```
django.core.exceptions.FieldError: Cannot resolve keyword 'дёшево' into field. Choices are: category, category_id, id, name, order_items, price, reviews, stock
```
Строка в `then` — имя поля (так можно подставить значение другой колонки: `then="name"`). Текст — только `Value("дёшево")`.

### Шаг 4. Рейтинг без NULL
Товары без отзывов при сортировке по средней оценке: `None` в PostgreSQL при `DESC` стоит **первым**. Подставим ноль:

Файл `orm.py`:
```python
from django.db.models import Avg, Value
from django.db.models.functions import Coalesce
qs = Product.objects.annotate(
    rating=Coalesce(Avg("reviews__rating"), Value(0.0))
).order_by("-rating", "id")
print([(p.name, p.rating) for p in qs])
```
Результат:
```
[('Ноутбук Aster 14', 5.0), ('Коврик для мыши', 4.0), ('Беспроводная мышь', 3.6666666666666665), ('Игровая мышь', 0.0), ('Подставка для ноутбука', 0.0)]
```
С целым нулём — `Coalesce(Avg("reviews__rating"), 0)`:
```
django.core.exceptions.FieldError: Expression contains mixed types: FloatField, IntegerField. You must set output_field.
```
`Avg` возвращает дробное число, ноль тоже должен быть дробным — `Value(0.0)`.

### Шаг 5. Свой порядок сортировки
Менеджеру — сначала новые заказы, остальные — от свежих к старым:

Файл `orm.py`:
```python
from django.db.models import Case, Value, When
first_new = Case(When(status="new", then=Value(0)), default=Value(1))
qs = Order.objects.order_by(first_new, "-created_at")
print(list(qs.values_list("number", "status")))
```
Результат:
```
[('A-15', 'new'), ('A-14', 'shipped'), ('A-13', 'paid'), ('A-12', 'paid'), ('A-11', 'cancelled'), ('A-10', 'shipped')]
```
SQL:
```
ORDER BY CASE WHEN "shop_order"."status" = 'new' THEN 0 ELSE 1 END ASC, "shop_order"."created_at" DESC
```

## Частые ошибки
- **Широкое условие первым.** Ветки проверяются по порядку; `price__lt=10000` перед `price__lt=2000` — «дёшево» не сработает никогда.
- **Строка без `Value`.** `then="дёшево"` — `FieldError: Cannot resolve keyword 'дёшево' into field`. Текст и числа — `Value(…)`.
- **Нет `default`.** Неподходящие строки получают `None` (`ELSE NULL`). Если метка нужна всем — `default=Value(…)`.
- **Типы в `Coalesce`.** `Coalesce(Avg(…), 0)` — `FieldError … mixed types`; ноль того же типа: `Value(0.0)` для среднего, `Decimal("0")` для денег.
- **Метки в Python вместо базы.** Цикл с `if` — работает, но по метке тогда нельзя отфильтровать или отсортировать запросом. Если по ней сортируют или группируют — `Case`.

## Итог
**Case / When**
- `Case(When(условие, then=Value(…)), …, default=Value(…))` — значение по условию для каждой строки.
- Ветки — по порядку, первая подходящая; без `default` — `None`.
- В `annotate`, `order_by`, агрегатах и `update`.

**Coalesce**
- Первое не-`NULL` значение; аргументы одного типа.

## Вопросы на собеседовании
<details><summary>Для чего `Case` и `When` в Django ORM?</summary>

Для условных значений в SQL: `CASE WHEN … THEN … ELSE … END`. Например, метка ценового диапазона в `annotate`, свой порядок в `order_by`, условная сумма в `Sum(Case(…))` или разное новое значение в одном `update()` без цикла по строкам.
</details>

<details><summary>Почему в `then` нужно `Value("текст")`, а не просто строка?</summary>

Аргументы `then` и `default` — выражения, а строка в выражениях ORM означает имя поля (как `F("name")`). `then="дёшево"` Django попытается найти поле «дёшево» и упадёт с `FieldError`. Константу оборачивают в `Value`.
</details>

<details><summary>Что делает `Coalesce`?</summary>

Возвращает первый аргумент, который не `NULL`, — `COALESCE` в SQL. Типичное применение — заменить `NULL` агрегата на ноль: `Coalesce(Avg("reviews__rating"), Value(0.0))`. Типы аргументов должны совпадать, иначе нужен `output_field`.
</details>

## Глубже
Значение из другой таблицы для каждой строки (дата последнего заказа) — следующая тема «Подзапросы».
