# Курс: Docker — шаг 80

**Контекст:** магазин работает «только у автора на ноутбуке». Ученик упаковывает его в контейнеры: сначала запускает Postgres магазина в Docker, потом пишет Dockerfile для Django и собирает весь стек (Django + Postgres + Nginx) в compose.
**Тренажёр:** нет (`engine` пустой). Задачи — `fix` (исправить или дописать Dockerfile/compose, проверка по правилам) и `quiz` (что сделает команда, порядок шагов).
**Источники:** `training_skills/Docker/DOCKER_basic_command.md` (**DB**), `clear_docker_imaage.md` (**CLR**), `training_skills/SQL/00_docker_container_postgres.md`, compose-файлы из `middle_course/new_admin_panel_sprint_2|3/docker_compose` (ориентир).

Формат — [docs/content-format.md](../../docs/content-format.md), легенда — [00-overview.md](00-overview.md).

## 1. Основы ●○○
| # | Тема | Что разбираем | Задача из магазина | Сырьё |
|---|---|---|---|---|
| 01 | Зачем Docker | «у меня работает», контейнер vs виртуальная машина, образ vs контейнер, Docker Hub | почему новый разработчик два дня не может запустить магазин | 🟡 DB «Что такое контейнер?» |
| 02 | Запуск контейнера | `docker run`, `-d`, `--name`, `-p`, `-e`, `--rm` | запустить Postgres магазина | ✅ DB «Запуск нового контейнера», ч.2 |
| 03 | Управление контейнерами | `ps -a`, `stop/start/restart`, `rm`, `logs -f`, `exec -it` | зайти в `psql` внутри контейнера | ✅ DB «Основные команды», «Подключение» |
| 04 | Образы | `pull`, `images`, теги, `rmi`, почему не `latest` | зафиксировать версию `postgres:16` | 🟡 DB |

## 2. Данные и сеть ●●○
| # | Тема | Что разбираем | Задача из магазина | Сырьё |
|---|---|---|---|---|
| 01 | Volumes и bind mounts | где живут данные, именованный том vs папка | данные БД магазина пропали после `rm` | ✅ DB «Работа с файлами», «Монтирование» |
| 02 | Переменные окружения | `-e`, `--env-file`, секреты не в образе | передать пароль БД через `.env` | 🟡 DB |
| 03 | Сети | bridge-сеть, обращение по имени контейнера, `localhost` внутри контейнера | Django не видит БД по `localhost` | ❌ |

## 3. Dockerfile ●●○
| # | Тема | Что разбираем | Задача из магазина | Сырьё |
|---|---|---|---|---|
| 01 | Первый Dockerfile | `FROM`, `WORKDIR`, `COPY`, `RUN`, `CMD`, `docker build -t` | образ Django-приложения магазина | ❌ |
| 02 | Слои и кэш | как строятся слои, порядок `COPY requirements.txt` → `pip install` → `COPY .` | сборка идёт 5 минут при каждой правке | ❌ |
| 03 | `.dockerignore` | что исключать | в образ попали `.git`, `venv` и `.env` | ❌ |
| 04 | Инструкции подробнее | `CMD` vs `ENTRYPOINT`, `EXPOSE`, `ARG` vs `ENV`, Gunicorn как команда запуска | запуск через `gunicorn shop.wsgi` | ❌ |
| 05 | Оптимизация образа | `slim`-образы, multi-stage, не-root пользователь, `PYTHONDONTWRITEBYTECODE` | уменьшить образ с 1 ГБ до 200 МБ | ❌ ●●● |
| 06 | Публикация образа | registry (Docker Hub, GHCR), `tag`, `login`, `push`, `pull` на сервере | доставить образ магазина на сервер | ❌ |

## 4. Docker Compose ●●●
| # | Тема | Что разбираем | Задача из магазина | Сырьё |
|---|---|---|---|---|
| 01 | compose.yaml | `services`, `image` vs `build`, `ports`, `docker compose up/down/logs` | Django + Postgres одной командой | 🟡 middle_course (код) |
| 02 | Зависимости и healthcheck | `depends_on` + `condition: service_healthy` | Django стартует раньше БД и падает | ❌ |
| 03 | Тома и окружение в compose | `volumes`, `env_file` | данные и настройки в compose | ❌ |
| 04 | Стек магазина | Django + Postgres + Nginx, статика через общий том, миграции при старте | собрать прод-подобный стек | ❌ |
| 05 | Обслуживание | `system df`, `prune` (что безопасно), логи контейнеров | на сервере кончилось место | ✅ CLR |

## Итог
4 раздела, 18 тем. Есть хорошая база по командам. Dockerfile и compose — главное содержание курса — пишутся с нуля.
