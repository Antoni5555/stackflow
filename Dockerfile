# Из одного Dockerfile собираются два образа:
#   web   (по умолчанию) — Django + Gunicorn;
#   nginx (--target nginx) — Nginx со статикой той же версии, что код.
# Статика собирается один раз (этап static) и копируется в оба образа.

# --- 1. Ставим зависимости в отдельное виртуальное окружение ---
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN python -m venv /venv
ENV PATH=/venv/bin:$PATH

COPY requirements.txt .
RUN pip install -r requirements.txt


# --- 2. Собираем статику ---
FROM python:3.12-slim AS static

ENV PATH=/venv/bin:$PATH
COPY --from=builder /venv /venv
WORKDIR /app
COPY src/ .

# SECRET_KEY здесь фиктивный — collectstatic ничего не шифрует и не ходит в БД.
# Сначала — архив Django для тренажёра (static/vendor/django.zip, в git его нет)
RUN DJANGO_SETTINGS_MODULE=config.settings.production SECRET_KEY=collectstatic \
    sh -c 'python manage.py build_django_bundle && python manage.py collectstatic --noinput'


# --- 3. Образ Nginx: конфиг + готовая статика ---
FROM nginx:1.29-alpine AS nginx

# Шаблон конфига: при старте контейнера nginx подставит ${DOMAIN} из окружения
COPY deploy/nginx/default.conf.template /etc/nginx/templates/
COPY --from=static /app/staticfiles /usr/share/nginx/static


# --- 4. Образ приложения (собирается по умолчанию) ---
FROM python:3.12-slim AS web

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/venv/bin:$PATH

# Приложение работает не от root: если его взломают, у процесса минимум прав
RUN useradd --create-home --uid 1000 app

COPY --from=builder /venv /venv

WORKDIR /app
COPY --chown=app:app src/ .

# Django нужен manifest статики (staticfiles.json), чтобы {% static %}
# выдавал имена с хешем. Сами файлы раздаёт Nginx.
COPY --from=static --chown=app:app /app/staticfiles ./staticfiles

# Контент для load_content (на сервере — отдельный шаг деплоя после миграций)
COPY --chown=app:app content/ /content/
ENV CONTENT_DIR=/content

USER app

EXPOSE 8000

# Миграции здесь не запускаются — это отдельный шаг деплоя
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "2", "--threads", "4", "--worker-class", "gthread"]
