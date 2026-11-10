# SITE_NAME

Платформа практики для разработчиков: короткая теория + интерактивные
тренажёры (SQL, ORM, Python, Linux) прямо в браузере.

Архитектура, стек и этапы — в [docs/architecture.md](docs/architecture.md),
деплой — в [docs/deploy.md](docs/deploy.md).

## Запуск в Docker (рекомендуется)

```bash
cp .env.example .env              # и впишите SECRET_KEY
docker compose up --build
```

Сайт: http://localhost:8000. Поднимаются три контейнера: `db` (PostgreSQL 16),
`redis`, `web` (Django, runserver). Код из `src/` подключён папкой — правки видны сразу.

## Контент

Курсы, уроки и задачи лежат в `content/` (формат — [docs/content-format.md](docs/content-format.md)).
В базу их загружает команда — после изменений в `content/` запустите её снова:

```bash
docker compose exec web python manage.py load_content
```

Повторный запуск обновляет записи, а не создаёт дубли. Удалённое из `content/`
скрывается с сайта, но не удаляется из базы (на него может ссылаться прогресс).

## Тесты и линтер

Нужен Python 3.12.

```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
flake8
pytest
```

Тестам с базой данных нужен PostgreSQL: проще всего держать запущенным
`docker compose up db` (порт 5432 открыт только для вашего компьютера).

Тесты тренажёров на JS (симуляторы Linux и Git, движок SQL) — в Node 20+.
Из npm нужен только PGlite той же версии, что грузится в браузере:

```bash
npm ci
npm test
```

## Структура

```
src/
├── config/          настройки (settings/base, development, production, test) и urls
├── core/            общий код: context processors, страницы ошибок, health-check
├── apps/            приложения: pages, courses, cheatsheets, trainers, accounts
├── templates/       base/, common/, <страница>/components/ — как помечено в design/
└── static/          css/ (base, components, pages/*, media), js/, fonts/
tests/               pytest
design/              макет — эталон дизайна, как код проекта не правится
```
