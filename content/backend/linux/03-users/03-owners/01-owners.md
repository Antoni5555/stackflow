---
title: Владельцы
type: lesson
level: 2
reading_time: 12
---

## Теория
Права из прошлой темы работают в связке с **владельцем** и **группой** файла: `rw-r-----` значат разное для `shop:shop` и для `root:root`. Поэтому половина проблем «Permission denied» на сервере решается не `chmod`, а сменой владельца.

Откуда берутся «чужие» файлы:
- файл создан через `sudo` — он принадлежит `root`;
- файл загрузили или распаковали под другим пользователем;
- скопировали с другого сервера с сохранением владельца (`tar`, `scp -p`).

Команды:
- **`chown пользователь файл`** — сменить владельца; **`chown пользователь:группа файл`** — и владельца, и группу сразу;
- **`chgrp группа файл`** — только группу;
- **`-R`** — рекурсивно: папка со всем содержимым.

Владельца меняет только `root` — поэтому `chown` почти всегда с `sudo`. Без него: `Operation not permitted`. Группу владелец может сменить сам, но только на группу, в которой состоит.

**Как устроить доступ сайта к файлам.** Код и загрузки пишет Gunicorn (`shop`), а фото и статику отдаёт Nginx (`www-data`). Два рабочих способа:
- владелец `shop`, права `755` на папки и `644` на файлы — читают все, пишет только `shop`. Просто, подходит, когда на сервере нет посторонних пользователей;
- владелец `shop`, группа `www-data`, права `750` на папки и `640` на файлы — читает только Nginx (через группу), остальные — ничего.

`chown -R www-data media`, «чтобы Nginx точно видел», — плохая идея: тогда Gunicorn (`shop`) не сможет сохранять новые фото, а взломанный Nginx сможет их подменить.

## Наглядно
**Рисунок 1.** Фото, загруженное под `root`, и как его починить.

![Рисунок 1. new-watch.jpg: владелец root, группа root, права rw------- — Nginx (www-data) попадает в «остальных» и получает 403, в error.log — open() failed (13: Permission denied). sudo chown -R shop:shop media — владелец shop, но права всё ещё rw-------. chmod 644 — остальные читают, Nginx отдаёт фото. Вариант с группой: shop:www-data, папки 750, файлы 640](img/owners.svg)

**Таблица 1.** Владельцы и права для файлов сайта.

| Что | Владелец:группа | Права | Кто пишет / кто читает |
|---|---|---|---|
| код `/srv/shop` | `shop:shop` | `755` / `644` | `shop` / все |
| `.env` | `shop:shop` | `600` | `shop` / только `shop` |
| `media`, `static` (простой вариант) | `shop:shop` | `755` / `644` | `shop` / все, в том числе Nginx |
| `media`, `static` (через группу) | `shop:www-data` | `750` / `640` | `shop` / `shop` и Nginx |
| `/etc/nginx/*` | `root:root` | `644` | `root` / все |

## На практике
Задача: новые фото товара загрузили на сервер под `root`, и сайт на них отвечает 403. Найти причину и починить. Команды выполнены в терминале сервера из `/srv/shop`.

### Шаг 1. Причина — в журнале Nginx
Последняя ошибка Nginx:
```bash
cd /srv/shop
sudo tail -n 1 /var/log/nginx/error.log
```
Результат:
```
2026/11/21 10:15:02 [error] 812#812: *57 open() "/srv/shop/media/products/new-watch.jpg" failed (13: Permission denied), client: 203.0.113.7, server: shop.example, request: "GET /media/products/new-watch.jpg HTTP/1.1", host: "shop.example"
```
`Permission denied` — Nginx не может открыть файл. Смотрим, чей он:
```bash
ls -l media/products
```
Результат:
```
total 21976
-rw-r--r-- 1 shop shop 5632000 Nov 20 15:47 headphones.JPG
-rw-r--r-- 1 shop shop  921600 Nov 19 15:47 keyboard.jpg
-rw-r--r-- 1 shop shop 6291456 Nov 18 15:47 laptop-air.jpg
-rw-r--r-- 1 shop shop 8388608 Oct 12 15:47 laptop-pro.png
-rw-r--r-- 1 shop shop  245760 Oct 22 15:47 mouse.jpg
-rw------- 1 root root  716800 Nov 21 15:47 new-watch.jpg
-rw------- 1 root root  307200 Nov 21 15:47 strap.jpg
```
Два новых фото — `root:root` с правами `600`: читать их может только `root`.

