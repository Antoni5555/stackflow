"""Команда load_content: загрузка, повторный запуск, скрытие удалённого, ошибки."""
import shutil

import pytest
from django.core.management import CommandError, call_command

from apps.courses.models import Course, Exercise, Lesson, Section, Topic, Track
from apps.courses.services.content_loader import ContentError, ContentLoader


pytestmark = pytest.mark.django_db

HELLO = 'backend/python/01-basics/01-hello'


def test_loads_whole_tree(loaded_content):
    assert Track.objects.get().slug == 'backend'
    assert list(Course.objects.values_list('slug', 'engine', 'order')) == [
        ('python', 'python', 10), ('soon', '', 20),
    ]
    section = Section.objects.get()
    assert (section.slug, section.order, section.level) == ('basics', 1, 1)
    assert list(Topic.objects.values_list('slug', flat=True)) == ['hello', 'second']
    assert Lesson.objects.count() == 2
    assert list(Exercise.objects.values_list('slug', 'type', 'order')) == [
        ('greeting', 'exercise', 2), ('guess', 'predict', 3),
        ('pick', 'quiz', 4), ('fix-conf', 'fix', 5),
    ]


def test_lesson_html_and_meta(loaded_content):
    lesson = Lesson.objects.get(topic__slug='hello')

    assert lesson.title == 'Привет, Python'
    assert lesson.reading_time == 7
    assert '---' not in lesson.body_html[:20]          # front matter не попал в текст
    assert 'id="fig-demo-t"' in lesson.body_html       # SVG вставлен
    assert 'class="faq__item"' in lesson.body_html


def test_exercise_spec_by_type(loaded_content):
    exercise = Exercise.objects.get(slug='greeting')
    assert exercise.statement_html == '<p>Выведите <code>Привет</code>.</p>\n'
    assert exercise.spec['starter_code'] == 'print(...)\n'
    assert exercise.spec['check']['tests'][0]['fail'] == 'Нужно вывести слово Привет.'
    assert exercise.spec['hints'] == ['Используйте <code>print</code>.']

    quiz = Exercise.objects.get(slug='pick').spec
    assert quiz['options'] == ['200 OK', '<code>409</code> Conflict']
    assert quiz['answer'] == [1]

    fix = Exercise.objects.get(slug='fix-conf').spec
    assert fix['files'] == {'nginx.conf': 'server {}\n'}
    assert fix['check']['rules'][0]['must_match'].startswith('^\\s*')


def test_second_run_changes_nothing(loaded_content):
    report = ContentLoader(loaded_content).load()

    assert not report.created and not report.updated and not report.hidden
    assert Topic.objects.count() == 2


def test_changed_file_is_updated(loaded_content):
    topic_yaml = loaded_content / HELLO / '_topic.yaml'
    topic_yaml.write_text('title: Новое название\n', encoding='utf-8')

    report = ContentLoader(loaded_content).load()

    assert report.updated == {'Topic': 1}
    assert Topic.objects.get(slug='hello').title == 'Новое название'


def test_removed_topic_is_hidden_not_deleted(loaded_content):
    """Удалённая тема скрывается: на неё может ссылаться прогресс пользователей."""
    shutil.rmtree(loaded_content / 'backend/python/01-basics/02-second')

    report = ContentLoader(loaded_content).load()

    topic = Topic.objects.get(slug='second')
    assert topic.is_published is False
    assert topic.lesson.is_published is False
    assert report.hidden == {'Topic': 1, 'Lesson': 1}


def test_returned_topic_is_published_again(loaded_content):
    second = loaded_content / 'backend/python/01-basics/02-second'
    backup = loaded_content.parent / 'second'
    shutil.move(second, backup)
    ContentLoader(loaded_content).load()
    shutil.move(backup, second)

    ContentLoader(loaded_content).load()

    assert Topic.objects.get(slug='second').is_published is True


def test_error_rolls_back_everything(content_dir):
    """Ошибка в одном файле — БД не меняется совсем (одна транзакция)."""
    (content_dir / HELLO / '03-guess.yaml').write_text('title: [не закрыт\n')

    with pytest.raises(ContentError, match='03-guess.yaml: YAML не читается'):
        ContentLoader(content_dir).load()

    assert Track.objects.count() == 0 and Course.objects.count() == 0


