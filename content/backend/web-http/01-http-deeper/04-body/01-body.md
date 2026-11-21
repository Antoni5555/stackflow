---
title: Тело запроса
type: lesson
level: 2
reading_time: 12
---

## Теория
Данные запроса едут в двух местах: в **URL** (query-параметры `?q=мышь&page=2` — для `GET`, фильтров, поиска) и в **теле** (для `POST`, `PUT`, `PATCH`). Формат тела сообщает заголовок `Content-Type`. В API встречаются три формата:

**`application/json`** — основной формат API. Вложенные объекты, списки, числа, `true`/`false`/`null`:
```
{"product": 2, "quantity": 1, "gift": true}
```
В Django его читают сами: `json.loads(request.body)` (в DRF — `request.data`).

**`application/x-www-form-urlencoded`** — формат HTML-форм: пары `ключ=значение` через `&`, как query-строка. Пробел — `+`, остальные спецсимволы и кириллица — `%XX` в UTF-8. Только строки, без вложенности. Django разбирает его в `request.POST`.

**`multipart/form-data`** — тело из нескольких **частей**, разделённых границей (`boundary`), у каждой части свои заголовки. Так передают **файлы** вместе с обычными полями. В Django — `request.FILES` и `request.POST`.

Выбор простой: данные для API — JSON; файлы — multipart; формы сайта — urlencoded (так их отправляет браузер). Query-параметры — для того, что описывает **выборку** (фильтр, сортировка, страница), а не для данных, которые изменяют ресурс.

Значения в URL и формах кодируют, а не склеивают строкой: `&` внутри значения иначе станет разделителем пар. В Python — `urllib.parse.urlencode`, в `httpx` — параметр `params=` (раздел «HTTP-клиенты»).

## Наглядно
**Рисунок 1.** Одни и те же данные в трёх форматах тела.

![Рисунок 1. JSON: Content-Type application/json, тело {"product": 2, "quantity": 1}. Форма: application/x-www-form-urlencoded, тело product=2&quantity=1. Multipart: multipart/form-data; boundary=…, тело из частей — часть photo с filename и Content-Type image/jpeg, часть alt — разделены строками boundary](img/body-formats.svg)

**Таблица 1.** Форматы тела.

| Формат | `Content-Type` | Типы данных | В Django | Когда |
|---|---|---|---|---|
| JSON | `application/json` | числа, строки, списки, объекты, `null` | `json.loads(request.body)` | API |
| форма | `application/x-www-form-urlencoded` | только строки, повторяющиеся ключи | `request.POST` | HTML-формы |
| multipart | `multipart/form-data; boundary=…` | строки и файлы | `request.POST`, `request.FILES` | загрузка файлов |
| query | — (в URL) | строки | `request.GET` | фильтры, поиск, страницы |

## На практике
Задача: отправить заказ JSON-ом и формой, загрузить фото товара и передать фильтры поиска. Учебный API магазина возвращает на `/api/echo/`, что пришло в запросе: `content_type`, сырое `body` и разобранный `request.POST`.

### Шаг 1. JSON и форма
Заказ JSON-ом:
```
$ curl -s -X POST http://localhost:8000/api/echo/ -H 'Content-Type: application/json' -d '{"product": 2, "quantity": 1}'
{"content_type": "application/json", "body": "{\"product\": 2, \"quantity\": 1}", "POST": {}}
```
JSON пришёл в `body`, а `request.POST` пуст: Django разбирает в него только формы. Те же данные формой:
```
$ curl -s -X POST http://localhost:8000/api/echo/ -d 'product=2&quantity=1'
{"content_type": "application/x-www-form-urlencoded", "body": "product=2&quantity=1", "POST": {"product": "2", "quantity": "1"}}
```
Форма разобрана в `POST` — и все значения стали строками: `"2"`, а не `2`.

### Шаг 2. Кодирование значений
Комментарий с кириллицей и `&`:
```
$ curl -s -X POST http://localhost:8000/api/echo/ --data-urlencode 'comment=Подарок & открытка'
{"content_type": "application/x-www-form-urlencoded", "body": "comment=%D0%9F%D0%BE%D0%B4%D0%B0%D1%80%D0%BE%D0%BA+%26+%D0%BE%D1%82%D0%BA%D1%80%D1%8B%D1%82%D0%BA%D0%B0", "POST": {"comment": "Подарок & открытка"}}
```
То же в Python:
```python
import json
from urllib.parse import parse_qs, urlencode
order = {"product": 2, "quantity": 1, "comment": "Подарок & открытка"}
print(json.dumps(order, ensure_ascii=False))
print(urlencode({"comment": "Подарок & открытка"}))
print(parse_qs("q=мышь&category=2&category=5"))
```
Результат:
```
{"product": 2, "quantity": 1, "comment": "Подарок & открытка"}
comment=%D0%9F%D0%BE%D0%B4%D0%B0%D1%80%D0%BE%D0%BA+%26+%D0%BE%D1%82%D0%BA%D1%80%D1%8B%D1%82%D0%BA%D0%B0
{'q': ['мышь'], 'category': ['2', '5']}
```
`urlencode` закодировал так же, как `curl`: пробел — `+`, `&` — `%26`. `parse_qs` возвращает списки — ключ может повторяться. Без `ensure_ascii=False` `json.dumps` записал бы кириллицу как `П…` — это тоже правильный JSON, просто длиннее.

