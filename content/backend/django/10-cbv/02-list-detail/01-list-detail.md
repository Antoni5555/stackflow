---
title: Просмотр
type: lesson
level: 2
reading_time: 12
---

## Теория
Каталог и карточка товара — типовые страницы, для них есть готовые классы из `django.views.generic`.

**`ListView`** — список объектов. Минимум — модель:
```
class ProductList(ListView):
    model = Product
```
Дальше класс всё делает по соглашениям:
- запрос — `Product.objects.all()`; порядок — `ordering = ["price"]`;
- шаблон — **`shop/product_list.html`** (`<приложение>/<модель>_list.html`), своё имя — `template_name`;
- в контексте список лежит дважды: `object_list` и **`product_list`** (`<модель>_list`), своё имя — `context_object_name`;
- **`paginate_by = 20`** — постраничный вывод по `?page=N`: в контексте `page_obj`, `paginator`, `is_paginated`, а список — только текущая страница. Страница за пределами — 404.

**`DetailView`** — один объект. Ищет его по `pk` или **`slug`** из адреса (`<int:pk>` или `<slug:slug>`), не нашёл — 404. Шаблон — `shop/product_detail.html`, в контексте — `object` и `product`. Другие имена параметров — `pk_url_kwarg`, `slug_url_kwarg`, другое поле для поиска — `slug_field`.

Нестандартный запрос или лишние данные — переопределением методов:
- **`get_queryset()`** — какие объекты показывать: фильтр по параметру адреса (`self.kwargs["pk"]`), по пользователю (`self.request.user`), `select_related`. Для `DetailView` объект ищется **внутри** этого QuerySet — так прячут снятые с продажи товары.
- **`get_context_data(**kwargs)`** — что ещё передать в шаблон. Сначала `context = super().get_context_data(**kwargs)`, затем добавить ключи, вернуть `context`.

## Наглядно
**Рисунок 1.** Что ListView и DetailView делают по соглашениям.

![Рисунок 1. ListView: model Product → queryset Product.objects.all() с ordering → шаблон shop/product_list.html → контекст product_list, object_list, page_obj. DetailView: slug из адреса → get_object() в get_queryset() → 404 или объект → шаблон shop/product_detail.html → контекст product, object](img/list-detail.svg)

**Таблица 1.** Атрибуты и методы, которые меняют чаще всего.

| Что | ListView | DetailView |
|---|---|---|
| модель / запрос | `model`, `queryset`, `get_queryset()` | то же |
| шаблон | `template_name` (по умолчанию `<модель>_list.html`) | `<модель>_detail.html` |
| имя в контексте | `context_object_name` (`<модель>_list`) | `<модель>` |
| порядок | `ordering` | — |
| страницы | `paginate_by` | — |
| поиск объекта | — | `pk`/`slug` в адресе, `slug_field`, `slug_url_kwarg` |
| доп. данные | `get_context_data()` | `get_context_data()` |

## На практике
Задача: каталог по 2 товара на странице от дешёвых к дорогим, карточка товара по `slug`, страница категории только с товарами в наличии.

### Шаг 1. Каталог и карточка
Файл `views.py`:
```python
from django.views.generic import DetailView, ListView

from .models import Product


class ProductList(ListView):
    model = Product
    paginate_by = 2
    ordering = ["price"]


class ProductDetail(DetailView):
    model = Product
```
Файл `urls.py` (фрагмент):
```python
urlpatterns = [
    path("catalog/", views.ProductList.as_view(), name="catalog"),
    path("products/<slug:slug>/", views.ProductDetail.as_view(), name="product"),
]
```
Файл `templates/shop/product_list.html`:
```html
<ul>
  {% for p in product_list %}
    <li>{{ p.name }}</li>
  {% endfor %}
</ul>
{% if is_paginated %}<p>Страница {{ page_obj.number }} из {{ page_obj.paginator.num_pages }}</p>{% endif %}
```
Шаблон карточки — `templates/shop/product_detail.html`: `{{ product.name }}` и `{{ object.price }}`.

### Шаг 2. Что отвечают страницы
Ответы на запросы (HTML сокращён до строк списка):
```
GET /catalog/ → 200 OK, SQL-запросов: 2
<li>Коврик для мыши</li>
<li>Беспроводная мышь</li>
<p>Страница 1 из 3</p>

GET /catalog/?page=3 → 200 OK
<li>Ноутбук Aster 14</li>
<p>Страница 3 из 3</p>

GET /catalog/?page=9 → 404 Not Found
Неправильная страница (9): Страница не содержит результатов

GET /products/aster-14/ → 200 OK
<h1>Ноутбук Aster 14</h1>
<p>64990,00 ₽</p>

GET /products/nope/ → 404 Not Found
Не найден ни один product, соответствующий запросу
```
Два запроса каталога — `SELECT COUNT(*)` для числа страниц и выборка с `ORDER BY "shop_product"."price" ASC LIMIT 2` (на третьей странице — `LIMIT 1 OFFSET 4`: товаров 5, на последней остался один).

