---
title: Ограничения
type: lesson
level: 2
reading_time: 10
---

## Теория
**Ограничения** (constraints) — правила, которые база проверяет при каждом `INSERT` и `UPDATE`. Строку, которая нарушает правило, база не запишет — откуда бы она ни пришла: с сайта, из админки, из скрипта импорта. Проверки в коде приложения полезны для понятных сообщений пользователю, но гарантию даёт только база.

- **`NOT NULL`** — значение обязательно.
- **`DEFAULT`** — значение, если столбец не указан в `INSERT`. Строго говоря, не ограничение, но пишется рядом.
- **`UNIQUE`** — значения не повторяются: email покупателя, код промокода. Важная деталь: **NULL не считаются равными**, поэтому в столбце `UNIQUE` без `NOT NULL` может быть сколько угодно строк с NULL. Если нужно «не больше одного NULL», в PostgreSQL 15+ пишут `UNIQUE NULLS NOT DISTINCT`.
- **`PRIMARY KEY`** — `UNIQUE` + `NOT NULL`; в таблице он один. По нему строку находят и на него ссылаются внешние ключи.
- **`CHECK (условие)`** — произвольное условие над строкой: `CHECK (price >= 0)`, `CHECK (status IN ('new', 'paid'))`. Строка не проходит, только если условие **FALSE**; при NULL она проходит. Поэтому `CHECK (amount > 0)` без `NOT NULL` пропустит пустую сумму.

Ограничение пишут **у столбца**, если оно про один столбец (`code text NOT NULL UNIQUE`), или **отдельной строкой** в конце `CREATE TABLE`, если про несколько: `UNIQUE (user_id, product_id)`, `PRIMARY KEY (order_id, product_id)`, `CHECK (balance <= amount)`. Составной ключ уникален **парой**: один покупатель может отложить много товаров, но один и тот же товар — один раз. Два отдельных `UNIQUE` на `user_id` и `product_id` означали бы совсем другое — каждый покупатель и каждый товар по одному разу на всю таблицу.

Имя ограничения PostgreSQL придумывает сам: `таблица_столбец_key` для `UNIQUE`, `таблица_столбец_check` для `CHECK`, `таблица_pkey` для ключа. Оно видно в тексте ошибки и нужно, чтобы удалить ограничение. Своё имя задают словом `CONSTRAINT`: `CONSTRAINT gift_cards_balance_le_amount CHECK (balance <= amount)`.

## Наглядно
**Таблица 1.** Ограничения и что они не пускают.

| Ограничение | Пример | Отклоняет | Пропускает |
|---|---|---|---|
| `NOT NULL` | `code text NOT NULL` | NULL | любое значение |
| `UNIQUE` | `email text UNIQUE` | повтор значения | несколько NULL |
| `PRIMARY KEY` | `PRIMARY KEY (id)` | повтор и NULL | — |
| `CHECK` | `CHECK (amount > 0)` | `0`, `-5` | `100`, **NULL** |
| составной `PRIMARY KEY` | `PRIMARY KEY (user_id, product_id)` | повтор пары | ту же `user_id` с другим товаром |

## На практике
Задача: таблица подарочных сертификатов. У сертификата уникальный код, номинал больше нуля, остаток не меньше нуля и не больше номинала; email получателя — необязательный, но если указан, то уникальный.

### Шаг 1. Создать таблицу
Каждое правило из задачи — ограничение в определении таблицы:
```sql
CREATE TABLE gift_cards (
    id      integer       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code    text          NOT NULL UNIQUE,
    amount  numeric(10,2) NOT NULL CHECK (amount > 0),
    balance numeric(10,2) NOT NULL CHECK (balance >= 0),
    email   text          UNIQUE,
    CHECK (balance <= amount)
);
```
Результат:
```
CREATE TABLE
```
`CHECK (balance <= amount)` сравнивает два столбца — он записан отдельной строкой.

