---
title: Тесты страниц и форм
type: lesson
level: 3
reading_time: 12
---

## Теория
Тест модели проверяет один метод. Тест **страницы** проверяет всё вместе: маршрут, view, права, запрос к базе, шаблон — так, как это видит браузер. Для этого у каждого `TestCase` есть **тестовый клиент** `self.client`: он отправляет запрос прямо в Django, без сервера и сети:
```
r = self.client.get("/catalog/")
r = self.client.post("/reviews/add/", {"author": "Анна", "rating": 5})
self.client.force_login(user)       # войти без пароля
```
Ответ — объект с `status_code`, `content`, заголовками (`r["Location"]`), `r.context` (контекст шаблона) и `r.templates`.

Проверки Django для ответов:
- **`assertContains(r, "текст")`** — статус 200 (или `status_code=…`) и текст есть в HTML; **`assertNotContains`** — текста нет;
- **`assertRedirects(r, "/куда/")`** — редирект 302 на адрес (и что тот открывается; `fetch_redirect_response=False` — не проверять);
- **`assertTemplateUsed(r, "shop/catalog.html")`**;
- `self.assertEqual(r.status_code, 404)` — для 403/404.

Что тестировать на страницах магазина — прежде всего **права**: гостя отправляет на вход, покупатель видит свой заказ и получает 404 на чужой. Такие тесты ловят самые опасные регрессии — когда кто-то при правке view случайно убрал фильтр по пользователю. Для форм — что верные данные сохраняются и перенаправляют, а неверные показывают ошибку и ничего не сохраняют.

Тест ценен тем, что **падает, когда код ломается**. Поэтому хороший приём — мысленно сломать код (убрать фильтр, декоратор, условие) и спросить: какой тест это заметит? В тренажёре так проверяются задачи «напишите тесты»: ваши тесты запускаются на правильном коде и на нескольких **сломанных версиях** — и должны падать на каждой.

## Наглядно
**Таблица 1.** Проверки ответов.

| Проверка | Что утверждает |
|---|---|
| `assertContains(r, "Заказ A-12")` | 200 и текст в ответе |
| `assertNotContains(r, "Старая")` | текста нет (статус 200) |
| `assertRedirects(r, "/accounts/login/?next=…", fetch_redirect_response=False)` | 302 на этот адрес |
| `assertTemplateUsed(r, "shop/catalog.html")` | страницу рисовал этот шаблон |
| `assertEqual(r.status_code, 404)` | чужой объект не найден |
| `assertFormError(r.context["form"], "rating", "…")` | ошибка формы у поля |

## На практике
Задача: тесты каталога и страницы заказа. Каталог показывает только активные товары; заказ видит только его владелец, гостя отправляет на вход.

### Шаг 1. Тесты
Файл `tests.py`:
```python
from django.contrib.auth.models import User
from django.test import TestCase

from .models import Category, Order, Product


class PagesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cat = Category.objects.create(name="Мыши")
        Product.objects.create(category=cat, name="Мышь", slug="mouse", price="1499.00")
        Product.objects.create(category=cat, name="Старая", slug="old", price="1.00", is_active=False)
        cls.anna = User.objects.create_user("anna")
        cls.boris = User.objects.create_user("boris")
        Order.objects.create(user=cls.anna, number="A-12")
        Order.objects.create(user=cls.boris, number="A-13")

    def test_catalog(self):
        r = self.client.get("/catalog/")
        self.assertContains(r, "Мышь (Мыши)")
        self.assertNotContains(r, "Старая")
        self.assertTemplateUsed(r, "shop/catalog.html")

    def test_guest_redirected(self):
        r = self.client.get("/orders/A-12/")
        self.assertRedirects(r, "/accounts/login/?next=/orders/A-12/", fetch_redirect_response=False)

    def test_own_order(self):
        self.client.force_login(self.anna)
        self.assertContains(self.client.get("/orders/A-12/"), "Заказ A-12")

    def test_foreign_order_404(self):
        self.client.force_login(self.anna)
        self.assertEqual(self.client.get("/orders/A-13/").status_code, 404)
```
На правильном коде все тесты проходят (`OK`). `fetch_redirect_response=False` — потому что страницы входа в проекте нет.

### Шаг 2. Ломаем код — что заметят тесты
Три сломанные версии view и что ответили тесты.

Поиск заказа без `user=request.user`:
```
FAIL: test_foreign_order_404 (shop.tests.PagesTests.test_foreign_order_404)
AssertionError: 200 != 404
```
В каталоге `Product.objects.all()` вместо активных:
```
FAIL: test_catalog (shop.tests.PagesTests.test_catalog)
AssertionError: 1 != 0 : 'Старая' unexpectedly found in the following response
```
Убран `@login_required` — гость доходит до запроса с `user=AnonymousUser`:
```
ERROR: test_guest_redirected (shop.tests.PagesTests.test_guest_redirected)
TypeError: Field 'id' expected a number but got <SimpleLazyObject: <django.contrib.auth.models.AnonymousUser object at 0x7c7360aad8b0>>.
```
Каждая поломка поймана своим тестом. Без `test_foreign_order_404` первая уязвимость прошла бы незамеченной — остальные тесты зелёные.

## Частые ошибки
- **Проверять только «страница открывается».** `assertEqual(r.status_code, 200)` на свой заказ не поймает, что открываются и чужие. Тест на запрет — отдельный.
- **`assertContains` для редиректа.** Он ждёт 200; редирект проверяют `assertRedirects`.
- **Входить через форму с паролем в каждом тесте.** `force_login(user)` — быстрее; пароль не нужен.
- **Проверять весь HTML строкой.** Тест ломается от любой правки вёрстки; ищите ключевой текст.
- **Тесты только «счастливого пути».** Неверная форма, гость, чужой объект, пустой список — там и прячутся ошибки.
- **Тест, который ничего не ловит.** Если сломать код и тест всё равно зелёный — он бесполезен. Проверяйте тесты мысленной поломкой.

## Итог
**Клиент**
- `self.client.get/post`, `force_login`; ответ — `status_code`, `content`, `context`, `templates`.

**Проверки**
- `assertContains`/`assertNotContains`, `assertRedirects`, `assertTemplateUsed`, статус 403/404.
- Права в первую очередь: гость, владелец, чужой.

## Вопросы на собеседовании
<details><summary>Что делает тестовый клиент Django?</summary>

Имитирует браузер: отправляет запросы прямо в обработчик Django (через middleware, маршруты и view) без HTTP-сервера, хранит cookie и сессию между запросами, умеет `force_login`. Ответ дополнен `context` и `templates`, использованными при отрисовке. CSRF по умолчанию не проверяет (`Client(enforce_csrf_checks=True)` — проверяет).
</details>

<details><summary>Чем `assertContains` лучше `assertIn(text, r.content.decode())`?</summary>

Он сразу проверяет статус (200 по умолчанию), декодирует ответ с учётом кодировки, умеет `count` и `html=True` (сравнение как HTML, без учёта пробелов и порядка атрибутов) и даёт понятное сообщение при падении.
</details>

<details><summary>Как понять, что тесты хорошие?</summary>

Они падают, когда поведение ломается. Проверка — мутационное тестирование: в код вносят маленькие поломки (убрать условие, заменить оператор) и смотрят, ловят ли их тесты; инструменты — `mutmut`, `cosmic-ray`. Процент покрытия (`coverage`) показывает, какие строки выполнялись, но не то, что результат проверен.
</details>

## Глубже
Данные для тестов без повторения и проверка числа запросов — следующая тема.