### Шаг 3. Свой запрос и дополнительные данные
Файл `views.py` (фрагмент):
```python
class CategoryProducts(ListView):
    template_name = "shop/category.html"
    context_object_name = "products"

    def get_queryset(self):
        return Product.objects.filter(
            category_id=self.kwargs["pk"], stock__gt=0
        ).order_by("name")

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["category"] = Category.objects.get(pk=self.kwargs["pk"])
        return context
```
Маршрут — `categories/<int:pk>/`, шаблон выводит `{{ category.name }}` и `products`. `GET /categories/2/`:
```html
<h1>Мыши</h1>
<ul><li>Беспроводная мышь</li><li>Коврик для мыши</li></ul>
```
Игровой мыши нет — её нет на складе. `object_list` в контексте тоже есть и содержит те же 2 товара.

### Шаг 4. Ошибки соглашений
Без шаблона `shop/product_list.html`:
```
django.template.exceptions.TemplateDoesNotExist: shop/product_list.html
```
`DetailView` с маршрутом `products/<str:code>/` — нет ни `pk`, ни `slug`:
```
AttributeError: Generic detail view ProductDetail must be called with either an object pk or a slug in the URLconf.
```
`ListView` без `model`, `queryset` и `get_queryset()`:
```
django.core.exceptions.ImproperlyConfigured: L is missing a QuerySet. Define L.model, L.queryset, or override L.get_queryset().
```
`paginate_by` без `ordering` — работает, но с предупреждением `UnorderedObjectListWarning: Pagination may yield inconsistent results with an unordered object_list` (раздел «ORM: чтение данных»).

## Частые ошибки
- **Не то имя шаблона или переменной.** По умолчанию — `<модель>_list.html` / `<модель>_detail.html` и `product_list` / `product`. Ошибка в имени переменной не падает — шаблон молча пуст.
- **Параметр адреса не `pk` и не `slug`.** `DetailView` его не найдёт — `AttributeError … must be called with either an object pk or a slug`. Переименуйте параметр или задайте `slug_url_kwarg`.
- **`get_context_data` без `super()`.** Контекст заменён целиком: пропадают `object_list`, `page_obj` и `view`.
- **`queryset = …` с данными запроса.** Атрибут класса вычисляется один раз; фильтр по `self.request` и `self.kwargs` — только в `get_queryset()`.
- **Пагинация без порядка.** Товары «перепрыгивают» между страницами; задайте `ordering`.
- **N+1 в списке.** `ListView` не знает, что выводит шаблон; `select_related`/`prefetch_related` — в `queryset` или `get_queryset()`.

## Итог
**ListView**
- `model`, `ordering`, `paginate_by`; шаблон `<модель>_list.html`, в контексте `<модель>_list` и `object_list`, `page_obj`.

**DetailView**
- Объект по `pk` или `slug` из адреса внутри `get_queryset()`; нет — 404; в контексте `object` и `<модель>`.

**Настройка**
- `get_queryset()` — свой запрос, `get_context_data()` — с `super()` и новыми ключами.

## Вопросы на собеседовании
<details><summary>Как DetailView находит объект?</summary>

`get_object()` берёт QuerySet из `get_queryset()` и фильтрует его по `pk` (параметр `pk_url_kwarg`, по умолчанию `pk`) или по `slug_field` со значением `slug_url_kwarg`. Не нашёл — `Http404`; нет ни того, ни другого параметра — `AttributeError`. Ограничение `get_queryset()` (например, только свои объекты) действует и на поиск.
</details>

<details><summary>Зачем переопределять `get_queryset()`, а не задавать `queryset`?</summary>

Атрибут `queryset` вычисляется один раз при определении класса и не знает о текущем запросе. В `get_queryset()` доступны `self.request` и `self.kwargs` — фильтр по пользователю, параметру адреса, GET-параметрам.
</details>

<details><summary>Что попадает в контекст ListView с `paginate_by`?</summary>

`paginator`, `page_obj` (текущая страница: `number`, `has_next`, `next_page_number`…), `is_paginated` и `object_list` / `<модель>_list` — объекты только текущей страницы. Номер страницы берётся из `?page=` (или из параметра адреса `page`); неверный номер — 404.
</details>

## Глубже
Создание, изменение и удаление на классах — следующая тема «Редактирование».
