---
title: Асинхронный клиент
type: lesson
level: 3
reading_time: 13
---

## Теория
На странице оформления заказа магазин показывает цены трёх служб доставки. Каждая отвечает 0,1–0,3 секунды. Запросы по очереди — сумма времён; при этом почти всё время программа **ждёт сеть**, а не считает. Пока ждём одну службу, можно было бы уже спросить остальные.

Это работа для `async` (курс Python, раздел про асинхронность): корутина на `await` отдаёт управление циклу событий, и тот запускает другие корутины. Для HTTP — **`httpx.AsyncClient`**: те же методы, что у `Client`, только с `await`:
```
async with httpx.AsyncClient(base_url=...) as client:
    r = await client.get("/v1/quote/")
```

Запросы параллельно — **`asyncio.gather(*корутины)`**: запускает их вместе и ждёт все; результаты — в порядке корутин, а не завершения. Общее время ≈ время **самого медленного** запроса, а не сумма.

Ошибки в `gather`:
- по умолчанию первое исключение вылетает из `gather` — результаты остальных теряются;
- с `return_exceptions=True` исключение становится элементом списка результатов — можно показать две цены из трёх.

Тайм-аут на всю корутину — `asyncio.wait_for(корутина, timeout=…)` (в Python 3.11+ ещё `async with asyncio.timeout(…)`): медленная служба не задержит страницу — её цену просто не покажем.

Ограничения:
- выигрыш только на **ожидании** (сеть, база, диск); вычисления `async` не ускоряет;
- внутри `async`-функции нельзя вызывать блокирующий код (`httpx.Client`, `time.sleep`) — он остановит весь цикл событий;
- в обычном синхронном view Django асинхронный клиент запускают через `asyncio.run(...)` или делают сам view асинхронным (`async def`); Django умеет оба варианта;
- сто тысяч одновременных запросов к одному сервису — та же DoS-атака; ограничивают `asyncio.Semaphore` или `httpx.Limits`.

## Наглядно
**Рисунок 1.** Три службы доставки: по очереди и через `gather`.

![Рисунок 1. По очереди: fast 0,1 с, затем post 0,3 с, затем courier 0,2 с — всего 0,6 с. Через gather: все три запроса стартуют одновременно, страница ждёт самый медленный — 0,3 с. С wait_for(timeout=0.5) зависшая служба отбрасывается через 0,5 с, остальные цены показываются](img/gather.svg)

**Таблица 1.** Синхронный и асинхронный клиент.

| | `httpx.Client` | `httpx.AsyncClient` |
|---|---|---|
| запрос | `client.get(...)` | `await client.get(...)` |
| открыть и закрыть | `with httpx.Client() as c:` | `async with httpx.AsyncClient() as c:` |
| несколько запросов | по очереди | `asyncio.gather(...)` — одновременно |
| тайм-аут на операцию | `timeout=` | `timeout=` + `asyncio.wait_for` |
| где вызывать | обычный код | `async def`, запуск — `asyncio.run` |

## На практике
Задача: цены доставки заказа у трёх служб — быстро, даже если одна из служб сломалась или зависла. Службы — асинхронный обработчик через `MockTransport`: каждая «думает» свою долю секунды (`asyncio.sleep`), время в выводе округлено до десятых.

### Шаг 1. Службы и запрос одной цены
Обработчик и корутина запроса:
```python
import asyncio
import time

import httpx

SERVICES = {
    "fast.example": (0.1, "390.00"),
    "post.example": (0.3, "250.00"),
    "courier.example": (0.2, "520.00"),
}


async def delivery_api(request):
    delay, price = SERVICES[request.url.host]
    await asyncio.sleep(delay)
    if price is None:
        return httpx.Response(503)
    return httpx.Response(200, json={"price": price})


transport = httpx.MockTransport(delivery_api)


async def quote(client, host):
    r = await client.get(f"https://{host}/v1/quote/")
    r.raise_for_status()
    return host, r.json()["price"]
```
`price = None` — служба сломана и отвечает 503 (пригодится в шаге 3).

### Шаг 2. По очереди и вместе
Продолжение того же кода:
```python
async def one_by_one():
    async with httpx.AsyncClient(transport=transport) as client:
        return [await quote(client, host) for host in SERVICES]


async def together():
    async with httpx.AsyncClient(transport=transport) as client:
        tasks = [quote(client, host) for host in SERVICES]
        return await asyncio.gather(*tasks)


for main in (one_by_one, together):
    start = time.perf_counter()
    prices = asyncio.run(main())
    print(main.__name__, round(time.perf_counter() - start, 1), "с")
    print(prices)
```
Результат:
```
one_by_one 0.6 с
[('fast.example', '390.00'), ('post.example', '250.00'), ('courier.example', '520.00')]
together 0.3 с
[('fast.example', '390.00'), ('post.example', '250.00'), ('courier.example', '520.00')]
```
По очереди — 0,1 + 0,3 + 0,2 = 0,6 с; вместе — 0,3 с, время самой медленной службы. Порядок результатов `gather` — как у корутин, хотя `fast.example` ответил первым, а `post.example` — последним. `await` внутри списка (`one_by_one`) не делает запросы параллельными: каждый ждёт предыдущий.

