---
title: "Стек магазина"
type: lesson
level: 3
reading_time: 15
---

## Теория
Соберём всё вместе: магазин на Django, база PostgreSQL и Nginx перед ними — как на настоящем сервере. Новых инструкций почти нет, но появляются вопросы устройства.

**Кто за что отвечает:**
- **Nginx** — единственный сервис, открытый наружу (`ports`). Отдаёт статику (CSS, JS, картинки админки) сам, быстро, а остальные запросы пересылает в Django: `proxy_pass http://web:8000` — по имени сервиса;
- **web** — Django под Gunicorn. Порт наружу не публикуется: к нему ходит только Nginx;
- **db** — PostgreSQL с томом и `healthcheck`. Наружу тоже не публикуется.

**Статика через общий том.** Django собирает статику командой `collectstatic` в `STATIC_ROOT`. Делаем это **при сборке образа** (`RUN python manage.py collectstatic --noinput`) — статика лежит в образе. Nginx живёт в другом контейнере и образа Django не видит, поэтому папку статики делают общим именованным томом: у `web` — `static:/app/staticfiles`, у `nginx` — `static:/static:ro`. Пустой именованный том при первом подключении Docker заполняет содержимым образа (`web`), и Nginx видит те же файлы.

**Миграции — отдельным шагом.** Не в `CMD` и не в `RUN`:
- в `RUN` нельзя: при сборке нет базы;
- в `CMD` опасно: при двух экземплярах `web` миграции запустятся дважды одновременно, а неудачная миграция уронит сайт;
- правильно — разовой командой после обновления: **`docker compose run --rm web python manage.py migrate`**. `run` создаёт **отдельный** временный контейнер из того же сервиса (с его образом, переменными и сетью), выполняет команду и удаляет контейнер (`--rm`).

**`restart`** — что делать, если контейнер завершился:
- `no` (по умолчанию) — ничего;
- `on-failure` — перезапустить при коде выхода ≠ 0;
- `unless-stopped` — перезапускать всегда, кроме случая, когда вы остановили его сами (`docker compose stop`). Переживает и перезагрузку сервера (вместе с Docker). Для боевых сервисов — обычный выбор;
- `always` — как `unless-stopped`, но поднимет и остановленный вручную после перезапуска Docker.

**Настройки** — одним файлом `env_file: shop.env` для `db` и `web`: Django читает `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS` через `os.environ`.

## Наглядно
**Рисунок 1.** Стек магазина: снаружи только Nginx, статика через общий том, миграции разовым контейнером.

![Рисунок 1. Запрос на localhost:58080 приходит в nginx. /static/ — nginx отдаёт файлы из тома static. Остальное — proxy_pass в web:8000 (Gunicorn, Django). web подключается к db:5432 (PostgreSQL, том pgdata, healthcheck). Том static: web заполняет его статикой из образа, nginx читает только для чтения. Сбоку: docker compose run --rm web python manage.py migrate — временный контейнер выполняет миграции и удаляется. У всех сервисов restart: unless-stopped](img/stack.svg)

**Таблица 1.** Сервисы стека.

| Сервис | Образ | Наружу | Тома | Особенности |
|---|---|---|---|---|
| `nginx` | `nginx:1.27-alpine` | `58080:80` | `static` (`:ro`), `nginx.conf` | статика сам, остальное — `proxy_pass http://web:8000` |
| `web` | свой, `build: .` | нет | `static` | Gunicorn, `collectstatic` при сборке |
| `db` | `postgres:16` | нет | `pgdata` | `healthcheck`, `web` ждёт `service_healthy` |

**Таблица 2.** `restart`.

| Значение | Перезапуск после падения | После `docker compose stop` и перезагрузки сервера |
|---|---|---|
| `no` | нет | нет |
| `on-failure` | только при коде ≠ 0 | нет |
| `unless-stopped` | да | остаётся остановленным |
| `always` | да | запускается снова |

## На практике
Задача: запустить магазин целиком — с базой, Nginx, статикой админки и миграциями — и убедиться, что упавший контейнер поднимается сам. Проект — минимальный Django 5.2 (настройки читают переменные окружения). Команды выполнены на Ubuntu 24.04 с Docker Engine 29 и Compose v2 (имена в выводе заменены на учебные).