@pytest.mark.parametrize('file_name, text, message', [
    ('03-guess.yaml', 'title: X\ntype: predict\n', 'нет обязательных полей'),
    ('04-pick.yaml',
     'title: X\ntype: quiz\nkind: many\ndifficulty: 1\npitfall: P\n'
     'statement: S\nexplanation: E\noptions: [a]\nanswer: [0]\n',
     'kind — single, multiple или order'),
    ('05-fix-conf.yaml',
     'title: X\ntype: video\ndifficulty: 1\npitfall: P\nstatement: S\n'
     'explanation: E\n',
     'неизвестный type'),
])
def test_invalid_exercise_is_reported(content_dir, file_name, text, message):
    (content_dir / HELLO / file_name).write_text(text, encoding='utf-8')

    with pytest.raises(ContentError, match=message):
        ContentLoader(content_dir).load()


def test_bad_folder_name_is_reported(content_dir):
    (content_dir / HELLO).rename(content_dir / 'backend/python/01-basics/Hello World')

    with pytest.raises(ContentError, match='NN-slug'):
        ContentLoader(content_dir).load()


def test_command_prints_report(content_dir, capsys):
    call_command('load_content', str(content_dir))

    out = capsys.readouterr().out
    assert 'Создано: Course: 2, Exercise: 4, Lesson: 2' in out
    assert 'Контент загружен.' in out


def test_command_fails_on_missing_dir(tmp_path):
    with pytest.raises(CommandError, match='Нет папки'):
        call_command('load_content', str(tmp_path / 'nope'))


def test_course_kind_is_loaded(content_dir):
    """kind: module — дополнительный модуль; без поля — основной путь."""
    course_yaml = content_dir / 'backend/soon/_course.yaml'
    course_yaml.write_text(
        course_yaml.read_text(encoding='utf-8') + 'kind: module\n', encoding='utf-8',
    )
    ContentLoader(content_dir).load()

    assert dict(Course.objects.values_list('slug', 'kind')) == {
        'python': 'main', 'soon': 'module',
    }


def test_unknown_course_kind_is_reported(content_dir):
    course_yaml = content_dir / 'backend/soon/_course.yaml'
    course_yaml.write_text(
        course_yaml.read_text(encoding='utf-8') + 'kind: extra\n', encoding='utf-8',
    )

    with pytest.raises(ContentError, match='kind — main или module'):
        ContentLoader(content_dir).load()


def test_practice_is_loaded_as_html(loaded_content):
    """_practice.yaml темы → Topic.practice: тексты уже в HTML, hint необязателен."""
    hello = Topic.objects.get(slug='hello')

    assert [task['title'] for task in hello.practice] == [
        'Сумма корзины', 'Самый дорогой товар',
    ]
    first, second = hello.practice
    assert 'class="code-block"' in first['text'] and '<code>sum</code>' in first['hint']
    assert second['hint'] == ''
    assert Topic.objects.get(slug='second').practice == []      # файла нет — пусто


@pytest.mark.parametrize('text, message', [
    ('title: X\n', 'ожидался список'),
    ('- title: X\n  text: T\n', 'задача 1: нет полей answer'),
    ('- title: X\n  text: T\n  answer: A\n  id: 1\n', "лишние поля \\['id'\\]"),
])
def test_invalid_practice_is_reported(content_dir, text, message):
    (content_dir / HELLO / '_practice.yaml').write_text(text, encoding='utf-8')

    with pytest.raises(ContentError, match=message):
        ContentLoader(content_dir).load()


def test_fix_keeps_file_order(content_dir):
    """Порядок файлов fix — как в YAML (JSONB в Postgres сортирует ключи)."""
    path = content_dir / HELLO / '05-fix-conf.yaml'
    text = path.read_text(encoding='utf-8').replace(
        'files:\n', 'files:\n  zz.conf: |\n    a\n', 1,
    )
    path.write_text(text, encoding='utf-8')
    ContentLoader(content_dir).load()

    spec = Exercise.objects.get(slug='fix-conf').spec
    assert spec['file_names'] == ['zz.conf', 'nginx.conf']


DOM_TASK = """title: Шапка
type: exercise
difficulty: 1
pitfall: P
statement: S
explanation: E
files:
  index.html: |
    <header></header>
  style.css: |
    header {}
check:
  type: dom
  rules:
%s
solution:
  style.css: |
    header { display: flex; }
"""


