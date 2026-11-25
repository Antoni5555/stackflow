---
title: "Зависимости и healthcheck"
type: lesson
level: 3
reading_time: 11
---

## Теория
`docker compose up` запускает сервисы параллельно. Django стартует за секунду и сразу идёт в базу, а PostgreSQL на первом запуске ещё создаёт кластер — несколько секунд. Итог: `connection refused`, контейнер приложения падает, хотя через секунду база была бы готова.

**`depends_on`** задаёт порядок:
- короткая запись `depends_on: [db]` — запустить `db` **раньше** `web`. Но «запущен» значит только «процесс контейнера стартовал», а не «база принимает подключения». Гонка остаётся;
- полная запись с условием — `depends_on: {db: {condition: service_healthy}}` — ждать, пока `db` станет **здоровым**. Для этого у `db` должна быть проверка здоровья.

**`healthcheck`** — команда, которую Docker периодически выполняет внутри контейнера:
- `test: ["CMD-SHELL", "pg_isready -U postgres"]` — код 0 значит «здоров». Для PostgreSQL есть готовая `pg_isready`, для Redis — `redis-cli ping`, для веб-приложения — запрос к `/health/`;
- `interval` — как часто проверять, `timeout` — сколько ждать ответа, `retries` — сколько неудач подряд считать «нездоров», `start_period` — время на старт, когда неудачи не считаются.

Статусы: `starting` → `healthy` или `unhealthy`; они видны в `docker compose ps` и `docker inspect`.

Другие условия `depends_on`: `service_started` (по умолчанию) и `service_completed_successfully` — дождаться, пока одноразовый сервис (например, миграции) **завершится с кодом 0**.

`healthcheck` сам контейнер не перезапускает — только сообщает статус. Перезапуск при падении — ключ `restart` (тема 4.05). А приложению всё равно полезно уметь переподключаться к базе: в работе она может перезапуститься в любой момент.

## Наглядно
**Рисунок 1.** `depends_on` без проверки здоровья и с ней.

![Рисунок 1. Сверху depends_on: [db]: db Started, web Started сразу же, web подключается — Connection refused, exited 1; база готова на секунду позже. Снизу condition: service_healthy: db Started, Waiting — healthcheck pg_isready каждые 2 секунды, Healthy, только потом web Started и подключается успешно](img/healthcheck.svg)

**Таблица 1.** Условия `depends_on`.

| Запись | Ждёт | Когда |
|---|---|---|
| `depends_on: [db]` | старта процесса `db` | порядок без гарантий готовности |
| `condition: service_started` | то же | то же, в полной записи |
| `condition: service_healthy` | статуса `healthy` | база, кэш, очередь — у них есть `healthcheck` |
| `condition: service_completed_successfully` | завершения с кодом 0 | миграции, загрузка данных перед стартом |

**Таблица 2.** Ключи `healthcheck`.

| Ключ | Пример | Смысл |
|---|---|---|
| `test` | `["CMD-SHELL", "pg_isready -U postgres"]` | команда проверки, 0 — здоров |
| `interval` | `2s` | пауза между проверками |
| `timeout` | `3s` | сколько ждать одну проверку |
| `retries` | `10` | неудач подряд до `unhealthy` |
| `start_period` | `30s` | время на старт, неудачи не считаются |

## На практике
Задача: убрать падение приложения при первом запуске. Вместо Django сервис `web` выполняет `check_db.py` — подключается к базе через `psycopg` и печатает «база доступна». Команды выполнены на Ubuntu 24.04 с Docker Engine 29 и Compose v2 (имена в выводе заменены на учебные).

### Шаг 1. Только порядок
Файл `compose.yaml`:
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: shop
  web:
    build: .
    command: ["python", "check_db.py"]
    environment:
      DB_HOST: db
      DB_PASSWORD: shop
    depends_on:
      - db
```
Запускаем без `-d`, чтобы видеть журналы обоих сервисов:
```bash
docker compose up
```
Результат (строки инициализации базы сокращены):
```
 Container shop-db-1 Started 
 Container shop-web-1 Starting 
 Container shop-web-1 Started 
