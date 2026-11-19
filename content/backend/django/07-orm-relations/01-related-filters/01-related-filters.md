---
title: Фильтр через связи
type: lesson
level: 2
reading_time: 11
---

## Теория
Двойное подчёркивание в условии проходит по связям сколько угодно раз: `category__parent__name="Электроника"` — «товары, у категории которых родительская категория — Электроника». Каждый шаг — `JOIN` в SQL, и ORM сам подбирает имена таблиц (`T3`, `T4…`), если одна таблица нужна дважды.

Путь работает в обе стороны и для любых связей:
- по `ForeignKey` вперёд: `Product.objects.filter(category__name="Мыши")`;
- по `ManyToManyField`: `Product.objects.filter(tags__name="хит")`;
- по **обратной** связи — через `related_name`: `Category.objects.filter(products__price__lt=5000)` — «категории, где есть товар дешевле 5000».

Главная ловушка — **дубли**. Когда условие идёт через связь «один ко многим» или «многие ко многим», `JOIN` размножает строки: товар с метками «хит» и «новинка» попадёт в `filter(tags__name__in=["хит", "новинка"])` дважды — по строке на каждую подходящую метку. То же с категорией, у которой два дешёвых товара. Убирает дубли **`.distinct()`** — `SELECT DISTINCT`.

Вторая ловушка — **одно условие или два**. Для многозначной связи (`tags`, `products`) условия в **одном** `filter()` относятся к **одной и той же** связанной строке, а в **разных** `filter()` — к любым:
- `filter(tags__name="хит").filter(tags__name="новинка")` — товары, у которых есть **и** метка «хит», **и** метка «новинка» (два `JOIN`);
- `filter(tags__name="хит", tags__name__startswith="н")` — товары, у которых **одна** метка одновременно называется «хит» и начинается на «н», — таких нет.

## Наглядно
**Рисунок 1.** `JOIN` через связь «многие ко многим» даёт строку на каждую подходящую метку — отсюда дубли.

![Рисунок 1. Товар Aster 14 с метками хит и новинка при условии tags__name__in=["хит","новинка"] даёт две строки JOIN; distinct() оставляет одну](img/join-duplicates.svg)

**Таблица 1.** Условия через связи.

| ORM | Смысл | SQL |
|---|---|---|
| `filter(category__parent__name="Электроника")` | через два FK | два `JOIN` на `shop_category` |
| `filter(tags__name="хит")` | через M2M | `JOIN` связки и `shop_tag` |
| `Category.objects.filter(products__price__lt=5000)` | по обратной связи | `JOIN shop_product` |
| `… .distinct()` | без дублей | `SELECT DISTINCT` |
| `filter(tags__name="хит").filter(tags__name="новинка")` | есть обе метки | два `JOIN` на связку |
| `filter(tags__name="хит", tags__name__startswith="н")` | одна метка с двумя свойствами | один `JOIN` |

## На практике
Задача: товары из подкатегорий «Электроники», товары с метками «хит» или «новинка», товары сразу с обеими метками и категории с недорогими товарами. Модели: категории с родителем (`parent`), товары с метками (`tags`), заказы и отзывы — их хватит на весь раздел.

### Шаг 1. Через несколько связей
`Product.objects.filter(category__parent__name="Электроника")`:
```
<QuerySet [<Product: Ноутбук Aster 14>, <Product: Беспроводная мышь>, <Product: Игровая мышь>]>
```
SQL (колонки товара сокращены):
```
SELECT … FROM "shop_product" INNER JOIN "shop_category" ON ("shop_product"."category_id" = "shop_category"."id") INNER JOIN "shop_category" T3 ON ("shop_category"."parent_id" = T3."id") WHERE T3."name" = 'Электроника' LIMIT 21
```
Таблица категорий присоединена дважды — второй раз под именем `T3`, как родитель.

