---
title: Пакетный менеджер
type: lesson
level: 2
reading_time: 11
---

## Теория
На сервере программы не скачивают с сайтов — их ставят из **репозитория** дистрибутива: Ubuntu хранит тысячи проверенных **пакетов** (Nginx, PostgreSQL, Git), и пакетный менеджер **`apt`** сам скачивает нужный пакет, его зависимости и раскладывает файлы по местам: программы — в `/usr/bin` или `/usr/sbin`, настройки — в `/etc/<программа>`, документацию — в `/usr/share/doc`.

Команды (все, что меняют систему, — через `sudo`):
- **`sudo apt update`** — скачать свежие **списки** пакетов. Сам ничего не устанавливает и не обновляет; делают перед установкой;
- **`sudo apt install nginx`** — поставить пакет (можно несколько через пробел). `apt` покажет, что поставит, и спросит `Do you want to continue? [Y/n]`; в скриптах добавляют **`-y`** — «да» без вопроса;
- **`sudo apt upgrade`** — обновить установленные пакеты до новых версий из списков;
- **`sudo apt remove nginx`** — удалить программу, **настройки в `/etc` оставить**; **`sudo apt purge nginx`** — удалить вместе с настройками;
- `apt list --installed` — что стоит; `apt show nginx` или `apt-cache policy nginx` — версия, описание, установлен ли; `which nginx` — где лежит программа.

Без `sudo` `apt install` откажет: ставить пакеты может только `root` — `apt` не сможет заблокировать базу пакетов (`Unable to acquire the dpkg frontend lock … are you root?`).

Что ставят на сервер магазина: `nginx`, `postgresql` (сервер базы) или только `postgresql-client` (`psql`, `pg_dump` — подключаться к базе на другом сервере), `git`, `python3-venv` (без него не создаётся виртуальное окружение), `curl`, `htop`.

`apt` и `pip` — разные уровни: `apt` ставит программы **системы**, `pip` — библиотеки Python **в виртуальное окружение проекта** (курс «Терминал и Git: старт»). Django через `apt` не ставят: версия в репозитории старая и общая для всей системы.

## Наглядно
**Рисунок 1.** Что делает `sudo apt install nginx`.

![Рисунок 1. apt update скачивает списки пакетов из репозитория Ubuntu. apt install nginx берёт пакет и зависимости из репозитория и раскладывает файлы: программа /usr/sbin/nginx, настройки /etc/nginx/nginx.conf и sites-available, страница /var/www/html, служба nginx. apt remove убирает программу и оставляет /etc/nginx, apt purge — убирает и настройки](img/apt-flow.svg)

**Таблица 1.** Команды `apt`.

| Задача | Команда |
|---|---|
| обновить списки пакетов | `sudo apt update` |
| поставить | `sudo apt install nginx git` |
| поставить без вопроса | `sudo apt install -y nginx` |
| обновить всё установленное | `sudo apt upgrade` |
| удалить, оставить настройки | `sudo apt remove nginx` |
| удалить вместе с настройками | `sudo apt purge nginx` |
| что установлено | `apt list --installed` |
| версия и стоит ли | `apt-cache policy nginx` |
| где программа | `which nginx` |

## На практике
Задача: поставить Nginx на сервер магазина. Ответы `apt` в тренажёре — учебные и короче настоящих; что отличается, сказано в шагах.

### Шаг 1. Есть ли Nginx
Программы нет — `which` ничего не печатает и возвращает 1:
```bash
which nginx; echo $?
```
Результат:
```
1
```
Версию в репозитории и установлен ли пакет показывает `apt-cache policy` (настоящий Ubuntu 24.04):
```bash
apt-cache policy nginx
```
Результат (начало):
```
nginx:
  Installed: (none)
  Candidate: 1.24.0-2ubuntu7.21
```
`Installed: (none)` — не установлен, `Candidate` — какая версия встанет.

### Шаг 2. Без sudo и с ним
Установка от обычного пользователя:
```bash
apt install nginx
```
Результат:
```
E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)
E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?
```
Через `sudo` — сначала списки, потом пакет:
```bash
sudo apt update
sudo apt install -y nginx
```
Результат (учебный вывод тренажёра):
```
Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease
Hit:2 http://security.ubuntu.com/ubuntu noble-security InRelease
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
All packages are up to date.
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
The following NEW packages will be installed:
  nginx
0 upgraded, 1 newly installed, 0 to remove and 0 not upgraded.
Setting up nginx (1.24.0-2ubuntu7.1) ...
```
На настоящем сервере вывод длиннее: `apt` ставит ещё зависимость `nginx-common`, пишет, сколько скачает, и строки `Get:` для каждого файла. Без `-y` перед установкой — вопрос `Do you want to continue? [Y/n]`.

