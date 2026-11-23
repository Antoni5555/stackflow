---
title: "Задачи и параллельный запуск"
type: lesson
level: 3
reading_time: 15
---

## Теория
`await` одной корутины за другой — по очереди. Чтобы склад, банк и доставка ждали **одновременно**, корутины нужно поставить в цикл событий как **задачи**. Здесь — как это сделать, как собрать результаты, что делать, если одна задача упала или зависла, и как отменить лишнее.

**Задача** (`asyncio.Task`) — корутина, поставленная в цикл событий. `asyncio.create_task(coro)` запускает её **сразу**, не дожидаясь: код идёт дальше, а задача работает, пока остальные ждут. Результат забирают позже — `await task`. Ссылку на задачу нужно хранить: задачу без ссылок сборщик мусора может удалить на середине (тема 07).

Как запустить несколько и дождаться всех:
- **`asyncio.gather(*корутины)`** — делает из них задачи и ждёт все; результаты — **в порядке аргументов**. Если одна упала, исключение вылетает из `gather`, а остальные продолжают работать впустую. С `return_exceptions=True` ошибки возвращаются в списке вместе с результатами;
- **`asyncio.TaskGroup`** (Python 3.11+) — `async with asyncio.TaskGroup() as tg: tg.create_task(…)`. Выход из блока ждёт все задачи. Если одна упала, группа **отменяет остальные** и выбрасывает `ExceptionGroup` — ловят его через `except*`. Это предпочтительный способ для «всё или ничего».

**Тайм-аут** — граница ожидания:
- `async with asyncio.timeout(0.5):` — всё внутри блока должно уложиться в 0,5 с, иначе `TimeoutError`;
- `await asyncio.wait_for(coro, timeout=0.5)` — то же для одной корутины.
Корутина, которую остановил тайм-аут, **отменяется**, а не продолжает работать.

**Отмена** — `task.cancel()`. В корутину на ближайшем `await` прилетает `asyncio.CancelledError`. Её не глушат: в `finally` закрывают ресурсы (соединение, файл) и дают ошибке уйти дальше, иначе задача «не отменится».

## Наглядно
**Рисунок 1.** `gather` и `TaskGroup` при ошибке одной задачи; тайм-аут отменяет зависшую.

![Рисунок 1. Три задачи: склад, банк, доставка. gather: банк упал — исключение вылетает из gather, склад и доставка продолжают работать впустую. TaskGroup: банк упал — группа отменяет склад и доставку и выбрасывает ExceptionGroup. Внизу: asyncio.timeout(0,15) — доставка не ответила за 0,15 с, её задача отменена, вылетает TimeoutError](img/tasks.svg)

**Таблица 1.** Инструменты.

| Задача | Инструмент |
|---|---|
| запустить в фоне сейчас, результат взять позже | `task = asyncio.create_task(coro)`, потом `await task` |
| дождаться всех, результаты по порядку | `await asyncio.gather(a(), b(), c())` |
| ошибки не прерывают остальных | `gather(…, return_exceptions=True)` |
| всё или ничего: при ошибке отменить остальных | `async with asyncio.TaskGroup() as tg:` + `except*` |
| ограничить время блока | `async with asyncio.timeout(0.5):` |
| ограничить время одной корутины | `await asyncio.wait_for(coro, timeout=0.5)` |
| отменить задачу | `task.cancel()`; в корутине — `finally` для уборки |

**Таблица 2.** `gather` и `TaskGroup`.

| | `gather` | `TaskGroup` |
|---|---|---|
| Результаты | список по порядку | `task.result()` у каждой задачи |
| Одна упала | исключение наружу, остальные работают дальше | остальные отменяются, `ExceptionGroup` |
| Несколько упали | наружу только первая ошибка | все ошибки в `ExceptionGroup` |
| Когда | нужны все результаты или частичные (`return_exceptions`) | операция «всё или ничего» |

## На практике
Задача: проверить склад, банк и доставку одновременно, пережить отказ одного сервиса, не ждать зависший и отменить лишнее. Сервисы — корутины с `asyncio.sleep`.

