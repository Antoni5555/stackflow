---
title: Сессии и сообщения
type: lesson
level: 3
reading_time: 11
---

## Теория
**Сессия** — данные одного посетителя, которые живут между запросами: корзина гостя, выбранный город, последние просмотренные товары. Браузер хранит только случайный ключ в cookie `sessionid`, сами данные — на сервере (по умолчанию — таблица `django_session`). Работать с сессией — как со словарём:
```
cart = request.session.get("cart", {})
request.session["cart"] = cart
del request.session["cart"]
```
Значения сохраняются в JSON, поэтому в сессию кладут строки, числа, списки, словари — не объекты моделей и не `Decimal` (храните `id` и строки).

Django сохраняет сессию, если **заметил изменение** — присваивание или удаление ключа верхнего уровня. Изменение **вложенного** словаря (`request.session["cart"]["aster-14"] = 1`) он не видит, и оно потеряется. Два выхода: присвоить ключ заново (`request.session["cart"] = cart`) или отметить `request.session.modified = True`.

Сессия живёт `SESSION_COOKIE_AGE` (по умолчанию две недели). При входе `login()` меняет ключ сессии, но данные сохраняет — корзина гостя остаётся после входа; `logout()` очищает сессию целиком.

**Сообщения** (`django.contrib.messages`) — одноразовые уведомления «Товар добавлен в корзину», «Заказ оформлен». Их ставят во view перед redirect, а показывают на следующей странице:
```
messages.success(request, "Товар добавлен в корзину")
```
Уровни — `debug`, `info`, `success`, `warning`, `error`; в шаблоне — цикл по `messages` (их кладёт контекст-процессор), у каждого `m.tags` для CSS-класса. Сообщение показывается **один раз**: после вывода в шаблоне оно удаляется.

## Наглядно
**Рисунок 1.** Корзина в сессии: в браузере — только ключ, данные — на сервере.

![Рисунок 1. Браузер хранит cookie sessionid=ab12…; сервер в таблице django_session по ключу ab12… хранит {"cart": {"wireless-mouse": 2, "mouse-pad": 1}}; POST /cart/add/ → изменить → request.session["cart"] = cart → сохранение после view](img/session-cart.svg)

**Таблица 1.** Сессии и сообщения.

| Что | Как |
|---|---|
| прочитать | `request.session.get("cart", {})` |
| записать | `request.session["cart"] = cart` |
| изменили вложенное | присвоить ключ заново или `request.session.modified = True` |
| удалить ключ / всё | `del request.session["cart"]` / `request.session.flush()` |
| сообщение | `messages.success(request, "…")`, `messages.error(…)` |
| показать | `{% for m in messages %}<p class="{{ m.tags }}">{{ m }}</p>{% endfor %}` |

## На практике
Задача: корзина гостя в сессии — `{slug: количество}` — и сообщение «… добавлен в корзину».

### Шаг 1. View и шаблон
Файл `views.py`:
```python
from django.contrib import messages
from django.shortcuts import get_object_or_404, redirect, render

from .models import Product


def add_to_cart(request, slug):
    product = get_object_or_404(Product, slug=slug)
    cart = request.session.get("cart", {})
    cart[slug] = cart.get(slug, 0) + 1
    request.session["cart"] = cart
    messages.success(request, f"{product.name} добавлен в корзину")
    return redirect("cart")


def cart(request):
    cart = request.session.get("cart", {})
    return render(request, "shop/cart.html", {"cart": cart})
```
Файл `templates/shop/cart.html`:
```html
{% for m in messages %}<p class="{{ m.tags }}">{{ m }}</p>{% endfor %}
<ul>{% for slug, qty in cart.items %}<li>{{ slug }}: {{ qty }}</li>{% endfor %}</ul>
```

### Шаг 2. Один посетитель
Два раза мышь и один раз коврик (POST на `/cart/add/<slug>/`), потом дважды `GET /cart/`:
```
POST /cart/add/wireless-mouse/ → 302, Location: /cart/
<p class="success">Беспроводная мышь добавлен в корзину</p><p class="success">Беспроводная мышь добавлен в корзину</p><p class="success">Коврик для мыши добавлен в корзину</p> <ul><li>wireless-mouse: 2</li><li>mouse-pad: 1</li></ul>
<ul><li>wireless-mouse: 2</li><li>mouse-pad: 1</li></ul>
```
Три накопившихся сообщения показались один раз и исчезли, корзина осталась. Содержимое сессии — `{'cart': {'wireless-mouse': 2, 'mouse-pad': 1}}`. Новый посетитель (другой клиент без cookie) видит пустую корзину `<ul></ul>`.

### Шаг 3. Изменение вложенного словаря
Тот же view, но без присваивания:

Файл `views.py` (фрагмент):
```python
    cart = request.session.setdefault("cart", {})
    cart[slug] = cart.get(slug, 0) + 1
```
После тех же трёх добавлений:
```
<ul><li>wireless-mouse: 1</li></ul>
```
Сохранилось только первое добавление: тогда `setdefault` создал ключ `cart` — изменение верхнего уровня. Дальше менялся вложенный словарь, Django изменений не увидел и сессию не сохранял.

## Частые ошибки
- **Изменили вложенное и не присвоили.** Данные теряются без ошибки. `request.session["cart"] = cart` или `request.session.modified = True`.
- **Объект модели или `Decimal` в сессии.** `TypeError: Object of type … is not JSON serializable`. Храните `id`, `slug`, строки.
- **Цена в корзине из сессии.** Сессию видит только сервер, но цена могла измениться; при оформлении берите цену из базы.
- **Шаблон не выводит `messages`.** Сообщения копятся и вываливаются разом на первой странице, где цикл есть. Выводите их в базовом шаблоне.

## Итог
**Сессия**
- Словарь посетителя на сервере, в браузере — cookie `sessionid`; значения — JSON.
- Сохраняется при изменении верхнего уровня; вложенное — присвоить заново или `modified = True`.

**Сообщения**
- `messages.success(request, …)` перед redirect; вывод — цикл по `messages` в шаблоне; показываются один раз.

## Вопросы на собеседовании
<details><summary>Где хранятся данные сессии в Django?</summary>

На сервере, движком из `SESSION_ENGINE`: по умолчанию в базе (`django_session`), также кэш, кэш + база или файлы. В браузере — только ключ в cookie `sessionid`. Есть движок `signed_cookies`, хранящий данные в самой cookie (подписанными, но читаемыми).
</details>

<details><summary>Почему изменение `request.session["cart"]["x"] = 1` может не сохраниться?</summary>

Django отслеживает только операции над самим объектом сессии (`__setitem__`, `__delitem__`). Изменение вложенного словаря сессию не помечает изменённой, и после view она не сохраняется. Нужно `request.session.modified = True` или присвоить ключ заново; `SESSION_SAVE_EVERY_REQUEST = True` сохраняет всегда.
</details>

<details><summary>Как работает фреймворк сообщений?</summary>

`messages.add_message()` (или `success`, `error`…) кладёт сообщение в хранилище (по умолчанию cookie, при переполнении — сессия). Контекст-процессор `messages` отдаёт их шаблону; при переборе в шаблоне они помечаются прочитанными и удаляются после ответа. Нужен `MessageMiddleware`.
</details>

## Глубже
Число товаров корзины в шапке каждой страницы — следующая тема «Контекст-процессоры».
