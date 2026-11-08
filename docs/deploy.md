# Деплой

## Как устроено

```
git push в main
  → CI: flake8, pytest
  → CI: сборка образов web и nginx (тег = SHA коммита) → GitHub Container Registry
  → CI: по SSH на сервер: deploy.sh <sha>
        pull → migrate → load_content → up -d (ждём healthcheck)
```

| Файл | Что делает |
|---|---|
| `Dockerfile` | два образа: `web` (Django + Gunicorn) и `nginx` (Nginx + статика той же версии) |
| `deploy/nginx/default.conf.template` | Nginx: HTTPS, редирект с HTTP, статика с долгим кэшем, прокси в Django |
| `docker-compose.prod.yml` | сервисы на сервере: db, redis, web, nginx, certbot |
| `deploy/deploy.sh` | выкатить версию: `sh deploy.sh <sha>` (CI и ручной откат) |
| `deploy/backup.sh` | копия базы в `~/backups` (cron раз в день, см. «Резервные копии») |
| `.env.prod.example` | пример `.env` для сервера |
| `.github/workflows/ci.yml` | job `images` (сборка и отправка образов), job `deploy` |

Главные правила:
- **Деплой только после зелёных тестов**: job `deploy` зависит от `images`, а тот — от `lint` и `tests`.
- **Без `down`**: старые контейнеры работают, пока новые не прошли healthcheck.
- **Миграции и `load_content` — отдельными шагами** перед запуском новой версии. Если они упали, сайт остаётся на старой версии.
- Наружу открыт только Nginx (порты 80 и 443). База и Redis доступны только внутри Docker.

Job `deploy` включается переменной `DEPLOY_ENABLED`; без неё пропускается. Он же копирует на сервер `docker-compose.prod.yml`, `deploy.sh` и `backup.sh`.

## Сервер: один раз

Нужен VPS с Ubuntu 24.04, 2 ГБ RAM (1 ГБ впритык), Docker Engine и домен, направленный на IP сервера (A-запись).

### 1. Пользователь для деплоя и Docker

Под root:

```bash
adduser --disabled-password deploy
usermod -aG docker deploy        # после установки Docker Engine
```

### 2. SSH-ключ для CI

На своём компьютере:

```bash
ssh-keygen -t ed25519 -f deploy_key -C "github-actions" -N ""
```

- Содержимое `deploy_key.pub` → на сервере в `/home/deploy/.ssh/authorized_keys`.
- Содержимое `deploy_key` (приватный) → секрет GitHub `SSH_PRIVATE_KEY` (см. ниже). Потом файл удалить.
- Отпечаток сервера для `SSH_KNOWN_HOSTS`: `ssh-keyscan <IP-сервера>`.

### 3. Папка и `.env`

Под пользователем `deploy`:

```bash
mkdir ~/stackflow && cd ~/stackflow
nano .env       # содержимое — из .env.prod.example, заполнить всё
```

`IMAGE_TAG` — SHA последнего коммита `main`, для которого CI собрал образы (видно во вкладке Actions).

Скопировать с компьютера `docker-compose.prod.yml` (как `docker-compose.yml`) и `deploy/deploy.sh`. При следующих деплоях это делает CI:

```bash
scp docker-compose.prod.yml deploy@<IP>:stackflow/docker-compose.yml
scp deploy/deploy.sh deploy@<IP>:stackflow/deploy.sh
```

### 4. Первый сертификат HTTPS

Nginx не стартует без сертификата, поэтому первый сертификат выпускаем сами, пока порт 80 свободен:

```bash
docker compose run --rm -p 80:80 --entrypoint certbot certbot \
  certonly --standalone -d <домен> -d www.<домен> -m <email> --agree-tos --no-eff-email
```

Один сертификат на оба имени: `www.<домен>` Nginx перенаправляет на `<домен>` (DNS-запись A для `www` — на тот же IP). Дальше сертификат продлевает контейнер `certbot`, а Nginx раз в 12 часов его перечитывает.

