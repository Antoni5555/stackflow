---
title: "Тома и bind mounts"
type: lesson
level: 2
reading_time: 12
---

## Теория
Разработчик обновил контейнер базы: `docker rm -f shop-db`, затем `docker run` с новым тегом — и все заказы пропали. Данные лежали в слое контейнера и удалились вместе с ним (тема 1.01). Всё, что должно пережить контейнер — файлы базы, загруженные фото товаров, — хранят **вне** его, в монтируемых папках.

Два способа примонтировать папку внутрь контейнера — флаг **`-v источник:путь_в_контейнере`**:
- **именованный том** (volume) — `-v pgdata:/var/lib/postgresql/data`. Хранилищем управляет Docker (на сервере — `/var/lib/docker/volumes/pgdata/_data`). Том создаётся при первом упоминании или `docker volume create`, живёт отдельно от контейнеров и удаляется только явно. Главный выбор для данных: базы, загрузки, кэши;
- **bind mount** — `-v /home/shop/init:/docker-entrypoint-initdb.d`: папка или файл **сервера**, путь начинается с `/` или `./`. Контейнер видит её содержимое в реальном времени. Для кода в разработке, конфигов, скриптов инициализации.

Важные детали:
- примонтированная папка **закрывает** то, что было по этому пути в образе. Пустая папка поверх `/usr/share/nginx/html` — и стартовая страница Nginx исчезла;
- многие образы объявляют, где у них данные (инструкция `VOLUME`, раздел 3). `postgres` — `/var/lib/postgresql/data`. Если ничего туда не примонтировать, Docker создаст **анонимный том** со случайным именем: данные переживут контейнер, но найти их потом сложно, а сами тома копятся. `docker rm -v` удаляет анонимные тома вместе с контейнером;
- том, который подключён к контейнеру (даже остановленному), удалить нельзя.

Команды томов: `docker volume create`, `ls`, `inspect`, `rm`. Флаг `-v` можно писать и для томов, и для bind mount; есть длинная запись `--mount type=volume,source=pgdata,target=/var/lib/postgresql/data`.

## Наглядно
**Рисунок 1.** Слой контейнера удаляется вместе с ним, том и bind mount — нет.

![Рисунок 1. Контейнер shop-db: слой изменений удаляется при docker rm. Именованный том pgdata в /var/lib/docker/volumes подключён в /var/lib/postgresql/data и переживает удаление контейнера: новый контейнер с тем же томом видит те же таблицы. Bind mount: папка сервера /home/shop/init подключена в /docker-entrypoint-initdb.d, изменения на сервере сразу видны в контейнере. Внизу: пустая папка поверх /usr/share/nginx/html закрывает файлы образа](img/volumes.svg)

**Таблица 1.** Где хранить данные.

| | Слой контейнера | Именованный том | Bind mount |
|---|---|---|---|
| Как подключить | ничего не делать | `-v pgdata:/путь` | `-v /папка/сервера:/путь` |
| Где лежит | внутри контейнера | `/var/lib/docker/volumes/…` | где вы сказали |
| После `docker rm` | удалено | осталось | осталось |
| Для чего | временные файлы | база, загрузки | код в разработке, конфиги, init-скрипты |

**Таблица 2.** Команды томов.

| Задача | Команда |
|---|---|
| создать | `docker volume create pgdata` |
| список | `docker volume ls` |
| где лежит | `docker volume inspect pgdata` |
| удалить | `docker volume rm pgdata` |
| удалить контейнер и его анонимные тома | `docker rm -v shop-db` |

## На практике
Задача: убедиться, что без тома данные базы пропадают, сохранить их в томе и заполнить новую базу скриптом при первом запуске. Команды выполнены на Ubuntu 24.04 с Docker Engine 29 (имена контейнеров и томов в выводе заменены на учебные).

