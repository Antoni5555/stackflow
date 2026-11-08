#!/bin/sh
# Резервная копия базы: pg_dump в ~/backups, хранятся последние KEEP копий.
#
#   sh backup.sh
#
# Запускается на сервере из папки с docker-compose.yml и .env — cron пользователя
# deploy раз в день (docs/deploy.md). Копии с сервера забирает к себе ПК автора.
set -eu

BACKUP_DIR="$HOME/backups"
KEEP=7

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
file="$BACKUP_DIR/stackflow-$(date -u +%Y-%m-%d_%H%M).dump"

# Сначала во временный файл: оборванная копия не выдаст себя за готовую
# -Fc — сжатый формат pg_restore: можно восстановить всё или отдельные таблицы
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
    > "$file.part"
mv "$file.part" "$file"
chmod 600 "$file"

# Старые копии — прочь (имена сортируются по дате)
ls -1 "$BACKUP_DIR"/stackflow-*.dump | head -n -"$KEEP" | xargs -r rm --

echo "==> Копия: $file ($(du -h "$file" | cut -f1))"