### Шаг 3. Что появилось
Программа и настройки:
```bash
which nginx
ls /etc/nginx
```
Результат:
```
/usr/sbin/nginx
nginx.conf  sites-available  sites-enabled
```
Пакет разложил файлы по стандартным местам — те самые `sites-available` и `sites-enabled` из темы «Ссылки».

### Шаг 4. Уже установлено
Git на сервере уже есть:
```bash
sudo apt install git
```
Результат:
```
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
git is already the newest version (1:2.43.0-1ubuntu7.1).
0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
```
Повторная установка ничего не ломает — `apt install` можно спокойно писать в скрипт настройки сервера.

### Шаг 5. remove и purge
Удалить Nginx, посмотреть настройки, поставить снова и удалить начисто:
```bash
sudo apt remove nginx
ls /etc/nginx
sudo apt install -y nginx
sudo apt purge nginx
ls /etc/nginx
```
Результат (без строк `Reading …` в начале каждой команды):
```
Removing nginx (1.24.0-2ubuntu7.1) ...
nginx.conf  sites-available  sites-enabled
The following NEW packages will be installed:
  nginx
0 upgraded, 1 newly installed, 0 to remove and 0 not upgraded.
Setting up nginx (1.24.0-2ubuntu7.1) ...
Removing nginx (1.24.0-2ubuntu7.1) ...
Purging configuration files for nginx (1.24.0-2ubuntu7.1) ...
sites-available
```
После `remove` настройки на месте — повторная установка их подхватит. `purge` удалил `nginx.conf` и пустую `sites-enabled`, а `sites-available` осталась: в ней наш файл `shop` из темы «Ссылки» — файлы, которых не было в пакете, `apt` не трогает.

## Частые ошибки
- **`apt install` без `apt update` на новом сервере.** Списки пакетов устарели — `E: Unable to locate package` или ошибка скачивания старой версии. Сначала `update`.
- **Путать `update` и `upgrade`.** `update` — только списки, `upgrade` — обновление самих программ.
- **`apt remove`, чтобы «начать с чистого листа».** Настройки в `/etc` остаются — и новая установка подхватит старые ошибки. Для полного удаления — `purge`.
- **Django и библиотеки через `apt`.** Старые версии, общие для всей системы. Библиотеки проекта — `pip` в виртуальном окружении.
- **`sudo pip install` в систему.** На Ubuntu 24.04 — `externally-managed-environment`: система защищает свой Python. `venv` для проекта.
- **Ставить программы из случайных скриптов «curl | sudo bash».** Код выполняется с правами `root` без проверки. Сначала репозиторий Ubuntu, затем официальный репозиторий разработчика.

## Итог
**apt**
- `update` — списки, `install` (`-y`), `upgrade`, `remove` (настройки остаются), `purge`; всё — через `sudo`.

**Проверки**
- `which` — где программа, `apt-cache policy` — стоит ли и какая версия, `apt list --installed` — всё установленное.

**apt и pip**
- `apt` — программы системы, `pip` — библиотеки проекта в `venv`.

## Вопросы на собеседовании
<details><summary>Чем `apt update` отличается от `apt upgrade`?</summary>

`apt update` скачивает с репозиториев актуальные списки пакетов и их версий, ничего не устанавливая. `apt upgrade` обновляет установленные пакеты до версий из этих списков. Поэтому их запускают в паре: `sudo apt update && sudo apt upgrade`.
</details>

<details><summary>Чем `apt remove` отличается от `apt purge`?</summary>

`remove` удаляет файлы программы, но оставляет её конфигурацию в `/etc` — при повторной установке настройки вернутся. `purge` удаляет и конфигурацию. Зависимости, которые больше не нужны, убирает `apt autoremove`.
</details>

<details><summary>Почему библиотеки Python ставят через pip в venv, а не через apt?</summary>

Пакеты `apt` — одна версия на всю систему, обычно отстающая и подобранная под системные утилиты. Проектам нужны свои, часто разные версии библиотек: их ставят `pip` в виртуальное окружение проекта, а зависимости фиксируют в `requirements.txt`. Начиная с Ubuntu 23.04 системный `pip` в обход `apt` запрещён (PEP 668).
</details>

## Глубже
Что делать, когда установленные программы и логи заняли весь диск, — следующая тема. Нужная версия Python, которой нет в репозитории, — тема «Версии Python». Настройка Nginx после установки — курс «Nginx и деплой».