### Шаг 3. Одна служба сломалась
`post.example` отвечает 503:
```python
SERVICES["post.example"] = (0.1, None)


async def all_quotes():
    async with httpx.AsyncClient(transport=transport) as client:
        tasks = [quote(client, host) for host in SERVICES]
        return await asyncio.gather(*tasks, return_exceptions=True)


for result in asyncio.run(all_quotes()):
    if isinstance(result, Exception):
        print("ошибка:", type(result).__name__, result.request.url.host)
    else:
        print(*result)
```
Результат:
```
fast.example 390.00
ошибка: HTTPStatusError post.example
courier.example 520.00
```
Без `return_exceptions=True` `gather` выбросил бы `HTTPStatusError`, и покупатель не увидел бы ни одной цены.

### Шаг 4. Одна служба зависла
`post.example` думает 5 секунд, а страница ждёт не дольше 0,5:
```python
SERVICES["post.example"] = (5, "250.00")


async def quote_or_none(client, host):
    try:
        return await asyncio.wait_for(quote(client, host), timeout=0.5)
    except (asyncio.TimeoutError, httpx.HTTPError):
        return host, None


async def best_quotes():
    async with httpx.AsyncClient(transport=transport) as client:
        tasks = [quote_or_none(client, host) for host in SERVICES]
        return await asyncio.gather(*tasks)


start = time.perf_counter()
print(asyncio.run(best_quotes()))
print(round(time.perf_counter() - start, 1), "с")
```
Результат:
```
[('fast.example', '390.00'), ('post.example', None), ('courier.example', '520.00')]
0.5 с
```
`wait_for` отменил зависший запрос через 0,5 с; страница покажет две цены, а у третьей — «недоступно».

## Частые ошибки
- **`await` в цикле вместо `gather`.** `for host in SERVICES: await quote(...)` — те же запросы по очереди.
- **Синхронный клиент внутри `async def`.** `httpx.get` или `time.sleep` блокируют цикл событий — все корутины стоят.
- **Забыть `await`.** `client.get(...)` без `await` — объект корутины вместо ответа; Python предупредит «coroutine was never awaited».
- **`gather` без обработки ошибок.** Одна упавшая служба — исключение и потерянные остальные результаты. `return_exceptions=True` или `try` внутри корутины.
- **Нет тайм-аута на операцию.** Самая медленная служба задаёт время всей страницы. `wait_for` или `asyncio.timeout`.
- **Новый `AsyncClient` на каждый запрос.** Нет переиспользования соединений; один клиент на все запросы операции.
- **Тысячи запросов разом.** Сервис ответит 429 или упадёт; `asyncio.Semaphore(10)` ограничивает одновременные запросы.

## Итог
**AsyncClient**
- `async with httpx.AsyncClient() as client`, `await client.get(...)`.

**Параллельно**
- `asyncio.gather(*корутины)` — время ≈ самый медленный запрос; результаты в порядке корутин.
- `return_exceptions=True` — ошибки списком, а не исключением; `asyncio.wait_for` — тайм-аут на корутину.

**Ограничения**
- Ускоряет только ожидание; внутри `async` — только неблокирующие вызовы; число одновременных запросов ограничивают.

## Вопросы на собеседовании
<details><summary>Почему `gather` ускоряет HTTP-запросы, если Python выполняет один поток?</summary>

Время запроса — почти целиком ожидание сети. На `await` корутина отдаёт управление циклу событий, и он отправляет следующие запросы, пока первые ждут ответа. Ответы обрабатываются по мере прихода. Это конкурентность, а не параллельные вычисления: для работы процессора нужны процессы.
</details>

<details><summary>Что происходит в `gather`, если одна корутина выбросила исключение?</summary>

По умолчанию исключение сразу передаётся в вызвавший `gather` код, но остальные корутины не отменяются — продолжают выполняться, их результаты теряются. С `return_exceptions=True` исключения возвращаются в списке результатов наравне со значениями. В Python 3.11+ есть `asyncio.TaskGroup`: при ошибке он отменяет остальные задачи и собирает исключения в `ExceptionGroup`.
</details>

<details><summary>Как ограничить число одновременных запросов?</summary>

`asyncio.Semaphore(n)`: каждая корутина делает запрос внутри `async with semaphore:`, одновременно выполняется не больше `n`. В `httpx` — ещё `httpx.Limits(max_connections=n)` у клиента: лишние запросы ждут свободного соединения в пуле.
</details>

## Глубже
Асинхронные view Django и асинхронные эндпоинты — курс FastAPI (этап 2). Сам курс «Веб и API» на этом закончен: дальше — Linux, где тот же `curl` проверяет сайт на сервере.
