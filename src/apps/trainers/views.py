"""Страницы тренажёров: задача и песочница.

Данные готовят функции из apps/courses/services/selectors.py.
"""

from django.conf import settings
from django.views.generic import TemplateView

from apps.courses.services import selectors
from apps.cheatsheets.services.notes import note_panel
from apps.progress.services import progress
from apps.courses.services.rendering import highlight, highlight_file


class EngineMixin:
    """Адреса Pyodide и PGlite для страниц тренажёров."""

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['PYODIDE_URL'] = settings.PYODIDE_URL
        context['PGLITE_URL'] = settings.PGLITE_URL
        return context


class ExerciseView(EngineMixin, TemplateView):
    """Задача: условие, редактор, проверка в браузере."""

    template_name = 'trainers/exercise_detail.html'
    extra_context = {'active_nav': 'courses'}

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context.update(selectors.exercise_page(
            kwargs['course'], kwargs['section'], kwargs['topic'], kwargs['exercise'],
        ))
        exercise = context['exercise']
        progress.apply_to_outline(context['sections'], self.request.user)
        exercise.is_solved = any(
            item.is_solved for section in context['sections']
            for topic in section.topics.all() for item in topic.exercises.all()
            if item.pk == exercise.pk
        )
        context['exercise_key'] = progress.exercise_key(exercise)
        context['note'] = note_panel(
            self.request.user, context['course'], context['topic'],
            context['exercise_key'],
        )
        spec = exercise.spec
        # Код на странице — с подсветкой, как в уроке
        if exercise.type == exercise.Type.PREDICT:
            code = spec['code'].rstrip('\n')
            context['code_html'] = highlight(code, 'python')
            context['code_line_numbers'] = '\n'.join(
                str(n) for n in range(1, code.count('\n') + 2)
            )
        if spec.get('inputs'):
            context['inputs_html'] = highlight(spec['inputs'].rstrip('\n'), 'python')
        # dom — задача на вёрстку: файлы и правила по готовой странице, как у fix
        context['check_type'] = check_type = spec.get('check', {}).get('type')
        # SQL-задача: решение и эталон выполняет PGlite в браузере на учебной базе
        is_sql = context['course'].engine == 'sql' and exercise.type == 'exercise'
        context['is_sql'] = is_sql
        if is_sql:
            solution = spec['solution'].rstrip('\n')
            context['solution_html'] = highlight(solution, 'postgresql')
            context['sql_dataset'] = selectors.sql_dataset(context['course'])
        elif check_type in ('tests', 'state'):
            # state — задача в терминале: эталон — команды, подсветка как у bash
            solution = spec['solution'].rstrip('\n')
            context['solution_html'] = highlight(
                solution, 'bash' if check_type == 'state' else 'python',
            )
        if exercise.type == exercise.Type.FIX or check_type == 'dom':
            # исправленные файлы — в разборе; язык подсветки — по имени файла
            context['solution_files'] = [
                (name, highlight_file(spec['solution'][name].rstrip('\n'), name))
                for name in spec['file_names'] if name in spec['solution']
            ]

        # Данные для JS: тип и всё, что нужно проверке. Подсказки и варианты quiz уже
        # в HTML страницы, эталон fix — в разборе
        hidden = {'hints', 'options'}
        # эталон SQL нужен браузеру: с ним сравнивается решение ученика
        if not is_sql and (
            exercise.type == exercise.Type.FIX or check_type in ('dom', 'state')
        ):
            hidden.add('solution')
        context['exercise_data'] = {
            'type': exercise.type,
            **{key: value for key, value in spec.items() if key not in hidden},
        }
        return context


# Файлы тренажёра HTML по умолчанию: карточка товара магазина
PLAYGROUND_HTML = {
    'index.html': """<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Магазин</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <article class="card">
    <h1 class="card__title">Беспроводная мышь</h1>
    <p class="card__price">1 290 ₽</p>
    <button class="card__buy">В корзину</button>
  </article>
</body>
</html>
""",
    'style.css': """body {
  font-family: system-ui, sans-serif;
  padding: 24px;
}

.card {
  max-width: 280px;
  padding: 16px;
  border: 1px solid #ddd;
  border-radius: 12px;
}

.card__price {
  font-weight: 700;
  color: #2a7a2a;
}
""",
}


