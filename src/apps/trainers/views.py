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


# Тренажёр Django по умолчанию: каталог магазина. Список товаров специально
# с N+1 (категория — отдельным запросом на товар), orm.py — как это исправить
PLAYGROUND_DJANGO = {
    'files': {
        'models.py': """from django.db import models


class Category(models.Model):
    name = models.CharField(max_length=100)

    def __str__(self):
        return self.name


class Product(models.Model):
    name = models.CharField(max_length=200)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    stock = models.PositiveIntegerField(default=0)
    category = models.ForeignKey(
        Category, on_delete=models.PROTECT, related_name="products",
    )

    def __str__(self):
        return self.name
""",
        'views.py': """from django.shortcuts import get_object_or_404, render

from .models import Product


def product_list(request):
    products = Product.objects.order_by("price")
    return render(request, "shop/product_list.html", {"products": products})


def product_detail(request, pk):
    product = get_object_or_404(Product, pk=pk)
    return render(request, "shop/product_detail.html", {"product": product})
""",
        'urls.py': """from django.urls import path

from . import views

urlpatterns = [
    path("products/", views.product_list, name="product_list"),
    path("products/<int:pk>/", views.product_detail, name="product_detail"),
]
""",
        'templates/shop/product_list.html': """<h1>Каталог</h1>
<ul>
  {% for product in products %}
    <li>
      <a href="{% url 'product_detail' product.pk %}">{{ product.name }}</a>
      — {{ product.category.name }}, {{ product.price }} ₽
    </li>
  {% empty %}
    <li>Товаров пока нет.</li>
  {% endfor %}
</ul>
""",
        'templates/shop/product_detail.html': """<p>
  <a href="{% url 'product_list' %}">← Каталог</a>
</p>
<h1>{{ product.name }}</h1>
<p>{{ product.category.name }} · {{ product.price }} ₽</p>
<p>
  {% if product.stock %}В наличии: {{ product.stock }} шт.
  {% else %}Нет в наличии{% endif %}
</p>
""",
        'orm.py': """# Строки ORM, как в manage.py shell: видно результат и SQL.
# Последняя строка-выражение выводится сама.
cheap = Product.objects.filter(price__lt=5000).select_related("category")
for product in cheap:
    print(product.name, "—", product.category.name)

Product.objects.count()
""",
    },
    # Учебные данные: выполняются после migrate на каждом запуске (как фикстура)
    'setup': """laptops = Category.objects.create(name="Ноутбуки")
phones = Category.objects.create(name="Смартфоны")
accessories = Category.objects.create(name="Аксессуары")
for name, price, stock, category in [
    ("Ноутбук Aster 14", 64990, 5, laptops),
    ("Ноутбук Nimbus Air", 54990, 0, laptops),
    ("Смартфон Pixelon 8", 39990, 12, phones),
    ("Смартфон Lumo S", 24990, 3, phones),
    ("Беспроводная мышь", 1499, 40, accessories),
    ("Коврик для мыши", 490, 100, accessories),
    ("USB-хаб на 4 порта", 1499, 0, accessories),
]:
    Product.objects.create(name=name, price=price, stock=stock, category=category)
""",
}


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
    """Тренажёр-песочница без задач. ?engine= python, html, sql, django, linux, git."""

    template_name = 'trainers/playground.html'
    extra_context = {'active_nav': 'playground'}
    engines = ('python', 'html', 'sql', 'django', 'linux', 'git')

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
        if engine == 'django':
            context['django_project'] = PLAYGROUND_DJANGO
            context['django_file_names'] = list(PLAYGROUND_DJANGO['files'])
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
