---
title: "Тома и окружение в compose"
type: lesson
level: 3
reading_time: 12
---

## Теория
В compose из прошлых тем две проблемы: база хранит данные в анонимном томе (после `down` и `up` — пустая), а пароль записан прямо в `compose.yaml`, который лежит в git. Compose умеет то же, что `docker run` с `-v` и `--env-file` (раздел 2), плюс подстановку переменных в сам файл.

**Тома:**
- в сервисе — `volumes: ["pgdata:/var/lib/postgresql/data"]` (именованный) или `["./media:/app/media"]` (папка рядом с `compose.yaml`);
- именованные тома объявляют **в разделе `volumes:` верхнего уровня**. Compose добавляет к имени проект: том `pgdata` проекта `shop` называется `shop_pgdata`;
- `docker compose down` тома **не удаляет** — данные переживают пересоздание контейнеров. `down -v` удаляет тома проекта **вместе с данными**.

**Переменные внутри контейнера:**
- `environment:` — прямо в файле, для несекретного;
- **`env_file: db.env`** — из файла. В отличие от `docker run --env-file`, compose **убирает кавычки** вокруг значения (`POSTGRES_PASSWORD="s3cr3t"` → `s3cr3t`). Файл с секретами — в `.gitignore`.

**Подстановка в сам `compose.yaml`** — `${ИМЯ}`. Значения берутся из окружения, где запускается `docker compose`, и из файла **`.env` рядом с `compose.yaml`** (он читается автоматически):
- `${WEB_PORT}` — значение или пустая строка с предупреждением;
- `${WEB_PORT:-58000}` — значение по умолчанию;
- `${DB_PASSWORD:?задайте DB_PASSWORD}` — ошибка, если переменной нет.

Так один `compose.yaml` в репозитории работает на ноутбуке и на сервере: отличается только `.env`. Итоговый файл после подстановок показывает **`docker compose config`** — первым делом при любых сомнениях.

Не путайте два `.env`: файл рядом с `compose.yaml` — для **подстановки** `${…}` в compose; `env_file:` — переменные **внутри контейнера**. Это может быть один и тот же файл, но механизмы разные.

## Наглядно
**Рисунок 1.** Откуда compose берёт тома и переменные.

![Рисунок 1. Файл .env рядом с compose.yaml: WEB_PORT=58000, TAG=1.4.2 — подставляются в ${WEB_PORT} и ${TAG} самого compose.yaml. Файл db.env по env_file попадает в окружение контейнера db (кавычки убираются). Раздел volumes: pgdata — том shop_pgdata подключён к /var/lib/postgresql/data. docker compose down удаляет контейнеры и сеть, том остаётся; down -v удаляет и том](img/volumes-env.svg)

**Таблица 1.** Переменные в compose.

| Механизм | Где пишут | Куда попадает |
|---|---|---|
| `environment:` | в `compose.yaml` | окружение контейнера |
| `env_file: файл` | отдельный файл | окружение контейнера, кавычки убираются |
| `${ИМЯ}`, `${ИМЯ:-по_умолчанию}`, `${ИМЯ:?ошибка}` | в `compose.yaml` | подставляется в сам файл |
| `.env` рядом с `compose.yaml` | отдельный файл | значения для `${…}` |

**Таблица 2.** Тома и команды.

| Задача | Как |
|---|---|
| именованный том | `volumes: [pgdata:/var/lib/postgresql/data]` + `volumes: {pgdata: }` внизу |
| папка проекта | `volumes: ["./media:/app/media"]` |
| удалить контейнеры, тома оставить | `docker compose down` |
| удалить и тома (данные!) | `docker compose down -v` |
| итоговый файл после подстановок | `docker compose config` |

## На практике
Задача: сохранить данные базы магазина между `down` и `up`, убрать пароль в отдельный файл и вынести порт и версию образа в `.env`. Команды выполнены на Ubuntu 24.04 с Docker Engine 29 и Compose v2 (имена в выводе заменены на учебные).

### Шаг 1. Файлы
Файл `db.env` — настройки базы (в `.gitignore`):
```
POSTGRES_PASSWORD="s3cr3t"
POSTGRES_DB=shop
```
Файл `.env` — значения для подстановки:
```
WEB_PORT=58000
TAG=1.4.2
```
Файл `compose.yaml`:
```yaml
services:
  db:
    image: postgres:16
    env_file: db.env
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      retries: 10
  web:
    build: .
    image: shop-web:${TAG}
    ports:
      - "${WEB_PORT}:8000"
    environment:
      DB_HOST: db
      DB_NAME: shop
      DB_PASSWORD: s3cr3t
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
```
Пароль у `web` для простоты в `environment`; в работе его тоже берут из файла.

### Шаг 2. Что получилось после подстановок
Проверяем итоговую конфигурацию:
```bash
docker compose config
```
Результат (раздел `web` сокращён):
```
name: shop
services:
  db:
    environment:
      POSTGRES_DB: shop
      POSTGRES_PASSWORD: s3cr3t
    image: postgres:16
    networks:
      default: null
    volumes:
      - type: volume
        source: pgdata
        target: /var/lib/postgresql/data
        volume: {}
…
  web:
…
    image: shop-web:1.4.2
…
    ports:
      - mode: ingress
        target: 8000
        published: "58000"
        protocol: tcp
networks:
  default:
    name: shop_default
volumes:
  pgdata:
    name: shop_pgdata
```
`env_file` превратился в `environment`, и **кавычки у пароля убраны** — в отличие от `docker run --env-file` (тема 2.02). `${TAG}` и `${WEB_PORT}` подставлены из `.env`, том получил имя `shop_pgdata`.

