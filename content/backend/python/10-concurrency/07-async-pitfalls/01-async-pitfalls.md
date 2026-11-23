---
title: "Частые ошибки async"
type: lesson
level: 3
reading_time: 13
---

## Теория
Асинхронный код ломается не так, как обычный. Чаще всего он не падает, а **тихо работает медленно** или **тихо не делает** часть работы: письмо не ушло, задача пропала, все корутины стоят из-за одной. Здесь — главные ошибки, как их заметить и как исправить.

**1. Блокирующий вызов в корутине.** Всё, что ждёт или считает без `await`, останавливает цикл событий целиком: `time.sleep`, `requests.get`, синхронный драйвер базы, чтение большого файла, долгий цикл вычислений. Признак — `gather` не ускоряет, а время равно сумме. Исправление:
- есть асинхронная версия — берите её: `asyncio.sleep`, `httpx.AsyncClient`, `asyncpg`;
- асинхронной нет (старая библиотека) — `await asyncio.to_thread(функция, аргументы)`: функция выполнится в отдельном потоке, а цикл событий продолжит работу;
- долгие вычисления — в процессы (`loop.run_in_executor` с `ProcessPoolExecutor`) или кусками с `await asyncio.sleep(0)` между ними, чтобы дать поработать другим.

**2. Забытый `await`.** `send_receipt(1042)` без `await` создаёт объект корутины и выбрасывает его: чек не отправлен, ошибок нет, только предупреждение `RuntimeWarning: coroutine 'send_receipt' was never awaited` в логах.

**3. Задача «запустил и забыл».** `asyncio.create_task(send_mail())` без ссылки и без ожидания:
- когда `asyncio.run` заканчивается, незавершённые задачи **отменяются** — письмо не уйдёт;
- задачу без ссылок может удалить сборщик мусора;
- исключение в ней никто не увидит — в лог попадёт только `Task exception was never retrieved`.
Задачи хранят (список или множество) и дожидаются — или запускают в `TaskGroup`.

**4. `asyncio.run` внутри корутины.** Цикл уже работает: `RuntimeError: asyncio.run() cannot be called from a running event loop`. Внутри корутин — только `await`. Ошибка часто встречается в Jupyter, где цикл событий уже запущен: там пишут `await main()` прямо в ячейке.

**5. Синхронный код вызывает асинхронный.** В обычной функции нельзя `await`. Варианты: сделать вызывающую функцию тоже `async` (асинхронность «расползается» вверх до точки входа) или вызвать `asyncio.run(...)` из синхронного кода верхнего уровня — один раз.

## Наглядно
**Рисунок 1.** Пять ошибок и как их заметить.

![Рисунок 1. Блокирующий вызов — gather не ускоряет, время равно сумме; исправление — async-версия или asyncio.to_thread. Забытый await — работа не сделана, предупреждение never awaited. Задача без ожидания — отменяется при выходе из asyncio.run, ошибка теряется. asyncio.run в корутине — RuntimeError. Долгое вычисление — другие корутины стоят; исправление — процессы или паузы asyncio.sleep(0)](img/async-pitfalls.svg)

**Таблица 1.** Симптом → причина → исправление.

| Симптом | Причина | Исправление |
|---|---|---|
| `gather` не ускоряет, время — сумма | блокирующий вызов в корутине | async-библиотека или `asyncio.to_thread` |
| работа не сделана, в логе `never awaited` | забыли `await` | `await` перед вызовом корутины |
| фоновое письмо не ушло | задачу не дождались, `asyncio.run` её отменил | хранить задачи и дождаться, `TaskGroup` |
| в логе `Task exception was never retrieved` | ошибку задачи никто не забрал | `await task` или `TaskGroup` |
| `asyncio.run() cannot be called from a running event loop` | `asyncio.run` внутри корутины | `await` |
| другие корутины «замирают» на время расчёта | вычисления без `await` | процессы или `await asyncio.sleep(0)` между кусками |