### Шаг 1. create_task — запустить сразу
Задачи стартуют в момент создания. Пока они ждут, `main` делает свою работу:
```python
import asyncio
import time


async def ask(name, seconds):
    await asyncio.sleep(seconds)
    return name


async def main():
    stock = asyncio.create_task(ask("склад", 0.1))
    delivery = asyncio.create_task(ask("доставка", 0.2))
    print("задачи запущены, считаем скидку")
    return [await stock, await delivery]


start = time.perf_counter()
print(asyncio.run(main()), round(time.perf_counter() - start, 1))
```
Результат:
```
задачи запущены, считаем скидку
['склад', 'доставка'] 0.2
```
`await stock` и `await delivery` идут по очереди, но задачи уже работали параллельно — общее время 0,2, а не 0,3.

### Шаг 2. gather — результаты по порядку
Порядок результатов — как в аргументах, а не как закончили:
```python
async def main():
    return await asyncio.gather(ask("доставка", 0.2), ask("склад", 0.1), ask("банк", 0.15))


print(asyncio.run(main()))
```
Результат:
```
['доставка', 'склад', 'банк']
```
Склад ответил первым, но в списке он второй — как в вызове `gather`.

### Шаг 3. Один сервис упал
Банк отвечает ошибкой. С `return_exceptions=True` она приходит в списке вместо результата:
```python
class PaymentError(Exception):
    pass


async def bank():
    await asyncio.sleep(0.05)
    raise PaymentError("банк недоступен")


async def main():
    results = await asyncio.gather(
        ask("склад", 0.1), bank(), ask("доставка", 0.1), return_exceptions=True
    )
    for r in results:
        print("ошибка:" if isinstance(r, Exception) else "ok:", r)


asyncio.run(main())
```
Результат:
```
ok: склад
ошибка: банк недоступен
ok: доставка
```
Без `return_exceptions` из `gather` вылетел бы `PaymentError`, а ответы склада и доставки потерялись бы.

### Шаг 4. TaskGroup — всё или ничего
Заказ без оплаты не нужен: если банк упал, склад и доставку ждать незачем. Доставка печатает, если её отменили:
```python
async def delivery():
    try:
        await asyncio.sleep(0.3)
        return "доставка"
    except asyncio.CancelledError:
        print("доставка: отменена")
        raise


async def main():
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(ask("склад", 0.1))
            tg.create_task(bank())
            tg.create_task(delivery())
    except* PaymentError as group:
        print("заказ не оформлен:", group.exceptions[0])


start = time.perf_counter()
asyncio.run(main())
print(round(time.perf_counter() - start, 2) < 0.1)
```
Результат:
```
доставка: отменена
заказ не оформлен: банк недоступен
True
```
Банк упал через 0,05 с — группа сразу отменила остальных и не стала ждать доставку 0,3 с. `except*` ловит ошибки нужного типа из `ExceptionGroup`; `raise` после печати в `delivery` даёт отмене завершиться.

### Шаг 5. Тайм-аут
Служба доставки зависла. Ждём не больше 0,15 с, иначе показываем «недоступно»:
```python
async def quote_or_none(seconds):
    try:
        async with asyncio.timeout(0.15):
            return await ask("доставка", seconds)
    except TimeoutError:
        return None


async def main():
    return await asyncio.gather(quote_or_none(0.1), quote_or_none(5))


start = time.perf_counter()
print(asyncio.run(main()), round(time.perf_counter() - start, 2) < 0.2)
```
Результат:
```
['доставка', None] True
```
Зависшую корутину тайм-аут отменил, и страница не ждала 5 секунд. То же для одной корутины — `asyncio.wait_for(ask(...), timeout=0.15)`.