### Шаг 3. Файл — multipart
Фото товара и подпись к нему:
```
$ curl -s -i -X POST http://localhost:8000/api/products/2/photo/ -F 'photo=@photo.jpg;type=image/jpeg' -F 'alt=Мышь сбоку'
HTTP/1.1 201 Created
Content-Type: application/json
Content-Length: 93

{"name": "photo.jpg", "size": 15, "content_type": "image/jpeg", "alt": "Мышь сбоку"}
```
Что ушло на сервер (запись `curl --trace-ascii`, поле `alt` — латиницей, номера байтов убраны):
```
POST /api/products/2/photo/ HTTP/1.1
Host: 127.0.0.1:8770
User-Agent: curl/8.5.0
Accept: */*
Content-Length: 318
Content-Type: multipart/form-data; boundary=------------------------OWgBGMCqUkzdKXzoEGlA7c

--------------------------OWgBGMCqUkzdKXzoEGlA7c
Content-Disposition: form-data; name="photo"; filename="photo.jpg"
Content-Type: image/jpeg

fake-jpeg-bytes
--------------------------OWgBGMCqUkzdKXzoEGlA7c
Content-Disposition: form-data; name="alt"

Mouse
--------------------------OWgBGMCqUkzdKXzoEGlA7c--
```
Граница случайная, её объявляет `Content-Type`; каждая часть — со своими заголовками, после последней — граница с `--`. Django собрал из частей `request.FILES["photo"]` и `request.POST["alt"]`.

### Шаг 4. Query-параметры
Поиск с двумя категориями:
```
$ curl -s 'http://localhost:8000/api/search/?q=мышь&category=2&category=5'
{"q": "мышь", "category": ["2", "5"]}
```
Повторяющийся параметр в Django — `request.GET.getlist("category")`; `request.GET["category"]` вернул бы только последнее значение.

## Частые ошибки
- **JSON в `request.POST`.** Он пуст для `application/json`; читают `json.loads(request.body)`.
- **Ждать числа из формы.** В urlencoded и multipart всё — строки: `"2"`. Приводят и проверяют (формы Django делают это сами).
- **Склеивать query строкой.** `f"?q={q}"` с `q = "мышь & коврик"` даст два параметра. `urlencode` или `params=`.
- **Файл в JSON строкой base64.** Тело больше на треть, весь файл в памяти; для файлов — multipart.
- **Указать `Content-Type: multipart/form-data` вручную без `boundary`.** Сервер не найдёт границы частей; заголовок с границей ставит клиент (`curl -F`, `httpx` с `files=`).
- **Данные изменения в query.** `POST /api/orders/?product=2` — параметры попадают в журналы сервера и историю; данные — в теле.

## Итог
**Форматы тела**
- JSON (`application/json`) — API; форма (`x-www-form-urlencoded`) — HTML-формы, всё строки; multipart — файлы + поля.

**URL**
- Query-параметры — выборка (фильтр, поиск, страница); кодировать `urlencode`, повторяющиеся ключи — списки.

## Вопросы на собеседовании
<details><summary>Чем `application/x-www-form-urlencoded` отличается от `multipart/form-data`?</summary>

urlencoded — одна строка пар `ключ=значение` с процентным кодированием, подходит для коротких текстовых полей. multipart — тело из частей с собственными заголовками, разделённых границей; позволяет передавать файлы и двоичные данные без кодирования. HTML-форма использует multipart при `enctype="multipart/form-data"`.
</details>

<details><summary>Почему `request.POST` пуст, если клиент прислал JSON?</summary>

Django разбирает в `request.POST` только тела с `Content-Type` формы (urlencoded и multipart). JSON нужно разобрать самому: `json.loads(request.body)`; DRF делает это в `request.data` с помощью парсеров по `Content-Type`.
</details>

<details><summary>Когда передавать данные в query-параметрах, а когда в теле?</summary>

Query — для параметров выборки ресурса в `GET`: фильтры, сортировка, пагинация, поиск; такие URL можно кэшировать и сохранить. Тело — для данных, которые создают или изменяют ресурс (`POST`, `PUT`, `PATCH`), и для больших или чувствительных данных: URL попадает в журналы, историю и заголовок `Referer`.
</details>

## Глубже
Доступ к API — токены, JWT, CORS — следующий раздел «Доступ и безопасность». Отправка JSON, форм и файлов из Python (`httpx`: `json=`, `data=`, `files=`) — раздел «HTTP-клиенты».
