---
title: "Управление контейнерами"
type: lesson
level: 1
reading_time: 11
---

## Теория
База магазина работает в контейнере `shop-db`. Каждый день с ним что-то делают: смотрят журнал, заходят в `psql`, останавливают на ночь, перезапускают после смены настроек, удаляют. Для этого — небольшой набор команд. Контейнер в них указывают по **имени** или по **ID** (хватает первых символов: `a9d4`).

У контейнера есть **статус**:
- `Created` — создан, но не запускался (например, не смог занять порт);
- `Up` — работает;
- `Exited (код)` — главный процесс завершился; `Exited (0)` — штатно, другое число — с ошибкой.

Команды:
- **`docker ps`** — работающие контейнеры; **`docker ps -a`** — все, включая остановленные; `-q` — только ID;
- **`docker stop`** — остановить штатно (сигнал TERM, через 10 секунд — KILL, как `kill` в курсе Linux); **`docker start`** — запустить остановленный; **`docker restart`** — остановить и запустить;
- **`docker rm`** — удалить остановленный контейнер; **`docker rm -f`** — остановить и удалить сразу. Вместе с контейнером исчезает его слой изменений;
- **`docker logs`** — всё, что главный процесс вывел в stdout и stderr; `--tail N` — последние N строк, `-f` — следить за новыми (выход — Ctrl+C, контейнер продолжит работать);
- **`docker exec контейнер команда`** — выполнить команду **внутри работающего** контейнера; `-it` — интерактивно: `docker exec -it shop-db psql -U postgres`, `docker exec -it shop-db bash`;
- **`docker inspect`** — все настройки и состояние в JSON; `--format` вытаскивает нужное поле.

`stop` и `start` сохраняют контейнер и его файлы: база после `start` на месте. `rm` удаляет контейнер навсегда.

## Наглядно
**Рисунок 1.** Жизненный цикл контейнера и команды, которые переводят его из состояния в состояние.

![Рисунок 1. docker run создаёт и запускает контейнер: Created → Up. docker stop переводит Up в Exited, docker start — обратно в Up, docker restart — Up через остановку снова в Up. docker rm удаляет контейнер в состоянии Exited или Created; docker rm -f — и работающий. Пока контейнер в Up, работают docker logs и docker exec](img/container-lifecycle.svg)

**Таблица 1.** Команды на каждый день.

| Задача | Команда |
|---|---|
| что запущено | `docker ps` |
| все, включая остановленные | `docker ps -a` |
| остановить / запустить / перезапустить | `docker stop shop-db` / `docker start shop-db` / `docker restart shop-db` |
| удалить | `docker rm shop-db` (работающий — `docker rm -f shop-db`) |
| последние строки журнала | `docker logs --tail 50 shop-db` |
| следить за журналом | `docker logs -f shop-db` |
| psql внутри | `docker exec -it shop-db psql -U postgres -d shop` |
| оболочка внутри | `docker exec -it shop-db bash` (в alpine-образах — `sh`) |
| одно поле настроек | `docker inspect --format '{{.State.Status}}' shop-db` |

## На практике
Задача: проверить базу магазина изнутри контейнера, остановить и снова запустить её и удалить контейнер. Контейнер `shop-db` запущен, как в прошлой теме. Команды выполнены на Ubuntu 24.04 с Docker Engine 29 (имена контейнеров в выводе заменены на учебные).

### Шаг 1. Запрос внутри контейнера
`psql` есть внутри образа `postgres` — на сервере его ставить не нужно:
```bash
docker exec shop-db psql -U postgres -d shop -c "SELECT current_database(), version();"
```
Результат:
```
 current_database |                                                       version                                                        
------------------+----------------------------------------------------------------------------------------------------------------------
 shop             | PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
(1 row)

```
База `shop` создана переменной `POSTGRES_DB`. Внутри — Debian, хотя сервер — Ubuntu. Без `-c` и с флагами `-it` откроется обычный интерактивный `psql` с приглашением `shop=#`; выход — `\q`.

### Шаг 2. Окружение контейнера
`exec` выполняет любую команду, например `env`:
```bash
docker exec shop-db env
```
Результат:
```
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/postgresql/16/bin
HOSTNAME=a9d41c49921a
POSTGRES_PASSWORD=shop
POSTGRES_DB=shop
GOSU_VERSION=1.19
LANG=en_US.utf8
PG_MAJOR=16
PG_VERSION=16.15-1.pgdg13+2
PGDATA=/var/lib/postgresql/data
HOME=/root
```
Видны наши `-e` и переменные, которые задал сам образ. Имя хоста внутри — короткий ID контейнера. Пароль виден любому, кто может выполнить `docker exec` или `docker inspect`, — помните об этом.

