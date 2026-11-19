#!/bin/sh
# Раз в 10 минут (cron): диск, база и главная страница. О проблеме пишет в Telegram
# один раз, когда она появилась, и ещё раз — когда прошла.
#
#   */10 * * * * sh ~/stackflow/monitor.sh
#
# Токен и чат — из файла с TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID (MONITOR_ENV).
set -u

ENV_FILE="${MONITOR_ENV:-$HOME/contentflow-bot/.env}"
STATE="$HOME/.monitor-state"
DISK_LIMIT="${DISK_LIMIT:-80}"
cd "$(dirname "$0")"

TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
CHAT=$(grep '^TELEGRAM_CHAT_ID=' "$ENV_FILE" | cut -d= -f2-)

problems=""
disk=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$disk" -ge "$DISK_LIMIT" ] && problems="$problems
• диск занят на $disk% (порог $DISK_LIMIT%)"

db=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q db)" 2>/dev/null)
[ "$db" = "healthy" ] || problems="$problems
• база: ${db:-не запущена}"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://stack-flow.ru/)
[ "$code" = "200" ] || problems="$problems
• главная страница отвечает $code"

send() {
    # Telegram с сервера иногда рвёт соединение — три попытки
    for _ in 1 2 3; do
        curl -s --max-time 20 -o /dev/null -f "https://api.telegram.org/bot$TOKEN/sendMessage" \
            --data-urlencode "chat_id=$CHAT" --data-urlencode "text=$1" && return 0
        sleep 10
    done
    return 1
}

if [ -n "$problems" ]; then
    # одно и то же не повторяем; новое сообщение — если набор проблем изменился
    [ "$problems" = "$(cat "$STATE" 2>/dev/null)" ] && exit 0
    send "⚠️ stack-flow.ru:$problems" && printf '%s' "$problems" > "$STATE"
elif [ -s "$STATE" ]; then
    send "✅ stack-flow.ru: всё снова в порядке (диск $disk%)" && : > "$STATE"
fi
