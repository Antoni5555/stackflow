---
title: aggregate
type: lesson
level: 2
reading_time: 10
---

## Теория
Дашборду менеджера нужны числа: выручка за месяц, число заказов, средний чек. Загружать все заказы в Python и складывать в цикле — медленно и лишняя память. Это делает база: **`aggregate()`** считает значения по всей выборке одним запросом и возвращает **словарь**.

Агрегатные функции — из `django.db.models`:
- `Count("поле")` — число строк (`COUNT`); `Count("поле", distinct=True)` — число разных значений;
- `Sum`, `Avg`, `Min`, `Max` — сумма, среднее, минимум, максимум.

Имя ключа задают аргументом: `aggregate(revenue=Sum(…))` → `{"revenue": …}`. Без имени Django составит его сам — `price__avg`, `id__count`. Для выражения (`Sum(F("price") * F("quantity"))`) имя обязательно.

`aggregate()` работает с любой выборкой: сначала `filter()` — какие строки считать, потом `aggregate()` — что посчитать. Путь через связи тоже работает: позиции оплаченных заказов — `OrderItem.objects.filter(order__status="paid")`.

Если строк нет, `Sum`, `Avg`, `Min` и `Max` возвращают **`None`** (в SQL сумма пустого набора — `NULL`), а `Count` — `0`. Подставить ноль — `Coalesce(Sum(…), значение)`; тип значения должен совпадать с типом поля.

`aggregate()` — конец цепочки: результат — словарь, а не QuerySet, к нему не приписать `.filter()`. Значение на **каждый** объект (отзывов у каждого товара) — `annotate()`, следующая тема.

## Наглядно
**Таблица 1.** Агрегатные функции.

| ORM | SQL | Пусто |
|---|---|---|
| `Count("id")` | `COUNT("id")` | `0` |
| `Count("user", distinct=True)` | `COUNT(DISTINCT "user_id")` | `0` |
| `Sum("stock")` | `SUM("stock")` | `None` |
| `Avg("rating")` | `AVG("rating")` | `None` |
| `Min("price")`, `Max("price")` | `MIN`, `MAX` | `None` |
| `Coalesce(Sum("price"), Decimal("0"))` | `COALESCE(SUM(…), 0)` | `Decimal('0')` |

## На практике
Задача: посчитать для дашборда сводку по каталогу и выручку магазина. Модели раздела: категории и товары (`price`, `stock`), заказы (`status`, `created_at`), позиции заказа (`quantity` и `price` — цена в момент покупки), отзывы (`rating`). Выручка — позиции заказов со статусом «Оплачен» (`paid`) или «Отправлен» (`shipped`).

### Шаг 1. Сводка по каталогу
Файл `orm.py`:
```python
from django.db.models import Avg, Count, Max, Min, Sum
print(Product.objects.aggregate(Count("id"), Avg("price"), Min("price"), Max("price")))
print(Product.objects.aggregate(total=Sum("stock")))
```
Результат:
```
{'id__count': 5, 'price__avg': Decimal('14531.8000000000'), 'price__min': Decimal('490'), 'price__max': Decimal('64990')}
{'total': 75}
```
SQL первого запроса:
```
SELECT COUNT("shop_product"."id") AS "id__count", (CAST(AVG("shop_product"."price") AS NUMERIC)) AS "price__avg", (CAST(MIN("shop_product"."price") AS NUMERIC)) AS "price__min", (CAST(MAX("shop_product"."price") AS NUMERIC)) AS "price__max" FROM "shop_product"
```
Один запрос — четыре числа. Тренажёр работает на SQLite и теряет нули после точки; PostgreSQL вернёт `Decimal('490.00')` и `Decimal('64990.00')` — с двумя знаками, как в колонке.

### Шаг 2. Выручка
Сумма позиции — цена × количество. Это выражение над двумя полями, поэтому — `F` и обязательное имя.

Файл `orm.py`:
```python
from django.db.models import F, Sum
paid = OrderItem.objects.filter(order__status__in=["paid", "shipped"])
print(paid.aggregate(revenue=Sum(F("price") * F("quantity"))))
```
Результат:
```
{'revenue': Decimal('74937')}
```
SQL:
```
SELECT (CAST(SUM((CAST(("shop_orderitem"."price" * "shop_orderitem"."quantity") AS NUMERIC))) AS NUMERIC)) AS "revenue" FROM "shop_orderitem" INNER JOIN "shop_order" ON ("shop_orderitem"."order_id" = "shop_order"."id") WHERE "shop_order"."status" IN ('paid', 'shipped')
```
Без имени — `aggregate(Sum(F("price") * F("quantity")))`:
```
TypeError: Complex aggregates require an alias
```

