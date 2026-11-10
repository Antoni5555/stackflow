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
