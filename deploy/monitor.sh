#!/bin/sh
# Раз в 10 минут (cron): диск, контейнеры и главная страница. О проблеме пишет
# в Telegram (notify.sh) один раз, когда она появилась, и ещё раз — когда прошла.
#
#   */10 * * * * sh ~/stackflow/monitor.sh >> ~/monitor.log 2>&1
#
# Токен и чат — в ~/.notify.env (TG_TOKEN, TG_CHAT_ID; права 600).
set -u

cd "$(dirname "$0")"
. "${NOTIFY_ENV:-$HOME/.notify.env}"
export TG_TOKEN TG_CHAT_ID
STATE="$HOME/.monitor-state"
DISK_LIMIT="${DISK_LIMIT:-80}"
SITE_URL="${SITE_URL:-https://stack-flow.ru}"

esc() { sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }

# Проблемы — по строке: «down|…» сайт не работает, «warn|…» пока работает
check() {
    disk=$(df --output=pcent / | tail -1 | tr -dc 0-9)
    [ "$disk" -ge "$DISK_LIMIT" ] && echo "warn|Диск занят на $disk % (порог $DISK_LIMIT %)"
    for svc in db web nginx redis; do
        id=$(docker compose ps -q "$svc" 2>/dev/null)
        st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null)
        case "$st" in healthy|running) ;; *) echo "down|Контейнер $svc: ${st:-не запущен}" ;; esac
    done
    res=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 20 "$SITE_URL/")
    [ "${res%% *}" = "200" ] || echo "down|Главная страница: HTTP ${res%% *} (за ${res#* } с)"
}

problems=$(check)
# Перезапуск контейнера при деплое занимает до минуты — тревога, только если не прошло
if [ -n "$problems" ] && [ "$problems" != "$(cat "$STATE" 2>/dev/null)" ]; then
    sleep 90
    problems=$(check)
fi

server_state() {
    df -h --output=pcent,avail,size / | tail -1 | awk '{print "Диск: " $1 " (свободно " $2 " из " $3 ")"}'
    free -m | awk '/^Mem:/ {printf "Память: занято %d из %d МБ\n", $3, $2}'
    echo "Нагрузка: $(cut -d' ' -f1-3 /proc/loadavg) · без перезагрузки $(awk '{print int($1/86400)}' /proc/uptime) дн."
    printf 'Контейнеры: '
    for svc in web nginx db redis; do
        st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
            "$(docker compose ps -q "$svc" 2>/dev/null)" 2>/dev/null)
        case "$st" in healthy|running) printf '%s ✅ ' "$svc" ;; *) printf '%s ❌ ' "$svc" ;; esac
    done
    echo
}

if [ -n "$problems" ]; then
    # одно и то же не повторяем; новое сообщение — если набор проблем изменился
    [ "$problems" = "$(cat "$STATE" 2>/dev/null)" ] && exit 0
    if echo "$problems" | grep -q '^down|'; then level=down; event='Сайт не работает'
    else level=warn; event='Нужно внимание'; fi
    {
        echo '<b>Проблемы</b>'
        echo "$problems" | cut -d'|' -f2- | esc | sed 's/^/• /'
        echo
        echo '<b>Сервер</b>'
        server_state | esc
        echo
        echo 'Проверить: <code>ssh deploy@2.58.127.115</code> → <code>cd ~/stackflow &amp;&amp; docker compose ps</code>'
    } | sh notify.sh "$level" "$event" && { printf '%s' "$problems" > "$STATE"; date +%s > "$STATE.since"; }
elif [ -s "$STATE" ]; then
    since=$(cat "$STATE.since" 2>/dev/null || date +%s)
    mins=$(( ($(date +%s) - since) / 60 ))
    {
        echo '<b>Было</b>'
        cut -d'|' -f2- "$STATE" | esc | sed 's/^/• /'
        echo
        echo "Длительность сбоя: около $mins мин"
        echo
        echo '<b>Сервер</b>'
        server_state | esc
    } | sh notify.sh up 'Снова работает' && { : > "$STATE"; rm -f "$STATE.since"; }
fi
