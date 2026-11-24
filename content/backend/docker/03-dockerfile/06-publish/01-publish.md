---
title: "Публикация образа"
type: lesson
level: 2
reading_time: 12
---

## Теория
Образ магазина собран на ноутбуке. Чтобы запустить его на сервере, можно скопировать туда код и собрать образ ещё раз — но тогда на сервере нужны исходники, интернет для `pip install` и минуты сборки, а главное, образ на сервере может получиться другим. Правильный путь: собрать **один раз** (на ноутбуке или в CI), положить в **реестр**, а сервер только скачивает готовое.

**Реестр** (registry) — хранилище образов, как GitHub для кода:
- **Docker Hub** (`docker.io`) — основной публичный; бесплатно — публичные образы и ограниченное число скачиваний;
- **GitHub Container Registry** (`ghcr.io`) — рядом с репозиторием, удобно из GitHub Actions; можно приватно;
- облачные (Yandex Container Registry и др.) и свой (`registry:2`).

Куда отправить образ, Docker понимает **по его имени**: `ghcr.io/shop/web:1.4.2` — реестр `ghcr.io`, репозиторий `shop/web`, тег `1.4.2`. Имя без реестра (`shop-web:1.0`) означает Docker Hub. Поэтому перед отправкой образу дают полное имя командой `docker tag` (тема 1.04).

Команды:
- **`docker login реестр`** — войти (для GHCR — токен GitHub с правом `write:packages`). Данные сохраняются в `~/.docker/config.json`. Пароль передают через `--password-stdin`, а не в командной строке;
- **`docker push имя:тег`** — отправить. Уходят только слои, которых в реестре ещё нет;
- **`docker pull имя:тег`** — скачать (на сервере). Скачиваются только недостающие слои.

**Теги при выпуске.** Каждая версия получает неизменяемый тег — номер версии (`1.4.2`) или короткий хеш коммита (`git-3f9a1c2`). Дополнительно можно двигать `latest`, но сервер запускают по точному тегу: так видно, что именно работает, и легко откатиться на предыдущий.

Docker Hub и GHCR требуют HTTPS. Исключение — реестр на `localhost`: Docker разрешает ему работать по HTTP, поэтому учебный реестр в этой теме запущен локально.

## Наглядно
**Рисунок 1.** Собрать один раз, хранить в реестре, на сервере только скачать.

![Рисунок 1. Ноутбук или CI: docker build -t shop-web:1.4.2, docker tag shop-web:1.4.2 ghcr.io/shop/web:1.4.2, docker push. Реестр ghcr.io хранит shop/web с тегами 1.4.1, 1.4.2 и latest. Сервер: docker pull ghcr.io/shop/web:1.4.2 и docker run — без исходников и без сборки. Откат: docker run ghcr.io/shop/web:1.4.1](img/publish.svg)

**Таблица 1.** Имена образов и реестры.

| Имя | Реестр | Репозиторий | Тег |
|---|---|---|---|
| `postgres:16` | Docker Hub (`docker.io/library`) | `postgres` | `16` |
| `antonshop/web:1.4.2` | Docker Hub | `antonshop/web` | `1.4.2` |
| `ghcr.io/shop/web:1.4.2` | GitHub | `shop/web` | `1.4.2` |
| `localhost:55000/shop/web:1.4.2` | свой, на этом сервере | `shop/web` | `1.4.2` |

**Таблица 2.** Команды публикации.

| Задача | Команда |
|---|---|
| войти | `echo "$TOKEN" \| docker login ghcr.io -u логин --password-stdin` |
| дать полное имя | `docker tag shop-web:1.4.2 ghcr.io/shop/web:1.4.2` |
| отправить | `docker push ghcr.io/shop/web:1.4.2` |
| скачать на сервере | `docker pull ghcr.io/shop/web:1.4.2` |
| выйти | `docker logout ghcr.io` |

