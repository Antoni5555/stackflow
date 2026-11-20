---
title: Методы модели
type: lesson
level: 3
reading_time: 12
---

## Теория
Модель — обычный класс Python, и поведение, которое касается одного объекта, удобно держать в нём самом («толстая модель»):
- **`__str__`** — как объект выглядит в админке, консоли, шаблоне и сообщениях об ошибках. Без него — `OrderItem object (1)`;
- **`@property`** — вычисляемое значение объекта: `product.in_stock`, `order_item.cost`. В шаблоне — без скобок: `{{ product.in_stock }}`. Свойство живёт только в Python: в `filter()` его нет, там — поля и аннотации;
- **`get_absolute_url()`** — канонический адрес объекта через `reverse`. Его используют `CreateView`/`UpdateView` после сохранения, админка (кнопка «Смотреть на сайте») и шаблоны: `{{ product.get_absolute_url }}`;
- обычные методы — действия над объектом: `order.recalc()`, `order.cancel()`.

**Переопределение `save()`** — чтобы что-то делать при каждом сохранении: заполнить `slug`, пересчитать сумму заказа. Правила:
- сигнатура `def save(self, *args, **kwargs)` и вызов **`super().save(*args, **kwargs)`** — без него ничего не сохранится, без `*args, **kwargs` сломаются `create()` и `save(update_fields=…)`;
- `save()` **не вызывается** при `QuerySet.update()`, `bulk_create()`, `bulk_update()` и `delete()` через QuerySet — логика в `save()` там молча не сработает. Если значение должно быть верным всегда, его лучше считать (аннотацией или `@property`), а не хранить.

Ещё ловушка `slugify`: по умолчанию он оставляет только латиницу — `slugify("Игровая мышь")` даёт пустую строку. Для кириллицы — `slugify(name, allow_unicode=True)` или транслитерация.

## Наглядно
**Таблица 1.** Что куда класть.

| Что | Где | Пример |
|---|---|---|
| вид объекта строкой | `__str__` | `return self.name` |
| вычисляемое значение одного объекта | `@property` | `in_stock`, `cost = price * quantity` |
| адрес объекта | `get_absolute_url()` | `reverse("product", kwargs={"slug": self.slug})` |
| действие над объектом | метод | `order.recalc()`, `order.cancel()` |
| при каждом сохранении | `save()` + `super().save(*args, **kwargs)` | заполнить `slug` |
| выборки | QuerySet / менеджер | `Product.objects.in_stock()` |

## На практике
Задача: свойство «в наличии» и адрес товара, автоматический `slug`, пересчёт суммы заказа при сохранении позиции.

### Шаг 1. Свойство и адрес
Файл `models.py` (фрагмент):
```python
class Product(models.Model):
    # … поля

    def __str__(self):
        return self.name

    @property
    def in_stock(self):
        return self.stock > 0

    def get_absolute_url(self):
        return reverse("product", kwargs={"slug": self.slug})
```
`p = Product.objects.get(slug="gaming-mouse")`, `print(p, p.in_stock, p.get_absolute_url())`:
```
Игровая мышь False /products/gaming-mouse/
```
`Product.objects.filter(in_stock=True)`:
```
django.core.exceptions.FieldError: Cannot resolve keyword 'in_stock' into field. Choices are: category, category_id, id, is_active, name, order_items, price, slug, stock
```
В запросе — поле: `filter(stock__gt=0)` (или метод QuerySet из прошлой темы).

### Шаг 2. slug при сохранении
Файл `models.py` (фрагмент):
```python
from django.utils.text import slugify


class Product(models.Model):
    # … поля и методы

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)
```
`slugify("Игровая мышь")`, `slugify("Gaming Mouse Pro!")` и `slugify("Игровая мышь", allow_unicode=True)`:
```
'' 'gaming-mouse-pro' 'игровая-мышь'
```
Товар «Mouse Pad XL» получил `mouse-pad-xl`. Товары «Коврик» и затем «Подставка» — оба с пустым `slug`, и второй падает:
```
django.db.utils.IntegrityError: UNIQUE constraint failed: shop_product.slug
```

