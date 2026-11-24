---
title: "Первый Dockerfile"
type: lesson
level: 2
reading_time: 13
---

## Теория
Готовые образы — PostgreSQL, Nginx, Redis — берут с Docker Hub. Образа с **кодом магазина** там нет: его нужно собрать самим. Рецепт сборки — текстовый файл **`Dockerfile`** в корне проекта: с какого образа начать, какие файлы положить, что установить и как запускать.

Главные инструкции:
- **`FROM образ`** — с чего начинаем. Для Django — `python:3.12-slim` (тема 1.04). Первая инструкция файла;
- **`WORKDIR /app`** — рабочая папка внутри образа: создаёт её и делает текущей для следующих инструкций и для контейнера;
- **`COPY откуда куда`** — скопировать файлы **с вашего компьютера** (из контекста сборки, см. ниже) в образ. `COPY . .` — всё содержимое папки проекта в текущую папку образа;
- **`RUN команда`** — выполнить команду **при сборке**: установить пакеты (`pip install`, `apt-get install`), собрать статику. Результат сохраняется в образе;
- **`CMD ["программа", "аргумент", …]`** — команда по умолчанию **при запуске** контейнера. В образе она одна (последняя побеждает), и её можно заменить в `docker run образ другая_команда`.

`RUN` и `CMD` путают чаще всего: `RUN` работает один раз, когда образ собирается; `CMD` — каждый раз, когда из образа запускают контейнер.

Сборка — **`docker build -t имя:тег путь`**. Путь (обычно `.`) — **контекст сборки**: папка, содержимое которой Docker отправляет сборщику. `COPY` видит только файлы из контекста — `COPY ../secret.txt` не сработает. Каждая инструкция становится шагом сборки и слоем образа (подробно — следующая тема).

Сервер для Django в образе — не `runserver` (он только для разработки), а **Gunicorn** (курс Django, раздел про деплой). Он должен слушать `0.0.0.0`, а не `127.0.0.1`: иначе запросы, пришедшие в контейнер через проброс порта, до него не дойдут.

## Наглядно
**Рисунок 1.** Dockerfile превращается в образ, образ — в контейнер.

![Рисунок 1. Слева папка проекта (контекст сборки): Dockerfile, requirements.txt, shop/. docker build -t shop-web:1.0 . выполняет инструкции по очереди: FROM python:3.12-slim, WORKDIR /app, COPY requirements.txt, RUN pip install, COPY . ., CMD gunicorn — получается образ shop-web:1.0 из слоёв. docker run -p 58000:8000 запускает контейнер, в котором выполняется CMD: gunicorn слушает 0.0.0.0:8000](img/dockerfile.svg)

**Таблица 1.** Инструкции первого Dockerfile.

| Инструкция | Когда работает | Что делает |
|---|---|---|
| `FROM python:3.12-slim` | сборка | основа образа |
| `WORKDIR /app` | сборка и запуск | рабочая папка |
| `COPY requirements.txt .` | сборка | файлы из контекста в образ |
| `RUN pip install -r requirements.txt` | сборка | команда, результат сохраняется в образе |
| `CMD ["gunicorn", …]` | запуск | что выполнить при `docker run` |

**Таблица 2.** Команды сборки.

| Задача | Команда |
|---|---|
| собрать образ из текущей папки | `docker build -t shop-web:1.0 .` |
| другой файл рецепта | `docker build -f Dockerfile.prod -t shop-web:1.0 .` |
| собрать без кэша | `docker build --no-cache -t shop-web:1.0 .` |
| из каких шагов образ | `docker history shop-web:1.0` |

## На практике
Задача: упаковать магазин в образ и запустить его. Чтобы не отвлекаться на Django, «магазин» — минимальное WSGI-приложение, которое запускает Gunicorn; с настоящим проектом Django всё точно так же. Команды выполнены на Ubuntu 24.04 с Docker Engine 29 (имена образов и контейнеров в выводе заменены на учебные).