## На практике
Задача: найти, почему «асинхронная» рассылка чеков медленная и почему часть чеков не уходит, и исправить. Внешние сервисы имитируем через `sleep`.

### Шаг 1. Блокирующая библиотека
Старый клиент налоговой — синхронный, внутри `time.sleep`. Три чека через `gather`:
```python
import asyncio
import time


def legacy_send(receipt_id):
    time.sleep(0.1)
    return receipt_id


async def send_receipt(receipt_id):
    return legacy_send(receipt_id)


async def main():
    return await asyncio.gather(*(send_receipt(i) for i in (1, 2, 3)))


start = time.perf_counter()
print(asyncio.run(main()), round(time.perf_counter() - start, 1))
```
Результат:
```
[1, 2, 3] 0.3
```
`gather` есть, а время — сумма: синхронный вызов не отдаёт управление, и чеки идут по очереди.

### Шаг 2. asyncio.to_thread
Переписать библиотеку нельзя — запускаем её в отдельном потоке:
```python
async def send_receipt(receipt_id):
    return await asyncio.to_thread(legacy_send, receipt_id)


start = time.perf_counter()
print(asyncio.run(main()), round(time.perf_counter() - start, 1))
```
Результат:
```
[1, 2, 3] 0.1
```
Каждый `legacy_send` спит в своём потоке, цикл событий свободен. В браузерном тренажёре потоков нет — этот шаг выполнен на обычном Python; если у библиотеки есть асинхронная версия, лучше взять её.

### Шаг 3. Забытый await и задача без ожидания
Чеки пишем в список `sent`. Одна функция забыла `await`, другая запустила задачу и не дождалась:
```python
sent = []


async def send(receipt_id):
    await asyncio.sleep(0.05)
    sent.append(receipt_id)


async def checkout_forgot_await():
    coro = send(1)
    coro.close()
    return "заказ оформлен"


async def checkout_fire_and_forget():
    asyncio.create_task(send(2))
    return "заказ оформлен"


print(asyncio.run(checkout_forgot_await()), sent)
print(asyncio.run(checkout_fire_and_forget()), sent)
```
Результат:
```
заказ оформлен []
заказ оформлен []
```
Оба «оформили заказ», чеков нет. В первом случае корутина не запускалась (`coro.close()` здесь только заменяет то, что без него сделал бы сборщик мусора, — с предупреждением `never awaited`). Во втором задача стартовала, но `asyncio.run` закончился раньше и отменил её.

### Шаг 4. Хранить задачи и дождаться
Фоновые задачи складываем во множество и ждём перед выходом:
```python
async def main():
    background = set()
    for receipt_id in (3, 4):
        task = asyncio.create_task(send(receipt_id))
        background.add(task)
        task.add_done_callback(background.discard)
    print("ответ покупателю отправлен")
    await asyncio.gather(*background)


sent.clear()
asyncio.run(main())
print(sent)
```
Результат:
```
ответ покупателю отправлен
[3, 4]
```
Ответ ушёл сразу, чеки — в фоне, но программа их дождалась. `add_done_callback(background.discard)` убирает завершённые задачи из множества, чтобы оно не росло. Если ждать всё вместе удобно блоком, — `TaskGroup` (тема 04).

### Шаг 5. asyncio.run внутри корутины
Внутри работающего цикла второй цикл не запустить:
```python
async def report():
    return "отчёт"


async def main():
    coro = report()
    try:
        asyncio.run(coro)
    except RuntimeError as e:
        print(e)
        coro.close()
    return await report()


print(asyncio.run(main()))
```
Результат:
```
asyncio.run() cannot be called from a running event loop
отчёт
```
Внутри корутины корутину просто ждут: `await report()`.

