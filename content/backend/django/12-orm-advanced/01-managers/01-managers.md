---
title: Свои QuerySet и менеджеры
type: lesson
level: 3
reading_time: 11
---

## Теория
Условие «в наличии» (`stock__gt=0`) встречается в каталоге, в категории, в поиске, в API. Скопированное в десять мест, оно разойдётся при первой правке. Повторяющиеся условия выносят в **методы своего QuerySet**:
```
class ProductQuerySet(models.QuerySet):
    def in_stock(self):
        return self.filter(stock__gt=0)
```
Метод возвращает QuerySet, поэтому методы сцепляются друг с другом и с обычными: `Product.objects.in_stock().cheap().order_by("price")`. Чтобы они были у `Product.objects`, менеджер строят из QuerySet: **`objects = ProductQuerySet.as_manager()`**. Методы доступны и в связях: `category.products.in_stock()`.

**Менеджер** — объект, через который модель отдаёт запросы (`objects`). Свой менеджер с переопределённым **`get_queryset()`** меняет базовую выборку: `Product.active` — только товары в продаже. У модели может быть несколько менеджеров.

Осторожно с **менеджером по умолчанию** — это **первый** объявленный в классе. Django использует его в админке, в `dumpdata`, в обратных связях (`category.products`). Если первым стоит менеджер с фильтром, «скрытые» объекты пропадают и оттуда. Поэтому первым оставляют обычный `objects`, а фильтрующие менеджеры объявляют после. И ещё: объявив любой свой менеджер, вы **теряете автоматический `objects`** — его надо объявить явно.

Менеджер с фильтром и методами QuerySet одновременно — `ActiveManager.from_queryset(ProductQuerySet)()`.

## Наглядно
**Таблица 1.** QuerySet, менеджер и их сочетания.

| Что | Как | Даёт |
|---|---|---|
| метод QuerySet | `class ProductQuerySet(models.QuerySet): def in_stock(self)` | `Product.objects.in_stock().cheap()` — цепочки |
| менеджер из QuerySet | `objects = ProductQuerySet.as_manager()` | методы у `objects` и в связях |
| менеджер с базовым фильтром | `get_queryset()` → `super().get_queryset().filter(…)` | `Product.active.all()` |
| оба сразу | `ActiveManager.from_queryset(ProductQuerySet)()` | `Product.active.in_stock()` |
| менеджер по умолчанию | первый объявленный | админка, `dumpdata`, обратные связи |

## На практике
Задача: `Product.objects.in_stock().cheap()` для каталога и менеджер `Product.active` для витрины. В учебных данных четыре товара: игровой мыши нет на складе, коврик снят с продажи (`is_active=False`).

### Шаг 1. Свой QuerySet
Файл `models.py` (фрагмент):
```python
class ProductQuerySet(models.QuerySet):
    def in_stock(self):
        return self.filter(stock__gt=0)

    def cheap(self, limit=2000):
        return self.filter(price__lt=limit)


class Product(models.Model):
    # … поля
    objects = ProductQuerySet.as_manager()
```
Файл `orm.py`:
```python
print(Product.objects.in_stock().cheap())
print(Product.objects.cheap(5000).in_stock().order_by("price"))
print(Category.objects.get(name="Мыши").products.in_stock())
```
Результат:
```
<ProductQuerySet [<Product: Беспроводная мышь>, <Product: Коврик для мыши>]>
<ProductQuerySet [<Product: Коврик для мыши>, <Product: Беспроводная мышь>]>
<ProductQuerySet [<Product: Беспроводная мышь>, <Product: Коврик для мыши>]>
```
SQL цепочки — обычные условия через `AND`:
```
SELECT … FROM "shop_product" WHERE ("shop_product"."stock" > 0 AND "shop_product"."price" < 2000)
```

### Шаг 2. Менеджер с фильтром
Файл `models.py` (фрагмент):
```python
class ActiveManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(is_active=True)


class Product(models.Model):
    # … поля
    objects = ProductQuerySet.as_manager()
    active = ActiveManager()
```
Файл `orm.py`:
```python
print(Product.active.count(), Product.objects.count())
print(hasattr(Product.active, "in_stock"))
```
Результат:
```
3 4
False
```
У `active` нет методов `ProductQuerySet` — это отдельный менеджер. С ними: `active = ActiveManager.from_queryset(ProductQuerySet)()`, тогда `Product.active.in_stock()` вернёт `<ProductQuerySet [<Product: Ноутбук Aster 14>, <Product: Беспроводная мышь>]>`.

### Шаг 3. Не тот менеджер первым
Объявим `active` раньше `objects`:

Файл `orm.py`:
```python
print(Product._meta.default_manager.name)
mice = Category.objects.get(name="Мыши")
print(mice.products.count(), Product.objects.filter(category=mice).count())
```
Результат:
```
active
2 3
```
`active` стал менеджером по умолчанию — и обратная связь `mice.products` молча скрыла коврик. Так же он пропадёт в админке. Прямая связь (`order_item.product`) фильтр не использует и снятый товар вернёт.

Только `active = ActiveManager()` без `objects` — `Product.objects` больше нет:
```
AttributeError: type object 'Product' has no attribute 'objects'
```

## Частые ошибки
- **Метод в менеджере вместо QuerySet.** `Product.objects.in_stock()` работает, а `Product.objects.filter(…).in_stock()` — нет: у QuerySet такого метода нет. Методы пишут в QuerySet и делают менеджер `as_manager()`.
- **Фильтрующий менеджер первым.** Он становится менеджером по умолчанию: объекты пропадают из админки, `dumpdata` и обратных связей.
- **Свой менеджер без `objects`.** `AttributeError: type object 'Product' has no attribute 'objects'`.
- **Метод QuerySet, который возвращает список.** `return [p for p in self if …]` ломает цепочку и считает в Python. Методы возвращают QuerySet.
- **Бизнес-логика в менеджере.** Менеджер — про выборки; изменения данных — в методах модели или сервисах.

## Итог
**Свой QuerySet**
- Методы-условия возвращают `self.filter(…)` и сцепляются; `objects = ProductQuerySet.as_manager()`.

**Менеджер**
- `get_queryset()` задаёт базовую выборку; `from_queryset()` добавляет методы QuerySet.
- Первый объявленный — по умолчанию (админка, обратные связи); первым — обычный `objects`.

## Вопросы на собеседовании
<details><summary>Чем менеджер отличается от QuerySet?</summary>

Менеджер — точка входа модели (`Model.objects`), он создаёт QuerySet через `get_queryset()`. QuerySet — сам ленивый запрос с цепочкой методов. Свои условия удобнее писать в QuerySet (тогда они сцепляются) и получать менеджер через `as_manager()` или `Manager.from_queryset()`.
</details>

<details><summary>Что такое менеджер по умолчанию и почему он важен?</summary>

Первый объявленный в модели менеджер (или `Meta.default_manager_name`). Его используют админка, `dumpdata`, обобщённые view без `queryset`, обратные связи. Менеджер с фильтром по умолчанию скрывает объекты везде; поэтому первым оставляют неотфильтрованный `objects`. Для прямых связей Django использует `_base_manager` — без фильтров.
</details>

<details><summary>Как сделать `Product.objects.in_stock().cheap()`?</summary>

Класс `ProductQuerySet(models.QuerySet)` с методами `in_stock` и `cheap`, каждый возвращает `self.filter(...)`; в модели — `objects = ProductQuerySet.as_manager()`. Методы доступны у менеджера, у любого QuerySet модели и в связях.
</details>

## Глубже
Где ещё размещать логику модели — следующая тема «Методы модели».
