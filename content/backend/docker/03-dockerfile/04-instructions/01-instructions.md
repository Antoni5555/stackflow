---
title: "CMD, ENTRYPOINT, ARG, ENV"
type: lesson
level: 2
reading_time: 13
---

## Теория
Образ из темы 3.01 работает, но есть мелочи, которые на сервере превращаются в проблемы: контейнер останавливается 10 секунд вместо доли секунды, логи приложения не видны в `docker logs`, перед запуском нужно выполнить подготовку, а версию сборки хочется передать снаружи. Это всё — про инструкции `CMD`, `ENTRYPOINT`, `ENV`, `ARG` и `EXPOSE`.

**Две формы `CMD`** (и `ENTRYPOINT`):
- **exec-форма** — список: `CMD ["gunicorn", "--bind", "0.0.0.0:8000", "shop.wsgi"]`. Программа запускается напрямую и становится главным процессом контейнера (PID 1);
- **shell-форма** — строка: `CMD gunicorn --bind 0.0.0.0:8000 shop.wsgi`. Docker запускает `/bin/sh -c "…"`, и главным процессом становится `sh`, а не Gunicorn. `docker stop` посылает сигнал TERM главному процессу — `sh` его не передаёт дальше, и через 10 секунд Docker убивает всё сигналом KILL (код `137`). Gunicorn не успевает корректно завершить запросы.

Используйте exec-форму. Если нужны переменные окружения в команде (`$PORT`), их подставляет приложение или скрипт входа (ниже).

**`ENTRYPOINT`** — программа, которая запускается **всегда**, а `CMD` становится её аргументами:
- `ENTRYPOINT ["/app/entrypoint.sh"]` + `CMD ["gunicorn", …]` → контейнер выполняет `entrypoint.sh gunicorn …`;
- `docker run образ python manage.py migrate` заменяет только `CMD`: выполнится `entrypoint.sh python manage.py migrate`;
- скрипт входа делает подготовку (проверить переменные, дождаться базы) и в конце **`exec "$@"`** — заменяет себя командой из `CMD`, чтобы она стала PID 1 и получала сигналы.

**`ENV` и `ARG`**:
- **`ENV ИМЯ=значение`** — переменная окружения **в образе**: есть и при сборке, и в каждом контейнере. Для постоянных настроек: `PYTHONUNBUFFERED=1`, `PYTHONDONTWRITEBYTECODE=1`. Не для секретов (тема 2.02);
- **`ARG ИМЯ=по_умолчанию`** — параметр **только сборки**: `docker build --build-arg ИМЯ=значение`. В контейнере его нет, если не переложить в `ENV`. Для версии сборки, выбора варианта зависимостей.

**`PYTHONUNBUFFERED=1`** — важная для Python настройка. Когда вывод идёт не в терминал, Python копит `print` в буфере и отдаёт пачкой. В контейнере это значит: `docker logs` пуст, пока буфер не заполнится или процесс не завершится. С `PYTHONUNBUFFERED=1` каждая строка уходит сразу.

**`EXPOSE 8000`** — только **пометка**, какой порт слушает приложение. Порт она не открывает: для этого `-p`. `docker ps` покажет `8000/tcp`, а `docker run -P` опубликует все `EXPOSE`-порты на случайные порты сервера.

## Наглядно
**Рисунок 1.** Shell- и exec-форма при `docker stop`; как ENTRYPOINT и CMD складываются в команду.

![Рисунок 1. Shell-форма CMD gunicorn …: PID 1 — /bin/sh -c, сигнал TERM до Gunicorn не доходит, через 10 секунд KILL, Exited (137). Exec-форма CMD ["gunicorn", …]: PID 1 — gunicorn, получает TERM, завершается за 0,25 секунды, Exited (0). Ниже: ENTRYPOINT ["/app/entrypoint.sh"] + CMD ["gunicorn", …] = entrypoint.sh gunicorn …; docker run образ python manage.py migrate заменяет только CMD](img/instructions.svg)

**Таблица 1.** Инструкции.

| Инструкция | Что делает | Когда действует |
|---|---|---|
| `CMD ["prog", "arg"]` | команда по умолчанию, заменяется аргументами `docker run` | запуск |
| `ENTRYPOINT ["prog"]` | программа, которая запускается всегда; `CMD` — её аргументы | запуск |
| `ENV K=v` | переменная окружения в образе | сборка и запуск |
| `ARG K=v` | параметр сборки, `--build-arg K=…` | только сборка |
| `EXPOSE 8000` | пометка о порте, ничего не открывает | документация, `-P` |

