---
title: "Compose для разработки"
type: lesson
level: 3
reading_time: 11
---

## Теория
В разработке каждая правка шаблона или view через `docker compose up -d --build` — это пересборка образа и пересоздание контейнера. Даже с кэшем слоёв это секунды ожидания на каждую строку. А на сервере, наоборот, никаких перезагрузок кода и папок с ноутбука быть не должно. Нужно, чтобы один проект запускался по-разному: удобно для разработки и строго для боя.

**Код через bind mount.** В разработке папку с кодом монтируют в контейнер поверх кода из образа (тема 2.01): `volumes: ["./shop:/app/shop"]`. Правка файла на ноутбуке сразу видна внутри. Остаётся, чтобы сервер её подхватил:
- Django `runserver` перезапускается при изменении файлов сам;
- Gunicorn — с флагом `--reload`.

**Override-файл.** Compose читает `compose.yaml` и, если рядом есть, **`compose.override.yaml`** — и **сливает** их: ключи из override дополняют или заменяют ключи основного файла. Удобное разделение:
- `compose.yaml` — общее и боевое: образы, сеть, тома базы, healthcheck;
- `compose.override.yaml` — только разработка: bind mount кода, `--reload` или `runserver`, `DEBUG=True`, открытые порты для отладки. Сам подхватывается на ноутбуке;
- на сервере его нет (или его не кладут) — либо явно указывают файлы: `docker compose -f compose.yaml -f compose.prod.yaml up -d`. С `-f` override сам **не** подхватывается.

Как сливаются ключи: словари (`environment`) объединяются, значения (`image`, `command`) заменяются, списки `ports` и `volumes` складываются.

**Профили** — сервисы, которые нужны не всегда: инструменты (`pgadmin`, `mailpit`), тестовый прогон, загрузка демо-данных. Сервис с `profiles: ["tools"]` при обычном `docker compose up` **не запускается**; включают его так: `docker compose --profile tools up -d`.

## Наглядно
**Рисунок 1.** compose.yaml + compose.override.yaml на ноутбуке; только compose.yaml — на сервере.

![Рисунок 1. compose.yaml: web — build ., ports 58000:8000, команда gunicorn из образа; tools — профиль tools. compose.override.yaml: web — command gunicorn --reload, volumes ./shop:/app/shop. На ноутбуке docker compose up сливает оба файла: правка shop/wsgi.py на диске → Worker reloading → новая версия без пересборки. На сервере docker compose -f compose.yaml up: код только из образа, без reload. Сервис tools запускается только с --profile tools](img/dev.svg)

**Таблица 1.** Что куда.

| Настройка | `compose.yaml` | `compose.override.yaml` (разработка) |
|---|---|---|
| образ, сборка | `build: .`, `image:` | — |
| код | из образа | `volumes: ["./shop:/app/shop"]` |
| сервер | `gunicorn` | `gunicorn --reload` или `runserver` |
| `DEBUG` | `False` | `True` |
| порт базы наружу | нет | `"127.0.0.1:55432:5432"` для отладки |
| инструменты | `profiles: ["tools"]` | — |

**Таблица 2.** Команды.

| Задача | Команда |
|---|---|
| запуск с override (сам) | `docker compose up -d` |
| только основной файл | `docker compose -f compose.yaml up -d` |
| основной + боевой | `docker compose -f compose.yaml -f compose.prod.yaml up -d` |
| что получилось после слияния | `docker compose config` |
| включить профиль | `docker compose --profile tools up -d` |

## На практике
Задача: править код магазина без пересборки образа и держать вспомогательный сервис, который не запускается по умолчанию. Команды выполнены на Ubuntu 24.04 с Docker Engine 29 и Compose v2 (имена в выводе заменены на учебные).

### Шаг 1. Два файла
Файл `compose.yaml` — общий. `tools` — вспомогательный контейнер, вместо него в проекте был бы pgAdmin или Mailpit:
```yaml
services:
  web:
    build: .
    ports:
      - "58000:8000"
  tools:
    image: alpine:3
    command: ["sleep", "3600"]
    profiles: ["tools"]
```
Файл `compose.override.yaml` — для разработки:
```yaml
services:
  web:
    command: ["gunicorn", "--bind", "0.0.0.0:8000", "--reload", "shop.wsgi"]
    volumes:
      - ./shop:/app/shop
```

### Шаг 2. Что получилось после слияния
Итоговая конфигурация `web`:
```bash
docker compose config
```
Результат:
```
name: shop
services:
  web:
    command:
      - gunicorn
      - --bind
      - 0.0.0.0:8000
      - --reload
      - shop.wsgi
    networks:
      default: null
    volumes:
      - type: bind
        source: /home/shop/shop/shop
        target: /app/shop
        bind: {}
    build:
      context: /home/shop/shop
      dockerfile: Dockerfile
    ports:
      - mode: ingress
        target: 8000
        published: "58000"
        protocol: tcp
networks:
  default:
    name: shop_default
```
`command` и `volumes` пришли из override, `build` и `ports` — из основного файла. Сервиса `tools` в выводе нет — его профиль не включён.