### Шаг 2. Вернуть владельца
Без `sudo` и с ним, сразу для всей папки:
```bash
chown shop media/products/new-watch.jpg
sudo chown -R shop:shop media
ls -l media/products/new-watch.jpg media/products/strap.jpg
```
Результат:
```
chown: changing ownership of 'media/products/new-watch.jpg': Operation not permitted
-rw------- 1 shop shop 716800 Nov 21 15:47 media/products/new-watch.jpg
-rw------- 1 shop shop 307200 Nov 21 15:47 media/products/strap.jpg
```
Владелец теперь `shop` — Gunicorn сможет менять и удалять эти фото. Но права остались `rw-------`.

### Шаг 3. Открыть на чтение
Проверка глазами Nginx до и после `chmod`:
```bash
sudo -u www-data cat media/products/new-watch.jpg > /dev/null
chmod 644 media/products/new-watch.jpg media/products/strap.jpg
sudo -u www-data cat media/products/new-watch.jpg > /dev/null; echo $?
```
Результат:
```
cat: media/products/new-watch.jpg: Permission denied
0
```
Код 0 — `www-data` прочитал файл: фото на сайте открывается. Понадобились обе команды: `chown` — чтобы файл стал «своим» для приложения, `chmod` — чтобы его мог читать Nginx.

### Шаг 4. Доступ только для Nginx
Строже — закрыть `media` от всех, кроме `shop` и Nginx, через группу:
```bash
sudo chgrp -R www-data media
chmod 750 media media/products media/tmp
chmod 640 media/products/*
ls -ld media
ls -l media/products/new-watch.jpg
sudo -u www-data cat media/products/new-watch.jpg > /dev/null; echo $?
```
Результат:
```
drwxr-x--- 4 shop www-data 4096 Nov 21 15:47 media
-rw-r----- 1 shop www-data 716800 Nov 21 15:47 media/products/new-watch.jpg
0
```
`shop` пишет (тройка владельца `rw-`), Nginx читает через группу (`r--`), остальные пользователи сервера — ничего (`---`). Группу на `www-data` меняли через `sudo`: `shop` не состоит в этой группе.

## Частые ошибки
- **`chmod 777` вместо смены владельца.** Ошибка пропадает, а файл может изменить любой. Причина — «чужой» владелец, лечится `chown`.
- **`chown -R www-data` на всю папку проекта.** Nginx получает право менять код, а Gunicorn теряет право писать загрузки. Владелец — пользователь приложения, Nginx — через группу или «остальных».
- **`sudo` при распаковке и копировании.** `sudo tar -xzf` и `sudo cp` создают файлы `root` — потом 403 и «Permission denied» у приложения. После такого — `sudo chown -R shop:shop …`.
- **Забыть `-R`.** `chown shop media` меняет только саму папку, файлы внутри остаются `root`.
- **Поменять владельца, забыв про права.** Как в шаге 2: владелец верный, а `600` по-прежнему не даёт читать Nginx.
- **`chgrp` на группу, где вас нет.** `Operation not permitted` — нужен `sudo` или членство в группе.

## Итог
**Команды**
- `sudo chown пользователь:группа файл`, `chgrp группа файл`, `-R` — рекурсивно; владельца меняет только `root`.

**Сайт**
- Владелец файлов — пользователь приложения (`shop`); Nginx читает через «остальных» (`755`/`644`) или через группу `www-data` (`750`/`640`).
- 403 на файл и `Permission denied` в `error.log` — проверить владельца и права, проверка — `sudo -u www-data cat файл`.

## Вопросы на собеседовании
<details><summary>Nginx отдаёт 403 на статику. Что проверить?</summary>

`error.log` Nginx: `open() … failed (13: Permission denied)` — проблема прав. Дальше: от какого пользователя работает Nginx (`user` в `nginx.conf`, обычно `www-data`), владелец и права файла (`ls -l`) и право `x` на **каждой** папке пути (`namei -l /путь/к/файлу`). Проверка — `sudo -u www-data cat файл`. Другие причины 403 — запрет в конфиге (`deny`) или папка без `index` при выключенном `autoindex`.
</details>

<details><summary>Чем `chown` отличается от `chmod`?</summary>

`chown` меняет владельца и группу файла — **кто** попадает в тройку владельца и группы; менять может только `root`. `chmod` меняет сами права в тройках — **что** разрешено; менять может владелец. Обычно нужны обе: файл должен принадлежать приложению, а права — пускать тех, кому нужно.
</details>

<details><summary>Как дать Nginx доступ к файлам приложения, не открывая их всем?</summary>

Оставить владельцем пользователя приложения, группу файлов сделать `www-data` (`chgrp -R www-data`), права — `750` на папки и `640` на файлы. Новые файлы будут наследовать группу папки, если поставить на неё бит setgid (`chmod g+s`).
</details>

## Глубже
Как устанавливать программы на сервер и смотреть, что занимает место на диске, — раздел «Пакеты, диски и версии Python». От какого пользователя запускается Gunicorn и как это задать — тема «Сервисы systemd».