web-1  | Traceback (most recent call last):
web-1  |   File "/app/check_db.py", line 4, in <module>
web-1  |     psycopg.connect(f"host={os.environ['DB_HOST']} user=postgres password={os.environ['DB_PASSWORD']}").close()
web-1  |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
web-1  |   File "/usr/local/lib/python3.12/site-packages/psycopg/connection.py", line 119, in connect
web-1  |     raise last_ex.with_traceback(None)
web-1  | psycopg.OperationalError: connection failed: connection to server at "172.23.0.2", port 5432 failed: Connection refused
web-1  | 	Is the server running on that host and accepting TCP/IP connections?
db-1   | performing post-bootstrap initialization ... ok
web-1 exited with code 1
…
db-1   | 2026-11-24 15:37:38.134 UTC [1] LOG:  database system is ready to accept connections
```
`depends_on` выполнил обещание — `db` запустился раньше. Но база ещё инициализировалась, приложение упало, и только потом в журнале появилось «ready to accept connections».

### Шаг 2. Проверка здоровья
Добавляем `healthcheck` базе и условие `web`:
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: shop
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      timeout: 3s
      retries: 10
  web:
    build: .
    command: ["python", "check_db.py"]
    environment:
      DB_HOST: db
      DB_PASSWORD: shop
    depends_on:
      db:
        condition: service_healthy
```
Удаляем прошлый запуск вместе с томом базы (`docker compose down -v`) и запускаем заново:
```bash
docker compose up -d
```
Результат:
```
 Network shop_default Creating 
 Network shop_default Created 
 Container shop-db-1 Creating 
 Container shop-db-1 Created 
 Container shop-web-1 Creating 
 Container shop-web-1 Created 
 Container shop-db-1 Starting 
 Container shop-db-1 Started 
 Container shop-db-1 Waiting 
 Container shop-db-1 Healthy 
 Container shop-web-1 Starting 
 Container shop-web-1 Started 
```
Появились строки `Waiting` и `Healthy`: compose ждал, пока `pg_isready` ответит «готово», и только потом запустил `web`.

### Шаг 3. Статус здоровья
Как выглядит здоровье в списке и в `inspect`:
```bash
docker compose ps -a
docker inspect --format '{{.State.Health.Status}}' shop-db-1
```
Результат:
```
NAME         IMAGE         COMMAND                  SERVICE   CREATED         STATUS                   PORTS
shop-db-1    postgres:16   "docker-entrypoint.s…"   db        3 seconds ago   Up 2 seconds (healthy)   5432/tcp
shop-web-1   shop-web      "python check_db.py"     web       3 seconds ago   Up Less than a second    
healthy
```
`(healthy)` в статусе — проверка проходит. Ошибки подключения больше нет: `check_db.py` нашёл базу готовой.

## Частые ошибки
- **`depends_on` без условия как гарантия готовности.** Только порядок запуска; база может ещё инициализироваться. Нужен `healthcheck` + `condition: service_healthy`.
- **`condition: service_healthy` без `healthcheck`.** `docker compose config` пропустит файл, а `up` остановится: `dependency failed to start: container shop-db-1 has no healthcheck configured`.
- **Проверка не того.** `test: ["CMD", "true"]` или проверка открытого порта говорят «здоров» раньше, чем сервис готов работать. Для PostgreSQL — `pg_isready`, для приложения — настоящий запрос.
- **Слишком маленькие `interval`/`retries`.** Большая база на медленном сервере стартует дольше — `unhealthy`, и `web` не запускается вовсе. Задайте `start_period` с запасом.
- **Надеяться, что healthcheck перезапустит контейнер.** Он только меняет статус. Перезапуск — `restart:`.
- **Приложение без переподключения.** База перезапустилась ночью — приложение навсегда с ошибкой. Django переподключается на следующем запросе, но фоновые воркеры нужно проверять.

## Итог
**Порядок**
- `depends_on: [db]` — только старт раньше, без готовности.

**Готовность**
- `healthcheck` (`test`, `interval`, `timeout`, `retries`, `start_period`) + `depends_on: {db: {condition: service_healthy}}`.
- Статус `healthy`/`unhealthy` — в `docker compose ps` и `docker inspect`.

**Одноразовые шаги**
- `condition: service_completed_successfully` — ждать завершения миграций.

## Вопросы на собеседовании
<details><summary>Гарантирует ли `depends_on`, что база готова к подключениям?</summary>

Короткая форма — нет: она только запускает зависимость раньше. Процесс контейнера может стартовать, а сервис внутри ещё инициализироваться. Гарантию даёт `healthcheck` у зависимости и `condition: service_healthy` у зависящего сервиса.
</details>

<details><summary>Что такое healthcheck в Docker?</summary>

Команда, которую Docker периодически выполняет внутри контейнера; код 0 — здоров, иначе — неудача. После заданного числа неудач подряд контейнер помечается `unhealthy`. Статус используют compose (`depends_on`), оркестраторы и мониторинг; сам Docker контейнер по нему не перезапускает.
</details>

<details><summary>Как запустить миграции до старта приложения в compose?</summary>

Отдельным сервисом с командой `python manage.py migrate`, от которого `web` зависит с условием `service_completed_successfully`; или отдельной командой при деплое: `docker compose run --rm web python manage.py migrate`. Делать миграции внутри `CMD` каждого экземпляра приложения рискованно: несколько экземпляров начнут мигрировать одновременно.
</details>

## Глубже
Как сохранить данные базы между `down` и `up` и вынести настройки из `compose.yaml` — следующая тема, «Тома и окружение в compose».
