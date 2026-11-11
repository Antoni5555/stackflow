"""Страница задачи и песочница Python."""
import json
import re

import pytest
from django.urls import reverse

from apps.courses.models import Exercise
from apps.trainers.views import HtmlCheckView
from tests.factories import (
    CourseFactory, ExerciseFactory, SectionFactory, TopicFactory, TrackFactory,
)


pytestmark = pytest.mark.django_db


def exercise_url(slug):
    return reverse('trainers:exercise', args=['python', 'basics', 'hello', slug])


def exercise_data(html):
    """JSON с данными задачи, который страница передаёт в JS."""
    match = re.search(
        r'<script id="exercise-data" type="application/json">(.*?)</script>', html,
    )
    return json.loads(match.group(1))


def test_exercise_page(client, loaded_content):
    response = client.get(exercise_url('greeting'))
    html = response.content.decode()

    assert response.status_code == 200
    assert '<h1 class="task__title">Приветствие</h1>' in html
    assert 'Задача 1' in html and 'Лёгкая' in html
    assert 'Подсказка 1 из 1' in html
    assert '>print(...)\n</textarea>' in html                 # заготовка в редакторе
    assert 'js/pages/exercise.js' in html
    assert 'data-pyodide="https://cdn.jsdelivr.net/pyodide/v0.27.8/full/"' in html
    # разбор и эталон — на странице, но скрыты до верного решения
    assert 'data-explanation hidden' in html and 'Эталонное решение' in html

    data = exercise_data(html)
    assert data['type'] == 'exercise'
    assert data['starter_code'] == 'print(...)\n'
    assert data['check']['tests'][0]['fail'] == 'Нужно вывести слово Привет.'
    assert 'hints' not in data


def test_exercise_navigation(client, loaded_content):
    """← урок темы, → следующая задача; в программе курса задача выделена."""
    html = client.get(exercise_url('greeting')).content.decode()

    assert 'aria-label="Назад: Привет, Python"' in html
    assert 'aria-label="Дальше: Что выведет"' in html
    assert ('<li class="lesson lesson--task lesson--current" '
            'data-exercise-key="python/basics/hello/greeting">'
            '<a href="/courses/python/basics/hello/greeting/">'
            '<span class="lesson__label">Задача 1</span>Приветствие</a>') in html


def test_playground_opens_first_section(client, loaded_content):
    """В песочнице нет текущей темы — открыт первый раздел, как на странице курса."""
    html = client.get(reverse('trainers:playground')).content.decode()

    assert '<details class="module-nav" open>' in html
    # в тренажёре — только разделы и темы, без задач
    assert 'topic--flat' in html and 'lesson--task' not in html
    assert 'href="/courses/python/basics/hello/"' in html


def test_predict_page(client, loaded_content):
    html = client.get(exercise_url('guess')).content.decode()

    assert 'Что выведет код' in html
    assert '<span class="fn">print</span>' in html            # код с подсветкой
    assert 'editor--answer' in html
    assert exercise_data(html) == {
        'type': 'predict', 'code': 'print(True + True)\n', 'answer': '2\n',
    }


def test_quiz_page(client, loaded_content):
    """quiz: варианты — в HTML, ответ — в данных для JS; Python не грузится."""
    html = client.get(exercise_url('pick')).content.decode()

    assert 'data-quiz="single"' in html
    assert html.count('type="radio" name="quiz"') == 2
    assert '<code>409</code> Conflict' in html          # вариант — Markdown в HTML
    assert exercise_data(html) == {'type': 'quiz', 'kind': 'single', 'answer': [1]}
    assert 'js/pages/quiz.js' in html and 'js/pages/exercise.js' not in html


@pytest.mark.parametrize('kind, control', [
    ('multiple', 'type="checkbox" name="quiz"'),
    ('order', 'data-move="-1"'),
])
def test_quiz_kinds(client, loaded_content, kind, control):
    exercise = Exercise.objects.get(slug='pick')
    exercise.spec = {**exercise.spec, 'kind': kind, 'answer': [1, 0]}
    exercise.save()

    html = client.get(exercise_url('pick')).content.decode()

    assert f'data-quiz="{kind}"' in html and html.count(control) == 2


