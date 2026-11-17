---
title: ALTER TABLE
type: lesson
level: 2
reading_time: 10
---

## Теория
Таблицы меняются вместе с магазином: товарам нужен вес для расчёта доставки, импорту — правильный тип цены, заказам — новое ограничение. Пересоздать таблицу с данными нельзя, поэтому структуру меняют командой `ALTER TABLE`. В Django такие команды генерирует миграция — `makemigrations` пишет их за вас, а `sqlmigrate` показывает SQL.

**Столбцы:**
- `ADD COLUMN столбец тип [ограничения]` — добавить. Существующие строки получают `DEFAULT`, а если его нет — NULL.
- `DROP COLUMN столбец` — удалить вместе с данными.
- `RENAME COLUMN старое TO новое` — переименовать; `RENAME TO новое_имя` — переименовать таблицу.
- `ALTER COLUMN столбец TYPE тип [USING выражение]` — сменить тип. Если PostgreSQL не умеет приводить автоматически (текст → число), `USING` объясняет, как получить новое значение из старого.
- `ALTER COLUMN столбец SET NOT NULL` / `DROP NOT NULL`, `SET DEFAULT …` / `DROP DEFAULT`.

**Ограничения:**
- `ADD CONSTRAINT имя CHECK (…)`, `ADD CONSTRAINT имя UNIQUE (…)`, `ADD CONSTRAINT имя FOREIGN KEY (…) REFERENCES …`.
- `DROP CONSTRAINT имя` — нужно имя, поэтому своим ограничениям имя дают сразу.

**Главное — существующие строки.** Новое правило проверяется на всех строках, что уже лежат в таблице. Если хоть одна его нарушает, `ALTER` падает и ничего не меняет:
- `ADD COLUMN … NOT NULL` без `DEFAULT` на непустой таблице — ошибка: старым строкам нечего записать;
- `SET NOT NULL` — ошибка, пока в столбце есть NULL;
- `ADD CONSTRAINT … CHECK` — ошибка, если какая-то строка не проходит условие.

Поэтому обязательный столбец без разумного значения по умолчанию добавляют в три шага: столбец без `NOT NULL` → заполнить `UPDATE` → `SET NOT NULL`.

Переименование и удаление столбца ломают код, который к нему обращается. В рабочем проекте с несколькими серверами это делают постепенно: сначала код перестают использовать старый столбец, потом удаляют.

## Наглядно
**Таблица 1.** Команды `ALTER TABLE`.

| Команда | Что делает | Когда падает |
|---|---|---|
| `ADD COLUMN is_visible boolean NOT NULL DEFAULT true` | новый столбец, старые строки — `true` | — |
| `ADD COLUMN weight_g integer NOT NULL` | новый обязательный столбец | в таблице есть строки |
| `ALTER COLUMN weight_g SET NOT NULL` | сделать обязательным | в столбце есть NULL |
| `ALTER COLUMN price TYPE numeric(10,2) USING price::numeric(10,2)` | сменить тип с пересчётом | значение не приводится (`'1 290 ₽'`) |
| `ADD CONSTRAINT … CHECK (stock > 0)` | новое правило | есть строки, которые его нарушают |
| `RENAME COLUMN name TO title` | новое имя | — |
| `DROP COLUMN weight_g` | удалить столбец и данные | на столбец ссылаются (без `CASCADE`) |

## На практике
Задача: добавить товарам признак видимости и вес, починить тип цены в таблице импорта.

### Шаг 1. Столбец со значением по умолчанию
Все существующие товары видимы в каталоге:
```sql
ALTER TABLE products ADD COLUMN is_visible boolean NOT NULL DEFAULT true;
SELECT id, name, is_visible FROM products WHERE id IN (1, 2);
```
Результат:
```
ALTER TABLE
 id |         name         | is_visible
----+----------------------+------------
  1 | Ноутбук Aster 14     | t
  2 | Ноутбук Aster 16 Pro | t
(2 rows)
```

### Шаг 2. Обязательный столбец без значения по умолчанию
Вес у товаров разный, общего значения нет:
```sql
ALTER TABLE products ADD COLUMN weight_g integer NOT NULL;
```
Результат:
```
ERROR:  column "weight_g" of relation "products" contains null values
```
В таблице 22 товара, и всем им пришлось бы записать NULL. Делаем в три шага: столбец без `NOT NULL`, заполнение, `SET NOT NULL`:
```sql
ALTER TABLE products ADD COLUMN weight_g integer;
UPDATE products SET weight_g = 1500 WHERE category_id = 3;
ALTER TABLE products ALTER COLUMN weight_g SET NOT NULL;
```
Результат:
```
ALTER TABLE
UPDATE 3
ERROR:  column "weight_g" of relation "products" contains null values
```
Вес заполнили только ноутбукам — у остальных 19 товаров NULL, и `SET NOT NULL` не проходит. Заполняем остальные и повторяем:
```sql
UPDATE products SET weight_g = 300 WHERE weight_g IS NULL;
ALTER TABLE products ALTER COLUMN weight_g SET NOT NULL;
```
Результат:
```
UPDATE 19
ALTER TABLE
```