**Таблица 2.** Exec- и shell-форма.

| | exec `["gunicorn", "…"]` | shell `gunicorn …` |
|---|---|---|
| PID 1 | сама программа | `/bin/sh -c` |
| `docker stop` | TERM доходит, корректное завершение | TERM не доходит, через 10 с KILL |
| Переменные `$VAR` в команде | не подставляются | подставляет `sh` |
| Рекомендация | да | только если очень нужно, и тогда `exec` внутри строки |

## На практике
Задача: понять, почему контейнер магазина останавливается 10 секунд, сделать скрипт входа, передать версию сборки и увидеть логи воркера. Команды выполнены на Ubuntu 24.04 с Docker Engine 29 (имена образов и контейнеров в выводе заменены на учебные).

### Шаг 1. Кто главный процесс
Два образа магазина: `shop-shell` с `CMD gunicorn --bind 0.0.0.0:8000 shop.wsgi` и `shop-exec` с той же командой в форме списка. Запускаем оба и смотрим, что Docker сделал главным процессом:
```bash
docker inspect -f '{{.Path}} {{.Args}}' shop-shell
docker inspect -f '{{.Path}} {{.Args}}' shop-exec
```
Результат:
```
/bin/sh [-c gunicorn --bind 0.0.0.0:8000 shop.wsgi]
gunicorn [--bind 0.0.0.0:8000 shop.wsgi]
```
В shell-форме PID 1 — `sh`, Gunicorn — его дочерний процесс.

### Шаг 2. docker stop: 10 секунд против четверти
Останавливаем оба (время замерено отдельно) и смотрим статусы:
```bash
docker stop shop-shell
docker stop shop-exec
docker ps -a --format '{{.Names}} {{.Status}}'
```
Результат:
```
shop-shell
shop-exec
shop-exec Exited (0) Less than a second ago
shop-shell Exited (137) Less than a second ago
```
`shop-shell` останавливался 10,2 секунды и завершён по KILL — код 137 (128 + 9). `shop-exec` — 0,25 секунды, штатно. В логе `shop-exec` видно, что Gunicorn получил сигнал:
```bash
docker logs shop-exec
```
Результат:
```
[2026-11-24 14:12:28 +0000] [1] [INFO] Starting gunicorn 23.0.0
[2026-11-24 14:12:28 +0000] [1] [INFO] Listening at: http://0.0.0.0:8000 (1)
[2026-11-24 14:12:28 +0000] [1] [INFO] Using worker: sync
[2026-11-24 14:12:28 +0000] [7] [INFO] Booting worker with pid: 7
[2026-11-24 14:12:40 +0000] [1] [INFO] Handling signal: term
[2026-11-24 14:12:40 +0000] [7] [INFO] Worker exiting (pid: 7)
[2026-11-24 14:12:40 +0000] [1] [INFO] Shutting down: Master
```
При каждом деплое shell-форма добавляла бы 10 секунд простоя и обрывала запросы.

### Шаг 3. Скрипт входа
Файл `entrypoint.sh` (права `+x`): проверка и запуск команды из `CMD`:
```bash
#!/bin/sh
set -e
echo "entrypoint: проверяю окружение, DJANGO_ENV=${DJANGO_ENV:-не задан}"
exec "$@"
```
Хвост Dockerfile — версия сборки как `ARG`, постоянные настройки как `ENV`:
```dockerfile
ARG APP_VERSION=dev
ENV PYTHONUNBUFFERED=1 APP_VERSION=${APP_VERSION}
EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "shop.wsgi"]
```
Собираем с версией и запускаем **другую** команду вместо `CMD`:
```bash
docker build --build-arg APP_VERSION=1.4.2 -t shop-web:1.4.2 .
docker run --rm -e DJANGO_ENV=prod shop-web:1.4.2 python -c "import os; print(os.environ['APP_VERSION'])"
```
Результат (вывод сборки сокращён):
```
entrypoint: проверяю окружение, DJANGO_ENV=prod
1.4.2
```
Скрипт входа отработал, а затем `exec "$@"` выполнил нашу команду вместо Gunicorn. `ARG` попал в образ только потому, что его переложили в `ENV`.

### Шаг 4. EXPOSE и -P
Запуск без `-p` и с `-P`:
```bash
docker run -d --name shop-web shop-web:1.4.2
docker ps --format '{{.Names}} {{.Ports}}'
docker rm -f shop-web
docker run -d --name shop-web -P shop-web:1.4.2
docker port shop-web
```
Результат (ID контейнеров убраны):
```
shop-web 8000/tcp
shop-web
8000/tcp -> 0.0.0.0:32768
8000/tcp -> [::]:32768
```
`EXPOSE` только показал порт `8000/tcp` — снаружи он недоступен. `-P` опубликовал его на случайном порту 32768. В бою порт задают явно: `-p 58000:8000`.