def test_fix_page(client, loaded_content):
    """fix: файлы и правила — в данных для JS, эталон — только в разборе."""
    html = client.get(exercise_url('fix-conf')).content.decode()
    data = exercise_data(html)

    assert data['type'] == 'fix'
    assert data['files'] == {'nginx.conf': 'server {}\n'}
    assert data['file_names'] == ['nginx.conf']
    assert data['check']['rules'][0]['fail'] == 'Нужна директива client_max_body_size.'
    assert 'solution' not in data
    assert 'Исправленный nginx.conf' in html and 'client_max_body_size' in html
    # один файл — без вкладок
    assert '<span class="tab tab--static">nginx.conf</span>' in html
    assert 'js/pages/fix.js' in html and 'js/pages/exercise.js' not in html


def test_unknown_or_hidden_exercise_404(client, loaded_content):
    assert client.get(exercise_url('nope')).status_code == 404

    Exercise.objects.filter(slug='greeting').update(is_published=False)
    assert client.get(exercise_url('greeting')).status_code == 404


def test_last_exercise_has_no_next_but_lesson_follows(client, loaded_content):
    """После последней задачи темы — урок следующей темы."""
    html = client.get(exercise_url('fix-conf')).content.decode()

    assert 'aria-label="Дальше: Вторая тема"' in html


def test_playground(client, loaded_content):
    html = client.get(reverse('trainers:playground')).content.decode()

    assert 'data-playground="python"' in html
    assert 'js/pages/playground.js' in html
    assert 'Программа курса' in html and 'Основы' in html     # курс движка python


def test_playground_without_python_course(client, db):
    response = client.get(reverse('trainers:playground'))

    assert response.status_code == 200
    assert 'Программа курса' not in response.content.decode()


PRACTICE_URL = reverse('trainers:practice', args=['python', 'basics', 'hello'])


def test_playground_has_practice_card(client, loaded_content):
    """«Задачник» открыт; в списке — только темы с задачником, по разделам."""
    html = client.get(reverse('trainers:playground')).content.decode()

    card = re.search(
        r'<details class="side-card"[^>]*data-practice>(.*?)</details>', html, re.S,
    )
    assert card and ' open ' in card.group(0)
    assert f'<option value="{PRACTICE_URL}">' in card.group(1)
    assert '<optgroup label="Основы">' in card.group(1)
    assert 'second' not in card.group(1)                  # у второй темы задачника нет
    assert 'js/practice.js' in html


def test_practice_tasks(client, loaded_content):
    html = client.get(PRACTICE_URL).content.decode()

    assert html.count('data-practice-task') == 2
    assert 'Задача 1 из 2' in html and 'Сумма корзины' in html
    assert html.count('<summary>Намёк</summary>') == 1      # у второй задачи намёка нет
    assert html.count('<summary>Ответ</summary>') == 2
    assert '<html' not in html                              # кусок, не страница


def test_practice_404_without_tasks(client, loaded_content):
    url = reverse('trainers:practice', args=['python', 'basics', 'second'])

    assert client.get(url).status_code == 404


def dom_exercise(topic):
    """Задача на вёрстку в теме hello (после fix-conf)."""
    return ExerciseFactory(
        topic=topic, slug='layout', type='exercise', order=6,
        spec={
            'files': {'index.html': '<header></header>', 'style.css': 'header {}'},
            'file_names': ['index.html', 'style.css'],
            'check': {'type': 'dom', 'rules': [
                {'selector': 'header', 'style': {'display': 'flex'},
                 'fail': 'Нужен flex.'},
            ]},
            'solution': {'style.css': 'header { display: flex; }'},
            'hints': [],
        },
    )


def test_html_exercise_page(client, loaded_content):
    dom_exercise(Exercise.objects.get(slug='greeting').topic)

    html = client.get(exercise_url('layout')).content.decode()
    data = exercise_data(html)

    assert data['check']['type'] == 'dom' and 'solution' not in data
    assert 'sandbox="allow-same-origin"' in html      # скрипты ученика не идут
    assert html.count('data-file=') == 2              # вкладки index.html и style.css
    assert 'Эталон: style.css' in html
    assert 'js/pages/html-exercise.js' in html
    assert 'js/pages/exercise.js' not in html