### Шаг 1. Проект
Папка проекта: `Dockerfile`, `requirements.txt` и пакет `shop`. Файл `requirements.txt`:
```
gunicorn==23.0.0
```
Файл `shop/wsgi.py` — то, что в Django генерирует `startproject`, только проще:
```python
def application(environ, start_response):
    start_response("200 OK", [("Content-Type", "text/plain; charset=utf-8")])
    return ["Магазин работает\n".encode()]
```

### Шаг 2. Dockerfile
Рецепт сборки, файл `Dockerfile`:
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "shop.wsgi"]
```
`--no-cache-dir` — не хранить в образе кэш скачанных пакетов: образ меньше. `shop.wsgi` — модуль, где Gunicorn ищет `application`.

### Шаг 3. Сборка
Собираем образ с именем и тегом из текущей папки:
```bash
docker build -t shop-web:1.0 .
```
Результат (служебные строки экспорта сокращены):
```
#0 building with "default" instance using docker driver

#1 [internal] load build definition from Dockerfile
#1 transferring dockerfile: 214B done
#1 DONE 0.0s

#2 [internal] load metadata for docker.io/library/python:3.12-slim
#2 DONE 0.0s

#3 [internal] load .dockerignore
#3 transferring context: 2B done
#3 DONE 0.0s

#4 [internal] load build context
#4 transferring context: 190B done
#4 DONE 0.0s

#5 [1/5] FROM docker.io/library/python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
#5 DONE 0.0s

#6 [2/5] WORKDIR /app
#6 CACHED

#7 [3/5] COPY requirements.txt .
#7 DONE 0.1s

#8 [4/5] RUN pip install --no-cache-dir -r requirements.txt
#8 1.731 Collecting gunicorn==23.0.0 (from -r requirements.txt (line 1))
#8 2.456 Installing collected packages: packaging, gunicorn
#8 2.587 Successfully installed gunicorn-23.0.0 packaging-26.4
#8 DONE 3.0s

#9 [5/5] COPY . .
#9 DONE 0.0s