### Шаг 5. Пропавшие логи
Фоновый воркер печатает номер заказа раз в секунду. Запускаем его без `PYTHONUNBUFFERED` и с ним и через 5 секунд смотрим журнал:
```bash
docker run -d --name worker-1 shop-worker
docker logs worker-1
docker run -d --name worker-2 -e PYTHONUNBUFFERED=1 shop-worker
docker logs worker-2
```
Результат (ID контейнеров убраны):
```
обрабатываю заказ 1042
обрабатываю заказ 1043
обрабатываю заказ 1044
```
Первый `docker logs` пуст: строки лежат в буфере Python. Второй показывает всё сразу. Поэтому `ENV PYTHONUNBUFFERED=1` пишут почти в каждый Dockerfile для Python.

## Частые ошибки
- **Shell-форма `CMD`.** `docker stop` ждёт 10 секунд и убивает процесс, запросы обрываются. Пишите список: `CMD ["gunicorn", …]`.
- **Скрипт входа без `exec "$@"`.** `sh entrypoint.sh` остаётся PID 1 — та же проблема с сигналами, а то и команда из `CMD` вовсе не запускается.
- **Ждать `ARG` в контейнере.** После сборки его нет: `os.environ['APP_VERSION']` — `KeyError`. Нужен `ENV APP_VERSION=${APP_VERSION}`.
- **Секрет в `ARG` или `ENV`.** Оба видны в `docker history` и `docker inspect`. Секреты — при запуске.
- **Надеяться на `EXPOSE`.** Он ничего не открывает: без `-p` порт недоступен с сервера.
- **Нет `PYTHONUNBUFFERED=1`.** Логи приложения приходят пачками или теряются при падении — отладка вслепую.
- **`CMD` и `ENTRYPOINT` в shell-форме вместе.** `ENTRYPOINT` в shell-форме игнорирует `CMD` и аргументы `docker run`. Обе — списками.

## Итог
**CMD и ENTRYPOINT**
- Exec-форма (список): программа — PID 1, `docker stop` работает штатно; shell-форма — 10 секунд и KILL.
- `ENTRYPOINT` — всегда, `CMD` — его аргументы по умолчанию; скрипт входа заканчивают `exec "$@"`.

**ENV и ARG**
- `ENV` — в образе и контейнерах; `ARG` — только при сборке (`--build-arg`); не для секретов.
- `PYTHONUNBUFFERED=1` — логи Python сразу в `docker logs`.

**EXPOSE**
- Пометка о порте; открывает `-p` (или `-P` на случайный).

## Вопросы на собеседовании
<details><summary>Чем `CMD` отличается от `ENTRYPOINT`?</summary>

`ENTRYPOINT` задаёт программу, которая выполняется при каждом запуске контейнера, а `CMD` — аргументы по умолчанию (или всю команду, если `ENTRYPOINT` нет). Аргументы `docker run образ …` заменяют `CMD`, а `ENTRYPOINT` меняют только флагом `--entrypoint`. Типичная связка — скрипт входа в `ENTRYPOINT` и команда сервера в `CMD`.
</details>

<details><summary>Почему важна exec-форма CMD?</summary>

В exec-форме программа становится PID 1 и получает сигналы напрямую: `docker stop` посылает TERM, приложение корректно завершается. В shell-форме PID 1 — `/bin/sh -c`, который не передаёт сигналы дочернему процессу; Docker ждёт 10 секунд и убивает контейнер KILL, обрывая запросы.
</details>

<details><summary>Чем `ARG` отличается от `ENV`?</summary>

`ARG` — переменная только этапа сборки, задаётся `--build-arg` и недоступна в работающем контейнере. `ENV` сохраняется в образе и есть в окружении каждого контейнера. Значение `ARG` переносят в контейнер явно: `ENV NAME=${NAME}`. Ни то, ни другое не подходит для секретов — оба видны в метаданных образа.
</details>

<details><summary>Зачем в Python-образах `PYTHONUNBUFFERED=1`?</summary>

Без терминала Python буферизует stdout, и вывод приходит в `docker logs` с задержкой или теряется при падении контейнера. Переменная отключает буферизацию: каждая строка лога сразу уходит в журнал Docker.
</details>

## Глубже
Как уменьшить образ в несколько раз и не запускать приложение от `root` — следующая тема, «Оптимизация образа».