### Шаг 3. Пересчёт суммы заказа
Файл `models.py` (фрагмент):
```python
class Order(models.Model):
    # … поля

    def recalc(self):
        self.total = sum(i.price * i.quantity for i in self.items.all())
        self.save(update_fields=["total"])


class OrderItem(models.Model):
    # … поля

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self.order.recalc()
```
Файл `orm.py`:
```python
order = Order.objects.get(number="A-12")
print(order.total)
gaming = Product.objects.get(slug="gaming-mouse")
OrderItem.objects.create(order=order, product=gaming, quantity=1, price="3490.00")
order.refresh_from_db()
print(order.total)
OrderItem.objects.filter(order=order).update(quantity=5)
order.refresh_from_db()
print(order.total)
order.recalc()
print(order.total)
```
Результат:
```
67988.00
71478.00
71478.00
349895.00
```
Добавление позиции пересчитало сумму, а `update(quantity=5)` — нет: `save()` не вызывался, сумма устарела, пока её не пересчитали вручную.

### Шаг 4. Ошибки в save()
Без `super().save(*args, **kwargs)` товар не сохраняется вовсе, и первая же позиция заказа с ним падает:
```
ValueError: save() prohibited to prevent data loss due to unsaved related object 'product'.
```
С сигнатурой `def save(self):` — падает `create()`, который передаёт свои аргументы:
```
TypeError: Product.save() got an unexpected keyword argument 'force_insert'
```

## Частые ошибки
- **Свойство в `filter()`.** `FieldError: Cannot resolve keyword 'in_stock'` — фильтруют по полям и аннотациям.
- **`save()` без `super().save(*args, **kwargs)`.** Объект не сохраняется; без `*args, **kwargs` — `TypeError … unexpected keyword argument 'force_insert'`.
- **Логика только в `save()`.** `update()`, `bulk_create()`, `bulk_update()` её обходят — сохранённое значение устаревает.
- **`slugify` для кириллицы.** Пустая строка и `IntegrityError` на втором товаре. `allow_unicode=True` или транслитерация.
- **Нет `__str__`.** В админке и сообщениях — `OrderItem object (1)`.
- **Запросы в `__str__`.** `return f"{self.order} — {self.product}"` в списке админки — N+1; `list_select_related` или простой `__str__`.

## Итог
**Методы модели**
- `__str__`, `@property` (только Python, не `filter`), `get_absolute_url()` через `reverse`, методы-действия.

**save()**
- `def save(self, *args, **kwargs)` → своё → `super().save(*args, **kwargs)`.
- Не вызывается при `update()`, `bulk_*` — то, что должно быть всегда верным, лучше вычислять.

## Вопросы на собеседовании
<details><summary>Когда переопределять `save()`, а когда использовать сигналы?</summary>

`save()` — когда логика касается самой модели и видна при чтении её кода (заполнить поле, нормализовать значение). Сигналы (`post_save`) — для реакции другого приложения, которое не должно менять модель (уведомления, кэш). Оба способа не срабатывают при `update()` и `bulk_*`.
</details>

<details><summary>Почему `@property` нельзя использовать в `filter()`?</summary>

Свойство вычисляется в Python у загруженного объекта, а `filter()` строит SQL — база о свойстве ничего не знает (`FieldError`). Для фильтра нужно то же условие на полях (`stock__gt=0`) или аннотация (`annotate(...)`), а повторяющиеся условия — в метод QuerySet.
</details>

<details><summary>Зачем модели `get_absolute_url()`?</summary>

Это единственное место, где задан адрес объекта. Его используют `CreateView`/`UpdateView` (redirect после сохранения), админка («Смотреть на сайте»), карта сайта, шаблоны. Сменился маршрут — правится одно место; внутри — `reverse()` по имени маршрута.
</details>

## Глубже
Сохранение нескольких объектов «всё или ничего» — следующая тема «Транзакции».