# Тренажёр Linux по умолчанию: сервер магазина (формат — как setup задач state)
PLAYGROUND_LINUX = {
    'cwd': '/srv/shop',
    'files': {
        '/srv/shop/manage.py': {'content': '#!/usr/bin/env python3\n', 'mode': '755'},
        '/srv/shop/requirements.txt': 'Django==5.2\npsycopg==3.2\n',
        '/srv/shop/.env': {
            'content': 'DEBUG=False\nSECRET_KEY=change-me\n', 'mode': '600',
        },
        '/srv/shop/config/settings.ini': 'DEBUG=False\nALLOWED_HOSTS=stack-flow.ru\n',
        '/srv/shop/logs/app.log': (
            'INFO  start server\nINFO  GET /catalog/ 200\n'
            'ERROR db connection lost\nINFO  GET /cart/ 200\n'
            'ERROR timeout /api/orders/\n'
        ),
        '/srv/shop/data/orders.csv': (
            'id,city,total\n1,Moscow,500\n2,Kazan,1200\n3,Moscow,90\n4,Omsk,750\n'
        ),
        '/srv/shop/media/photo.jpg': {'size': '3M'},
        '/srv/shop/deploy.sh': '#!/bin/bash\necho "Деплой магазина: $1"\n',
        '/etc/nginx/sites-available/shop.conf': {
            'content': 'server {\n    listen 80;\n    server_name stack-flow.ru;\n}\n',
            'owner': 'root',
        },
        '/var/log/nginx/access.log': {'size': '12M', 'owner': 'www-data', 'mtime': 9},
        '/var/log/nginx/error.log': {'content': '', 'owner': 'www-data', 'mtime': 2},
    },
    'dirs': ['/srv/shop/backup', {'/etc/nginx/sites-enabled': {'owner': 'root'}}],
}


# Тренажёр SQL по умолчанию: JOIN и UPDATE на учебной базе магазина
PLAYGROUND_SQL = """-- Учебная база «магазин»: таблицы и колонки — в «Схеме базы» ниже.
-- Ctrl + Enter — выполнить всё; можно выделить запрос и выполнить только его.

SELECT p.name, p.price, c.name AS category
FROM products p
JOIN categories c ON c.id = p.category_id
WHERE p.price > 30000
ORDER BY p.price DESC;

UPDATE products SET stock = stock + 5 WHERE id = 1;
"""


# Тренажёр Git по умолчанию: проект магазина с историей, веткой и «GitHub»
PLAYGROUND_GIT = {
    'cwd': '/home/shop/shop',
    'commits': [
        {'message': 'Каркас магазина', 'files': {
            'README.md': '# Магазин\n',
            'shop/settings.py': 'DEBUG = True\nALLOWED_HOSTS = []\n',
            '.gitignore': '.env\nvenv/\n__pycache__/\n',
        }},
        {'message': 'Каталог товаров', 'files': {
            'catalog/models.py': 'class Product:\n    name = ""\n    price = 0\n',
        }},
        # promo ответвляется до «Корзины»: в графе развилка, слияние — merge-коммит
        {'message': 'Промокоды: модель', 'branch': 'promo', 'files': {
            'promo/models.py': 'class Promo:\n    code = ""\n    discount = 0\n',
        }},
        {'message': 'Корзина', 'files': {
            'cart/views.py': 'def cart(request):\n    pass\n',
        }},
    ],
    'head': 'main',
    'remote': {'url': 'git@github.com:shop/shop.git', 'pushed': ['main']},
    'files': {'/home/shop/shop/.env': 'SECRET_KEY=change-me\n'},
}


class PlaygroundView(EngineMixin, TemplateView):
    """Тренажёр-песочница без задач. ?engine= python, html, sql, linux или git."""

    template_name = 'trainers/playground.html'
    extra_context = {'active_nav': 'playground'}
    engines = ('python', 'html', 'sql', 'linux', 'git')

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        engine = self.request.GET.get('engine')
        engine = engine if engine in self.engines else self.engines[0]
        context['engine'] = engine
        context.update(selectors.playground(engine))
        if engine == 'html':
            context['html_files'] = PLAYGROUND_HTML
            context['html_file_names'] = list(PLAYGROUND_HTML)
        if engine == 'linux':
            context['linux_setup'] = PLAYGROUND_LINUX
        if engine == 'git':
            context['git_setup'] = PLAYGROUND_GIT
        if engine == 'sql':
            context['sql_code'] = PLAYGROUND_SQL
            context['sql_dataset'] = selectors.sql_dataset(context['course'])
        course = context['course']
        if course:
            context['note'] = note_panel(self.request.user, course, None, course.slug)
            context['practice'] = selectors.practice_topics(context['sections'])
        return context


class PracticeView(TemplateView):
    """Задачи задачника одной темы — кусок HTML для плашки «Задачник»."""

    template_name = 'trainers/components/_practice_tasks.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['topic'] = selectors.practice_topic(
            kwargs['course'], kwargs['section'], kwargs['topic'],
        )
        return context


class HtmlCheckView(TemplateView):
    """Только при DEBUG: эталоны задач на вёрстку проверяются в браузере.

    Стили считает только браузер, поэтому check_tasks.py (Python) их не проверит.
    Страница прогоняет каждую задачу: эталон проходит все правила, заготовка — нет.
    """

    template_name = 'trainers/html_check.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        exercises = selectors.dom_exercises()
        context['exercises'] = exercises
        context['exercises_data'] = [
            {
                'url': exercise.get_absolute_url(),
                'title': exercise.title,
                'files': exercise.spec['files'],
                'solution': exercise.spec['solution'],
                'rules': exercise.spec['check']['rules'],
            }
            for exercise in exercises
        ]
        return context