def test_html_playground(client, loaded_content):
    html = client.get(reverse('trainers:playground') + '?engine=html').content.decode()

    assert 'data-playground="html"' in html and 'js/pages/playground-html.js' in html
    assert 'id="playground-files"' in html
    assert 'aria-current="page">HTML и CSS</a>' in html
    assert 'Программа курса' not in html         # курса с движком html ещё нет


def test_unknown_playground_engine_falls_back_to_python(client, loaded_content):
    html = client.get(reverse('trainers:playground') + '?engine=cobol').content.decode()

    assert 'data-playground="python"' in html


def test_html_check_page_lists_dom_exercises(rf, loaded_content):
    """Страница проверки эталонов (подключается только при DEBUG) — данные для JS."""
    dom_exercise(Exercise.objects.get(slug='greeting').topic)

    response = HtmlCheckView.as_view()(rf.get('/dev/html-check/'))
    response.render()

    data = response.context_data['exercises_data']
    layout = Exercise.objects.get(slug='layout')
    assert [item['title'] for item in data] == [layout.title]
    assert data[0]['solution'] == {'style.css': 'header { display: flex; }'}


def test_linux_playground(client, loaded_content):
    """Тренажёр Linux: терминал, дерево файлов и сервер по умолчанию для JS."""
    url = reverse('trainers:playground') + '?engine=linux'
    html = client.get(url).content.decode()

    assert 'data-playground="linux"' in html and 'js/pages/playground-linux.js' in html
    for part in ('data-terminal-input', 'data-file-tree', 'data-nano'):
        assert part in html
    setup = json.loads(re.search(
        r'<script id="linux-setup" type="application/json">(.*?)</script>', html, re.S,
    ).group(1))
    assert setup['cwd'] == '/srv/shop' and '/srv/shop/.env' in setup['files']
    assert 'aria-current="page">Linux</a>' in html


def test_linux_exercise_page(client, loaded_content):
    """Задача в терминале: терминал и дерево, правила — для JS, эталон — в разборе."""
    ExerciseFactory(
        topic=Exercise.objects.get(slug='greeting').topic, slug='copy', type='exercise',
        order=6,
        spec={
            'setup': {'cwd': '/srv/shop', 'files': {'/srv/shop/config/a.ini': 'x'}},
            'check': {'type': 'state', 'expect': [
                {'path': '/srv/shop/backup/config/a.ini', 'exists': True, 'fail': 'F'},
            ]},
            'solution': 'cp -r config backup/\n',
            'hints': [],
        },
    )

    html = client.get(exercise_url('copy')).content.decode()
    data = exercise_data(html)

    assert data['setup']['cwd'] == '/srv/shop' and 'solution' not in data
    assert 'data-terminal-input' in html and 'data-file-tree' in html
    assert 'js/pages/linux-exercise.js' in html and 'js/pages/exercise.js' not in html
    assert 'Эталонное решение' in html and 'config' in html


def test_git_playground(client, loaded_content):
    """Тренажёр Git: терминал, карточка «Репозиторий», дерево, проект для JS."""
    url = reverse('trainers:playground') + '?engine=git'
    html = client.get(url).content.decode()

    assert 'data-playground="git"' in html and 'js/pages/playground-git.js' in html
    parts = ('data-terminal-input', 'data-git-view', 'data-git-graph', 'data-file-tree')
    for part in parts:
        assert part in html
    setup = json.loads(re.search(
        r'<script id="git-setup" type="application/json">(.*?)</script>', html, re.S,
    ).group(1))
    assert setup['remote']['pushed'] == ['main'] and len(setup['commits']) == 4
    assert 'aria-current="page">Git</a>' in html