### Шаг 2. Две карты без email
Сертификаты без получателя — email не указываем:
```sql
INSERT INTO gift_cards (code, amount, balance)
VALUES ('GIFT-1000', 1000, 1000), ('GIFT-3000', 3000, 3000)
RETURNING id, code, email;
```
Результат:
```
 id |   code    | email
----+-----------+-------
  1 | GIFT-1000 |
  2 | GIFT-3000 |
(2 rows)

INSERT 0 2
```
У обеих карт email — NULL, и `UNIQUE` это пропустил: NULL не равен NULL.

### Шаг 3. Что не пройдёт
Повтор кода, остаток больше номинала и нулевой номинал — по одному запросу:
```sql
INSERT INTO gift_cards (code, amount, balance) VALUES ('GIFT-1000', 500, 500);
INSERT INTO gift_cards (code, amount, balance) VALUES ('GIFT-500', 500, 700);
INSERT INTO gift_cards (code, amount, balance) VALUES ('GIFT-0', 0, 0);
```
Результат:
```
ERROR:  duplicate key value violates unique constraint "gift_cards_code_key"
DETAIL:  Key (code)=(GIFT-1000) already exists.
ERROR:  new row for relation "gift_cards" violates check constraint "gift_cards_check"
DETAIL:  Failing row contains (4, GIFT-500, 500.00, 700.00, null).
ERROR:  new row for relation "gift_cards" violates check constraint "gift_cards_amount_check"
DETAIL:  Failing row contains (5, GIFT-0, 0.00, 0.00, null).
```
По имени ограничения в ошибке видно, какое правило нарушено. Табличный `CHECK` без своего имени назван просто `gift_cards_check` — по нему не поймёшь, что он проверяет; для таких лучше задать имя через `CONSTRAINT`. Номера 3, 4 и 5 счётчик потратил на отклонённые строки.

## Частые ошибки
- **`CHECK` без `NOT NULL`.** `CHECK (amount > 0)` пропускает NULL: условие «неизвестно», а не FALSE.
- **`UNIQUE` без `NOT NULL`.** Строк с NULL может быть сколько угодно.
- **Два `UNIQUE` вместо составного.** `user_id UNIQUE, product_id UNIQUE` — не «пара уникальна», а «каждый по одному разу».
- **Проверки только в коде приложения.** Скрипт импорта или ручной `UPDATE` их обойдёт. Правило данных — в базе.
- **Безымянные табличные `CHECK`.** `таблица_check` в ошибке ничего не говорит; имя — через `CONSTRAINT`.

## Итог
**Ограничения**
- `NOT NULL`, `UNIQUE`, `PRIMARY KEY` (= `UNIQUE` + `NOT NULL`), `CHECK`; `DEFAULT` — рядом.
- У столбца — про один столбец; отдельной строкой — про несколько.
- Составной ключ уникален парой, а не каждым столбцом.

**NULL**
- `UNIQUE` пропускает несколько NULL.
- `CHECK` отклоняет только FALSE — NULL проходит; нужен ещё `NOT NULL`.

**Имена**
- Автоматические: `_pkey`, `_key`, `_check`, `_fkey`; своё — `CONSTRAINT имя`.

## Вопросы на собеседовании
<details><summary>Чем `PRIMARY KEY` отличается от `UNIQUE`?</summary>

`PRIMARY KEY` — это `UNIQUE` + `NOT NULL`, и в таблице он один: по нему строку однозначно находят и на него по умолчанию ссылаются внешние ключи. `UNIQUE` может быть несколько, и без `NOT NULL` он пропускает NULL — даже несколько строк. Оба создают уникальный индекс.
</details>

<details><summary>Почему `CHECK (amount > 0)` пропускает NULL?</summary>

`CHECK` отклоняет строку, только если условие FALSE. Сравнение `NULL > 0` даёт NULL — «неизвестно», и строка проходит. Так задумано, чтобы необязательные столбцы с проверками можно было оставлять пустыми. Если значение обязательно, к `CHECK` добавляют `NOT NULL`.
</details>

<details><summary>Зачем проверять данные в базе, если форма на сайте уже проверила?</summary>

В базу пишут не только формы: админка, импорт, фоновые задачи, ручные запросы, другие сервисы. Ограничение в базе действует для всех и не зависит от ошибок в коде. Проверки в приложении нужны для понятных сообщений пользователю, ограничения в базе — для гарантии.
</details>
