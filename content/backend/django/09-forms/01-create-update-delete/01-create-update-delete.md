---
title: Создание, изменение, удаление
type: lesson
level: 2
reading_time: 12
---

## Теория
Запись в базу через ORM — три операции.

**Создание.** `Product.objects.create(поле=…)` — `INSERT` сразу, возвращает объект с `pk`. Или в два шага: `p = Product(…)` — объект только в памяти (`p.pk` — `None`), `p.save()` — `INSERT`. Поля с `default` можно не передавать.

**Изменение одного объекта** — поменять атрибут и вызвать `save()`. У объекта с `pk` `save()` делает `UPDATE` **всех** полей значениями из памяти. Если объект был загружен давно, а кто-то успел изменить другое поле, `save()` затрёт это изменение старым значением. `save(update_fields=["price"])` пишет только перечисленные поля.

**Изменение многих строк** — `QuerySet.update(поле=…)`: один `UPDATE … WHERE`, возвращает число строк. Объекты в память не загружаются, метод `save()` модели и сигналы не вызываются. Значение от текущего — через `F` (раздел «ORM: чтение данных»): `update(price=F("price") * Decimal("1.1"))`. У объекта метода `update` нет — только у QuerySet.

**Удаление** — `obj.delete()` или `QuerySet.delete()`, возвращают кортеж: всего удалено и сколько каждой модели. Что будет со ссылающимися строками, решает `on_delete` у `ForeignKey` (раздел «Модели»):
- `CASCADE` — удаляются вместе (позиции вместе с заказом);
- `PROTECT` — удаление запрещено, `ProtectedError` (товар, который есть в заказах);
- `SET_NULL`, `SET_DEFAULT` — ссылка обнуляется или ставится значение по умолчанию.

Удалять товар с историей заказов обычно нельзя — его **снимают с продажи**: `is_active = False`.

## Наглядно
**Рисунок 1.** Два объекта загружены из базы до изменений: `save()` второго затирает остаток, который записал первый.

![Рисунок 1. В базе stock 40, price 1499. Объект a ставит stock 39 и сохраняет. Объект b, загруженный раньше, ставит price 1399 и сохраняет все поля — stock снова 40. С save(update_fields=["price"]) остаток 39 остался бы](img/lost-update.svg)

**Таблица 1.** Операции записи.

| ORM | SQL | Возвращает | `save()` модели |
|---|---|---|---|
| `Product.objects.create(…)` | `INSERT` | объект | вызывается |
| `p.save()` (новый) | `INSERT` | `None` | — |
| `p.save()` (из базы) | `UPDATE` всех полей | `None` | — |
| `p.save(update_fields=["price"])` | `UPDATE` одного поля | `None` | — |
| `qs.update(price=…)` | один `UPDATE … WHERE` | число строк | нет |
| `p.delete()`, `qs.delete()` | `DELETE` (+ каскад) | `(всего, {модель: число})` | — |

## На практике
Задача: добавить товар, снять игровую мышь с продажи, поднять цены мышей на 10 % и удалить заказ. Модели раздела: категории, товары (`slug`, `price`, `stock`, `is_active`), заказы и позиции (`CASCADE` от заказа, `PROTECT` от товара), промокоды, отзывы.

### Шаг 1. Создание
Файл `orm.py`:
```python
p = Product.objects.create(
    category=Category.objects.get(name="Мыши"),
    name="Коврик для мыши", slug="mouse-pad", price="490.00",
)
print(p.pk, p.stock, p.is_active)
q = Product(category=p.category, name="Коврик XL", slug="pad-xl", price="990.00")
print(q.pk)
q.save()
print(q.pk)
```
Результат:
```
4 0 True
None
5
```
`stock` и `is_active` взяли значения `default`. Объект `q` до `save()` в базе не существует.

### Шаг 2. Снять с продажи
Файл `orm.py`:
```python
p = Product.objects.get(slug="gaming-mouse")
p.is_active = False
p.save()
p.price = "2990.00"
p.save(update_fields=["price"])
```
SQL двух сохранений:
```
UPDATE "shop_product" SET "category_id" = 2, "name" = 'Игровая мышь', "slug" = 'gaming-mouse', "price" = '3490.00', "stock" = 0, "is_active" = 0 WHERE "shop_product"."id" = 3
UPDATE "shop_product" SET "price" = '2990.00' WHERE "shop_product"."id" = 3
```
Первый `save()` переписал все колонки, второй — одну.

### Шаг 3. Потерянное изменение
Склад списал мышь, а менеджер в это время менял цену — оба работали с объектами, загруженными до изменений:

Файл `orm.py`:
```python
a = Product.objects.get(slug="wireless-mouse")
b = Product.objects.get(slug="wireless-mouse")
a.stock = 39
a.save()
b.price = "1399.00"
b.save()
print(Product.objects.values("stock", "price").get(slug="wireless-mouse"))
```
Результат:
```
{'stock': 40, 'price': Decimal('1399.00')}
```
Списание пропало: `b.save()` записал и `stock = 40` из своей памяти. Менял одно поле — `save(update_fields=["price"])`; меняешь число от текущего — `F` в `update`.

### Шаг 4. Цены категории одним запросом
Файл `orm.py`:
```python
from decimal import Decimal
mice = Product.objects.filter(category__name="Мыши")
n = mice.update(price=F("price") * Decimal("1.1"))
print(n)
print(list(Product.objects.order_by("id").values_list("name", "price")))
```
Результат:
```
2
[('Ноутбук Aster 14', Decimal('64990.00')), ('Беспроводная мышь', Decimal('1648.90')), ('Игровая мышь', Decimal('3839.00'))]
```
Один `UPDATE` для всех мышей; Python строки не загружал. У объекта так нельзя: `Product.objects.get(slug="aster-14").update(price=1)` — `AttributeError: 'Product' object has no attribute 'update'`.

### Шаг 5. Удаление и каскад
Файл `orm.py`:
```python
print(Order.objects.get(number="A-12").delete())
print(OrderItem.objects.count())
```
Результат:
```
(3, {'shop.OrderItem': 2, 'shop.Order': 1})
0
```
Позиции удалились вместе с заказом (`CASCADE`). Товар из заказа удалить нельзя — `Product.objects.get(slug="aster-14").delete()`:
```
django.db.models.deletion.ProtectedError: ("Cannot delete some instances of model 'Product' because they are referenced through protected foreign keys: 'OrderItem.product'.", {<OrderItem: OrderItem object (1)>})
```
После `delete()` у объекта в памяти `pk` становится `None`, остальные поля остаются.

## Частые ошибки
- **`save()` после долгой работы с объектом.** Записываются все поля из памяти — чужие изменения пропадают. `save(update_fields=[…])` или `update()` с `F`.
- **`update()` у объекта.** `AttributeError: 'Product' object has no attribute 'update'`. Один объект — `save()`, много строк — `filter(…).update(…)`.
- **Ждать, что `update()` вызовет `save()`.** Переопределённый `save()` (например, генерация `slug`) и сигналы при `update()` не срабатывают.
- **Цикл с `save()` по тысяче строк.** Тысяча `UPDATE`. Одинаковое изменение — `update()`, разные значения — `bulk_update` (следующая тема).
- **Удалять товар с заказами.** `PROTECT` не даст, и правильно: история заказов важнее. Снимают с продажи — `is_active = False`.
- **Нарушить `unique`.** `create(slug="aster-14")` при существующем — `IntegrityError: UNIQUE constraint failed: shop_product.slug`. Проверка уникальности до записи — в форме (тема «ModelForm»).

## Итог
**Создание**
- `objects.create(…)` или `Model(…)` + `save()`; поля с `default` можно не передавать.

**Изменение**
- `save()` — `UPDATE` всех полей; `update_fields` — только перечисленных.
- `qs.update(…)` — один запрос, число строк, без `save()` модели.

**Удаление**
- `delete()` → `(всего, {модель: число})`; связанные — по `on_delete`: `CASCADE`, `PROTECT` (`ProtectedError`), `SET_NULL`.

## Вопросы на собеседовании
<details><summary>Чем `save()` отличается от `QuerySet.update()`?</summary>

`save()` работает с одним объектом в памяти и пишет все его поля (или `update_fields`), вызывая переопределённый `save()` и сигналы `pre_save`/`post_save`. `update()` — один SQL `UPDATE` по условию для всех строк QuerySet, объекты не загружаются, `save()` и сигналы не вызываются, возвращает число строк.
</details>

<details><summary>Что такое lost update и как его избежать в Django?</summary>

Два процесса загрузили объект, каждый изменил своё поле и вызвал `save()` — второй перезаписал изменение первого старым значением. Защита: `save(update_fields=[...])`, атомарный `update()` с `F`-выражением, `select_for_update()` в транзакции для блокировки строки.
</details>

<details><summary>Что вернёт `delete()` и что произойдёт со связанными объектами?</summary>

Кортеж `(всего удалено, {"app.Model": число})`. Связанные строки обрабатываются по `on_delete` их `ForeignKey`: `CASCADE` удаляет, `PROTECT`/`RESTRICT` запрещают с исключением, `SET_NULL`/`SET_DEFAULT` меняют ссылку, `DO_NOTHING` оставляет решать базе.
</details>

## Глубже
Создание «если нет» и массовые операции — следующая тема. Атомарность нескольких операций и `select_for_update` — раздел «Продвинутый ORM», тема «Транзакции».
