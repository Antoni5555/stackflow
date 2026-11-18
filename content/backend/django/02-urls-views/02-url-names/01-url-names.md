---
title: Имена маршрутов
type: lesson
level: 1
reading_time: 10
---

## Теория
Ссылка на товар встречается в каталоге, корзине, письме о заказе, редиректе после оплаты. Если в каждом месте написать адрес руками — `"/products/" + slug + "/"`, — то когда маркетинг попросит перенести товары на `/catalog/…`, придётся искать и править все места. Что-то обязательно забудут, и ссылки начнут вести на 404.

Поэтому у маршрута есть **имя**: `path("catalog/<slug:slug>/", views.product_detail, name="product_detail")`. Адрес по имени строит Django — это называется **обратным разрешением** (reverse): от имени и параметров к адресу. Адрес меняется в одном месте — в `urls.py`, а все ссылки перестраиваются сами.
- в Python-коде — **`reverse("product_detail", args=["aster-14"])`** или `kwargs={"slug": "aster-14"}` → `"/catalog/aster-14/"`;
- в шаблоне — тег **`{% url 'product_detail' product.slug %}`**;
- `redirect("product_detail", slug="aster-14")` принимает имя маршрута сам (тема «Запрос и ответ»).

Если Django не может построить адрес — нет маршрута с таким именем или не хватает параметров, — он выбрасывает **`NoReverseMatch`**, и страница падает с ошибкой 500. Это хорошо: сломанная ссылка видна сразу, а не когда по ней кликнет покупатель.

Имена в большом проекте повторяются: `detail` есть у товара, заказа и статьи. Поэтому маршрутам приложения дают **пространство имён**: в его `urls.py` пишут `app_name = "catalog"`, а ссылаются с префиксом — `{% url 'catalog:product_detail' slug %}`, `reverse("catalog:product_list")`. Пространство имён создаётся, когда модуль подключают через `include`.

## Наглядно
**Рисунок 1.** Прямое и обратное разрешение: адрес → view по маршруту и имя + параметры → адрес.

![Рисунок 1. Маршрут catalog/<slug:slug>/ с именем product_detail: запрос /catalog/aster-14/ находит view, а reverse("product_detail", args=["aster-14"]) и {% url %} строят по имени тот же адрес](img/url-reverse.svg)

**Таблица 1.** Как получить адрес по имени.

| Где | Как | Результат |
|---|---|---|
| Python | `reverse("product_detail", args=["aster-14"])` | `"/catalog/aster-14/"` |
| Python | `reverse("product_detail", kwargs={"slug": "aster-14"})` | `"/catalog/aster-14/"` |
| Шаблон | `{% url 'product_detail' product.slug %}` | `/catalog/aster-14/` |
| С пространством имён | `{% url 'catalog:product_detail' slug %}` | тот же адрес |
| Редирект | `redirect("product_detail", slug="aster-14")` | ответ 302 на этот адрес |

## На практике
Задача: каталог со ссылками на товары и ссылка «← Каталог» на странице товара — без адресов, записанных вручную.

### Шаг 1. Маршруты с именами
Файл `urls.py`:
```python
from django.urls import path

from . import views

urlpatterns = [
    path("catalog/", views.product_list, name="product_list"),
    path("catalog/<slug:slug>/", views.product_detail, name="product_detail"),
]
```

### Шаг 2. reverse во view и url в шаблоне
`reverse` строит адрес каталога для ссылки «назад», шаблон — ссылки на товары:

Файл `views.py`:
```python
from django.http import HttpResponse
from django.shortcuts import render
from django.urls import reverse

PRODUCTS = {
    "aster-14": "Ноутбук Aster 14",
    "wireless-mouse": "Беспроводная мышь",
}


def product_list(request):
    return render(request, "shop/product_list.html", {"products": PRODUCTS})


def product_detail(request, slug):
    back = reverse("product_list")
    return HttpResponse(f'<a href="{back}">← Каталог</a><h1>{PRODUCTS[slug]}</h1>')
```

Файл `templates/shop/product_list.html`:
```html
<h1>Каталог</h1>
<ul>
  {% for slug, name in products.items %}
    <li><a href="{% url 'product_detail' slug %}">{{ name }}</a></li>
  {% endfor %}
</ul>
```
`products.items` в шаблоне — то же, что `PRODUCTS.items()` в Python: пары «slug, название».