### Шаг 3. Ограничение и старые строки
Хотим запретить нулевой остаток:
```sql
ALTER TABLE products ADD CONSTRAINT products_stock_positive CHECK (stock > 0);
```
Результат:
```
ERROR:  check constraint "products_stock_positive" of relation "products" is violated by some row
```
Четыре товара сейчас с нулевым остатком. Да и само правило неверное: «нет в наличии» — нормальное состояние товара.

### Шаг 4. Сменить тип
Цены из файла поставщика загрузили в текстовый столбец:
```sql
CREATE TABLE import_products (
    id    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name  text NOT NULL,
    price text
);
INSERT INTO import_products (name, price)
VALUES ('Кеды', '3490.00'), ('Кроссовки', '5990');
ALTER TABLE import_products ALTER COLUMN price TYPE numeric(10,2);
```
Результат:
```
CREATE TABLE
INSERT 0 2
ERROR:  column "price" cannot be cast automatically to type numeric
HINT:  You might need to specify "USING price::numeric(10,2)".
```
Текст может содержать что угодно, поэтому автоматически PostgreSQL его в число не превращает. `USING` говорит, как пересчитать:
```sql
ALTER TABLE import_products
ALTER COLUMN price TYPE numeric(10,2) USING price::numeric(10,2);
SELECT id, name, price FROM import_products;
```
Результат:
```
ALTER TABLE
 id |   name    |  price
----+-----------+---------
  1 | Кеды      | 3490.00
  2 | Кроссовки | 5990.00
(2 rows)
```
Если бы в какой-то строке было `'1 290 ₽'`, приведение упало бы, и тип не поменялся бы — такие строки сначала чистят `UPDATE`.

## Частые ошибки
- **`ADD COLUMN … NOT NULL` без `DEFAULT`.** На непустой таблице — ошибка. Три шага: столбец, заполнение, `SET NOT NULL`.
- **Смена типа без `USING`.** Текст в число, число в дату — нужно явное выражение.
- **Новое ограничение «не видит» старые данные.** Видит: `ALTER` проверяет все строки. Сначала исправляют данные.
- **Безымянные ограничения.** Чтобы удалить ограничение, нужно его имя — смотрите его в ошибке или задавайте своё.
- **Переименование «на живую».** Код, обращающийся к старому имени, падает сразу после `ALTER`.

## Итог
**Столбцы**
- `ADD COLUMN`, `DROP COLUMN`, `RENAME COLUMN … TO …`, `RENAME TO …`.
- `ALTER COLUMN … TYPE … USING …`, `SET/DROP NOT NULL`, `SET/DROP DEFAULT`.

**Ограничения**
- `ADD CONSTRAINT имя …`, `DROP CONSTRAINT имя`.

**Существующие строки**
- Новое правило проверяется на всех строках; нарушение — `ALTER` не выполняется.
- Обязательный столбец: добавить без `NOT NULL` → заполнить → `SET NOT NULL`.

## Вопросы на собеседовании
<details><summary>Как добавить обязательный столбец в таблицу с данными?</summary>

Если есть разумное значение по умолчанию — `ADD COLUMN … NOT NULL DEFAULT значение`: старые строки получат его. Если нет — добавить столбец без `NOT NULL`, заполнить `UPDATE` (на большой таблице — порциями) и затем `ALTER COLUMN … SET NOT NULL`. Так же устроены миграции Django: `makemigrations` спрашивает значение для существующих строк.
</details>

<details><summary>Почему `ALTER TABLE` на большой таблице может остановить сайт?</summary>

Большинство вариантов `ALTER TABLE` берут самую строгую блокировку таблицы: пока команда работает, к таблице не может обратиться ни один запрос, даже `SELECT`. Быстрые изменения (`ADD COLUMN` с постоянным `DEFAULT` в PostgreSQL 11+, переименование) занимают миллисекунды, а смена типа с перезаписью таблицы или проверка нового ограничения по миллионам строк — минуты. Поэтому ограничения добавляют с `NOT VALID` и проверяют отдельно (`VALIDATE CONSTRAINT`), а тяжёлые изменения делают по шагам.
</details>

<details><summary>Что делает `USING` в `ALTER COLUMN … TYPE`?</summary>

Задаёт выражение, по которому новое значение вычисляется из старого: `USING price::numeric(10,2)`, `USING trim(code)`, `USING created::date`. Без него PostgreSQL применяет только автоматическое приведение, которого для многих пар типов нет (например, `text` → `numeric`).
</details>
