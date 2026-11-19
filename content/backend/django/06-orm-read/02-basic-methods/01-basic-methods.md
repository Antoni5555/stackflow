---
title: Базовые методы
type: lesson
level: 2
reading_time: 11
---

## Теория
Почти любой запрос страницы магазина собирается из нескольких методов менеджера `objects` и QuerySet:
- **`all()`** — все строки (`SELECT … FROM`);
- **`filter(условия)`** — строки, подходящие под **все** условия: `filter(category__name="Мыши", is_active=True)` — это `WHERE … AND …`. Двойное подчёркивание проходит по связи: `category__name` — поле `name` связанной категории (в SQL — `JOIN`);
- **`exclude(условия)`** — строки, **не** подходящие: `exclude(stock=0)` → `WHERE NOT (stock = 0)`;
- **`get(условия)`** — **ровно один** объект. Не нашлось — `Model.DoesNotExist`, нашлось несколько — `Model.MultipleObjectsReturned`. Для поиска по уникальному полю: `pk`, `slug`;
- **`first()`**, `last()` — первый/последний объект или `None`, если строк нет (без исключения);
- **`exists()`** — есть ли хоть одна строка: `SELECT 1 … LIMIT 1`, самый дешёвый способ проверить.

`filter` и `exclude` возвращают QuerySet и сочетаются в цепочку; `get`, `first`, `exists` выполняют запрос сразу.

Во view страница одного объекта почти всегда — «найти или ответить 404». Для этого есть **`get_object_or_404(Product, slug=slug)`** из `django.shortcuts`: внутри — `get()`, а `DoesNotExist` превращается в `Http404`. Первым аргументом можно передать и QuerySet: `get_object_or_404(Product.objects.filter(is_active=True), slug=slug)` — или просто добавить условие в аргументы. Есть и `get_list_or_404` — для списка, который не должен быть пустым.

## Наглядно
**Таблица 1.** Методы выборки и что они возвращают.

| Метод | Возвращает | Пусто | Больше одного |
|---|---|---|---|
| `filter(…)`, `exclude(…)`, `all()` | QuerySet | пустой QuerySet | все |
| `get(…)` | объект | `DoesNotExist` | `MultipleObjectsReturned` |
| `first()`, `last()` | объект или `None` | `None` | первый/последний |
| `exists()` | `bool` | `False` | `True` |
| `get_object_or_404(…)` | объект | `Http404` | `MultipleObjectsReturned` |

**Таблица 2.** Методы и их SQL.

| ORM | SQL |
|---|---|
| `filter(is_active=True, stock=0)` | `WHERE is_active AND stock = 0` |
| `exclude(stock=0)` | `WHERE NOT (stock = 0)` |
| `filter(category__name="Мыши")` | `INNER JOIN shop_category … WHERE shop_category.name = 'Мыши'` |
| `get(slug="aster-14")` | `WHERE slug = 'aster-14' LIMIT 21` |
| `first()` | `ORDER BY id ASC LIMIT 1` |
| `exists()` | `SELECT 1 AS "a" … LIMIT 1` |

## На практике
Задача: найти товар по адресу, выбрать активные мыши, проверить, есть ли товары не в наличии, и сделать страницу товара с 404 для скрытых товаров.

### Шаг 1. Методы в консоли
Файл `orm.py`:
```python
print(Product.objects.get(slug="aster-14"))
print(Product.objects.filter(category__name="Мыши").exclude(is_active=False))
print(Product.objects.filter(slug="nope").first())
print(Product.objects.filter(stock=0).exists())
```
Результат:
```
Ноутбук Aster 14
<QuerySet [<Product: Беспроводная мышь>, <Product: Игровая мышь>]>
None
True
```
SQL (колонки товара сокращены):
```
SELECT … FROM "shop_product" WHERE "shop_product"."slug" = 'aster-14' LIMIT 21
SELECT … FROM "shop_product" INNER JOIN "shop_category" ON ("shop_product"."category_id" = "shop_category"."id") WHERE ("shop_category"."name" = 'Мыши' AND NOT (NOT "shop_product"."is_active")) LIMIT 21
SELECT … FROM "shop_product" WHERE "shop_product"."slug" = 'nope' ORDER BY "shop_product"."id" ASC LIMIT 1
SELECT 1 AS "a" FROM "shop_product" WHERE "shop_product"."stock" = 0 LIMIT 1
```
`get` берёт до 21 строки, чтобы честно сообщить, сколько нашлось. `exclude(is_active=False)` дал двойное отрицание — `NOT (NOT …)`: в таких случаях понятнее `filter(is_active=True)`.

