---
title: "Асинхронные менеджеры и итераторы"
type: lesson
level: 3
reading_time: 13
---

## Теория
В разделе 7 `with` открывал и закрывал ресурс, а в разделе 6 генератор отдавал каталог страницами. В асинхронном коде у обоих есть «близнецы» для случаев, когда сам вход, выход или получение следующего элемента требует **ожидания**: открыть соединение с базой — это запрос по сети, закрыть его — тоже, а следующая страница заказов приходит из API.

**`async with`** — асинхронный менеджер контекста. Протокол — `__aenter__` и `__aexit__`: те же `__enter__` и `__exit__` (тема 7.13), только корутины, и Python ждёт их через `await`. Проще всего писать через **`@asynccontextmanager`** из `contextlib`: асинхронный генератор, где код до `yield` — вход, после — выход. Выход ставят в `finally`, иначе при ошибке внутри блока он не выполнится. Так устроены `httpx.AsyncClient`, соединения и транзакции асинхронных драйверов баз.

**`async for`** — перебор, где каждый следующий элемент получают через `await`. Протокол — `__aiter__` и `__anext__`; конец перебора — исключение `StopAsyncIteration`. Проще — **асинхронный генератор**: `async def` с `yield` внутри. Он может ждать (`await`) между элементами, например загружать следующую страницу, только когда текущая закончилась. Обычный `for` с ним не работает — нужен `async for`.

**Асинхронный comprehension** — `[o async for o in orders()]` — собирает элементы асинхронного генератора в список; писать его можно только внутри корутины.

Асинхронный генератор ленивый, как обычный: если `async for` прервали `break`, следующие страницы не загружаются.

## Наглядно
**Рисунок 1.** `async with` закрывает соединение даже при ошибке; асинхронный генератор загружает страницы по мере перебора.

![Рисунок 1. Слева: async with connect() — await __aenter__ открывает соединение, блок кода, при выходе или ошибке await __aexit__ закрывает. Справа: async for order in all_orders() — генератор загружает страницу 1, отдаёт заказы по одному, на конце страницы ждёт загрузки страницы 2; после break страница 3 не загружается](img/async-with-for.svg)

**Таблица 1.** Обычные и асинхронные версии.

| | Обычная | Асинхронная |
|---|---|---|
| менеджер контекста | `with`, `__enter__` / `__exit__` | `async with`, `__aenter__` / `__aexit__` |
| менеджер из генератора | `@contextmanager` | `@asynccontextmanager` |
| перебор | `for`, `__iter__` / `__next__` | `async for`, `__aiter__` / `__anext__` |
| конец перебора | `StopIteration` | `StopAsyncIteration` |
| генератор | `def` + `yield` | `async def` + `yield` |
| comprehension | `[x for x in it]` | `[x async for x in agen()]` — внутри корутины |

## На практике
Задача: открыть «соединение» с API заказов так, чтобы оно закрывалось при любой ошибке, и перебрать заказы постранично, не загружая лишнего. API имитируем словарём страниц и `asyncio.sleep`.

### Шаг 1. Менеджер-класс
Соединение печатает, когда открывается и закрывается:
```python
import asyncio
from contextlib import asynccontextmanager


class Connection:
    async def __aenter__(self):
        await asyncio.sleep(0.01)
        print("соединение открыто")
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await asyncio.sleep(0.01)
        print("соединение закрыто" + (" (ошибка)" if exc_type else ""))


async def main():
    async with Connection() as conn:
        print("работаем")
    try:
        async with Connection():
            raise ValueError("плохой ответ API")
    except ValueError as e:
        print("поймали:", e)


asyncio.run(main())
```
Результат:
```
соединение открыто
работаем
соединение закрыто
соединение открыто
соединение закрыто (ошибка)
поймали: плохой ответ API
```
`__aexit__` выполнился и при ошибке; `None` из него не подавляет исключение — оно ушло дальше.

### Шаг 2. То же через @asynccontextmanager
Код до `yield` — вход, в `finally` — выход:
```python
@asynccontextmanager
async def connect(name):
    await asyncio.sleep(0.01)
    print(name, "открыто")
    try:
        yield name
    finally:
        await asyncio.sleep(0.01)
        print(name, "закрыто")


async def main():
    try:
        async with connect("API заказов") as api:
            print("запрос к", api)
            raise TimeoutError
    except TimeoutError:
        print("тайм-аут")


asyncio.run(main())
```
Результат:
```
API заказов открыто
запрос к API заказов
API заказов закрыто
тайм-аут
```
Без `try/finally` ошибка из блока прервала бы генератор на `yield`, и «закрыто» не напечаталось бы — соединение утекло бы.