def test_git_exercise_page(client, loaded_content):
    """Задача в курсе с движком git: свой скрипт и карточка «Репозиторий»."""
    greeting = Exercise.objects.get(slug='greeting')
    course = greeting.topic.section.course
    course.engine = 'git'
    course.save()
    ExerciseFactory(
        topic=greeting.topic, slug='promo', type='exercise', order=6,
        spec={
            'setup': {
                'cwd': '/home/shop/shop', 'commits': [{'message': 'x', 'files': {}}],
            },
            'check': {'type': 'state', 'expect': [{'branch': 'promo', 'fail': 'F'}]},
            'solution': 'git switch -c promo\n',
            'hints': [],
        },
    )

    html = client.get(exercise_url('promo')).content.decode()

    assert 'js/pages/git-exercise.js' in html
    assert 'js/pages/linux-exercise.js' not in html
    assert 'data-git-view' in html and 'data-terminal-input' in html


def sql_dataset(html):
    return json.loads(re.search(
        r'<script id="sql-dataset" type="application/json">(.*?)</script>', html, re.S,
    ).group(1))


def test_sql_playground(client, db):
    """Тренажёр SQL: редактор, схема, журнал; учебная база направления курса SQL."""
    track = TrackFactory(sql_dataset='CREATE TABLE users (id int);')
    CourseFactory(track=track, engine='sql', slug='sql')
    html = client.get(reverse('trainers:playground') + '?engine=sql').content.decode()

    assert 'data-playground="sql"' in html and 'js/pages/playground-sql.js' in html
    assert 'pglite@0.2.17' in html and 'js/engines/sql/worker' in html
    for part in ('data-schema', 'data-run-log', 'data-action="step"'):
        assert part in html
    assert sql_dataset(html) == 'CREATE TABLE users (id int);'
    assert 'JOIN categories c' in html
    assert 'aria-current="page">SQL</a>' in html


def test_sql_playground_without_sql_course(client, db):
    """Курса SQL ещё нет — база берётся у направления, где она есть."""
    TrackFactory(slug='empty')
    TrackFactory(slug='backend', sql_dataset='SELECT 1;')
    html = client.get(reverse('trainers:playground') + '?engine=sql').content.decode()

    assert sql_dataset(html) == 'SELECT 1;'


def test_sql_exercise_page(client, db):
    """SQL-задача: свой скрипт, редактор с заготовкой, эталон и setup — для браузера."""
    track = TrackFactory(sql_dataset='CREATE TABLE users (id int);')
    course = CourseFactory(track=track, engine='sql', slug='sql')
    topic = TopicFactory(section=SectionFactory(course=course))
    exercise = ExerciseFactory(
        topic=topic, type=Exercise.Type.EXERCISE, slug='no-orders',
        spec={
            'solution': 'SELECT id FROM users;\n', 'starter_code': 'SELECT\n',
            'setup': 'CREATE TABLE t (x int);',
            'check': {'type': 'result', 'order_matters': True}, 'hints': [],
        },
    )
    html = client.get(exercise.get_absolute_url()).content.decode()

    assert 'js/pages/sql-exercise.js' in html and 'js/pages/exercise.js' not in html
    assert 'data-sql-worker=' in html and 'pglite@0.2.17' in html
    assert sql_dataset(html) == 'CREATE TABLE users (id int);'
    data = exercise_data(html)
    assert data['solution'] == 'SELECT id FROM users;\n'
    assert data['setup'] == 'CREATE TABLE t (x int);'
    assert 'solution.sql' in html and '>SELECT\n</textarea>' in html
    assert 'Эталонное решение' in html and '<span class="k">SELECT</span>' not in html


def test_django_playground(client, db):
    """Тренажёр Django: файлы проекта на вкладках, строка запроса, архив Django."""
    url = reverse('trainers:playground') + '?engine=django'
    html = client.get(url).content.decode()

    assert 'data-playground="django"' in html
    assert 'js/pages/playground-django.js' in html
    assert 'vendor/django' in html and 'js/engines/django/runner' in html
    for name in ('models.py', 'views.py', 'urls.py', 'orm.py'):
        assert f'data-file="{name}"' in html
    script = r'<script id="django-project" type="application/json">(.*?)</script>'
    project = json.loads(re.search(script, html, re.S).group(1))
    assert 'class Product(models.Model)' in project['files']['models.py']
    assert 'Category.objects.create' in project['setup']
    assert 'aria-current="page">Django</a>' in html