### Шаг 3. Данные переживают down
Запускаем, создаём таблицу, удаляем контейнеры и смотрим тома:
```bash
docker compose up -d --build
docker compose exec db psql -U postgres -d shop -c "CREATE TABLE orders (id serial); INSERT INTO orders DEFAULT VALUES;"
docker compose down
docker volume ls --filter label=com.docker.compose.project=shop
```
Результат (строки создания и удаления контейнеров сокращены):
```
CREATE TABLE
INSERT 0 1
DRIVER    VOLUME NAME
local     shop_pgdata
```
Контейнеры удалены, том `shop_pgdata` остался. Поднимаем проект снова:
```bash
docker compose up -d
docker compose exec db psql -U postgres -d shop -c "SELECT count(*) FROM orders;"
```
Результат:
```
 count 
-------
     1
(1 row)
```
Новый контейнер базы подключил тот же том — заказ на месте.

### Шаг 4. down -v
С флагом `-v` удаляется и том:
```bash
docker compose down -v
```
Результат (строки контейнеров сокращены):
```
 Volume shop_pgdata Removing 
 Network shop_default Removing 
```
Теперь следующий `up` начнёт с пустой базы. На сервере `down -v` равен удалению базы магазина.

### Шаг 5. Переменной нет
Что будет, если `.env` нет, а переменные не заданы:
```bash
docker compose --env-file /dev/null config
```
Результат (сама конфигурация не показана; в терминале эти строки выглядят короче — `WARN[0000] The "TAG" variable is not set…`):
```
time="2026-11-24T18:38:36+03:00" level=warning msg="The \"TAG\" variable is not set. Defaulting to a blank string."
time="2026-11-24T18:38:36+03:00" level=warning msg="The \"WEB_PORT\" variable is not set. Defaulting to a blank string."
```
Compose подставил пустые строки: образ стал `shop-web:` без тега, а порт — без номера на сервере. Чтобы такая ошибка не прошла тихо, пишут `${WEB_PORT:-58000}` или `${TAG:?задайте TAG}`.

## Частые ошибки
- **Том не объявлен внизу.** `pgdata:/var/…` в сервисе без раздела `volumes:` верхнего уровня — `service "db" refers to undefined volume pgdata: invalid compose project`. Добавьте `volumes: {pgdata: }`.
- **`down -v` «для чистоты».** Удаляет базу. Перед этим — `pg_dump`, а на сервере лучше не использовать вовсе.
- **Секреты в `compose.yaml` в git.** Пароли — в `env_file` или `.env`, который в `.gitignore`; в репозитории — `.env.example` без значений.
- **Путать `.env` для подстановки и `env_file`.** `${DB_PASSWORD}` берётся из `.env` рядом с compose, а не из `env_file` сервиса; переменные из `env_file` в `${…}` не участвуют.
- **Тихая пустая переменная.** Предупреждение `… variable is not set. Defaulting to a blank string` легко пропустить. Задавайте значения по умолчанию или `:?` для обязательных.
- **Кавычки в `env_file` и `--env-file` по-разному.** Compose их убирает, `docker run --env-file` — нет. Один и тот же файл даст разные пароли.
- **Относительный путь не от той папки.** `./media` считается от папки с `compose.yaml`, а не от текущей папки терминала (если запускать с `-f` откуда-то ещё).

## Итог
**Тома**
- В сервисе `том:/путь` или `./папка:/путь`; именованные — в разделе `volumes:`; имя — `проект_том`.
- `down` тома сохраняет, `down -v` удаляет вместе с данными.

**Переменные**
- `environment:` — в файле; `env_file:` — из файла (кавычки убираются).
- `${…}` — подстановка из окружения и `.env` рядом с `compose.yaml`; `:-` по умолчанию, `:?` — обязательно.

**Проверка**
- `docker compose config` — итоговый файл после подстановок.

## Вопросы на собеседовании
<details><summary>Чем `docker compose down` отличается от `down -v`?</summary>

`down` удаляет контейнеры и сети проекта, а именованные тома оставляет — данные баз сохраняются. `down -v` удаляет ещё и тома, объявленные в проекте, и анонимные тома контейнеров — данные теряются безвозвратно.
</details>

<details><summary>Как передать разные настройки одному compose.yaml на разных машинах?</summary>

Подстановкой `${ПЕРЕМЕННАЯ}` в `compose.yaml` со значениями из окружения или файла `.env` рядом с ним; переменные контейнеров — через `env_file`. В репозитории — общий `compose.yaml` и `.env.example`, а настоящие `.env` с секретами у каждого свои и в git не попадают. Дополнительно — override-файлы (следующая тема).
</details>

<details><summary>Чем `environment` отличается от `env_file` в compose?</summary>

`environment` задаёт переменные прямо в `compose.yaml`; `env_file` подгружает их из отдельного файла. Результат одинаковый — переменные в окружении контейнера. Секреты выносят в `env_file`, чтобы не хранить их в файле из репозитория.
</details>

## Глубже
Как в разработке не пересобирать образ на каждую правку и держать отдельные настройки для ноутбука — следующая тема, «Compose для разработки».