### Шаг 2. get без результата и с лишними
`Product.objects.get(slug="nope")`:
```
shop.models.Product.DoesNotExist: Product matching query does not exist.
```
`Product.objects.get(category__name="Мыши")` — мышей три:
```
shop.models.Product.MultipleObjectsReturned: get() returned more than one Product -- it returned 3!
```

### Шаг 3. Страница товара
Файл `views.py` (фрагмент):
```python
from django.shortcuts import get_object_or_404, render

from .models import Product


def product_detail(request, slug):
    product = get_object_or_404(Product, slug=slug, is_active=True)
    return render(request, "shop/product.html", {"product": product})
```
Результат для снятой с продажи проводной мыши и для ноутбука:
```
GET /products/wired-mouse/ → 404 Not Found

Page not found (404)
No Product matches the given query.
Raised by: shop.views.product_detail

GET /products/aster-14/ → 200 OK

<h1>Ноутбук Aster 14</h1>
```
Один запрос на страницу; скрытый товар — 404, как будто его нет.

## Частые ошибки
- **`get()` по неуникальному полю.** Сегодня мышь одна, завтра две — и страница падает с `MultipleObjectsReturned`. `get` — для `pk` и уникальных полей.
- **`get()` во view без обработки.** Несуществующий адрес даёт 500 вместо 404. Во view — `get_object_or_404`.
- **`filter(...)[0]` для «первого».** Пустой результат — `IndexError`. Есть `first()` — он вернёт `None`.
- **`if qs:` ради проверки.** Загружает все строки; для «есть ли» — `exists()`. Если строки потом нужны — наоборот, `if qs:` и тот же `qs` в цикле: один запрос.
- **Забыть условие видимости в `get_object_or_404`.** Снятый с продажи товар открывается по прямой ссылке. Условия — вторым и следующими аргументами.

## Итог
**Выборка**
- `filter` — все условия (`AND`), `exclude` — `NOT`, `__` — через связь (`JOIN`).
- Возвращают QuerySet; цепочки складываются в один запрос.

**Один объект**
- `get` — ровно один: иначе `DoesNotExist` / `MultipleObjectsReturned`.
- `first`/`last` — `None` вместо исключения; `exists` — дешёвая проверка.
- Во view — `get_object_or_404(Model, …условия)`.

## Вопросы на собеседовании
<details><summary>Чем `get()` отличается от `filter()`?</summary>

`filter()` возвращает QuerySet (возможно, пустой) и ленив. `get()` сразу выполняет запрос и возвращает ровно один объект; нет совпадений — `DoesNotExist`, несколько — `MultipleObjectsReturned`. Для поиска «или ничего» — `filter(...).first()`.
</details>

<details><summary>Что делает `get_object_or_404`?</summary>

Вызывает `get()` у модели, менеджера или QuerySet с переданными условиями и превращает `DoesNotExist` в `Http404`. Используется во view страниц одного объекта, чтобы несуществующий адрес давал 404, а не 500.
</details>

<details><summary>Как проверить, что запрос вернёт хоть одну строку, не загружая данные?</summary>

`qs.exists()` — выполняет `SELECT 1 … LIMIT 1`. Это дешевле `count()` и тем более `len()` / `bool()`, которые загружают строки. Но если строки всё равно будут использованы, проще вычислить QuerySet один раз.
</details>

## Глубже
Условия «больше», «содержит», «в списке», по датам — следующая тема «Lookups». Сложные условия с «или» — тема «Q-объекты».