## На практике
Задача: опубликовать образ магазина и запустить его «на сервере» из реестра. Чтобы ничего не отправлять в интернет, реестр запущен локально из официального образа `registry:2` на порту 55000 — команды для Docker Hub и GHCR те же, меняется только адрес. Команды выполнены на Ubuntu 24.04 с Docker Engine 29.

### Шаг 1. Свой реестр
Реестр — тоже контейнер. Его данные — в томе:
```bash
docker run -d --name registry -p 55000:5000 -v registry-data:/var/lib/registry registry:2
```
Результат (строки загрузки образа сокращены):
```
Unable to find image 'registry:2' locally
2: Pulling from library/registry
Status: Downloaded newer image for registry:2
9082a11ee1b0de973a159b223e8887cd68c10001a3e3b9c4634beaa92f18eb46
```
На `localhost` реестр работает без HTTPS и без входа — для учёбы этого достаточно.

### Шаг 2. Полное имя
Образ `shop-web:1.4.2` уже собран. Даём ему имя с адресом реестра — точную версию и `latest`:
```bash
docker tag shop-web:1.4.2 localhost:55000/shop/web:1.4.2
docker tag shop-web:1.4.2 localhost:55000/shop/web:latest
docker images localhost:55000/shop/web
```
Результат:
```
IMAGE                             ID             DISK USAGE   CONTENT SIZE   EXTRA
localhost:55000/shop/web:1.4.2    ee18842e04ec        193MB         47.2MB        
localhost:55000/shop/web:latest   ee18842e04ec        193MB         47.2MB        
```
Один образ (ID тот же) — два имени.

### Шаг 3. Отправка
Отправляем версию, потом `latest`:
```bash
docker push localhost:55000/shop/web:1.4.2
docker push localhost:55000/shop/web:latest
```
Результат (строки слоёв сокращены):
```
The push refers to repository [localhost:55000/shop/web]
44136fa355b3: Pushed
fdf75b184c3f: Pushed
…
1.4.2: digest: sha256:ee18842e04ec75d689a2406b60a9ba98f21179ad65f2ef8d34e56eb93783e186 size: 856
The push refers to repository [localhost:55000/shop/web]
68bced9e0afa: Layer already exists
37fb86c2a767: Layer already exists
…
latest: digest: sha256:ee18842e04ec75d689a2406b60a9ba98f21179ad65f2ef8d34e56eb93783e186 size: 856
```
Первый `push` отправил все слои. Второй не отправил ничего: слои уже в реестре, добавилась только ссылка `latest` на тот же digest. Так и в работе: новая версия магазина отправляет только слой кода, а базовый `python:3.12-slim` и пакеты — один раз.

### Шаг 4. Что в реестре
У реестра есть HTTP API — посмотрим репозитории и теги:
```bash
curl -s localhost:55000/v2/_catalog
curl -s localhost:55000/v2/shop/web/tags/list
```
Результат:
```
{"repositories":["shop/web"]}
{"name":"shop/web","tags":["latest","1.4.2"]}
```

### Шаг 5. «Сервер» скачивает
Удаляем локальные имена, как будто мы на чистом сервере, и скачиваем образ из реестра:
```bash
docker rmi localhost:55000/shop/web:1.4.2 localhost:55000/shop/web:latest
docker pull localhost:55000/shop/web:1.4.2
docker pull localhost:55000/shop/web:9.9.9
```
Результат:
```
Untagged: localhost:55000/shop/web:1.4.2
Untagged: localhost:55000/shop/web:latest
1.4.2: Pulling from shop/web
Digest: sha256:ee18842e04ec75d689a2406b60a9ba98f21179ad65f2ef8d34e56eb93783e186
Status: Downloaded newer image for localhost:55000/shop/web:1.4.2
localhost:55000/shop/web:1.4.2
Error response from daemon: failed to resolve reference "localhost:55000/shop/web:9.9.9": localhost:55000/shop/web:9.9.9: not found
```
Строк загрузки слоёв нет: на этой машине они уже лежали, скачался только описатель образа. На настоящем сервере здесь были бы строки `Pull complete`. Несуществующий тег — `not found`.