#10 exporting to image
#10 naming to docker.io/library/shop-web:1.0 done
#10 DONE 0.6s
```
Сначала Docker прочитал Dockerfile и отправил контекст (190 байт — наши файлы), потом выполнил пять шагов `[1/5]`…`[5/5]`. `pip install` реально скачал пакеты — внутри сборки есть сеть. В терминале тот же вывод выглядит компактнее: строки шагов обновляются на месте.

### Шаг 4. Образ и запуск
Размер образа и запуск контейнера с пробросом порта:
```bash
docker images shop-web
docker run -d --name shop-web -p 58000:8000 shop-web:1.0
curl -s localhost:58000
```
Результат:
```
IMAGE          ID             DISK USAGE   CONTENT SIZE   EXTRA
shop-web:1.0   18de9cf1311b        193MB         47.2MB        
d76cbe931aa6640a8442cf22edb7ce387a613613be24a58fdfd15b308d3d54ea
Магазин работает
```
Образ — 193 МБ: 179 МБ база `python:3.12-slim`, остальное — Gunicorn и код. Контейнер выполнил `CMD`, и магазин ответил через опубликованный порт.

### Шаг 5. Журнал и история образа
Что делает Gunicorn внутри и из каких шагов состоит образ:
```bash
docker logs shop-web
docker history shop-web:1.0
```
Результат (история базового образа сокращена):
```
[2026-11-24 08:16:59 +0000] [1] [INFO] Starting gunicorn 23.0.0
[2026-11-24 08:16:59 +0000] [1] [INFO] Listening at: http://0.0.0.0:8000 (1)
[2026-11-24 08:16:59 +0000] [1] [INFO] Using worker: sync
[2026-11-24 08:16:59 +0000] [6] [INFO] Booting worker with pid: 6
IMAGE          CREATED         CREATED BY                                      SIZE      COMMENT
18de9cf1311b   4 seconds ago   CMD ["gunicorn" "--bind" "0.0.0.0:8000" "sho…   0B        buildkit.dockerfile.v0
<missing>      4 seconds ago   COPY . . # buildkit                             24.6kB    buildkit.dockerfile.v0
<missing>      15 hours ago    RUN /bin/sh -c pip install --no-cache-dir -r…   11.7MB    buildkit.dockerfile.v0
<missing>      15 hours ago    COPY requirements.txt . # buildkit              12.3kB    buildkit.dockerfile.v0
<missing>      2 weeks ago     WORKDIR /app                                    8.19kB    buildkit.dockerfile.v0
<missing>      2 weeks ago     CMD ["python3"]                                 0B        buildkit.dockerfile.v0
…
```
Gunicorn — главный процесс контейнера (PID 1) и слушает `0.0.0.0:8000`. В истории каждая инструкция — свой слой: `pip install` добавил 11,7 МБ, код — 24,6 КБ, `CMD` — 0 байт (это только настройка). Ниже — шаги, из которых собран сам `python:3.12-slim`; его `CMD ["python3"]` наш `CMD` заменил.

## Частые ошибки
- **`RUN` вместо `CMD`.** `RUN gunicorn …` — сборка зависнет: сервер запустится во время сборки и никогда не закончится. Запуск — `CMD`.
- **`127.0.0.1` вместо `0.0.0.0`.** Gunicorn слушает только внутри контейнера, `curl` с сервера получает обрыв соединения. В контейнере сервер слушает `0.0.0.0`.
- **`runserver` в образе для сервера.** Медленный, однопоточный, не для боя. В образе — Gunicorn (или Uvicorn для ASGI).
- **`COPY` файла вне контекста.** `COPY ../config.ini .` — `failed to compute cache key: … "/config.ini": not found`. Всё нужное — внутри папки, которую передаёте в `docker build`.
- **Нет `WORKDIR`.** Файлы копируются в `/`, вперемешку с системными папками. Задавайте рабочую папку явно.
- **`pip install` без `--no-cache-dir`.** Кэш скачанных пакетов остаётся в образе мёртвым грузом.
- **Забыть `.` в конце `docker build`.** `ERROR: docker: 'docker buildx build' requires 1 argument` — не указан контекст.

## Итог
**Dockerfile**
- `FROM` — основа, `WORKDIR` — папка, `COPY` — файлы из контекста, `RUN` — команда при сборке, `CMD` — команда при запуске.

**Сборка**
- `docker build -t имя:тег .` — точка — контекст: что видит `COPY`.
- Каждая инструкция — шаг и слой; `docker history` показывает их размеры.

**Запуск**
- Сервер в контейнере — Gunicorn на `0.0.0.0`; порт открывают `-p` при `docker run`.

## Вопросы на собеседовании
<details><summary>Чем `RUN` отличается от `CMD`?</summary>

`RUN` выполняется при сборке образа, и его результат (установленные пакеты, созданные файлы) сохраняется в новом слое. `CMD` задаёт команду, которую контейнер выполнит при запуске; при сборке она не выполняется, и её можно переопределить аргументами `docker run`.
</details>

<details><summary>Что такое контекст сборки?</summary>

Папка (или архив), которую `docker build` передаёт сборщику, — обычно `.`. Инструкции `COPY` и `ADD` видят только файлы из контекста. Большой контекст замедляет сборку, а лишние файлы в нём могут попасть в образ — поэтому его ограничивают `.dockerignore`.
</details>

<details><summary>Почему в контейнере сервер должен слушать 0.0.0.0?</summary>

`127.0.0.1` внутри контейнера — интерфейс самого контейнера. Запросы через опубликованный порт приходят на его сетевой интерфейс из Docker-сети, а не на loopback. Сервер, слушающий только `127.0.0.1`, их не увидит. `0.0.0.0` — слушать на всех интерфейсах.
</details>

## Глубже
Почему порядок `COPY requirements.txt` → `pip install` → `COPY . .` экономит минуты при каждой сборке — следующая тема, «Слои и кэш». Как не утащить в образ `.git`, `venv` и `.env` — тема «.dockerignore».
