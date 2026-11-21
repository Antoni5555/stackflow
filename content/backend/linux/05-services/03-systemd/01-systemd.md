---
title: Сервисы systemd
type: lesson
level: 3
reading_time: 13
---

## Теория
Запустить Gunicorn в терминале — мало: закроете SSH — процесс остановится, перезагрузится сервер — сайт не поднимется, упадёт — никто не перезапустит. Для этого в Ubuntu есть **systemd** — главный процесс системы (PID 1), который запускает **службы** (сервисы) и следит за ними. Nginx, PostgreSQL, SSH — всё это службы systemd; Gunicorn магазина делают такой же службой.

Служба описывается **unit-файлом** — `/etc/systemd/system/gunicorn.service`:
```
[Unit]
Description=Gunicorn for shop
After=network.target

[Service]
User=shop
Group=shop
WorkingDirectory=/srv/shop
EnvironmentFile=/srv/shop/.env
ExecStart=/srv/shop/venv/bin/gunicorn --workers 2 --bind 127.0.0.1:8000 config.wsgi:application
Restart=always

[Install]
WantedBy=multi-user.target
```
- `[Unit]` — описание и порядок: `After=network.target` — запускать после сети;
- `[Service]` — как запускать: от какого пользователя (`User`, `Group`), из какой папки (`WorkingDirectory`), с какими переменными (`EnvironmentFile` — файл `.env`, `Environment="ИМЯ=значение"` — по одной), какой командой (`ExecStart` — **полный путь**, `PATH` здесь не настроен: используем `gunicorn` из `venv`), перезапускать ли при падении (`Restart=always`);
- `[Install]` — `WantedBy=multi-user.target`: запускать при обычной загрузке сервера (если служба включена).

Команды `systemctl` (изменения — через `sudo`):
- `sudo systemctl daemon-reload` — перечитать unit-файлы **после каждой их правки**;
- `start` / `stop` / `restart` — запустить, остановить, перезапустить сейчас;
- `enable` / `disable` — включить / выключить автозапуск при загрузке (`enable --now` — включить и сразу запустить);
- **`systemctl status gunicorn`** — состояние: `active (running)` или `failed`, PID, последние строки журнала;
- `systemctl is-active` / `is-enabled` — коротко, для скриптов.

**Журнал**: всё, что служба пишет в stdout и stderr, собирает journald. Смотреть — **`journalctl -u gunicorn`**: `-n 50` — последние 50 строк, `-f` — следить в реальном времени (как `tail -f`), `--since "10 min ago"` — за последние 10 минут.

## Наглядно
**Рисунок 1.** Unit-файл, systemd и процессы Gunicorn.

![Рисунок 1. /etc/systemd/system/gunicorn.service: User=shop, WorkingDirectory=/srv/shop, EnvironmentFile=/srv/shop/.env, ExecStart=/srv/shop/venv/bin/gunicorn …, Restart=always. systemd (PID 1) по daemon-reload читает файл, по start запускает master Gunicorn от shop с переменными из .env; упал — перезапускает; enable — запуск при загрузке. Вывод Gunicorn уходит в журнал: journalctl -u gunicorn](img/systemd.svg)

**Таблица 1.** Команды systemd.

| Задача | Команда |
|---|---|
| перечитать unit-файлы | `sudo systemctl daemon-reload` |
| запустить / остановить | `sudo systemctl start gunicorn` / `stop` |
| перезапустить после деплоя | `sudo systemctl restart gunicorn` |
| автозапуск при загрузке | `sudo systemctl enable gunicorn` |
| состояние | `systemctl status gunicorn --no-pager` |
| последние строки журнала | `journalctl -u gunicorn -n 50 --no-pager` |
| следить за журналом | `journalctl -u gunicorn -f` |

## На практике
Задача: запустить Gunicorn магазина службой и разобраться, почему после правки она не стартует. Команды выполнены на настоящем Ubuntu (в тренажёре systemd нет); имя сервера в журнале — `shop-server`, длинные строки сокращены.

### Шаг 1. Запуск и состояние
Unit-файл из теории уже лежит в `/etc/systemd/system/gunicorn.service`:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gunicorn
systemctl status gunicorn --no-pager
```
Результат:
```
● gunicorn.service - Gunicorn for shop
     Loaded: loaded (/etc/systemd/system/gunicorn.service; enabled; preset: enabled)
     Active: active (running) since Sat 2026-11-21 18:56:18 MSK; 2s ago
   Main PID: 8732 (gunicorn)
      Tasks: 4 (limit: 16185)
     Memory: 68.8M (peak: 69.1M)
        CPU: 453ms
     CGroup: /system.slice/gunicorn.service