### Шаг 1. Файлы проекта
Хвост Dockerfile — статика собирается при сборке образа:
```dockerfile
COPY . .
RUN python manage.py collectstatic --noinput
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "config.wsgi"]
```
В `settings.py` `STATIC_ROOT = BASE_DIR / "staticfiles"` — это `/app/staticfiles`. Файл `nginx.conf`:
```nginx
server {
    listen 80;

    location /static/ {
        alias /static/;
    }

    location / {
        proxy_pass http://web:8000;
        proxy_set_header Host $host;
    }
}
```
Файл `shop.env` (в `.gitignore`):
```
POSTGRES_PASSWORD=s3cr3t
POSTGRES_DB=shop
DJANGO_SECRET_KEY=change-me-on-server
DJANGO_ALLOWED_HOSTS=localhost
```
Файл `compose.yaml`:
```yaml
services:
  db:
    image: postgres:16
    env_file: shop.env
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      retries: 10
    restart: unless-stopped

  web:
    build: .
    env_file: shop.env
    volumes:
      - static:/app/staticfiles
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  nginx:
    image: nginx:1.27-alpine
    ports:
      - "58080:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - static:/static:ro
    depends_on:
      - web
    restart: unless-stopped

volumes:
  pgdata:
  static:
```
`:ro` — Nginx может только читать: случайно испортить статику или свой конфиг он не сможет.

### Шаг 2. Запуск
Собираем и запускаем, затем смотрим список:
```bash
docker compose up -d --build
docker compose ps
```
Результат (строки создания контейнеров сокращены):
```
 Container shop-db-1 Waiting 
 Container shop-db-1 Healthy 
 Container shop-web-1 Starting 
 Container shop-web-1 Started 
 Container shop-nginx-1 Starting 
 Container shop-nginx-1 Started 
NAME           IMAGE               COMMAND                  SERVICE   CREATED         STATUS                   PORTS
shop-db-1      postgres:16         "docker-entrypoint.s…"   db        6 seconds ago   Up 5 seconds (healthy)   5432/tcp
shop-nginx-1   nginx:1.27-alpine   "/docker-entrypoint.…"   nginx     6 seconds ago   Up 3 seconds             0.0.0.0:58080->80/tcp, [::]:58080->80/tcp
shop-web-1     shop-web            "gunicorn --bind 0.0…"   web       6 seconds ago   Up 3 seconds             
```
Порядок запуска: база → (здорова) → web → nginx. Наружу открыт только Nginx.

### Шаг 3. Ошибка 500 и миграции
Главная страница считает пользователей в базе:
```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:58080/
```
Результат:
```
500
```
База новая и пустая — таблиц Django ещё нет. Выполняем миграции разовым контейнером:
```bash
docker compose run --rm web python manage.py migrate
```
Результат (часть миграций сокращена):
```
 Container shop-db-1 Running 
 Container shop-db-1 Waiting 
 Container shop-db-1 Healthy 
 Container shop-web-run-8812cc9dd704 Creating 
 Container shop-web-run-8812cc9dd704 Created 
Operations to perform:
  Apply all migrations: admin, auth, contenttypes, sessions
Running migrations:
  Applying contenttypes.0001_initial... OK
  Applying auth.0001_initial... OK
  Applying admin.0001_initial... OK
  …
  Applying sessions.0001_initial... OK
```
`run` запустил отдельный контейнер `shop-web-run-…` из образа `web` с теми же переменными и сетью, дождался здоровой базы и удалился после команды. Работающий `shop-web-1` его не заметил. Снова главная страница:
```bash
curl -s localhost:58080/
```
Результат:
```
Магазин работает, пользователей: 0
```

### Шаг 4. Кто отдаёт статику
Заголовки ответа для CSS админки и для самой страницы входа:
```bash
curl -sI localhost:58080/static/admin/css/base.css
curl -sI localhost:58080/admin/login/
```
Результат (часть заголовков сокращена):
```
HTTP/1.1 200 OK
Server: nginx/1.27.5
Content-Type: text/css
Content-Length: 22120
Last-Modified: Wed, 25 Nov 2026 04:51:13 GMT
ETag: "6b066941-5668"
HTTP/1.1 200 OK
Server: nginx/1.27.5
Content-Type: text/html; charset=utf-8
Content-Length: 4165
Cache-Control: max-age=0, no-cache, no-store, must-revalidate, private
X-Content-Type-Options: nosniff
Set-Cookie: csrftoken=K3cHCA9PvjJJiqnn23LlNG39ROdFCwyZ; expires=Wed, 24 Nov 2027 04:51:24 GMT; Max-Age=31449600; Path=/; SameSite=Lax
```
CSS отдал Nginx как файл: `Last-Modified` и `ETag` — от файла в томе (время сборки образа). Страницу входа сгенерировал Django: у неё `csrftoken` и заголовки безопасности. `Server: nginx` у обоих — Nginx стоит перед всем.

