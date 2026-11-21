---
title: curl
type: lesson
level: 3
reading_time: 11
---

## Теория
**curl** — HTTP-клиент командной строки. Он есть почти на любом сервере, и им проверяют API быстрее всего: работает ли приложение за Nginx, что именно отвечает сервер, какие заголовки пришли. Весь этот курс показывает ответы API через `curl`, теперь разберём его ключи.

Запрос:
- `-X POST` — метод (по умолчанию `GET`, с `-d` — `POST`);
- `-H 'Имя: значение'` — заголовок, можно несколько раз;
- `-d 'данные'` — тело; без своего `Content-Type` curl ставит `application/x-www-form-urlencoded` (раздел «HTTP подробнее», тема «Заголовки» — отсюда был ответ 415);
- `--json '{…}'` — тело JSON, curl сам ставит `Content-Type: application/json` и `Accept: application/json` (curl 7.82 и новее);
- `-F 'поле=значение'`, `-F 'photo=@файл'` — multipart с файлами (тема «Тело запроса»).

Ответ:
- `-i` — показать строку статуса и заголовки ответа вместе с телом;
- `-I` — только заголовки (запрос `HEAD`);
- `-v` — подробно: что ушло (`>`) и что пришло (`<`) — главный инструмент отладки;
- `-L` — идти по редиректам (`301`, `302`; без него curl показывает сам редирект);
- `-o файл` — тело в файл, `-w '%{http_code}'` — напечатать выбранное (код ответа, время).

Для скриптов:
- `-s` — без индикатора загрузки; `-sS` — тихо, но ошибки показывать;
- `-f` — при коде 4xx/5xx вернуть ненулевой **код выхода** (22), чтобы скрипт или CI заметили ошибку;
- `-m 5` — прервать запрос через 5 секунд (код выхода 28).

Ошибка соединения и ошибка HTTP — разные вещи: `curl: (7) Failed to connect` — до сервера не достучались (приложение не запущено, порт не тот), а `404` или `500` — сервер ответил.

Запрос из браузера легко повторить в терминале: в DevTools, вкладка Network, правый клик по запросу → **Copy → Copy as cURL**. Получится команда со всеми заголовками и cookie — её можно сократить и менять по одному параметру.

## Наглядно
**Рисунок 1.** Что показывает `curl -v`: строки `>` ушли на сервер, `<` пришли от него.

![Рисунок 1. curl -v --json на POST /api/v1/cart/items/. Строки с > — запрос: POST /api/v1/cart/items/ HTTP/1.1, Host, User-Agent curl/8.5.0, Content-Type application/json, Accept application/json, Content-Length 29. Строки с < — ответ: HTTP/1.1 201 Created, Content-Type application/json, Location /api/v1/cart/items/9/, Content-Length 58. Затем тело](img/curl-verbose.svg)

**Таблица 1.** Ключи curl.

| Ключ | Что делает | Пример |
|---|---|---|
| `-X` | метод | `-X DELETE` |
| `-H` | заголовок | `-H 'Authorization: Bearer …'` |
| `-d` | тело (по умолчанию форма) | `-d 'q=мышь'` |
| `--json` | тело JSON + заголовки | `--json '{"product": 2}'` |
| `-i` / `-I` | заголовки ответа / только заголовки | `curl -I …` |
| `-v` | весь обмен | `curl -v …` |
| `-L` | идти по редиректам | `curl -L …` |
| `-s` / `-sS` | тихо / тихо, но с ошибками | `curl -sS …` |
| `-f` | код выхода 22 на 4xx/5xx | `curl -f … \|\| echo упало` |
| `-m` | тайм-аут в секундах | `-m 5` |
| `-o` / `-w` | тело в файл / вывести поле | `-o /dev/null -w '%{http_code}'` |

## На практике
Задача: проверить API магазина из терминала — как это делают на сервере после деплоя. Учебный API запущен на `localhost:8000`; в выводе `-i` и `-v` служебные заголовки (`Server`, `Date` и заголовки безопасности) убраны.

### Шаг 1. Тело, заголовки, весь обмен
Только тело:
```
$ curl -s http://localhost:8000/api/v1/products/2/
{"id": 2, "name": "Беспроводная мышь", "price": "1499.00"}
```
Только заголовки — запрос `HEAD`:
```
$ curl -s -I http://localhost:8000/api/v1/products/2/
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 74
```
`Content-Length: 74` при 58 символах тела: длина — в байтах, а кириллица в UTF-8 занимает по 2 байта. Добавление в корзину с `--json` и `-v`:
```
$ curl -s -v -X POST http://localhost:8000/api/v1/cart/items/ --json '{"product": 2, "quantity": 1}'
> POST /api/v1/cart/items/ HTTP/1.1
> Host: localhost:8000
> User-Agent: curl/8.5.0
> Content-Type: application/json
> Accept: application/json
> Content-Length: 29
>
< HTTP/1.1 201 Created
< Content-Type: application/json
< Location: /api/v1/cart/items/9/
< Content-Length: 58
<
{"id": 9, "product": 2, "quantity": 1, "price": "1499.00"}
```
`--json` сам поставил `Content-Type` и `Accept` — `-H` не понадобился.