### Шаг 3. Асинхронный генератор страниц
API отдаёт заказы страницами по два. Генератор загружает следующую страницу, только когда кончилась текущая:
```python
PAGES = {1: [101, 102], 2: [103, 104], 3: [105]}


async def fetch_page(page):
    await asyncio.sleep(0.01)
    print("загружена страница", page)
    return PAGES.get(page, [])


async def all_orders():
    page = 1
    while True:
        orders = await fetch_page(page)
        if not orders:
            return
        for order in orders:
            yield order
        page += 1


async def main():
    async for order in all_orders():
        print("заказ", order)


asyncio.run(main())
```
Результат:
```
загружена страница 1
заказ 101
заказ 102
загружена страница 2
заказ 103
заказ 104
загружена страница 3
заказ 105
загружена страница 4
```
Пустая четвёртая страница — сигнал конца: генератор закончился, и `async for` вышел из цикла.

### Шаг 4. break — лишнее не загружается
Нужен первый заказ с номером больше 102:
```python
async def main():
    async for order in all_orders():
        if order > 102:
            print("нашли", order)
            break


asyncio.run(main())
```
Результат:
```
загружена страница 1
загружена страница 2
нашли 103
```
Страницы 3 и 4 не запрашивались: генератор ленивый.

### Шаг 5. Comprehension и обычный for
Собрать все заказы в список можно асинхронным comprehension. Обычный `for` с асинхронным генератором не работает:
```python
async def main():
    orders = [o async for o in all_orders() if o % 2]
    print(orders)
    for o in all_orders():
        print(o)


asyncio.run(main())
```
Результат:
```
загружена страница 1
загружена страница 2
загружена страница 3
загружена страница 4
[101, 103, 105]
Traceback (most recent call last):
  File "main.py", line 8, in <module>
    asyncio.run(main())
  File "main.py", line 4, in main
    for o in all_orders():
TypeError: 'async_generator' object is not iterable
```
`async for` вызывает `__anext__` через `await`; у асинхронного генератора нет обычного `__next__`, поэтому `for` падает.

## Частые ошибки
- **`with` вместо `async with`.** `with httpx.AsyncClient() as c:` — `TypeError`: у объекта нет `__enter__`. Асинхронные менеджеры — только `async with`, внутри корутины.
- **`@asynccontextmanager` без `try/finally`.** Ошибка в блоке — и выход не выполнился: соединение не закрыто, транзакция не откатилась.
- **`for` по асинхронному генератору.** `TypeError: 'async_generator' object is not iterable`. Нужен `async for`.
- **Загрузить всё, чтобы взять одно.** `[o async for o in all_orders()]` и поиск в списке читают все страницы. Ищите в `async for` с `break`.
- **`time.sleep` или синхронный запрос в `__aenter__` / генераторе.** Блокирует весь цикл событий, как в любой корутине.
- **`return значение` в асинхронном генераторе.** Нельзя: `SyntaxError: 'return' with value in async generator`. Конец — просто `return`.

## Итог
**async with**
- `__aenter__` / `__aexit__` — корутины; `@asynccontextmanager` + `try/finally` вокруг `yield`.
- Выход выполняется и при ошибке; ресурсы, вход и выход которых ждут сеть.

**async for**
- `__aiter__` / `__anext__`, конец — `StopAsyncIteration`; проще — `async def` с `yield`.
- Генератор ленивый: `break` — дальше не загружаем.
- `[x async for x in agen()]` — внутри корутины; обычный `for` не работает.

## Вопросы на собеседовании
<details><summary>Зачем нужен `async with`, если есть `with`?</summary>

Когда вход или выход сами требуют ожидания — открыть соединение, начать и закончить транзакцию, закрыть HTTP-клиент. Обычные `__enter__` / `__exit__` не могут использовать `await`; асинхронные `__aenter__` / `__aexit__` — корутины, и цикл событий во время их ожидания выполняет другие задачи.
</details>

<details><summary>Что такое асинхронный генератор?</summary>

Функция `async def`, в которой есть `yield`. Её перебирают через `async for`; между элементами она может ждать (`await`), например подгружать следующую страницу из API. Как и обычный генератор, она ленивая: следующий элемент вычисляется только когда его запросили.
</details>

<details><summary>Как сделать класс, который можно перебирать через `async for`?</summary>

Реализовать `__aiter__` (возвращает сам итератор, обычно `self`) и асинхронный `__anext__`, который возвращает следующий элемент или выбрасывает `StopAsyncIteration`, когда элементы кончились. Чаще проще написать асинхронный генератор.
</details>

## Глубже
С настоящим API постраничное чтение пишут так же, только `fetch_page` делает запрос через `httpx.AsyncClient` — курс «Веб и API». Типичные ошибки асинхронного кода целиком — следующая тема.