### Шаг 3. Выручка за месяц
Файл `orm.py`:
```python
from django.db.models import F, Sum
qs = OrderItem.objects.filter(
    order__status__in=["paid", "shipped"],
    order__created_at__year=2026, order__created_at__month=11,
)
print(qs.aggregate(revenue=Sum(F("price") * F("quantity"))))
```
Результат:
```
{'revenue': Decimal('4470')}
```
Месяц считается в часовом поясе проекта (`TIME_ZONE`) — как в разделе «ORM: чтение данных».

### Шаг 4. Пустая выборка
Файл `orm.py`:
```python
from django.db.models import Count, Sum
print(Order.objects.filter(number="X").aggregate(Sum("id"), Count("id")))
```
Результат:
```
{'id__sum': None, 'id__count': 0}
```
Чтобы в шаблоне было «0 ₽», а не пустота, — `Coalesce`:

Файл `orm.py`:
```python
from decimal import Decimal
from django.db.models import Sum
from django.db.models.functions import Coalesce
empty = OrderItem.objects.filter(order__number="X")
print(empty.aggregate(t=Coalesce(Sum("price"), Decimal("0"))))
```
Результат:
```
{'t': Decimal('0')}
```
С целым нулём — `Coalesce(Sum("price"), 0)` — Django не знает, какой тип у результата:
```
django.core.exceptions.FieldError: Expression contains mixed types: DecimalField, IntegerField. You must set output_field.
```

## Частые ошибки
- **Считать в Python.** `sum(i.price * i.quantity for i in OrderItem.objects.all())` загружает все позиции в память. `aggregate()` — одно число из базы.
- **Ждать QuerySet.** `Product.objects.aggregate(n=Count("id")).filter(…)` — `AttributeError: 'dict' object has no attribute 'filter'`. Сначала `filter`, потом `aggregate`.
- **`None` вместо нуля.** Сумма пустой выборки — `None`; в шаблоне пусто, в Python `None + 1` — `TypeError`. `Coalesce(Sum(…), Decimal("0"))`.
- **Ноль не того типа.** `Coalesce(Sum("price"), 0)` для `DecimalField` — `FieldError … mixed types`. Ноль — `Decimal("0")` (или `Value(0, output_field=DecimalField())`).
- **Выражение без имени.** `aggregate(Sum(F("price") * F("quantity")))` — `TypeError: Complex aggregates require an alias`.
- **`Count` по связи с дублями.** Покупателей с заказами — `Order.objects.aggregate(Count("user", distinct=True))`; без `distinct` — число заказов.

## Итог
**aggregate**
- Значения по всей выборке одним запросом; результат — словарь.
- `Count`, `Sum`, `Avg`, `Min`, `Max`; имя ключа — `имя=Функция(…)`, для выражений обязательно.
- Сначала `filter`, потом `aggregate`.

**Пусто**
- `Sum`/`Avg`/`Min`/`Max` → `None`, `Count` → `0`; ноль — `Coalesce(…, Decimal("0"))`.

## Вопросы на собеседовании
<details><summary>Что возвращает `aggregate()` и чем он отличается от `annotate()`?</summary>

`aggregate()` считает значения по всей выборке и возвращает словарь — дальше цепочка не продолжается. `annotate()` добавляет вычисленное значение к каждому объекту и возвращает QuerySet: фильтровать и сортировать по нему можно дальше.
</details>

<details><summary>Почему `Sum` по пустой выборке возвращает `None`, а не 0?</summary>

Так работает SQL: агрегатные функции, кроме `COUNT`, на пустом наборе дают `NULL`. Ноль подставляют `Coalesce(Sum(...), 0)` в запросе — с нулём того же типа, что поле (`Decimal("0")` для `DecimalField`) — или `or 0` в Python.
</details>

<details><summary>Как посчитать выручку по позициям заказов (цена × количество)?</summary>

`OrderItem.objects.filter(...).aggregate(revenue=Sum(F("price") * F("quantity")))` — умножение выполняет база, Python получает одно число. Имя `revenue` обязательно: у выражения нет имени по умолчанию.
</details>

## Глубже
Значение на каждый объект — следующая тема `annotate`. Выручка по месяцам или статусам — тема «Группировка».