### Шаг 3. Правка без пересборки
Запускаем, правим `shop/wsgi.py` на диске и снова спрашиваем магазин:
```bash
docker compose up -d --build
curl -s localhost:58000
sed -i 's/Магазин работает/Магазин работает — новая версия/' shop/wsgi.py
curl -s localhost:58000
docker compose logs web
```
Результат (строки запуска контейнера сокращены):
```
Магазин работает
Магазин работает — новая версия
web-1  | [2026-11-25 04:47:03 +0000] [1] [INFO] Starting gunicorn 23.0.0
web-1  | [2026-11-25 04:47:03 +0000] [1] [INFO] Listening at: http://0.0.0.0:8000 (1)
web-1  | [2026-11-25 04:47:03 +0000] [1] [INFO] Using worker: sync
web-1  | [2026-11-25 04:47:03 +0000] [7] [INFO] Booting worker with pid: 7
web-1  | [2026-11-25 04:47:06 +0000] [7] [INFO] Worker reloading: /app/shop/wsgi.py modified
web-1  | [2026-11-25 04:47:06 +0000] [7] [INFO] Worker exiting (pid: 7)
web-1  | [2026-11-25 04:47:06 +0000] [9] [INFO] Booting worker with pid: 9
```
Файл на ноутбуке поменялся — Gunicorn увидел это через bind mount и перезапустил воркер. Образ не пересобирался.

### Шаг 4. Профиль
Включаем профиль `tools`:
```bash
docker compose --profile tools up -d
docker compose ps
```
Результат:
```
 Container shop-web-1 Running 
 Container shop-tools-1 Creating 
 Container shop-tools-1 Created 
 Container shop-tools-1 Starting 
 Container shop-tools-1 Started 
NAME           IMAGE      COMMAND                  SERVICE   CREATED                  STATUS                  PORTS
shop-tools-1   alpine:3   "sleep 3600"             tools     Less than a second ago   Up Less than a second   
shop-web-1     shop-web   "gunicorn --bind 0.0…"   web       6 seconds ago            Up 5 seconds            0.0.0.0:58000->8000/tcp, [::]:58000->8000/tcp
```
`web` уже работал (`Running`), добавился только `tools`. Остановить вместе с профилем — `docker compose --profile tools down`.

### Шаг 5. Как будет на сервере
Только основной файл, без override:
```bash
docker compose -f compose.yaml config
```
Результат:
```
name: shop
services:
  web:
    networks:
      default: null
    build:
      context: /home/shop/shop
      dockerfile: Dockerfile
    ports:
      - mode: ingress
        target: 8000
        published: "58000"
        protocol: tcp
networks:
  default:
    name: shop_default
```
Ни `--reload`, ни монтирования кода: контейнер работает с кодом из образа и командой из Dockerfile.

## Частые ошибки
- **Override на сервере.** Скопировали всю папку проекта — и в бою `--reload`, `DEBUG=True` и код с диска. На сервере — `-f compose.yaml` (и `compose.prod.yaml`) или не класть override.
- **Ждать override при `-f`.** С `-f compose.yaml -f compose.prod.yaml` файл `compose.override.yaml` не читается — только перечисленные.
- **Монтировать весь проект поверх `/app`.** `./:/app` закрывает и `.venv`, и собранную статику, и установленное в образе (тема 2.01). Монтируйте только папки с кодом.
- **`--reload` в бою.** Лишняя нагрузка и перезапуски от любого изменения файлов. Только для разработки.
- **Забытый профиль при остановке.** `docker compose down` без `--profile tools` удаляет только `web`: контейнер `tools` продолжает работать, а сеть проекта не удаляется — `Network shop_default Resource is still in use`. Останавливайте с тем же профилем.
- **Списки в override.** `ports` и `volumes` складываются: порт из override добавляется к основному, а не заменяет его. Не дублируйте один и тот же порт.

## Итог
**Разработка**
- Код — bind mount папки (`./shop:/app/shop`); сервер с перезагрузкой (`runserver`, `gunicorn --reload`).

**Файлы**
- `compose.override.yaml` сливается с `compose.yaml` автоматически; с `-f` — только перечисленные файлы.
- Словари объединяются, значения заменяются, списки складываются; проверка — `docker compose config`.

**Профили**
- `profiles: ["tools"]` — сервис не запускается по умолчанию; `--profile tools` включает.

## Вопросы на собеседовании
<details><summary>Как в Docker-разработке видеть изменения кода без пересборки образа?</summary>

Смонтировать папку с кодом в контейнер (bind mount) и запустить сервер с автоперезагрузкой: `runserver` в Django или `gunicorn --reload`. Изменения файлов на хосте сразу видны в контейнере, сервер перезагружает код. В боевом образе код копируется при сборке, без монтирования.
</details>

<details><summary>Что такое compose.override.yaml?</summary>

Дополнительный файл, который Compose автоматически объединяет с `compose.yaml`, если запускать без `-f`. В нём держат настройки разработки (монтирование кода, отладочные порты, `DEBUG`), чтобы основной файл оставался близким к боевому. На сервере используют явный набор файлов через `-f`.
</details>

<details><summary>Зачем нужны профили в compose?</summary>

Чтобы держать в одном файле сервисы, которые нужны не всегда: администрирование базы, тестовую почту, тестовый прогон. Сервис с профилем не стартует при обычном `up`, а включается флагом `--profile имя` или переменной `COMPOSE_PROFILES`.
</details>

## Глубже
Как собрать боевой стек магазина — Django, PostgreSQL и Nginx со статикой и миграциями — следующая тема.
