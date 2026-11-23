---
title: "Запуск контейнера"
type: lesson
level: 1
reading_time: 11
---

## Теория
Чтобы разрабатывать магазин, нужен PostgreSQL 16. Ставить его в систему — значит возиться с версиями, службами и паролями. С Docker база запускается одной командой и удаляется так же — без следов в системе.

**`docker run [флаги] образ [команда]`** — создать контейнер из образа и запустить. Если образа нет локально, Docker сначала скачает его. Главные флаги:
- **`-d`** (detached) — в фоне: команда печатает ID контейнера и возвращает терминал. Без `-d` вывод контейнера идёт в терминал, а Ctrl+C его останавливает;
- **`--name shop-db`** — имя. Без него Docker придумает случайное (`happy_turing`). Имя уникально: второй контейнер с тем же именем не создать;
- **`-p 55432:5432`** — публикация порта: **порт хоста : порт в контейнере**. PostgreSQL внутри слушает 5432, а с сервера к нему ходят на 55432. Без `-p` контейнер с хоста не достать;
- **`-e ИМЯ=значение`** — переменная окружения внутри контейнера. Так настраивают почти все официальные образы: `POSTGRES_PASSWORD`, `POSTGRES_DB`;
- **`--rm`** — удалить контейнер, когда он завершится. Для разовых команд;
- **`-it`** — интерактивный режим с терминалом: для `bash`, `python`, `psql` внутри контейнера.

**Команда после образа** заменяет команду по умолчанию: `docker run --rm python:3.12-slim python --version` вместо интерактивного Python выполнит одну команду и завершится. Контейнер живёт, пока работает его главный процесс.

Какие переменные понимает образ, написано на его странице на Docker Hub. У `postgres` без `POSTGRES_PASSWORD` контейнер сразу завершается с ошибкой.

## Наглядно
**Рисунок 1.** `docker run -d --name shop-db -p 55432:5432 -e POSTGRES_PASSWORD=… postgres:16`: что за что отвечает.

![Рисунок 1. Команда docker run разобрана по частям: -d — в фоне; --name shop-db — имя; -p 55432:5432 — порт 55432 сервера ведёт на порт 5432 контейнера; -e POSTGRES_PASSWORD и POSTGRES_DB — переменные окружения внутри; postgres:16 — образ. Справа сервер: запрос на localhost:55432 проходит через проброс в контейнер shop-db, где PostgreSQL слушает 5432](img/docker-run.svg)

**Таблица 1.** Флаги `docker run`.

| Флаг | Что делает | Пример |
|---|---|---|
| `-d` | в фоне, печатает ID | `docker run -d postgres:16` |
| `--name` | имя контейнера | `--name shop-db` |
| `-p хост:контейнер` | открыть порт контейнера на сервере | `-p 55432:5432` |
| `-e ИМЯ=значение` | переменная окружения | `-e POSTGRES_PASSWORD=shop` |
| `--rm` | удалить после завершения | `docker run --rm alpine:3 date` |
| `-it` | интерактивно, с терминалом | `docker run -it --rm python:3.12-slim` |
| команда после образа | вместо команды по умолчанию | `… python:3.12-slim python --version` |

## На практике
Задача: поднять PostgreSQL 16 для разработки магазина — в фоне, с базой `shop`, паролем и портом 55432 на сервере — и разобрать типичные ошибки запуска. Команды выполнены на Ubuntu 24.04 с Docker Engine 29 (имена контейнеров в выводе заменены на учебные).

### Шаг 1. Без пароля
Самый короткий запуск:
```bash
docker run --name shop-db postgres:16
```
Результат:
```
Error: Database is uninitialized and superuser password is not specified.
       You must specify POSTGRES_PASSWORD to a non-empty value for the
       superuser. For example, "-e POSTGRES_PASSWORD=password" on "docker run".

       You may also use "POSTGRES_HOST_AUTH_METHOD=trust" to allow all
       connections without a password. This is *not* recommended.

       See PostgreSQL documentation about "trust":
       https://www.postgresql.org/docs/current/auth-trust.html
```
Контейнер завершился, но не удалился: имя `shop-db` занято. Убираем его — `docker rm shop-db` (подробнее — следующая тема).

### Шаг 2. Правильный запуск
В фоне, с паролем, базой и портом:
```bash
docker run -d --name shop-db -e POSTGRES_PASSWORD=shop -e POSTGRES_DB=shop -p 55432:5432 postgres:16
```
Результат:
```
a9d41c49921a0c5d356754ee8de0590f3988ea53e9cc2dfa915d1590de3d7547
```
Это полный ID контейнера. Терминал свободен, база работает в фоне.