Добавить имя в уже выпущенный сертификат (сайт работает, проверка — через Nginx):

```bash
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  --cert-name <домен> --expand -d <домен> -d www.<домен>
docker compose exec nginx nginx -s reload
```

### 5. Первый запуск

Образы в GHCR привязаны к публичному репозиторию, поэтому для скачивания вход не нужен. Если пакет окажется приватным, сначала выполнить `docker login ghcr.io` с личным токеном (`read:packages`).

```bash
sh deploy.sh <IMAGE_TAG>
docker compose exec web python manage.py createsuperuser
```

Проверка: `https://<домен>/health/` → `ok`.

### 6. Включить автодеплой в GitHub

Settings → Secrets and variables → Actions:

| Тип | Имя | Значение |
|---|---|---|
| Secret | `SSH_HOST` | IP сервера |
| Secret | `SSH_USER` | `deploy` |
| Secret | `SSH_PRIVATE_KEY` | приватный ключ из шага 2 |
| Secret | `SSH_KNOWN_HOSTS` | вывод `ssh-keyscan <IP>` |
| Variable | `DEPLOY_ENABLED` | `true` |

Job `deploy` использует environment `production`: в Settings → Environments можно, например, требовать ручное подтверждение каждого деплоя.

## Повседневное

Все команды — на сервере в `~/stackflow`:

```bash
docker compose ps                         # что запущено, healthy ли web
docker compose logs -f web                # логи Django (и письма, пока нет SMTP)
docker compose logs -f nginx
sh deploy.sh <sha-прошлой-версии>         # откат (образы хранятся 7 дней)
```

Откат кода не откатывает миграции. Если новая миграция удалила или переименовала поле, просто откатиться нельзя. Поэтому такие изменения делаем в два релиза: сначала код перестаёт использовать поле, потом миграция.

## Резервные копии

```
сервер, 15:00 МСК: cron → backup.sh → pg_dump → ~/backups (последние 7)
ПК автора, 15:30 МСК: таймер systemd → rsync с сервера → зашифрованный контейнер (LUKS + ext4, последние 30)
```

Копия на том же сервере не спасёт, если пропадёт сам сервер, поэтому вторая — вне его. Если ПК был выключен, таймер забирает копии при следующем включении; на сервере их 7, так что ПК может не включаться неделю.

Включить на сервере (один раз, cron работает в UTC: 12:00 UTC = 15:00 МСК):

```bash
(crontab -l 2>/dev/null; echo '0 12 * * * cd ~/stackflow && sh backup.sh >> ~/backups/backup.log 2>&1') | crontab -
```

Копия — формат `pg_dump -Fc`, в ней персональные данные (email, имена, хеши паролей): хранить только у себя, в git не класть.

### Восстановление

На сервере, из `~/stackflow`, сайт на время останавливаем:

```bash
docker compose stop web nginx
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < ~/backups/stackflow-<дата>.dump
docker compose start web nginx
```

Копию с ПК сначала положить на сервер: `scp <файл>.dump deploy@<IP>:backups/`. Проверить копию, не трогая рабочую базу: восстановить её в отдельную базу (`createdb … restore_check`, `pg_restore -d restore_check`) и посчитать строки.

## Ещё не сделано

- **SMTP — обязательно до открытия сайта**: войти можно только после подтверждения почты письмом. Провайдера выбираем вместе с хостингом; на домене нужны DNS-записи SPF, DKIM и DMARC, иначе письма уйдут в спам. Пока `EMAIL_HOST` пуст, письма пишутся в лог `web`.
- **Хостинг — в России**: 152-ФЗ требует хранить персональные данные граждан РФ на серверах в РФ (так и написано в политике конфиденциальности).
- Реквизиты оператора (`OPERATOR_*` в `.env`) — для страниц политики и согласия.
- HSTS preload — когда будет постоянный домен (сейчас предупреждение `check --deploy` заглушено).