### Шаг 2. Дубли
Файл `orm.py`:
```python
print(Product.objects.filter(tags__name__in=["хит", "новинка"]))
print(Product.objects.filter(tags__name__in=["хит", "новинка"]).distinct())
```
Результат:
```
<QuerySet [<Product: Ноутбук Aster 14>, <Product: Игровая мышь>, <Product: Ноутбук Aster 14>, <Product: Беспроводная мышь>]>
<QuerySet [<Product: Ноутбук Aster 14>, <Product: Игровая мышь>, <Product: Беспроводная мышь>]>
```
У Aster 14 обе метки — и он в списке дважды. `distinct()` добавил `SELECT DISTINCT`, и порядок без `order_by` снова не гарантирован.

### Шаг 3. Обе метки
Файл `orm.py`:
```python
print(Product.objects.filter(tags__name="хит").filter(tags__name="новинка"))
print(Product.objects.filter(tags__name="хит", tags__name__startswith="н"))
```
Результат:
```
<QuerySet [<Product: Ноутбук Aster 14>]>
<QuerySet []>
```
Первый запрос — два независимых `JOIN` (`shop_product_tags` и `T4`): одна метка «хит», другая «новинка». Второй — одно присоединение и два условия на одну и ту же метку.

### Шаг 4. По обратной связи
`Category.objects.filter(products__price__lt=5000)`:
```
<QuerySet [<Category: Мыши>, <Category: Мыши>, <Category: Коврики>]>
```
У «Мышей» два товара дешевле 5000 — категория дважды. С `.distinct()`: `<QuerySet [<Category: Мыши>, <Category: Коврики>]>`.

## Частые ошибки
- **Дубли после фильтра по M2M или обратной связи.** Список товаров с повторами, счётчики завышены. Нужен `distinct()` — или подзапрос (`filter(id__in=…)`).
- **`distinct()` «на всякий случай».** Лишняя сортировка или хеширование на большой выборке. Ставят, когда фильтр действительно идёт через «многие».
- **Одно условие вместо двух.** «И метка хит, и метка новинка» в одном `filter` даёт пустой результат — условия относятся к одной метке. Нужны два `filter`.
- **Путь через имя модели вместо `related_name`.** `Category.objects.filter(product__price__lt=…)` при `related_name="products"` — `FieldError: Cannot resolve keyword 'product' into field. Choices are: children, id, name, parent, parent_id, products`. В пути — то же имя, что у обратной связи.
- **Фильтр через связь в цикле.** `for c in categories: Product.objects.filter(category=c)` — запрос на каждую категорию; одним запросом — `filter(category__in=categories)` или `prefetch_related` (тема 5).

## Итог
**Путь по связям**
- `связь__связь__поле__lookup` — `JOIN` на каждый шаг; работает по FK, M2M и обратным связям (`related_name`).

**Дубли**
- Фильтр через «многие» размножает строки — `distinct()`.

**Один filter или два**
- Многозначная связь: условия в одном `filter` — про одну связанную строку, в разных — про любые.

## Вопросы на собеседовании
<details><summary>Почему фильтр по ManyToMany даёт дубли и как их убрать?</summary>

Условие через связь превращается в `JOIN`, и строка основной таблицы повторяется для каждой подходящей связанной строки. Товар с двумя подходящими метками вернётся дважды. Убрать — `.distinct()` или подзапрос `filter(pk__in=…)`; для подсчётов — `Count(…, distinct=True)`.
</details>

<details><summary>Чем `filter(a__x=1, a__y=2)` отличается от `filter(a__x=1).filter(a__y=2)` для многозначной связи?</summary>

В одном `filter` оба условия применяются к одной и той же связанной строке (один `JOIN`). В цепочке — к любым связанным строкам (свой `JOIN` на каждый `filter`): «есть строка с x=1 и есть строка с y=2». Для `ForeignKey` вперёд разницы нет — связанная строка одна.
</details>

<details><summary>Как отфильтровать категории по свойствам их товаров?</summary>

Через обратную связь: `Category.objects.filter(products__price__lt=5000).distinct()` — имя берётся из `related_name` (без него — имя модели строчными: `product__price`). Для «есть хоть один» вместо `distinct` можно `Exists(…)` с подзапросом (раздел «ORM: агрегация»).
</details>

## Глубже
Обратные связи в коде и шаблонах — следующая тема. Подсчёт без дублей (`Count(…, distinct=True)`) — раздел «ORM: агрегация».