```
`enabled` — запустится при загрузке, `active (running)` — работает сейчас, `Main PID` — master. Под строкой `CGroup` systemd рисует дерево процессов службы — master и два воркера (здесь убрано).

### Шаг 2. Журнал службы
Что Gunicorn написал при старте:
```bash
journalctl -u gunicorn -n 5 --no-pager
```
Результат:
```
Nov 21 18:56:18 shop-server gunicorn[8732]: [2026-11-21 18:56:18 +0300] [8732] [INFO] Starting gunicorn 26.2.0
Nov 21 18:56:18 shop-server gunicorn[8732]: [2026-11-21 18:56:18 +0300] [8732] [INFO] Listening at: http://127.0.0.1:8000 (8732)
Nov 21 18:56:18 shop-server gunicorn[8732]: [2026-11-21 18:56:18 +0300] [8732] [INFO] Using worker: sync
Nov 21 18:56:18 shop-server gunicorn[8734]: [2026-11-21 18:56:18 +0300] [8734] [INFO] Booting worker with pid: 8734
Nov 21 18:56:18 shop-server gunicorn[8735]: [2026-11-21 18:56:18 +0300] [8735] [INFO] Booting worker with pid: 8735
```
`Listening at: http://127.0.0.1:8000` — Gunicorn слушает порт; Nginx будет пересылать запросы сюда.

### Шаг 3. Служба не стартует
В `ExecStart` по ошибке указали путь к несуществующему окружению. После правки и перезапуска:
```bash
sudo systemctl daemon-reload
sudo systemctl restart gunicorn
systemctl status gunicorn --no-pager
```
Результат:
```
× gunicorn.service - Gunicorn for shop
     Loaded: loaded (/etc/systemd/system/gunicorn.service; enabled; preset: enabled)
     Active: failed (Result: exit-code) since Sat 2026-11-21 18:56:27 MSK; 1s ago
   Duration: 1ms
    Process: 8957 ExecStart=/srv/shop/venv/bin/gunicorn --workers 2 --bind 127.0.0.1:8000 config.wsgi:application (code=exited, status=203/EXEC)
   Main PID: 8957 (code=exited, status=203/EXEC)
        CPU: 628us
```
`status=203/EXEC` — systemd не смог **запустить** программу из `ExecStart`: файла нет или нет права на запуск. Проверка — `ls -l /srv/shop/venv/bin/gunicorn`. Если же программа запустилась и упала сама (ошибка в коде, `ModuleNotFoundError`), статус будет `status=1/FAILURE`, а причина — в `journalctl -u gunicorn`.

### Шаг 4. После деплоя
Новая версия кода выложена — перезапуск и проверка:
```bash
sudo systemctl restart gunicorn
systemctl is-active gunicorn
```
Результат:
```
active
```
`is-active` печатает одно слово и ставит код выхода 0/не 0 — удобно в скрипте деплоя.

## Частые ошибки
- **Править unit-файл без `daemon-reload`.** systemd помнит старую версию — изменения не действуют, а `status` предупреждает `changed on disk`.
- **`start` без `enable`.** Сайт работает до первой перезагрузки сервера. Для постоянной службы — `enable --now`.
- **Относительный путь или «просто gunicorn» в `ExecStart`.** У службы нет `PATH` из `~/.bashrc`: `status=203/EXEC`. Полный путь в `venv`.
- **Переменные в `~/.bashrc` вместо unit-файла.** Службы его не читают: Django не видит `SECRET_KEY`. `EnvironmentFile=/srv/shop/.env`.
- **Служба от `root`.** Без `User=` Gunicorn работает от `root`. Всегда `User=shop`.
- **Смотреть только `status`.** В нём несколько последних строк; причина падения — в `journalctl -u … -n 50`.

## Итог
**Unit-файл**
- `[Unit]` (`After`), `[Service]` (`User`, `WorkingDirectory`, `EnvironmentFile`, `ExecStart` с полным путём, `Restart=always`), `[Install]` (`WantedBy`).

**Команды**
- `daemon-reload` после правки; `start`/`stop`/`restart`; `enable --now`; `status`, `is-active`.

**Журнал**
- `journalctl -u служба -n 50`, `-f`; `203/EXEC` — не запустилась программа, `1/FAILURE` — упала сама.

## Вопросы на собеседовании
<details><summary>Как сделать, чтобы Gunicorn запускался при загрузке и перезапускался при падении?</summary>

Описать службу systemd: unit-файл в `/etc/systemd/system/` с `ExecStart` (полный путь к gunicorn из venv), `User`, `WorkingDirectory`, `EnvironmentFile`, `Restart=always` и `WantedBy=multi-user.target`; затем `systemctl daemon-reload` и `systemctl enable --now`. Альтернатива — запуск в контейнере с политикой перезапуска Docker.
</details>

<details><summary>Чем `systemctl enable` отличается от `start`?</summary>

`start` запускает службу сейчас, до остановки или перезагрузки. `enable` создаёт ссылки, по которым systemd запустит службу при загрузке, но сейчас её не запускает. Обычно нужны оба: `enable --now`.
</details>

<details><summary>Служба в статусе failed. Как найти причину?</summary>

`systemctl status служба` — код выхода и последние строки; `journalctl -u служба -n 100 --no-pager` — полный вывод программы. Код `203/EXEC` — не найден или не исполняемый файл из `ExecStart`, `217/USER` — нет пользователя из `User=`, `1/FAILURE` — программа упала сама (смотреть traceback). После исправления unit-файла — `daemon-reload`.
</details>

## Глубже
Слушает ли Gunicorn порт и доходит ли до него запрос — следующая тема, сеть. Nginx перед Gunicorn и выкладка целиком — курс «Nginx и деплой».
