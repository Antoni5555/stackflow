---
title: "compose.yaml"
type: lesson
level: 2
reading_time: 12
---

## Теория
Магазин — это уже несколько контейнеров: Django, PostgreSQL, потом Nginx и Redis. Запускать каждый своей длинной командой `docker run` с сетью, портами, переменными и томами — долго и легко ошибиться, а новому разработчику нужно передать все эти команды. **Docker Compose** описывает весь набор контейнеров в одном файле **`compose.yaml`** и управляет им одной командой.

Файл — YAML: отступы пробелами (не табуляцией) задают вложенность, `ключ: значение` — словарь, `- элемент` — список. Главное в файле — раздел **`services`**: каждый сервис — будущий контейнер.

Ключи сервиса:
- **`image`** — готовый образ: `postgres:16`;
- **`build: .`** — собрать образ из Dockerfile в указанной папке (тема 3.01). Можно вместе с `image:` — тогда собранный образ получит это имя;
- **`ports`** — список пробросов `"хост:контейнер"` (кавычки, чтобы YAML не прочитал `58000:8000` как число);
- **`environment`** — переменные окружения словарём;
- **`command`** — заменить `CMD` образа.

Что Compose делает сам:
- **проект** — набор сервисов; имя по умолчанию — имя папки с файлом (или ключ `name:` в начале файла);
- **сеть проекта** `проект_default` — все сервисы в ней, и **имя сервиса — это имя хоста**: Django обращается к базе как `db` (тема 2.03);
- **имена контейнеров** — `проект-сервис-1`.

Команды (запускаются из папки с `compose.yaml`):
- `docker compose up -d` — создать и запустить всё в фоне; `--build` — пересобрать образы сервисов с `build`;
- `docker compose ps`, `logs [сервис]`, `exec сервис команда`;
- `docker compose stop` / `start` — остановить и запустить, не удаляя;
- `docker compose down` — остановить и **удалить** контейнеры и сеть (тома остаются).

Старая отдельная программа `docker-compose` (через дефис, версия 1) больше не развивается. Сейчас Compose — часть Docker: `docker compose` через пробел. Старое имя файла `docker-compose.yml` тоже понимается.

## Наглядно
**Рисунок 1.** Файл compose.yaml и то, что из него получается.

![Рисунок 1. compose.yaml: services db (image postgres:16, environment) и web (build ., ports 58000:8000, environment DB_HOST db). docker compose up -d создаёт проект shop: сеть shop_default, контейнеры shop-db-1 и shop-web-1. Web обращается к базе по имени db:5432, сервер — к web по localhost:58000](img/compose.svg)

**Таблица 1.** `docker run` и compose.

| `docker run` | `compose.yaml` |
|---|---|
| `--name shop-db` | имя сервиса `db` → контейнер `проект-db-1` |
| `postgres:16` | `image: postgres:16` |
| `docker build -t … .` | `build: .` |
| `-p 58000:8000` | `ports: ["58000:8000"]` |
| `-e K=v` | `environment: {K: v}` |
| `--network shop` | сеть проекта создаётся сама |
| команда после образа | `command: [...]` |

**Таблица 2.** Команды compose.

| Задача | Команда |
|---|---|
| запустить всё в фоне | `docker compose up -d` |
| пересобрать и запустить | `docker compose up -d --build` |
| что запущено | `docker compose ps` |
| журнал сервиса | `docker compose logs web` |
| команда внутри | `docker compose exec db psql -U postgres` |
| остановить и удалить | `docker compose down` |
| проверить файл | `docker compose config` |

## На практике
Задача: описать магазин из двух сервисов — базы и приложения — и запустить его одной командой. Приложение — минимальное WSGI-приложение на Gunicorn, которое подключается к базе через `psycopg` (Dockerfile — как в разделе 3). Команды выполнены на Ubuntu 24.04 с Docker Engine 29 и Compose v2 (имена в выводе заменены на учебные; проект называется `shop` по имени папки).

### Шаг 1. Файл
Файл `compose.yaml` в папке проекта рядом с Dockerfile:
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: shop
      POSTGRES_DB: shop
  web:
    build: .
    ports:
      - "58000:8000"
    environment:
      DB_HOST: db
      DB_NAME: shop
      DB_PASSWORD: shop
```
`DB_HOST: db` — имя сервиса базы; приложение собирает из этих переменных строку подключения.

### Шаг 2. Запуск
Собираем образ приложения и запускаем всё:
```bash
docker compose up -d --build
```
Результат (вывод сборки сокращён):
```
 Image shop-web Building 
 Image shop-web Built 
 Network shop_default Creating 
 Network shop_default Created 
 Container shop-web-1 Creating 
 Container shop-db-1 Creating 
 Container shop-web-1 Created 
 Container shop-db-1 Created 
 Container shop-web-1 Starting 
 Container shop-db-1 Starting 
 Container shop-db-1 Started 
 Container shop-web-1 Started 