### Шаг 2. Редирект
Старый адрес каталога:
```
$ curl -s -i http://localhost:8000/api/products/
HTTP/1.1 301 Moved Permanently
Content-Type: text/html; charset=utf-8
Location: /api/v1/products/?page_size=2
Content-Length: 0
```
Без `-L` curl показывает сам редирект, с `-L` — идёт по `Location`:
```
$ curl -s -L http://localhost:8000/api/products/
{"count": 8, "next": "/api/v1/products/?page_size=2&page=2", "previous": null, "results": [{"id": 1, "name": "Ноутбук Air 13", "price": "84990.00"}, {"id": 2, "name": "Беспроводная мышь", "price": "1499.00"}]}
```

### Шаг 3. curl в скриптах
Только код ответа — для проверки после деплоя:
```
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/api/v1/products/
200
```
Несуществующий товар с `-f` — код выхода 22, скрипт узнает об ошибке:
```
$ curl -s -f http://localhost:8000/api/v1/products/99/; echo "код выхода: $?"
код выхода: 22
```
Медленный адрес (отвечает через 3 секунды) с тайм-аутом в 1 секунду:
```
$ curl -sS -m 1 http://localhost:8000/api/v1/slow/; echo "код выхода: $?"
curl: (28) Operation timed out after 1000 milliseconds with 0 bytes received
код выхода: 28
```
Порт, на котором ничего не запущено:
```
$ curl -sS http://localhost:8099/api/v1/products/; echo "код выхода: $?"
curl: (7) Failed to connect to localhost port 8099 after 0 ms: Couldn't connect to server
код выхода: 7
```
Код 7 — до сервера не достучались вообще: проверяют, запущен ли Gunicorn и тот ли порт (курс «Nginx и деплой»). Код 22 — сервер ответил, но ошибкой.

## Частые ошибки
- **`-d` с JSON без заголовка.** Тело уходит как форма — API отвечает 415 или не находит данных. `--json` или `-H 'Content-Type: application/json'`.
- **Одинарные кавычки внутри JSON в bash.** `-d '{'product': 2}'` — кавычки закрывают строку. Снаружи одинарные, внутри двойные: `'{"product": 2}'`.
- **Не видно ошибки в скрипте.** Без `-f` curl на 500 возвращает код выхода 0 — проверка «сайт жив» проходит. `-f` или `-w '%{http_code}'`.
- **Редирект вместо ответа.** Пустое тело и 301 — забыли `-L` или адрес без `/` на конце (Django добавляет его редиректом).
- **`-X GET` с `-d`.** Тело у `GET` серверы обычно игнорируют; параметры — в адрес (`?q=…`) или `-G` с `--data-urlencode`.
- **Токен в истории команд.** `curl -H 'Authorization: Bearer eyJ…'` остаётся в `~/.bash_history`. Токен — в переменной окружения: `-H "Authorization: Bearer $TOKEN"`.

## Итог
**Запрос**
- `-X` метод, `-H` заголовок, `-d` форма, `--json` JSON, `-F` файлы.

**Ответ**
- `-i` заголовки + тело, `-I` только заголовки, `-v` весь обмен, `-L` редиректы.

**Скрипты**
- `-sS`, `-f` (код выхода 22 на ошибку HTTP), `-m` (тайм-аут, код 28), `-w '%{http_code}'`; код 7 — нет соединения.

## Вопросы на собеседовании
<details><summary>Как проверить, что ответ API — именно тот, который ждёт клиент?</summary>

`curl -v` или `curl -i`: видно статус, заголовки (`Content-Type`, `Location`, `Cache-Control`) и тело. Чтобы повторить запрос браузера точно, — «Copy as cURL» в DevTools. Для сравнения с проксей — запрос напрямую к Gunicorn (`curl http://127.0.0.1:8000/…`) и через Nginx.
</details>

<details><summary>Чем отличаются ошибки curl (7) и (28) от ответа 502?</summary>

(7) — curl не смог установить соединение: на порту никто не слушает. (28) — соединение было, но ответ не пришёл за время `-m`. 502 — curl соединился с Nginx и получил ответ, а вот Nginx не смог получить ответ от приложения. Первые два — ошибки сети на стороне клиента, третий — HTTP-ответ сервера.
</details>

<details><summary>Как использовать curl в healthcheck или CI?</summary>

`curl -fsS -m 5 https://shop.example/health/` — тихо, с ошибками в выводе, с тайм-аутом, и с ненулевым кодом выхода на 4xx/5xx и сетевые ошибки. Шаг CI или `HEALTHCHECK` в Dockerfile падает по коду выхода.
</details>

## Глубже
Те же запросы из кода на Python — следующая тема, `httpx`. Проверка сайта после деплоя через `curl` — курс «Nginx и деплой».
