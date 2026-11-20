---
title: Тестовые данные и запросы
type: lesson
level: 3
reading_time: 11
---

## Теория
Чтобы создать товар, нужна категория; заказ — пользователь и товары. В двадцати тестах это двадцать одинаковых блоков `create(...)`, и когда у модели появится обязательное поле, придётся править все. Повторяющееся создание данных выносят в **фабрики** — функции, которые создают объект с разумными значениями по умолчанию, а в тесте указывают только то, что важно для проверки:
```
def make_product(**kwargs):
    data = {"name": "Мышь", "price": "1499.00", "is_active": True}
    data.update(kwargs)
    ...
    return Product.objects.create(**data)

make_product(is_active=False)      # тесту важно только это
```
Готовые библиотеки: **factory_boy** (классы-фабрики, последовательности, связанные объекты) и **model_bakery** (`baker.make(Product, is_active=False)` — заполнит остальное сам). В тренажёре их нет — пишем свои функции.

Помните про изоляцию: каждый тест видит только данные `setUpTestData` и свои; созданное в соседнем тесте откатывается, и даже изменённый в памяти объект из `setUpTestData` в следующем тесте снова исходный.

**Число запросов.** N+1 не видно в браузере на трёх товарах и не видно в коде. Закрепить, что страница работает за фиксированное число запросов, можно тестом — **`assertNumQueries(n)`**:
```
with self.assertNumQueries(1):
    self.client.get("/catalog/")
```
Если кто-то уберёт `select_related` или добавит в шаблон обращение к связи, тест упадёт и покажет список выполненных запросов. Чтобы тест ловил N+1, в базе должно быть **несколько** объектов: на одном товаре «1 + N» равно «1 + 1».

## Наглядно
**Таблица 1.** Данные для тестов.

| Способ | Плюсы | Минусы |
|---|---|---|
| `create()` прямо в тесте | явно | повторы; правка во многих местах |
| своя фабрика `make_product(**kwargs)` | только важные поля, одно место правки | писать самим |
| factory_boy / model_bakery | последовательности, связи, меньше кода | зависимость, «магия» значений |
| фикстуры JSON (`fixtures = [...]`) | готовый набор | хрупкие при изменении моделей |

## На практике
Задача: фабрика товаров для тестов и тест, который закрепляет число запросов каталога.

### Шаг 1. Фабрика и изоляция
Файл `tests.py`:
```python
from django.test import TestCase

from .models import Category, Product


def make_product(**kwargs):
    data = {"name": "Мышь", "price": "1499.00", "is_active": True}
    data.update(kwargs)
    data.setdefault("slug", data["name"].lower().replace(" ", "-"))
    data.setdefault("category", Category.objects.get_or_create(name="Мыши")[0])
    return Product.objects.create(**data)


class IsolationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.mouse = make_product(name="Mouse")

    def test_a_creates(self):
        make_product(name="Pad", price="490.00")
        self.assertEqual(Product.objects.count(), 2)

    def test_b_sees_only_own(self):
        self.assertEqual(Product.objects.count(), 1)

    def test_c_changes_object(self):
        self.mouse.price = "1.00"
        self.mouse.save()
        self.assertEqual(str(Product.objects.get().price), "1.00")

    def test_d_object_restored(self):
        self.assertEqual(str(self.mouse.price), "1499.00")
        self.assertEqual(str(Product.objects.get().price), "1499.00")
```
Все четыре теста — `ok`: товар из `test_a` не виден в `test_b`, цена, изменённая в `test_c`, в `test_d` снова 1499.00 — и в базе, и у объекта `self.mouse`.

### Шаг 2. Тест на число запросов
Файл `tests.py` (фрагмент):
```python
    def test_catalog_queries(self):
        with self.assertNumQueries(1):
            self.client.get("/catalog/")
```
С `select_related("category")` во view тест проходит. Уберём `select_related`:
```
FAIL: test_catalog_queries (shop.tests.PagesTests.test_catalog_queries)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "tests.py", line 37, in test_catalog_queries
    with self.assertNumQueries(1):
AssertionError: 2 != 1 : 2 queries executed, 1 expected
Captured queries were:
1. SELECT "shop_product"."id", "shop_product"."category_id", "shop_product"."name", "shop_product"."slug", "shop_product"."price", "shop_product"."is_active" FROM "shop_product" WHERE "shop_product"."is_active" ORDER BY "shop_product"."name" ASC
2. SELECT "shop_category"."id", "shop_category"."name" FROM "shop_category" WHERE "shop_category"."id" = 1 LIMIT 21
```
Сообщение сразу показывает лишний запрос — категорию товара. Активный товар здесь один; с тремя товарами запросов было бы четыре.

## Частые ошибки
- **Тест на N+1 с одним объектом.** «1 + N» при N = 1 неотличимо от двух нормальных запросов. Создайте 3–5 объектов.
- **`assertNumQueries` для страницы входа или с сессией.** Чтение сессии и пользователя — тоже запросы; считайте их в ожидаемом числе или проверяйте страницы одного вида.
- **Фабрика с фиксированным `slug`/`email`.** Второй объект нарушит `unique`. Генерируйте из названия или счётчика.
- **Фикстуры JSON на всё.** Ломаются при каждом изменении модели и прячут, какие данные важны тесту.
- **Тест зависит от данных `setUpTestData`, которые меняет другой тест.** Изменения откатываются, но на это нельзя полагаться в `TransactionTestCase` — там данные очищаются, а не откатываются.

## Итог
**Данные**
- Фабрики (`make_product(**kwargs)`, factory_boy, model_bakery) — в тесте только важные поля.
- Каждый тест видит только `setUpTestData` и свои данные.

**Запросы**
- `with self.assertNumQueries(n):` закрепляет число запросов; при падении — список запросов.
- Для N+1 — несколько объектов в базе.

## Вопросы на собеседовании
<details><summary>Как протестировать, что в коде нет N+1?</summary>

`assertNumQueries(n)` вокруг запроса страницы или вызова функции при нескольких объектах в базе: число запросов должно быть постоянным. В pytest-django — фикстура `django_assert_num_queries`. Тест падает при добавлении лишнего обращения к связи и выводит выполненные запросы.
</details>

<details><summary>Зачем фабрики тестовых данных?</summary>

Чтобы не повторять создание связанных объектов в каждом тесте и указывать только поля, важные для проверки. При изменении модели правится одна фабрика. factory_boy и model_bakery добавляют последовательности уникальных значений, связанные объекты и генерацию данных.
</details>

<details><summary>Чем `TestCase` отличается от `TransactionTestCase`?</summary>

`TestCase` оборачивает тесты в транзакции и откатывает их — быстро. `TransactionTestCase` очищает таблицы после каждого теста — медленнее, но позволяет тестировать сам код с транзакциями: `on_commit`, `select_for_update`, поведение при коммите. Для `on_commit` в `TestCase` есть `captureOnCommitCallbacks`.
</details>

## Глубже
Запуск тестов после каждого пуша (GitHub Actions) — курс «Проект под ключ». Тесты API — курс «Веб и API».