### Шаг 3. Запросы
Результат:
```
GET /catalog/ → 200 OK

<h1>Каталог</h1>
<ul>

    <li><a href="/catalog/aster-14/">Ноутбук Aster 14</a></li>

    <li><a href="/catalog/wireless-mouse/">Беспроводная мышь</a></li>

</ul>

GET /catalog/aster-14/ → 200 OK

<a href="/catalog/">← Каталог</a><h1>Ноутбук Aster 14</h1>
```
Адреса в HTML построил Django. Поменяйте в `urls.py` `catalog/` на `shop/` — ссылки перестроятся, а шаблон и view останутся прежними.

### Шаг 4. Забыли параметр
Пишем в шаблоне `{% url 'product_detail' %}` — без slug.

Результат:
```
GET /catalog/ → 500 Internal Server Error

NoReverseMatch: Reverse for 'product_detail' with no arguments not found. 1 pattern(s) tried: ['catalog/(?P<slug>[-a-zA-Z0-9_]+)/\\Z']
```
Маршрут нашёлся, но без slug адрес не построить. В сообщении видно, какой шаблон адреса Django пробовал: `slug` внутри — это регулярное выражение конвертера.

### Шаг 5. Пространство имён
Маршруты каталога переносим в свой модуль с `app_name`:

Файл `catalog_urls.py`:
```python
from django.urls import path

from . import views

app_name = "catalog"
urlpatterns = [
    path("", views.product_list, name="product_list"),
    path("<slug:slug>/", views.product_detail, name="product_detail"),
]
```

Файл `urls.py`:
```python
from django.urls import include, path

urlpatterns = [
    path("catalog/", include("shop.catalog_urls")),
]
```
Если оставить в шаблоне `{% url 'product_detail' slug %}`, страница упадёт.

Результат:
```
GET /catalog/ → 500 Internal Server Error

NoReverseMatch: Reverse for 'product_detail' not found. 'product_detail' is not a valid view function or pattern name.
```
Теперь имя полностью — `catalog:product_detail`. Исправляем шаблон на `{% url 'catalog:product_detail' slug %}` и view на `reverse("catalog:product_list")` — страницы снова открываются с теми же адресами.

## Частые ошибки
- **Адрес вручную.** `href="/products/{{ slug }}/"` и `"/catalog/" + slug` ломаются при первом переносе страниц. Адреса — только через `{% url %}` и `reverse`.
- **Не тот способ передать параметры.** `reverse("product_detail", "aster-14")` — второй аргумент `reverse` не параметры; нужно `args=[...]` или `kwargs={...}`.
- **Имя без пространства имён.** После `app_name = "catalog"` имя — `catalog:product_detail`; старое `product_detail` даёт `NoReverseMatch`.
- **Имя в шаблоне без кавычек.** `{% url product_detail slug %}` — Django ищет переменную `product_detail`, а не маршрут. Имя — строкой: `'product_detail'`.
- **Одинаковые имена в разных приложениях без `app_name`.** Побеждает одно из них, и часть ссылок молча ведёт не туда.

## Итог
**Имя маршрута**
- `path(…, name="product_detail")` — адрес меняется в одном месте, ссылки строятся по имени.

**Построить адрес**
- Python: `reverse("имя", args=[…])` / `kwargs={…}`; шаблон: `{% url 'имя' параметр %}`.
- Не получилось — `NoReverseMatch` (ошибка 500 сразу, а не битая ссылка).

**Пространства имён**
- `app_name = "catalog"` в подключённом через `include` модуле → `catalog:product_detail`.

## Вопросы на собеседовании
<details><summary>Зачем маршрутам имена?</summary>

Чтобы не зашивать адреса в код и шаблоны. Ссылки строятся по имени через `reverse` и `{% url %}`, поэтому адрес меняется только в `urls.py`. Ошибка в имени или параметрах сразу даёт `NoReverseMatch`, а не тихую битую ссылку.
</details>

<details><summary>Что делает `reverse`?</summary>

Обратное разрешение URL: по имени маршрута (и пространству имён) и параметрам возвращает адрес-строку, например `reverse("catalog:product_detail", kwargs={"slug": "aster-14"})` → `"/catalog/aster-14/"`. Если маршрута нет или параметры не подходят, выбрасывает `NoReverseMatch`. Для использования в атрибутах класса и настройках есть ленивый `reverse_lazy`.
</details>

<details><summary>Что такое `app_name` и пространства имён URL?</summary>

`app_name` в `urls.py` приложения задаёт пространство имён: имена его маршрутов становятся `app_name:имя`. Это разводит одинаковые имена разных приложений (`catalog:detail`, `orders:detail`). Пространство создаётся при подключении модуля через `include`; с параметром `namespace` можно подключить одно приложение дважды под разными именами.
</details>

## Глубже
Ссылки на страницы в шаблонах и их наследование — раздел «Шаблоны». Редирект по имени после отправки формы — тема «Запрос и ответ» и раздел «Изменение данных и формы».
