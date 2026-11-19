---
title: Обратные связи
type: lesson
level: 2
reading_time: 10
---

## Теория
`ForeignKey` объявлен у товара, но пройти по нему можно и обратно: от категории к её товарам, от покупателя к его заказам, от заказа к позициям. Обратная связь — это **менеджер** на объекте «одного»: `category.products`, `user.orders`, `order.items`. У него те же методы, что у `objects`, только все запросы уже ограничены этим объектом:
- `category.products.all()` — `WHERE category_id = <id категории>`;
- `user.orders.filter(…)`, `.count()`, `.exists()`, `.order_by(…)` — всё внутри заказов этого покупателя;
- `category.products.create(name=…)` — создать товар сразу в этой категории.

Имя менеджера задаёт **`related_name`**; без него — `<модель>_set`: `order_set`. Когда `related_name` задан, `_set` больше нет. Для `ForeignKey` на ту же модель (`parent = ForeignKey("self")`) обратная связь — дочерние объекты: `electronics.children.all()`.

В шаблоне — то же самое без скобок: `{% for order in user.orders.all %}`. Каждое обращение `x.related.all()` — **новый запрос**: в цикле по десяти категориям это десять запросов за товарами. Как загрузить их заранее — тема `prefetch_related`.

Страница «Мои заказы» — главный пример обратной связи: заказы ищут **через** текущего пользователя (`request.user.orders`), и чужие заказы туда попасть не могут (подробно — раздел «Пользователи и доступ»).

## Наглядно
**Таблица 1.** Прямые и обратные связи учебных моделей.

| Связь в модели | Вперёд | Обратно |
|---|---|---|
| `Product.category = ForeignKey(Category, related_name="products")` | `product.category` | `category.products.all()` |
| `Category.parent = ForeignKey("self", related_name="children")` | `mice.parent` | `electronics.children.all()` |
| `Order.user = ForeignKey(User, related_name="orders")` | `order.user` | `user.orders.all()` |
| `OrderItem.order = ForeignKey(Order, related_name="items")` | `item.order` | `order.items.all()` |
| `Product.tags = ManyToManyField(Tag, related_name="products")` | `product.tags.all()` | `tag.products.all()` |
| `Review.product` без `related_name` (для примера) | `review.product` | `product.review_set.all()` |

## На практике
Задача: показать товары и подкатегории категории и заказы покупателя.

### Шаг 1. Менеджеры обратных связей
Файл `orm.py`:
```python
mice = Category.objects.get(name="Мыши")
print(mice.products.all(), mice.children.all())
anna = User.objects.get(username="anna")
print(anna.orders.all())
print(hasattr(anna, "order_set"))
```
Результат:
```
<QuerySet [<Product: Беспроводная мышь>, <Product: Игровая мышь>]> <QuerySet []>
<QuerySet [<Order: A-12>, <Order: A-14>]>
False
```
SQL обратных связей:
```
SELECT "shop_product"."id", "shop_product"."category_id", "shop_product"."name", "shop_product"."price", "shop_product"."is_active" FROM "shop_product" WHERE "shop_product"."category_id" = 3 LIMIT 21
SELECT "shop_category"."id", "shop_category"."name", "shop_category"."parent_id" FROM "shop_category" WHERE "shop_category"."parent_id" = 3 LIMIT 21
SELECT "shop_order"."id", "shop_order"."user_id", "shop_order"."number" FROM "shop_order" WHERE "shop_order"."user_id" = 1 LIMIT 21
```
Менеджер — это готовый `filter(category_id=…)`. У «Мышей» нет подкатегорий — пустой QuerySet. С `related_name="orders"` имени `order_set` у пользователя нет.

### Шаг 2. В шаблоне
Страница покупателя с его заказами:

Файл `templates/shop/account.html`:
```html
<h1>Заказы {{ user.username }}</h1>
<ul>
  {% for order in user.orders.all %}
    <li>{{ order.number }}: позиций {{ order.items.count }}</li>
  {% empty %}
    <li>Заказов пока нет.</li>
  {% endfor %}
</ul>
```
Запросов здесь: заказы покупателя — один, и `order.items.count` — ещё по одному на каждый заказ. На двух заказах это незаметно, на сотне — сотня запросов. Это и есть N+1 — следующая тема.

## Частые ошибки
- **`_set` при заданном `related_name`.** `user.order_set` — `AttributeError: 'User' object has no attribute 'order_set'. Did you mean: 'orders'?`; в шаблоне — тихая пустота. Имя обратной связи — из `related_name`.
- **Обратная связь без `.all` в шаблоне.** `{% for order in user.orders %}` — менеджер не итерируется: `TypeError: 'RelatedManager' object is not iterable`.
- **`Order.objects.filter(user=request.user)` и `request.user.orders.all()` — путают как разные.** Это одно и то же; второй вариант просто короче и читается как «заказы этого пользователя».
- **Обратная связь в цикле.** `{% for c in categories %}{{ c.products.count }}{% endfor %}` — запрос на каждую категорию. Число одним запросом — `annotate(Count(…))` (раздел «ORM: агрегация»).
- **Одинаковые `related_name` у двух связей на одну модель.** `fields.E304`/`E305` — проект не запустится.

## Итог
**Обратная связь**
- Менеджер на объекте «одного»: `category.products`, `user.orders`, `order.items` — `all`, `filter`, `count`, `create`.
- Имя — `related_name`, без него `<модель>_set`.

**В шаблоне**
- `{% for x in obj.related.all %}`; каждое обращение — свой запрос.

## Вопросы на собеседовании
<details><summary>Как получить все объекты, ссылающиеся на данный через ForeignKey?</summary>

Через обратный менеджер: `category.products.all()` (по `related_name`) или `category.product_set.all()` (по умолчанию). Менеджер — QuerySet с фильтром по внешнему ключу; у него есть `filter`, `count`, `create`, `add` и т. д.
</details>

<details><summary>Зачем задавать `related_name`?</summary>

Для понятного имени обратной связи (`user.orders` вместо `user.order_set`) и обязательно — когда две связи ведут в одну модель (адрес доставки и адрес оплаты), иначе имена конфликтуют. Это же имя используется в фильтрах через обратную связь: `User.objects.filter(orders__number="A-12")`.
</details>

<details><summary>Что такое `related_query_name`?</summary>

Имя обратной связи именно для фильтров (`filter(<имя>__…)`), если оно должно отличаться от `related_name`. По умолчанию совпадает с `related_name`, а без него — с именем модели строчными. Нужен редко.
</details>

## Глубже
Почему обращение к связям в цикле превращается в сотни запросов и как это увидеть — следующая тема «Проблема N+1».
