---
title: "Оптимизация образа"
type: lesson
level: 3
reading_time: 14
---

## Теория
Магазину нужен драйвер PostgreSQL `psycopg2`, а он собирается из исходников на C: нужны компилятор `gcc`, заголовки `libc6-dev` и `libpq-dev`. Поставили их в образ — сборка прошла, но образ вырос до полугигабайта, и в нём лежит компилятор, который в работе не нужен и только расширяет возможности взломщика. Плюс приложение работает от `root`. Эта тема — о том, как собрать маленький и безопасный образ.

Что делает образ меньше и безопаснее:
- **`slim`-основа** вместо полного образа (тема 1.04) — минус гигабайт;
- **многоэтапная сборка** (multi-stage) — в одном Dockerfile несколько `FROM`. Первый этап (`FROM … AS build`) ставит компиляторы и собирает зависимости; второй начинается с чистого `slim` и копирует из первого **только результат**: `COPY --from=build /opt/venv /opt/venv`. Всё, что было в первом этапе, в итоговый образ не попадает. Удобно ставить пакеты в виртуальное окружение (`python -m venv /opt/venv`) — тогда результат лежит в одной папке;
- **во втором этапе — только рантайм-библиотеки**: `libpq5` вместо `libpq-dev` и `gcc`;
- **`--no-install-recommends`, `--no-cache-dir`, `rm -rf /var/lib/apt/lists/*`** — без лишних пакетов и кэшей (тема 3.02).

Почему **не `root`**: если в приложении найдут уязвимость, взломщик получит права процесса. От `root` он может менять любые файлы контейнера, а при ошибках настройки Docker — выбраться на сервер. Создаём пользователя (`useradd`) и переключаемся на него инструкцией **`USER app`** — все следующие `RUN`, `CMD` и `docker exec` выполняются от него. Файлы приложения копируют с владельцем: `COPY --chown=app:app . .`.

Ещё две переменные для Python-образа:
- `PYTHONDONTWRITEBYTECODE=1` — не создавать `__pycache__` в контейнере;
- `PYTHONUNBUFFERED=1` — логи сразу в `docker logs` (тема 3.04).

## Наглядно
**Рисунок 1.** Многоэтапная сборка: компилятор остаётся в первом этапе, в итоговый образ попадает только готовое окружение.

![Рисунок 1. Этап build: python:3.12-slim, apt-get install gcc libc6-dev libpq-dev, python -m venv /opt/venv, pip install -r requirements.txt — psycopg2 компилируется. Этап 2: чистый python:3.12-slim, libpq5, useradd app, COPY --from=build /opt/venv, COPY --chown=app:app ., USER app. Справа размеры: python:3.12 — 1,62 ГБ, slim + gcc в одном этапе — 536 МБ, многоэтапный — 205 МБ](img/optimize.svg)

**Таблица 1.** Один и тот же магазин (Gunicorn + psycopg2) — три Dockerfile.

| Вариант | Размер | Компилятор в образе | Пользователь |
|---|---|---|---|
| `FROM python:3.12` | 1,62 ГБ | есть | `root` |
| `FROM python:3.12-slim` + `gcc` в одном этапе | 536 МБ | есть | `root` |
| многоэтапный, `slim`, `USER app` | 205 МБ | нет | `app` |

**Таблица 2.** Приёмы.

| Приём | Что даёт |
|---|---|
| `FROM python:3.12-slim` | основа 179 МБ вместо 1,6 ГБ |
| `FROM … AS build` + `COPY --from=build` | инструменты сборки не попадают в итоговый образ |
| `libpq5` вместо `libpq-dev` во втором этапе | только библиотека для работы, без заголовков |
| `useradd` + `USER app` | приложение не от `root` |
| `COPY --chown=app:app` | файлы принадлежат пользователю приложения |
| `ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1` | без `__pycache__`, логи сразу |

## На практике
Задача: собрать образ магазина с `psycopg2` маленьким и без `root`. Команды выполнены на Ubuntu 24.04 с Docker Engine 29 (имена образов и контейнеров в выводе заменены на учебные).

### Шаг 1. Многоэтапный Dockerfile
Файл `requirements.txt`:
```
gunicorn==23.0.0
psycopg2==2.9.13
```
Файл `Dockerfile`:
```dockerfile
# этап 1: сборка зависимостей
FROM python:3.12-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev libpq-dev && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# этап 2: итоговый образ
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 app
COPY --from=build /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY --chown=app:app . .
USER app
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "shop.wsgi"]
```
`ENV PATH=…` делает `python`, `pip` и `gunicorn` из `/opt/venv` командами по умолчанию — в обоих этапах.

### Шаг 2. Сборка
Собираем многоэтапный образ:
```bash
docker build -t shop-web:multi .
```
Результат (строки загрузки, вывод apt и pip сокращены):
```
#5 [build 1/5] FROM docker.io/library/python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
#5 CACHED

#6 [stage-1 2/5] RUN apt-get update && apt-get install -y --no-install-recommends libpq5 && rm -rf /var/lib/apt/lists/*     && useradd --create-home --uid 1000 app
#6 CACHED

#7 [build 2/5] RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev libpq-dev && rm -rf /var/lib/apt/lists/*
#7 DONE 25.8s

#8 [build 3/5] RUN python -m venv /opt/venv
#8 DONE 3.0s

#9 [build 4/5] COPY requirements.txt .
#9 DONE 0.1s

#10 [build 5/5] RUN pip install --no-cache-dir -r requirements.txt
#10 DONE 25.0s

#11 [stage-1 3/5] COPY --from=build /opt/venv /opt/venv
#11 DONE 0.1s

#12 [stage-1 4/5] WORKDIR /app
#12 DONE 0.0s

#13 [stage-1 5/5] COPY --chown=app:app . .
#13 DONE 0.1s
```
Шаги этапов помечены `build` и `stage-1`; независимые шаги BuildKit выполняет параллельно, поэтому порядок строк перемешан. Компиляция `psycopg2` заняла 25 секунд — на следующих сборках её возьмёт кэш.