### Шаг 5. Упал — поднялся
Убиваем главный процесс web, как при падении, и смотрим:
```bash
docker compose exec web sh -c "kill 1"
docker compose ps
docker inspect -f '{{.RestartCount}}' shop-web-1
```
Результат:
```
NAME           IMAGE               COMMAND                  SERVICE   CREATED          STATUS                    PORTS
shop-db-1      postgres:16         "docker-entrypoint.s…"   db        11 seconds ago   Up 10 seconds (healthy)   5432/tcp
shop-nginx-1   nginx:1.27-alpine   "/docker-entrypoint.…"   nginx     11 seconds ago   Up 7 seconds              0.0.0.0:58080->80/tcp, [::]:58080->80/tcp
shop-web-1     shop-web            "gunicorn --bind 0.0…"   web       11 seconds ago   Up 2 seconds              
1
```
`web` работает снова («Up 2 seconds» при возрасте 11 секунд), `RestartCount` — 1. А после ручной остановки (`docker compose stop web`) он остаётся `Exited (0)` — именно этим `unless-stopped` отличается от `always`.

## Частые ошибки
- **Миграции в `RUN` или `CMD`.** При сборке нет базы; в `CMD` несколько экземпляров мигрируют одновременно. Отдельный шаг: `docker compose run --rm web python manage.py migrate`.
- **Старая статика после обновления.** Именованный том заполняется из образа только **пустым**. Новая версия с новыми CSS — а в томе старые файлы. Варианты: удалять том `static` при деплое, выполнять `collectstatic` в том после запуска (`docker compose run --rm web python manage.py collectstatic --noinput`) или класть статику в образ Nginx.
- **`proxy_pass http://localhost:8000`.** Внутри контейнера Nginx это он сам — `502 Bad Gateway`. Имя сервиса: `http://web:8000`.
- **Порты web и db наружу.** Лишние точки входа для атак. Наружу — только Nginx.
- **`DEBUG=True` в бою.** Страница ошибки показывает настройки и код. В `shop.env` сервера — без `DJANGO_DEBUG=True`.
- **`ALLOWED_HOSTS` без вашего домена.** `400 Bad Request` на каждый запрос. `DJANGO_ALLOWED_HOSTS=shop.example,localhost`.
- **Без `restart`.** Упавший ночью Gunicorn не поднимется до утра. Для боевых сервисов — `unless-stopped`.

## Итог
**Устройство**
- Наружу только Nginx: статика сам, остальное `proxy_pass http://web:8000`; web и db без `ports`.
- Статика — `collectstatic` при сборке и общий том `static` (у Nginx `:ro`).

**Порядок**
- db (`healthcheck`) → web (`service_healthy`) → nginx.
- Миграции — `docker compose run --rm web python manage.py migrate` после обновления.

**Надёжность**
- `restart: unless-stopped` — поднимает упавшие контейнеры и после перезагрузки сервера.

## Вопросы на собеседовании
<details><summary>Зачем Nginx перед Django в Docker?</summary>

Nginx быстро отдаёт статику и медиа, держит медленных клиентов (буферизует запросы и ответы), завершает HTTPS, ограничивает размер запросов и частоту, и через него наружу открыт один порт. Gunicorn остаётся внутри Docker-сети и обрабатывает только динамические запросы.
</details>

<details><summary>Как и когда запускать миграции Django в Docker?</summary>

Отдельной разовой командой при деплое, после обновления образа и до или сразу после перезапуска приложения: `docker compose run --rm web python manage.py migrate` (или отдельным сервисом с `service_completed_successfully`). Не при сборке (нет базы) и не в команде запуска каждого экземпляра (одновременные миграции, падение сайта при ошибке).
</details>

<details><summary>Чем `docker compose run` отличается от `exec`?</summary>

`exec` выполняет команду в уже работающем контейнере сервиса. `run` создаёт новый контейнер из конфигурации сервиса (образ, переменные, тома, сеть), выполняет команду и с `--rm` удаляет его. Для миграций и разовых задач удобнее `run`: он не зависит от состояния работающего приложения.
</details>

<details><summary>Чем `restart: unless-stopped` отличается от `always`?</summary>

Оба перезапускают упавший контейнер и запускают его после перезагрузки Docker. Разница — в остановленном вручную: `unless-stopped` оставит его остановленным, `always` после перезапуска Docker запустит снова.
</details>

## Глубже
HTTPS, домен, сжатие и кэширование в Nginx, бэкапы базы и автоматический деплой — курс «Nginx и деплой». Как следить за местом, которое Docker занимает на сервере, — следующая тема, «Обслуживание».