```
Одна команда собрала образ, создала сеть и два контейнера. Сервисы запускаются параллельно — порядок нигде не задан (к этому вернёмся в следующей теме).

### Шаг 3. Что запущено
Список сервисов и запрос к приложению:
```bash
docker compose ps
curl -s localhost:58000
```
Результат:
```
NAME         IMAGE         COMMAND                  SERVICE   CREATED         STATUS         PORTS
shop-db-1    postgres:16   "docker-entrypoint.s…"   db        4 seconds ago   Up 4 seconds   5432/tcp
shop-web-1   shop-web      "gunicorn --bind 0.0…"   web       4 seconds ago   Up 4 seconds   0.0.0.0:58000->8000/tcp, [::]:58000->8000/tcp
Магазин работает, баз на сервере: 4
```
База не опубликована наружу (`5432/tcp` без стрелки), а приложение подключилось к ней по имени `db`. Образ приложения назван по проекту и сервису: `shop-web`.

### Шаг 4. Журнал и команда внутри
Журнал одного сервиса и запрос к базе:
```bash
docker compose logs web
docker compose exec db psql -U postgres -d shop -c "SELECT current_user;"
```
Результат:
```
web-1  | [2026-11-24 15:37:20 +0000] [1] [INFO] Starting gunicorn 23.0.0
web-1  | [2026-11-24 15:37:20 +0000] [1] [INFO] Listening at: http://0.0.0.0:8000 (1)
web-1  | [2026-11-24 15:37:20 +0000] [1] [INFO] Using worker: sync
web-1  | [2026-11-24 15:37:20 +0000] [7] [INFO] Booting worker with pid: 7
 current_user 
--------------
 postgres
(1 row)
```
В compose обращаются к **сервисам** (`web`, `db`), а не к полным именам контейнеров. Строки журнала помечены сервисом — удобно, когда смотрите `docker compose logs` без имени, по всем сразу.

### Шаг 5. Остановить и убрать
Удаляем контейнеры и сеть проекта:
```bash
docker compose down
```
Результат:
```
 Container shop-db-1 Stopping 
 Container shop-web-1 Stopping 
 Container shop-db-1 Stopped 
 Container shop-db-1 Removing 
 Container shop-db-1 Removed 
 Container shop-web-1 Stopped 
 Container shop-web-1 Removing 
 Container shop-web-1 Removed 
 Network shop_default Removing 
 Network shop_default Removed 
```
Контейнеры и сеть удалены, образ `shop-web` остался. Данные базы здесь лежали в анонимном томе — и он тоже остался «сиротой» (тема 2.01). Как хранить их правильно — тема «Тома и окружение в compose».

### Шаг 6. Ошибки в файле
Лишний пробел в отступе и проброс портов строкой вместо списка. Проверяем файлы командой `config`:
```bash
docker compose -f bad.yaml config
docker compose -f bad2.yaml config
```
Результат:
```
yaml: line 4: mapping values are not allowed in this context
validating /home/shop/shop/bad2.yaml: services.web.ports must be a array
```
Первая ошибка — от разбора YAML: строка `ports:` с неверным отступом. Вторая — от проверки схемы compose: `ports` должен быть списком (`- "58000:80"`), а не строкой.

## Частые ошибки
- **Табуляция или неровные отступы.** `yaml: line N: …` — YAML понимает только пробелы и одинаковый отступ на одном уровне.
- **`ports` без кавычек.** `- 58000:8000` обычно работает, но по старым правилам YAML запись вида `- 22:22` читается как число в шестидесятеричной системе — документация Docker советует кавычки. Пишите `- "58000:8000"`.
- **`localhost` для другого сервиса.** Внутри контейнера это он сам (тема 2.03). Пишите имя сервиса: `db`.
- **Правка кода без `--build`.** `docker compose up -d` берёт уже собранный образ — изменений не видно. `docker compose up -d --build`.
- **`docker-compose` через дефис.** Старая версия, может не поддерживать новые ключи (`depends_on.condition`, `profiles`). Используйте `docker compose`.
- **Команды не из той папки.** Compose ищет `compose.yaml` в текущей папке: `no configuration file provided: not found`. Перейдите в папку проекта или укажите `-f путь`.
- **Путать `stop` и `down`.** `stop` оставляет контейнеры, `down` удаляет их и сеть. Тома удаляет только `down -v`.

## Итог
**Файл**
- `services:` — сервис на контейнер; `image` или `build`, `ports` списком в кавычках, `environment`, `command`.

**Что делает Compose**
- Проект по имени папки, сеть `проект_default`, имя сервиса = имя хоста, контейнеры `проект-сервис-1`.

**Команды**
- `up -d [--build]`, `ps`, `logs сервис`, `exec сервис …`, `stop`/`start`, `down`, `config`.

## Вопросы на собеседовании
<details><summary>Зачем нужен Docker Compose?</summary>

Чтобы описать многоконтейнерное приложение (приложение, база, кэш, прокси) декларативно в одном файле и управлять им одной командой: создать сеть, тома и контейнеры с нужными настройками, посмотреть логи, остановить. Файл хранится в репозитории, и окружение у всех разработчиков одинаковое.
</details>

<details><summary>Как сервисы в compose находят друг друга?</summary>

Compose создаёт для проекта пользовательскую сеть, и встроенный DNS Docker отвечает на имена сервисов. Сервис `web` подключается к базе по адресу `db:5432`. Публиковать порты для связи между сервисами не нужно.
</details>

<details><summary>Чем `docker compose down` отличается от `stop`?</summary>

`stop` останавливает контейнеры, но оставляет их — `start` вернёт всё как было. `down` останавливает и удаляет контейнеры и сеть проекта. Тома при этом остаются; удалить и их — `down -v`.
</details>

## Глубже
Почему приложение может упасть, если база ещё не готова, и как этого избежать — следующая тема, «Зависимости и healthcheck».