### Шаг 6. Запуск из реестра
Запускаем скачанный образ:
```bash
docker run -d --name shop-web -p 58000:8000 localhost:55000/shop/web:1.4.2
curl -s localhost:58000
```
Результат:
```
78a32a475686da3f869ec5db6681fa37d147f2d6f561769180cc464fd9af7937
Магазин работает
```
На «сервере» не понадобились ни код, ни `pip install`, ни Dockerfile — только образ. Для Docker Hub или GHCR всё то же самое: `docker login`, `tag` с адресом реестра, `push`; на сервере — `login` (для приватных), `pull`, `run`.

## Частые ошибки
- **`push` без адреса реестра.** `docker push shop-web:1.4.2` пытается отправить в Docker Hub в чужое пространство имён — `denied: requested access to the resource is denied`. Сначала `docker tag` с реестром и вашим логином или организацией.
- **Не вошли в реестр.** `push` — `unauthorized` или `denied`. `docker login реестр` (для GHCR — токен с `write:packages`).
- **Пароль в командной строке.** `docker login -p пароль` попадает в историю терминала. Передавайте через `--password-stdin`.
- **Только `latest`.** На сервере неясно, какая версия работает, а откатиться некуда. Каждому выпуску — свой неизменяемый тег.
- **Перезаписывать тег версии.** Новая сборка под старым `1.4.2` — на разных серверах «одна» версия с разным кодом. Новый код — новый тег.
- **Секреты в публикуемом образе.** Всё в образе получит каждый, у кого есть доступ к реестру (тема 3.03): `.env` — в `.dockerignore`, секреты — при запуске.
- **Собирать на сервере.** Исходники, интернет и минуты простоя при каждом деплое, а образ может отличаться от проверенного. Собирают в CI, сервер только скачивает.

## Итог
**Зачем**
- Собрать один раз, хранить в реестре, на сервере только `pull` и `run`.

**Как**
- Имя с адресом реестра: `docker tag … ghcr.io/владелец/репо:тег`; `docker login` (`--password-stdin`); `docker push`; на сервере `docker pull`.
- Отправляются и скачиваются только недостающие слои.

**Теги**
- Неизменяемая версия (`1.4.2`, хеш коммита) на каждый выпуск; сервер запускают по точному тегу — легко откатиться.

## Вопросы на собеседовании
<details><summary>Как доставить Docker-образ на сервер?</summary>

Собрать в CI или локально, дать имя с адресом реестра (`docker tag`), отправить `docker push`; на сервере выполнить `docker login` (для приватного реестра), `docker pull` и перезапустить контейнер с новым тегом. Альтернатива без реестра — `docker save`/`docker load` архивом, но она неудобна и не умеет докачивать только изменённые слои.
</details>

<details><summary>Почему на сервере не стоит собирать образ?</summary>

Серверу тогда нужны исходники, доступ к пакетным репозиториям и ресурсы на сборку; деплой идёт дольше, а образ может отличаться от проверенного в CI (другие версии пакетов). Готовый образ из реестра — тот же самый байт в байт, и откат — это запуск предыдущего тега.
</details>

<details><summary>Зачем нужен digest, если есть тег?</summary>

Тег — изменяемая ссылка: его можно перенести на другой образ. Digest (`sha256:…`) — отпечаток содержимого, он однозначно указывает на конкретный образ. `docker pull имя@sha256:…` гарантирует, что скачается ровно то, что проверяли.
</details>

## Глубже
Как публиковать образ автоматически при каждом пуше в `main` — GitHub Actions в курсе «Nginx и деплой». Как запускать магазин из нескольких контейнеров одной командой — следующий раздел, «Docker Compose».