def test_dom_exercise_is_loaded(content_dir):
    """exercise с check.type: dom — задача на вёрстку: файлы, правила, порядок."""
    rules = (
        "    - selector: header\n      style: {display: flex}\n"
        "      fail: Нужен flex.\n"
        "    - must_match: 'style\\\\.css'\n      fail: Подключите стили.\n"
    )
    layout = content_dir / HELLO / '06-layout.yaml'
    layout.write_text(DOM_TASK % rules, encoding='utf-8')
    ContentLoader(content_dir).load()

    spec = Exercise.objects.get(slug='layout').spec
    assert spec['file_names'] == ['index.html', 'style.css']
    assert spec['check']['rules'][0]['style'] == {'display': 'flex'}
    assert 'starter_code' not in spec


@pytest.mark.parametrize('rules, message', [
    ('    - selector: header\n      color: red\n      fail: F\n',
     "неизвестные поля \\['color'\\]"),
    ('    - selector: header\n      count: 1\n', 'нужен словарь с fail'),
    ('    - text: X\n      fail: F\n', 'нужен selector или must_match'),
])
def test_invalid_dom_rules_are_reported(content_dir, rules, message):
    layout = content_dir / HELLO / '06-layout.yaml'
    layout.write_text(DOM_TASK % rules, encoding='utf-8')

    with pytest.raises(ContentError, match=message):
        ContentLoader(content_dir).load()


STATE_TASK = """title: Копия конфига
type: exercise
difficulty: 1
pitfall: P
statement: S
explanation: E
setup:
  cwd: /srv/shop
  files:
    /srv/shop/config/a.ini: x
  dirs: [/srv/shop/backup]
check:
  type: state
  expect:
%s
solution: |
  cp -r config backup/
"""


def test_state_exercise_is_loaded(content_dir):
    """exercise с check.type: state — задача в терминале: setup, правила."""
    rules = (
        "    - path: /srv/shop/backup/config/a.ini\n      exists: true\n      fail: F\n"
    )
    task = content_dir / HELLO / '06-copy.yaml'
    task.write_text(STATE_TASK % rules, encoding='utf-8')
    ContentLoader(content_dir).load()

    spec = Exercise.objects.get(slug='copy').spec
    assert spec['setup']['cwd'] == '/srv/shop'
    assert spec['check']['expect'][0]['exists'] is True
    assert spec['solution'] == 'cp -r config backup/\n'


@pytest.mark.parametrize('rules, message', [
    ('    - path: /a\n      exists: true\n      mode: "644"\n      fail: F\n',
     'path \\+ одно из'),
    ('    - path: /a\n      size: 1\n      fail: F\n', 'path \\+ одно из'),
    ('    - output_matches: x\n      path: /a\n      fail: F\n',
     'output_matches — только с fail'),
    ('    - path: /a\n      exists: true\n', 'нужен словарь с fail'),
])
def test_invalid_state_rules_are_reported(content_dir, rules, message):
    task = content_dir / HELLO / '06-copy.yaml'
    task.write_text(STATE_TASK % rules, encoding='utf-8')

    with pytest.raises(ContentError, match=message):
        ContentLoader(content_dir).load()


GIT_TASK = """title: Ветка для промокодов
type: exercise
difficulty: 1
pitfall: P
statement: S
explanation: E
setup:
  cwd: /home/shop/shop
  commits:
    - message: Каркас
      files:
        a.py: x
  remote:
    url: git@github.com:shop/shop.git
    pushed: [main]
  venv:
    path: venv
    packages: {django: 5.1.4}
check:
  type: state
  expect:
%s
solution: |
  git switch -c promo
"""


def test_git_state_exercise_is_loaded(content_dir):
    """Задача Git: setup с историей, GitHub и venv; правила Git, exists: false."""
    rules = (
        "    - branch: promo\n      fail: F\n"
        "    - tracked: .env\n      exists: false\n      fail: F\n"
        "    - pip_package: {name: django}\n"
        "      venv: venv\n      fail: F\n"
    )
    task = content_dir / HELLO / '06-promo.yaml'
    task.write_text(GIT_TASK % rules, encoding='utf-8')
    ContentLoader(content_dir).load()

    spec = Exercise.objects.get(slug='promo').spec
    assert spec['setup']['remote']['pushed'] == ['main']
    expected = {'tracked': '.env', 'exists': False, 'fail': 'F'}
    assert spec['check']['expect'][1] == expected


@pytest.mark.parametrize('rules, message', [
    ('    - branch: promo\n      head: promo\n      fail: F\n', 'branch — без'),
    ('    - head: main\n      exists: false\n      fail: F\n',
     "head — без \\['exists'\\]"),
])
def test_invalid_git_rules_are_reported(content_dir, rules, message):
    task = content_dir / HELLO / '06-promo.yaml'
    task.write_text(GIT_TASK % rules, encoding='utf-8')

    with pytest.raises(ContentError, match=message):
        ContentLoader(content_dir).load()