### Шаг 6. Отмена и уборка
Задачу отменяют, если результат больше не нужен (покупатель ушёл со страницы). `finally` закрывает ресурсы:
```python
async def track(order_id):
    print("подключились к службе доставки")
    try:
        while True:
            await asyncio.sleep(0.05)
    finally:
        print("соединение закрыто")


async def main():
    task = asyncio.create_task(track(1042))
    await asyncio.sleep(0.12)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        print("отслеживание остановлено:", task.cancelled())


asyncio.run(main())
```
Результат:
```
подключились к службе доставки
соединение закрыто
отслеживание остановлено: True
```
`cancel()` только просит остановиться: `CancelledError` прилетает в задачу на ближайшем `await`, `finally` выполняется, и ошибка доходит до того, кто ждёт задачу.

## Частые ошибки
- **`await` в цикле вместо `gather`.** `for s in services: await ask(s)` — снова по очереди.
- **`create_task` без ссылки.** `asyncio.create_task(send_mail())` без сохранения задачи — её может удалить сборщик мусора, а ошибка в ней потеряется. Храните задачу и дожидайтесь её (или используйте `TaskGroup`).
- **`gather` без обработки ошибок.** Одна упавшая корутина — и потеряны результаты остальных. `return_exceptions=True` или `TaskGroup`.
- **Нет тайм-аута.** Самый медленный сервис задаёт время всей операции, зависший — вешает её. `asyncio.timeout` на внешние вызовы.
- **Глушить `CancelledError`.** `except Exception` его не ловит (он наследует `BaseException`), но `except BaseException` или `except asyncio.CancelledError: pass` без `raise` ломают отмену и тайм-ауты. Убирайте в `finally`, ошибку пропускайте дальше.
- **`except` вместо `except*` у `TaskGroup`.** Группа выбрасывает `ExceptionGroup`: `except PaymentError` её не поймает.

## Итог
**Задачи**
- `create_task` запускает корутину сразу; результат — `await task`; ссылку храните.

**Несколько сразу**
- `gather` — результаты по порядку; `return_exceptions=True` — ошибки в списке.
- `TaskGroup` — при ошибке отменяет остальных; ловят `except*`.

**Время и отмена**
- `asyncio.timeout` / `wait_for` — `TimeoutError` и отмена зависшей корутины.
- `task.cancel()` — `CancelledError` на ближайшем `await`; уборка в `finally`, ошибку не глушить.

## Вопросы на собеседовании
<details><summary>Чем корутина отличается от задачи?</summary>

Корутина — объект, который ещё не выполняется; сама по себе она запустится только при `await`, и тогда вызывающий ждёт её до конца. Задача (`Task`) — корутина, поставленная в цикл событий: она начинает работать сразу и выполняется конкурентно с остальными, а результат забирают через `await task`.
</details>

<details><summary>Чем `asyncio.gather` отличается от `TaskGroup`?</summary>

`gather` ждёт все корутины и возвращает результаты списком по порядку; при ошибке выбрасывает первое исключение, но остальные корутины продолжают работать (или с `return_exceptions=True` возвращает ошибки в списке). `TaskGroup` (3.11+) при ошибке одной задачи отменяет остальные и выбрасывает `ExceptionGroup` со всеми ошибками — подходит для операций «всё или ничего».
</details>

<details><summary>Как ограничить время выполнения корутины?</summary>

`await asyncio.wait_for(coro, timeout=…)` или блок `async with asyncio.timeout(…)` (3.11+). При превышении корутина отменяется и выбрасывается `TimeoutError`. Тайм-аут ставят на все обращения к внешним сервисам, чтобы зависший сервис не вешал всю операцию.
</details>

<details><summary>Как работает отмена задачи?</summary>

`task.cancel()` помечает задачу, и на ближайшем `await` внутри неё возникает `asyncio.CancelledError`. Корутина может убрать за собой в `finally` (закрыть соединение) и должна пропустить ошибку дальше. Тот, кто ждёт задачу, получит `CancelledError`, а `task.cancelled()` вернёт `True`.
</details>

## Глубже
`asyncio.as_completed` — обрабатывать результаты по мере готовности, а не по порядку. Как не отправить 1000 запросов разом и раздать работу нескольким обработчикам — следующая тема, «Ограничение нагрузки». С настоящими HTTP-запросами (`httpx.AsyncClient`) те же приёмы — в курсе «Веб и API».