### Шаг 3. Работает ли
Список запущенных контейнеров:
```bash
docker ps
```
Результат:
```
CONTAINER ID   IMAGE         COMMAND                  CREATED         STATUS         PORTS                                           NAMES
a9d41c49921a   postgres:16   "docker-entrypoint.s…"   4 seconds ago   Up 4 seconds   0.0.0.0:55432->5432/tcp, [::]:55432->5432/tcp   shop-db
```
`PORTS` — порт 55432 сервера (IPv4 и IPv6) ведёт на 5432 контейнера. Django на сервере подключится к `localhost:55432`. А вот последние строки журнала базы:
```bash
docker logs --tail 3 shop-db
```
Результат:
```
2026-11-23 17:31:12.640 UTC [1] LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"
2026-11-23 17:31:12.647 UTC [64] LOG:  database system was shut down at 2026-11-23 17:31:12 UTC
2026-11-23 17:31:12.656 UTC [1] LOG:  database system is ready to accept connections
```
«ready to accept connections» — база готова.

### Шаг 4. Имя занято
Повторяем ту же команду — например, по истории терминала:
```bash
docker run -d --name shop-db -e POSTGRES_PASSWORD=shop postgres:16
```
Результат:
```
docker: Error response from daemon: Conflict. The container name "/shop-db" is already in use by container "a9d41c49921a0c5d356754ee8de0590f3988ea53e9cc2dfa915d1590de3d7547". You have to remove (or rename) that container to be able to reuse that name.

Run 'docker run --help' for more information
```
Новый контейнер с тем же именем не создаётся. Либо работаем с существующим (`docker start shop-db`), либо удаляем его.

### Шаг 5. Порт занят
Вторая база с другим именем, но тем же портом сервера:
```bash
docker run -d --name test-db -e POSTGRES_PASSWORD=shop -p 55432:5432 postgres:16
```
Результат:
```
88e1d725bddc391c7011faf62d59b52fd45dcaab5c2cdd68827597991aee3501
docker: Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint test-db (6f7f82c5fc790b7099df6117057aa2c773fbf401cbb1e6e0694fdb3a24bc39da): Bind for 0.0.0.0:55432 failed: port is already allocated

Run 'docker run --help' for more information
```
Порт сервера 55432 уже отдан `shop-db`. Обратите внимание: ID напечатан — контейнер `test-db` **создан**, но не запущен (статус `Created`). Его нужно удалить (`docker rm test-db`) и запустить снова с другим портом хоста: `-p 55433:5432`. Порт внутри контейнера у обоих может быть 5432 — у каждого контейнера своя сеть.

### Шаг 6. Разовая команда
Для одной команды — `--rm` и команда после образа:
```bash
docker run --rm python:3.12-slim python -c "print(2490 * 2)"
```
Результат:
```
4980
```
Python выполнил код, главный процесс завершился — контейнер остановился и сразу удалился.

## Частые ошибки
- **Забыть `-d`.** Терминал занят выводом контейнера, а Ctrl+C останавливает базу. Сервисы запускают с `-d`.
- **Перепутать порядок в `-p`.** `-p 5432:55432` — порт 5432 сервера ведёт на порт 55432 контейнера, где никто не слушает. Порядок — **хост:контейнер**.
- **Без `-p`.** Контейнер работает, но с сервера к нему не подключиться — `Connection refused`.
- **Без обязательных переменных.** `postgres` без `POSTGRES_PASSWORD` сразу завершается. Что нужно образу — на его странице на Docker Hub.
- **Флаги после имени образа.** `docker run postgres:16 -d` — `-d` уйдёт как аргумент в команду контейнера. Флаги Docker — **до** образа.
- **Оставлять упавшие контейнеры.** После ошибки контейнер остаётся (`Exited` или `Created`) и держит имя. Удаляйте или используйте `--rm` для разовых запусков.
- **Пароль в истории терминала.** `-e POSTGRES_PASSWORD=…` виден в истории и в `docker inspect`. Для учёбы допустимо, для сервера — `--env-file` (раздел 2).

## Итог
**Команда**
- `docker run [флаги] образ [команда]`; флаги — до образа.

**Флаги**
- `-d` — в фоне; `--name` — имя; `-p хост:контейнер` — порт; `-e` — переменная; `--rm` — удалить после; `-it` — интерактивно.

**Проверка**
- `docker ps` — что запущено и какие порты; `docker logs` — журнал.

**Ошибки**
- Имя занято, порт занят, нет обязательной переменной — контейнер остаётся, его удаляют.

## Вопросы на собеседовании
<details><summary>Что делает `-p 8080:80`?</summary>

Публикует порт: подключения к порту 8080 хоста Docker перенаправляет на порт 80 внутри контейнера. Первым идёт порт хоста, вторым — контейнера. Без публикации порт контейнера доступен только из его сети, но не снаружи.
</details>

<details><summary>Чем `docker run` отличается от `docker start`?</summary>

`docker run` создаёт **новый** контейнер из образа и запускает его (и скачивает образ, если его нет). `docker start` запускает **существующий** остановленный контейнер с теми же настройками и данными его слоя.
</details>

<details><summary>Когда контейнер останавливается сам?</summary>

Когда завершается его главный процесс (PID 1): закончилась команда, упало приложение, нет обязательной настройки. Поэтому `docker run python:3.12-slim python --version` сразу завершается, а контейнер с PostgreSQL работает, пока работает сервер базы.
</details>

## Глубже
Как смотреть журналы, заходить внутрь контейнера, останавливать и удалять — следующая тема. Как не потерять данные базы при удалении контейнера — раздел 2, «Тома».