def test_unknown_setup_key_is_reported(content_dir):
    rules = "    - branch: promo\n      fail: F\n"
    task = content_dir / HELLO / '06-promo.yaml'
    text = (GIT_TASK % rules).replace('  cwd:', '  owner: shop\n  cwd:')
    task.write_text(text, encoding='utf-8')

    with pytest.raises(ContentError, match="неизвестные ключи \\['owner'\\]"):
        ContentLoader(content_dir).load()


SQL_TOPIC = 'backend/sql/01-select/01-join'
SQL_TASK = """title: Покупатели без заказов
type: exercise
difficulty: 2
pitfall: P
statement: S
explanation: E
solution: |
  SELECT id FROM users;
%s
hints: ['Нужен **LEFT JOIN**']
"""


def sql_course(content_dir, check):
    """Курс SQL с одной задачей и учебной базой направления."""
    topic = content_dir / SQL_TOPIC
    topic.mkdir(parents=True)
    (content_dir / 'backend/sql/_course.yaml').write_text(
        'title: SQL\nengine: sql\norder: 30\n', encoding='utf-8')
    (content_dir / 'backend/sql/01-select/_section.yaml').write_text(
        'title: Выборка\n', encoding='utf-8')
    (topic / '_topic.yaml').write_text('title: JOIN\n', encoding='utf-8')
    (topic / '01-no-orders.yaml').write_text(SQL_TASK % check, encoding='utf-8')
    shared = content_dir / 'backend/_shared'
    shared.mkdir()
    (shared / 'schema.sql').write_text('CREATE TABLE users (id int);', encoding='utf-8')
    (shared / 'seed.sql').write_text('INSERT INTO users VALUES (1);', encoding='utf-8')


def test_sql_dataset_is_loaded(content_dir):
    sql_course(content_dir, 'check:\n  type: result\n')
    ContentLoader(content_dir).load()

    dataset = Track.objects.get(slug='backend').sql_dataset
    assert dataset == 'CREATE TABLE users (id int);\nINSERT INTO users VALUES (1);'
    spec = Exercise.objects.get(slug='no-orders').spec
    assert spec['check'] == {'type': 'result', 'order_matters': True}
    assert spec['hints'] == ['Нужен <strong>LEFT JOIN</strong>']


@pytest.mark.parametrize('check, expected', [
    ('check:\n  type: state\n  tables: [orders, order_items]',
     [{'name': 'orders', 'columns': None}, {'name': 'order_items', 'columns': None}]),
    ('check:\n  type: state\n  tables:\n    products: [id, price]\n    tags: [name]',
     [{'name': 'products', 'columns': ['id', 'price']},
      {'name': 'tags', 'columns': ['name']}]),
    ('setup: |\n  CREATE TABLE wishlist (user_id int);\n'
     'check:\n  type: schema\n  tables: [wishlist]',
     [{'name': 'wishlist', 'columns': None}]),
])
def test_sql_state_and_schema_tables(content_dir, check, expected):
    sql_course(content_dir, check)
    ContentLoader(content_dir).load()

    spec = Exercise.objects.get(slug='no-orders').spec
    assert spec['check']['tables'] == expected


@pytest.mark.parametrize('check, message', [
    ('check:\n  type: tests', 'result, state или schema'),
    ('check:\n  type: result\n  order_matters: maybe', 'order_matters — true или'),
    ('check:\n  type: result\n  tables: [users]', "лишние поля \\['tables'\\]"),
    ('check:\n  type: state', 'нет обязательных полей: tables'),
    ('check:\n  type: state\n  tables: []', 'нет обязательных полей: tables'),
    ('check:\n  type: state\n  tables: [1]', 'tables — список таблиц'),
    ('check:\n  type: state\n  tables: {products: []}', 'tables — список таблиц'),
    ('check:\n  type: schema\n  tables: {wishlist: [id]}', 'schema: tables — список'),
    ('setup: {a: 1}\ncheck:\n  type: result', 'setup — текст SQL'),
])
def test_invalid_sql_exercise_is_reported(content_dir, check, message):
    sql_course(content_dir, check)

    with pytest.raises(ContentError, match=message):
        ContentLoader(content_dir).load()


def test_track_without_shared_has_empty_dataset(loaded_content):
    assert Track.objects.get(slug='backend').sql_dataset == ''