### Шаг 1. Без тома
Запускаем базу, создаём таблицу:
```bash
docker run -d --name shop-db -e POSTGRES_PASSWORD=shop postgres:16
docker exec shop-db psql -U postgres -c "CREATE TABLE products (id serial, name text); INSERT INTO products (name) VALUES ('Чайник');"
```
Результат:
```
ab5ad8358f5427b7c542e0766f6a35990b2825b9a64b9907f9d574237a73e6fc
CREATE TABLE
INSERT 0 1
```
Где база хранит файлы? Смотрим подключения контейнера:
```bash
docker inspect --format '{{json .Mounts}}' shop-db
```
Результат:
```
[{"Type":"volume","Name":"4e8d86153b928d2c83e62ce363d11aeeb7847cf518562a1d83be69fb215cfa2e","Source":"/var/lib/docker/volumes/4e8d86153b928d2c83e62ce363d11aeeb7847cf518562a1d83be69fb215cfa2e/_data","Destination":"/var/lib/postgresql/data","Driver":"local","Mode":"","RW":true,"Propagation":""}]
```
Образ `postgres` сам попросил том для `/var/lib/postgresql/data`, и Docker создал **анонимный** — с именем из 64 символов.

### Шаг 2. Новый контейнер — пустая база
Удаляем контейнер и запускаем такой же:
```bash
docker rm -f shop-db
docker run -d --name shop-db -e POSTGRES_PASSWORD=shop postgres:16
docker exec shop-db psql -U postgres -c "SELECT count(*) FROM products;"
```
Результат:
```
shop-db
03fd6024209abcab4f9d37e17f0c4c79bd71700f03139fd7a3bc7e02324c44c1
ERROR:  relation "products" does not exist
LINE 1: SELECT count(*) FROM products;
                             ^
```
Таблицы нет: новый контейнер получил **новый** анонимный том. Старый остался лежать на диске — с данными, но без понятного имени. Такие «осиротевшие» тома копятся: `docker volume ls -q --filter dangling=true` на рабочем ноутбуке легко покажет десяток.

### Шаг 3. Именованный том
Создаём том и подключаем его по имени:
```bash
docker rm -f -v shop-db
docker volume create pgdata
docker run -d --name shop-db -e POSTGRES_PASSWORD=shop -v pgdata:/var/lib/postgresql/data postgres:16
docker exec shop-db psql -U postgres -c "CREATE TABLE products (id serial, name text); INSERT INTO products (name) VALUES ('Чайник'), ('Кружка');"
```
Результат:
```
shop-db
pgdata
954d310830667a26d9079cb236ddf29a372d116dbe3389e74705aa050b0a1dd6
CREATE TABLE
INSERT 0 2
```
`-v` в `rm` убрал и анонимный том старого контейнера.

### Шаг 4. Данные пережили контейнер
Удаляем контейнер и запускаем новый с тем же томом:
```bash
docker rm -f shop-db
docker run -d --name shop-db -e POSTGRES_PASSWORD=shop -v pgdata:/var/lib/postgresql/data postgres:16
docker exec shop-db psql -U postgres -c "SELECT count(*) FROM products;"
```
Результат:
```
shop-db
272b484eb7b92eb1b291dcdec703bed8f77703b99b3afe7d9efa7763d0e4cea6
 count 
-------
     2
(1 row)
```
Таблица на месте. Так и обновляют версию базы в пределах 16-й: новый контейнер, тот же том.

### Шаг 5. Где том и почему его не удалить
Описание тома и попытка удалить его, пока он подключён:
```bash
docker volume inspect pgdata
docker volume rm pgdata
```
Результат:
```
[
    {
        "CreatedAt": "2026-11-23T20:56:05+03:00",
        "Driver": "local",
        "Labels": null,
        "Mountpoint": "/var/lib/docker/volumes/pgdata/_data",
        "Name": "pgdata",
        "Options": null,
        "Scope": "local"
    }
]
Error response from daemon: remove pgdata: volume is in use - [272b484eb7b92eb1b291dcdec703bed8f77703b99b3afe7d9efa7763d0e4cea6]
```
`Mountpoint` — где файлы на сервере (читать их может только `root`). Подключённый том Docker удалить не даёт.

### Шаг 6. Bind mount: скрипт при первом запуске
Образ `postgres` при **первой** инициализации пустой базы выполняет SQL-файлы из `/docker-entrypoint-initdb.d`. Файл на сервере `init/01-schema.sql`:
```sql
CREATE TABLE products (id serial PRIMARY KEY, name text);
INSERT INTO products (name) VALUES ('Чайник'), ('Кружка');
```
Подключаем папку сервера и смотрим результат:
```bash
docker run -d --name test-db -e POSTGRES_PASSWORD=shop -v /home/shop/init:/docker-entrypoint-initdb.d postgres:16
docker exec test-db psql -U postgres -c "SELECT * FROM products;"
```
Результат:
```
cf38d82e7928e1918f0944849da5bd21fa5d84dfe129b0887f1d0c416d15e339
 id |  name  
----+--------
  1 | Чайник
  2 | Кружка
(2 rows)
```
В логах (`docker logs test-db`) видно `CREATE TABLE` и `INSERT 0 2` между строками инициализации. Если подключить к контейнеру уже заполненный том, скрипты **не выполнятся** — они только для новой базы.