### Шаг 3. Остановить и посмотреть все контейнеры
Останавливаем базу и смотрим список вместе с остановленными:
```bash
docker stop shop-db
docker ps -a
```
Результат:
```
shop-db
CONTAINER ID   IMAGE         COMMAND                  CREATED         STATUS                              PORTS     NAMES
a9d41c49921a   postgres:16   "docker-entrypoint.s…"   5 seconds ago   Exited (0) Less than a second ago             shop-db
```
`docker ps` без `-a` его бы не показал. `Exited (0)` — база остановилась штатно, порт освобождён. Данные — в слое контейнера, `docker start shop-db` вернёт её вместе с ними.

### Шаг 4. Удалить работающий
Запускаем снова и пробуем удалить:
```bash
docker start shop-db
docker rm shop-db
```
Результат:
```
shop-db
Error response from daemon: cannot remove container "shop-db": container is running: stop the container before removing or force remove
```
Работающий контейнер `rm` не удаляет — защита от случайности. Либо `docker stop`, потом `docker rm`, либо сразу `docker rm -f shop-db`.

### Шаг 5. Одно поле из настроек
`inspect` выдаёт сотни строк JSON. `--format` берёт нужное — статус, образ и порты:
```bash
docker inspect --format '{{.State.Status}} {{.Config.Image}} {{.NetworkSettings.Ports}}' shop-db
```
Результат:
```
running postgres:16 map[5432/tcp:[{0.0.0.0 55432} {:: 55432}]]
```
Удобно в скриптах: например, проверить, что база запущена, перед миграциями.

### Шаг 6. Удалить совсем
Удаляем сразу, без остановки, и проверяем список:
```bash
docker rm -f shop-db
docker ps -a
```
Результат:
```
shop-db
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
```
Контейнера нет, а с ним и созданных в базе таблиц — они жили в слое контейнера. Образ `postgres:16` остался: следующий `docker run` будет мгновенным.

## Частые ошибки
- **`docker ps` не показывает контейнер.** Он остановлен — смотрите `docker ps -a` и `docker logs`, почему.
- **`rm` вместо `stop`.** Остановить на ночь — `stop`; `rm` удаляет контейнер и данные его слоя.
- **`exec` в остановленный контейнер.** `Error response from daemon: container … is not running`. Сначала `docker start`.
- **`exec -it` в скрипте или CI.** Без терминала — ошибка `cannot attach stdin to a TTY-enabled container because stdin is not a terminal`. В скриптах — без `-it`: `docker exec shop-db psql -c "…"`.
- **`bash` в alpine-образе.** `exec: "bash": executable file not found in $PATH`. В alpine — `sh`.
- **`logs -f` и Ctrl+C.** Ctrl+C останавливает только просмотр журнала, контейнер работает дальше — это не `docker run` без `-d`.
- **Менять файлы внутри через `exec` «навсегда».** Правки в слое контейнера пропадут при `rm`. Настройки — через переменные, тома и образ.

## Итог
**Состояния**
- `Created` → `Up` → `Exited (код)`; `ps` — работающие, `ps -a` — все.

**Жизненный цикл**
- `stop` / `start` / `restart` сохраняют контейнер; `rm` удаляет, `rm -f` — и работающий.

**Внутрь и наружу**
- `logs [--tail N] [-f]` — журнал; `exec [-it]` — команда внутри работающего; `inspect --format` — нужное поле.

## Вопросы на собеседовании
<details><summary>Чем `docker stop` отличается от `docker kill` и `docker rm -f`?</summary>

`stop` посылает главному процессу TERM и даёт ему 10 секунд завершиться штатно, потом — KILL. `kill` сразу посылает KILL (или указанный сигнал). `rm -f` останавливает контейнер KILL'ом и удаляет его. Для баз данных нужен `stop`: им важно корректно записать данные на диск.
</details>

<details><summary>Чем `docker exec` отличается от `docker run`?</summary>

`run` создаёт новый контейнер из образа. `exec` выполняет дополнительную команду в уже работающем контейнере — в той же файловой системе, сети и с теми же переменными. `exec` используют для отладки и обслуживания: `psql`, миграции, просмотр файлов.
</details>

<details><summary>Где смотреть, почему контейнер не запускается?</summary>

`docker ps -a` — статус и код выхода, `docker logs контейнер` — что вывел главный процесс перед завершением (например, «POSTGRES_PASSWORD is not specified»), `docker inspect` — настройки, с которыми он создан (порты, переменные, тома).
</details>

## Глубже
Откуда берутся образы, что значат теги и почему `latest` опасен — следующая тема.
