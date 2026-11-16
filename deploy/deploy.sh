#!/bin/sh
# Выкатывает на сервере версию сайта с тегом <sha> (SHA коммита, образы — в GHCR).
#
#   sh deploy.sh <sha>
#
# Запускается из папки с docker-compose.yml и .env. Его вызывает CI после
# зелёных тестов; вручную — для отката на прошлую версию (docs/deploy.md).
# Без `docker compose down`: старые контейнеры работают, пока новые не готовы.
set -eu

TAG="${1:?укажите тег образа: sh deploy.sh <sha>}"

# Переменная окружения важнее .env: пока всё не прошло успешно,
# в .env остаётся прошлый тег (на нём сайт поднимется после перезагрузки)
export IMAGE_TAG="$TAG"

echo "==> Скачиваю образы $TAG"
docker compose pull web nginx

echo "==> Миграции"
docker compose run --rm web python manage.py migrate --noinput

echo "==> Контент"
docker compose run --rm web python manage.py load_content

echo "==> Запускаю новую версию"
# --wait: ждём, пока healthcheck web не скажет «живо»; иначе — ошибка
docker compose up -d --remove-orphans --wait --wait-timeout 120

# Всё получилось — запоминаем тег
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/" .env

# Старые образы удаляем через 2 дня: деплоев много, за неделю набегает несколько ГБ.
# Откату это не мешает — deploy.sh всё равно скачивает нужную версию из GHCR
echo "==> Удаляю неиспользуемые образы старше 2 дней"
docker image prune -af --filter "until=48h"

echo "==> Готово: $TAG"
