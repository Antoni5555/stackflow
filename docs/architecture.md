# Архитектура

Платформа практики для разработчиков: короткая теория + интерактивные
тренажёры прямо в браузере. Контент делится на направления (сейчас — Backend на Python):
направление → курс → раздел → тема → урок и задачи.

## Главный принцип

**Сервер не выполняет код пользователей.** Python, SQL и Linux работают в браузере
(Pyodide, PGlite, свой симулятор). Сервер отдаёт страницы и хранит аккаунты, прогресс
и заметки — поэтому он простой, дешёвый и его нельзя взломать через тренажёр.

## Стек

| Слой | Технология | Зачем |
|---|---|---|
| Язык / фреймворк | Python 3.12, Django 5.2 | страницы рендерит сервер — быстро и хорошо для поиска |
| БД сайта | PostgreSQL 16 (во всех окружениях) | пользователи, прогресс, заметки, контент |
| Кэш | Redis | общий для всех воркеров Gunicorn |
| API | Django REST Framework | сохранение прогресса и заметок из JS (только сессия + CSRF) |
| Аккаунты | своя модель `accounts.User` (вход по email) + django-allauth | регистрация с подтверждением почты |
| Markdown | `markdown-it-py` + `Pygments`; `nh3` для заметок | уроки → HTML при загрузке; заметки пользователей → очищенный HTML |
| Интерактив | ванильный JS (ES-модули), без сборщика | каждая страница грузит только своё |
| Python-движок | Pyodide в Web Worker | Python в браузере; позже Django через тестовый клиент |
| SQL-движок | PGlite в Web Worker | Postgres в браузере |
| Linux | свой симулятор на JS | лёгкий и безопасный |
| Сервер | Gunicorn + Nginx, HTTPS — Let's Encrypt | |
| Инфраструктура | Docker Compose, GitHub Actions, образы в GHCR | деплой только после зелёных тестов — [deploy.md](deploy.md) |
| Тесты | pytest, pytest-django, factory-boy, flake8 | |

## Структура

```
content/                         уроки (.md) и задачи (.yaml) — формат: docs/content-format.md
  backend/<курс>/<NN-раздел>/<NN-тема>/
src/
  config/settings/               base, development, production, test
  core/                          общее: context processors (SITE_NAME), ошибки, хранилище статики;
                                 не импортирует из apps/
  apps/
    pages/                       главная, о проекте, юридические документы
    courses/                     Track → Course → Section → Topic → Lesson / Exercise, load_content
    trainers/                    страницы задач и песочницы
    progress/                    прогресс по задачам и урокам
    cheatsheets/                 заметки → шпаргалки
    accounts/                    пользователь, регистрация, профиль
    feedback/                    сообщения об ошибках в уроках и задачах
  templates/                     base/, common/_*.html, <страница>/components/_*.html
  static/
    css/                         base, components, pages/*, media
    js/engines/<движок>/         движки тренажёров (единый интерфейс init/run/check/reset)
tests/                           pytest
design/                          макет — эталон дизайна
deploy/                          Nginx, скрипт деплоя
```

- Бизнес-логика — в `apps/<app>/services/`, views тонкие.
- Выборки для страниц делают фиксированное число SQL-запросов (без N+1), это проверяют тесты.

## Модели

```
courses:     Track → Course(engine) → Section(level) → Topic → Lesson (1:1) / Exercise(type, spec JSON)
             у всех is_published; slug уникален внутри родителя, у курса — на весь сайт
accounts:    User(email — логин, имя, фамилия, время согласия на обработку данных)
progress:    ExerciseProgress(user, exercise, solved_at), LessonView(user, lesson, viewed_at)
cheatsheets: Note(user, course, topic NULL = «Из тренажёра», exercise NULL, title, body_html)
feedback:    ContentReport(user, topic, exercise NULL = урок, quote, context, comment, status)
```

- Контент не редактируется в админке: он приходит из `content/` командой `load_content`
  (идемпотентно; удалённое из `content/` скрывается, а не удаляется — на него может ссылаться прогресс).
- Шпаргалка курса — не отдельная модель, а заметки пользователя по курсу, сгруппированные по теме.
- Прогресс гостя хранится в `localStorage` браузера и переносится на сервер после входа.
- Об ошибке в уроке или задаче сообщают, выделив текст: сообщение попадает в админку
  вместе с путём к файлу в `content/`. Правят файл, а не базу — `load_content` перезаписал бы
  правку из админки. Только вошедшим, не больше 20 сообщений в час.
- Админка — на Unfold: меню собрано по смыслу (настройки `UNFOLD` в `config/settings/base.py`),
  главная — счётчики и новые сообщения об ошибках (`core/admin_dashboard.py`,
  `templates/admin/index.html`). Заметки и прогресс — только просмотр и удаление.

## Как макет превращается в шаблоны

1. Каждый кусок `design/index.html` с комментарием `[templates/…]` → отдельный файл по этому пути.
2. Повторяющиеся куски → `templates/common/`, подключаются через `{% include %}`.
3. CSS: переменные и база → `base.css`, компоненты → `components.css`, страницы → `pages/*.css`
   (страница подключает только свой файл), адаптив → `media.css`.
4. Тестовые данные макета заменяются данными из базы.

## Этапы

| Этап | Что | Статус |
|---|---|---|
| 0. Скелет | Django, настройки, Docker Compose, базовый шаблон, CSS из макета, тема, CI | готово |
| 1. Каталог и теория | модели курсов, `load_content`, каталог, курс, урок | готово |
| 2. Python-тренажёр | Pyodide в Web Worker, редактор, проверка задач, песочница | готово |
| 3. Аккаунты, прогресс, заметки | регистрация, прогресс, заметки и шпаргалки, профиль | готово |
| Деплой | production-compose, Nginx, HTTPS, CI с деплоем | подготовлен, ждёт сервера |
| 4. SQL-тренажёр | PGlite, журнал выполнения, подсветка изменений, схема базы, пары JOIN, проверка задач | готово |
| 5. Django и Linux | Django через тестовый клиент в Pyodide, симулятор shell, затем Git | впереди |
| 6. Docker, Nginx, новые направления | | впереди |