### Шаг 3. Размеры трёх вариантов
Для сравнения тот же магазин собран из `python:3.12` и из `slim` с `gcc` в одном этапе:
```bash
docker images shop-web
```
Результат:
```
IMAGE            ID             DISK USAGE   CONTENT SIZE   EXTRA
shop-web:full    6108d8aa02f2       1.62GB          418MB        
shop-web:multi   4ffa58466ef4        205MB         49.6MB        
shop-web:single  4bd0efcc4186        536MB          137MB        
```
Многоэтапный образ в 2,6 раза меньше одноэтапного и в 8 раз меньше полного. Каждый деплой скачивает 50 МБ вместо 418.

### Шаг 4. Что внутри
Компилятор, пользователь и драйвер базы:
```bash
docker run --rm shop-web:single which gcc
docker run --rm shop-web:multi which gcc
docker run --rm shop-web:multi python -c "import psycopg2; print(psycopg2.__version__)"
```
Результат:
```
/usr/bin/gcc
2.9.13 (dt dec pq3 ext lo64)
```
В одноэтапном образе `gcc` есть, в многоэтапном — нет (`which` ничего не нашёл, код 1). При этом скомпилированный `psycopg2` работает: он приехал из первого этапа вместе с `/opt/venv`.

### Шаг 5. Не root
От чьего имени работает контейнер и что ему можно:
```bash
docker run --rm shop-web:single whoami
docker run --rm shop-web:multi sh -c "whoami; id"
docker run --rm shop-web:multi sh -c "touch /etc/hacked"
```
Результат:
```
root
app
uid=1000(app) gid=1000(app) groups=1000(app)
touch: cannot touch '/etc/hacked': Permission denied
```
Приложение работает от `app` и не может менять системные файлы контейнера — права из курса Linux работают и здесь. Магазин при этом отвечает как раньше: `curl localhost:58000` → «Магазин работает».

## Частые ошибки
- **Инструменты сборки в итоговом образе.** `gcc`, `libpq-dev`, `build-essential` — сотни мегабайт и лишние инструменты для взломщика. Собирайте в отдельном этапе.
- **`gcc` с `--no-install-recommends` без `libc6-dev`.** Компиляция падает с `fatal error: stdlib.h: No such file or directory`. Нужны `gcc libc6-dev` (или `build-essential`).
- **`libpq-dev` вместо `libpq5` во втором этапе.** Заголовки не нужны для работы — только библиотека.
- **`COPY --from=build` не того.** Скопировали `/app`, а пакеты лежат в `site-packages` первого этапа — `ModuleNotFoundError`. Ставьте зависимости в `venv` и копируйте его целиком.
- **`USER` до установки пакетов.** `apt-get` и `pip install` в системные папки требуют `root`: `Permission denied`. `USER app` — ближе к концу, после установки.
- **Файлы приложения от `root`.** Приложение не может записать в свою папку (загрузки, `collectstatic`). `COPY --chown=app:app` или `chown` для нужных папок.

## Итог
**Размер**
- `slim`-основа; инструменты сборки — в первом этапе (`FROM … AS build`), в итоговый образ — `COPY --from=build` только результата (`/opt/venv`).
- Во втором этапе — рантайм-библиотеки (`libpq5`), без кэшей apt и pip.

**Безопасность**
- `useradd` + `USER app` ближе к концу; файлы — `COPY --chown`.

**Python**
- `PYTHONUNBUFFERED=1`, `PYTHONDONTWRITEBYTECODE=1`.

## Вопросы на собеседовании
<details><summary>Что такое multi-stage build и зачем он нужен?</summary>

Dockerfile с несколькими `FROM`: каждый начинает новый этап, а итоговым образом становится последний. В ранних этапах ставят компиляторы и собирают зависимости или фронтенд, в последний копируют только результат (`COPY --from=имя_этапа`). Образ получается меньше и без инструментов сборки, а кэш этапов ускоряет пересборку.
</details>

<details><summary>Почему приложение в контейнере не должно работать от root?</summary>

При уязвимости в приложении взломщик получает права процесса. `root` в контейнере может менять любые файлы образа и, при ошибках настройки (смонтированный сокет Docker, привилегированный режим), получить доступ к серверу. Непривилегированный пользователь (`USER app`) сильно ограничивает ущерб.
</details>

<details><summary>Как уменьшить Docker-образ Python-приложения?</summary>

Взять `slim`-основу; ставить пакеты с `--no-install-recommends` и `--no-cache-dir`, чистить списки apt в том же `RUN`; вынести сборку C-расширений в отдельный этап и копировать только `venv`; исключить лишнее `.dockerignore`; не устанавливать dev-зависимости в боевой образ.
</details>

## Глубже
Как доставить собранный образ на сервер через реестр — следующая тема, «Публикация образа». Сканирование образа на уязвимости — `docker scout` и Trivy.