### Шаг 6. Долгое вычисление
Пересчёт 300 цен «замораживает» пульс сервера — корутину, которая должна отмечаться каждые 0,01 с. Сравним расчёт целиком и кусками с `await asyncio.sleep(0)`:
```python
async def heartbeat(beats):
    while True:
        beats.append(1)
        await asyncio.sleep(0.01)


async def recalc(chunks):
    for i in range(300):
        time.sleep(0.001)
        if chunks and i % 10 == 0:
            await asyncio.sleep(0)


async def run(chunks):
    beats = []
    hb = asyncio.create_task(heartbeat(beats))
    await asyncio.sleep(0)
    await recalc(chunks)
    hb.cancel()
    return len(beats)


print("целиком:", asyncio.run(run(False)))
print("кусками:", asyncio.run(run(True)) > 5)
```
Результат:
```
целиком: 1
кусками: True
```
Целиком пульс отметился один раз — в самом начале — и молчал 0,3 с. С паузами `sleep(0)` каждые 10 цен цикл событий успевает запускать `heartbeat` — около десяти раз за расчёт. Для по-настоящему тяжёлых расчётов паузы не спасут — их выносят в процессы.

## Частые ошибки
Этот урок и есть список частых ошибок; коротко:
- **`time.sleep`, `requests`, синхронная база в `async def`.** Всё стоит. Async-библиотека или `asyncio.to_thread`.
- **Вызов корутины без `await`.** Работа не сделана, тихо. Следите за `never awaited` в логах; mypy и линтеры (`ruff`, правило `RUF006` и др.) ловят часть случаев.
- **`create_task` и забыть.** Задача отменяется при выходе, ошибка теряется. Ссылка + ожидание или `TaskGroup`.
- **`asyncio.run` в корутине.** `RuntimeError`. Только `await`.
- **Тяжёлый расчёт в корутине.** Остальные ждут. Процессы, `to_thread` для блокирующих C-библиотек, `sleep(0)` — для умеренных циклов.

## Итог
**Медленно**
- Блокирующий вызов → async-версия или `asyncio.to_thread`; вычисления → процессы или паузы `sleep(0)`.

**Не сделано**
- Забытый `await` → предупреждение `never awaited`.
- Задача без ожидания → отменена при выходе; хранить и ждать, `TaskGroup`.

**Не запускается**
- `asyncio.run` внутри корутины → `RuntimeError`; внутри — `await`.

## Вопросы на собеседовании
<details><summary>Почему асинхронный код может работать не быстрее синхронного?</summary>

Если внутри корутин есть блокирующие вызовы (`time.sleep`, `requests`, синхронный драйвер базы) или долгие вычисления, они не отдают управление циклу событий, и корутины выполняются по очереди. Выигрыш asyncio — только на ожидании, которое отдаёт управление через `await`.
</details>

<details><summary>Как вызвать блокирующую функцию из асинхронного кода?</summary>

`await asyncio.to_thread(func, *args)` (Python 3.9+) или `await loop.run_in_executor(None, func, *args)` — функция выполняется в пуле потоков, а цикл событий продолжает работу. Для тяжёлых вычислений — `run_in_executor` с `ProcessPoolExecutor`, чтобы обойти GIL.
</details>

<details><summary>Что будет с задачей, созданной через `create_task`, если её не ждать?</summary>

Она выполняется в фоне, пока работает цикл событий. Когда `asyncio.run` завершает главную корутину, оставшиеся задачи отменяются. Задачу без ссылок может удалить сборщик мусора, а её исключение увидят только в логе как `Task exception was never retrieved`. Поэтому задачи хранят и дожидаются или используют `TaskGroup`.
</details>

<details><summary>Почему в Jupyter `asyncio.run` выдаёт ошибку?</summary>

В Jupyter цикл событий уже запущен — в нём работает сам блокнот. `asyncio.run` пытается создать новый цикл внутри работающего и выбрасывает `RuntimeError: asyncio.run() cannot be called from a running event loop`. В ячейке можно писать `await main()` напрямую.
</details>

## Глубже
Режим отладки `asyncio.run(main(), debug=True)` (или переменная `PYTHONASYNCIODEBUG=1`) пишет в лог корутины, которые слишком долго держали цикл событий, и задачи с потерянными ошибками. С настоящими HTTP-запросами всё это применяется в курсе «Веб и API», с асинхронными view — в курсе FastAPI.
