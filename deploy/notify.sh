#!/bin/sh
# Сообщение в Telegram по общему стандарту оповещений (docs/notifications.md).
#
#   notify.sh <уровень> <событие> < тело
#
# Уровень: ok | fail | down | warn | up | info. Тело — строки «Ключ: значение»
# (HTML Telegram: <b>, <i>, <a>, <code>; & < > в данных экранирует esc()).
# Шапку (значок, название сайта, событие, домен) и подвал (ссылки, время МСК)
# скрипт добавляет сам. Нужны TG_TOKEN и TG_CHAT_ID; SITE_NAME и SITE_URL —
# по умолчанию STACKFLOW и https://stack-flow.ru; LINKS — строка ссылок подвала.
set -u

LEVEL="${1:?уровень: ok | fail | down | warn | up | info}"
EVENT="${2:?событие, например «Деплой завершён»}"
SITE_NAME="${SITE_NAME:-STACKFLOW}"
SITE_URL="${SITE_URL:-https://stack-flow.ru}"

case "$LEVEL" in
    ok) icon='✅' ;; fail) icon='❌' ;; down) icon='🔴' ;;
    warn) icon='⚠️' ;; up) icon='🟢' ;; *) icon='ℹ️' ;;
esac

body=$(cat)
links="${LINKS:-<a href=\"$SITE_URL\">Открыть сайт</a>}"
now=$(TZ=Europe/Moscow date '+%d.%m.%Y %H:%M')

text="$icon <b>$SITE_NAME</b> · $EVENT
<code>${SITE_URL#https://}</code>

$body

$links
<i>$now МСК</i>"

# Telegram из России иногда рвёт соединение — три попытки
for _ in 1 2 3; do
    curl -s -f --max-time 20 -o /dev/null "https://api.telegram.org/bot$TG_TOKEN/sendMessage" \
        --data-urlencode "chat_id=$TG_CHAT_ID" --data-urlencode "text=$text" \
        --data-urlencode "parse_mode=HTML" --data-urlencode "disable_web_page_preview=true" \
        && exit 0
    sleep 10
done
echo "notify.sh: Telegram не ответил" >&2
exit 1