### Шаг 7. Папка закрывает содержимое образа
Пустая папка сервера поверх папки со стартовой страницей Nginx — и без неё:
```bash
docker run --rm -v /home/shop/empty:/usr/share/nginx/html nginx:1.27-alpine ls -la /usr/share/nginx/html
docker run --rm nginx:1.27-alpine ls /usr/share/nginx/html
```
Результат:
```
total 8
drwxrwxr-x    2 1000     1000          4096 Nov 23 17:56 .
drwxr-xr-x    3 root     root          4096 Apr 16  2025 ..
50x.html
index.html
```
С bind mount внутри пусто: папка сервера закрыла файлы образа, а владелец — числовой UID пользователя сервера. Без монтирования — две страницы из образа.

## Частые ошибки
- **База без тома.** Данные — в слое или анонимном томе; после пересоздания контейнера «всё пропало». Для базы всегда именованный том.
- **`docker volume rm` или `volume prune -a` «для порядка».** Удаляет данные навсегда. Перед удалением тома с базой — бэкап (`pg_dump`).
- **Перепутать том и папку.** `-v pgdata:/…` — том Docker; `-v ./pgdata:/…` — папка `pgdata` в текущей папке сервера. Одна точка — разное поведение и права.
- **Bind mount поверх папки с файлами образа.** Пустая папка сервера «стирает» содержимое образа в этом месте (шаг 7). Так случайно прячут собранную статику или код.
- **Ждать, что init-скрипты выполнятся снова.** `/docker-entrypoint-initdb.d` работает только для пустой базы. Для изменений схемы — миграции.
- **Анонимные тома копятся.** Каждый `docker run postgres` без `-v` оставляет том на сотни мегабайт. Используйте именованные тома, `docker rm -v` и `--rm` для разовых запусков.
- **Права на bind mount.** Процесс внутри работает под своим пользователем (UID); если папка сервера ему не принадлежит — `Permission denied` (курс Linux, права и владельцы).

## Итог
**Зачем**
- Слой контейнера удаляется вместе с ним; данные — в томах или папках сервера.

**Способы**
- `-v имя:/путь` — именованный том, управляет Docker; для данных.
- `-v /папка:/путь` — bind mount; для кода, конфигов, init-скриптов.

**Детали**
- Монтирование закрывает содержимое образа по этому пути.
- Образы с `VOLUME` без `-v` создают анонимные тома; `rm -v` их убирает.
- Подключённый том не удалить; удаление тома = удаление данных.

## Вопросы на собеседовании
<details><summary>Чем volume отличается от bind mount?</summary>

Том создаёт и хранит Docker (в `/var/lib/docker/volumes`), он не зависит от структуры папок сервера, им удобно управлять командами `docker volume`, и он подходит для данных баз. Bind mount подключает конкретную папку или файл сервера: изменения видны в обе стороны сразу, но всё зависит от путей и прав на сервере. Bind mount удобен для кода в разработке и конфигов.
</details>

<details><summary>Как сохранить данные PostgreSQL при пересоздании контейнера?</summary>

Подключить именованный том в папку данных: `-v pgdata:/var/lib/postgresql/data`. Новый контейнер с тем же томом увидит прежние файлы базы. Для переноса или страховки дополнительно делают логический бэкап `pg_dump`.
</details>

<details><summary>Что такое анонимный том?</summary>

Том, который Docker создаёт сам, когда образ объявил `VOLUME`, а при запуске туда ничего не подключили. У него случайное имя, он переживает удаление контейнера (если не указать `rm -v`), но новый контейнер его не подхватит. Такие тома незаметно занимают место.
</details>

## Глубже
Как передать пароль базы, не показывая его в командной строке, — следующая тема. Тома в compose и бэкап тома — раздел 4 и курс «Nginx и деплой».
