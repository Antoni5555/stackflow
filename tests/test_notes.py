"""Заметки и шпаргалки: очистка HTML, API, страницы, плашка в правой панели."""
import pytest
from django.urls import reverse

from apps.cheatsheets.models import Note
from apps.cheatsheets.services import notes
from tests.factories import UserFactory


pytestmark = pytest.mark.django_db

LESSON_URL = reverse('courses:lesson', args=['python', 'basics', 'hello'])


@pytest.fixture
def user(loaded_content):
    return UserFactory()


@pytest.fixture
def logged_in(client, user):
    client.force_login(user)
    return client


def create(client, source, title='LEFT JOIN', body='<p>текст</p>'):
    return client.post(reverse('notes:list'),
                       {'source': source, 'title': title, 'body': body},
                       content_type='application/json')


def test_clean_html_keeps_only_formatting():
    dirty = ('<p onclick="x()">Текст <b>жирный</b> '
             '<a href="javascript:x">ссылка</a></p>'
             '<script>alert(1)</script><img src=x onerror=alert(1)>'
             '<div><code>print()</code></div><h4>Итог</h4><ul><li>пункт</li></ul>')

    clean = notes.clean_html(dirty)

    assert clean == ('<p>Текст <b>жирный</b> ссылка</p>'
                     '<code>print()</code><h4>Итог</h4><ul><li>пункт</li></ul>')


def test_clean_html_keeps_tables_without_attributes():
    html = ('<table style="width:900px" border="1"><thead><tr><th>Тип</th>'
            '<th>Пример</th></tr></thead><tbody><tr><td colspan="2"><code>int</code>'
            '</td></tr></tbody></table>')

    assert notes.clean_html(html) == (
        '<table><thead><tr><th>Тип</th><th>Пример</th></tr></thead>'
        '<tbody><tr><td><code>int</code></td></tr></tbody></table>'
    )


def test_clean_html_drops_empty_paragraphs():
    html = '<b>Срез</b><p><ul><li>s[::-1]</li></ul></p><p><br></p>'

    assert notes.clean_html(html) == '<b>Срез</b><ul><li>s[::-1]</li></ul>'


def test_api_requires_login(client, loaded_content):
    assert create(client, 'python/basics/hello').status_code == 403


@pytest.mark.parametrize('source, topic, exercise', [
    ('python/basics/hello', 'hello', None),                 # урок
    ('python/basics/hello/greeting', 'hello', 'greeting'),  # задача
    ('python', None, None),                                 # тренажёр
])
def test_create_note_from_source(logged_in, user, source, topic, exercise):
    response = create(logged_in, source)

    assert response.status_code == 201
    assert response.json()['count'] == 1
    note = Note.objects.get(user=user)
    assert note.course.slug == 'python'
    assert (note.topic.slug if note.topic else None) == topic
    assert (note.exercise.slug if note.exercise else None) == exercise


def test_create_note_cleans_body(logged_in):
    response = create(logged_in, 'python', body='<b>ok</b><script>x</script>')

    assert response.json()['body_html'] == '<b>ok</b>'


@pytest.mark.parametrize('source, title, code', [
    ('python/basics/nope', 'Тема', 404),
    ('python/basics', 'Тема', 404),
    ('python/basics/hello', '   ', 400),
])
def test_create_note_errors(logged_in, source, title, code):
    assert create(logged_in, source, title=title).status_code == code


def test_edit_and_delete_own_note(logged_in, user):
    note_id = create(logged_in, 'python/basics/hello').json()['id']
    url = reverse('notes:detail', args=[note_id])

    response = logged_in.patch(url, {'title': 'Новое', 'body': '<i>x</i>'},
                               content_type='application/json')
    assert response.json() == {'id': note_id, 'title': 'Новое', 'body_html': '<i>x</i>'}

    assert logged_in.delete(url).status_code == 204
    assert not Note.objects.exists()


def test_cannot_touch_other_users_note(client, loaded_content):
    owner, other = UserFactory(), UserFactory()
    client.force_login(owner)
    note_id = create(client, 'python/basics/hello').json()['id']
    client.force_login(other)
    url = reverse('notes:detail', args=[note_id])

    assert client.patch(url, {'title': 'x', 'body': ''},
                        content_type='application/json').status_code == 404
    assert client.delete(url).status_code == 404
    assert Note.objects.filter(pk=note_id).exists()


# --- плашка «Заметка» ---

def test_note_panel_for_guest(client, loaded_content):
    html = client.get(LESSON_URL).content.decode()

    assert 'Войти, чтобы писать заметки' in html
    assert 'data-note-editor' not in html


def test_note_panel_for_logged_in(logged_in):
    create(logged_in, 'python/basics/hello')

    html = logged_in.get(LESSON_URL).content.decode()

    assert 'data-source="python/basics/hello"' in html
    assert 'запиши главное своими словами' in html
    assert 'уже <span data-note-count>1</span>' in html
    assert 'js/note-editor.js' in html


def test_playground_note_goes_to_trainer_group(logged_in):
    html = logged_in.get(reverse('trainers:playground')).content.decode()

    assert 'data-source="python"' in html


# --- шпаргалки ---

def test_cheatsheets_for_guest(client, loaded_content):
    html = client.get(reverse('cheatsheets:list')).content.decode()

    assert 'Шпаргалки — с аккаунтом' in html


def test_cheatsheet_cards(logged_in):
    create(logged_in, 'python/basics/hello')
    create(logged_in, 'python')

    html = logged_in.get(reverse('cheatsheets:list')).content.decode()

    assert 'href="/cheatsheets/python/"' in html
    assert '2 заметки' in html
    assert '<span>Привет</span><span>Из тренажёра</span>' in html


def test_cheatsheet_detail_groups(logged_in):
    create(logged_in, 'python', title='Из песочницы')
    create(logged_in, 'python/basics/hello/greeting', title='Про print')

    url = reverse('cheatsheets:detail', args=['python'])
    html = logged_in.get(url).content.decode()

    assert 'Раздел 1 · Основы' in html
    assert html.index('Про print') < html.index('Из песочницы')   # темы, потом тренажёр
    assert 'из задачи «Приветствие»' in html and 'из тренажёра' in html


def test_cheatsheet_detail_shows_only_own_notes(client, loaded_content):
    owner, other = UserFactory(), UserFactory()
    client.force_login(owner)
    create(client, 'python/basics/hello', title='Секрет')
    client.force_login(other)

    html = client.get(reverse('cheatsheets:detail', args=['python'])).content.decode()

    assert 'Секрет' not in html


def test_cheatsheet_detail_requires_login(client, loaded_content):
    response = client.get(reverse('cheatsheets:detail', args=['python']))

    assert response.status_code == 302


def test_cheatsheet_detail_queries(logged_in, django_assert_max_num_queries):
    """Число запросов не растёт с числом заметок (ссылки «из урока/задачи» без N+1)."""
    for _ in range(10):
        create(logged_in, 'python/basics/hello/greeting')
        create(logged_in, 'python/basics/hello')

    with django_assert_max_num_queries(8):
        logged_in.get(reverse('cheatsheets:detail', args=['python']))


def test_profile_recent_notes(logged_in):
    create(logged_in, 'python/basics/hello', title='Последняя')

    html = logged_in.get(reverse('accounts:profile')).content.decode()

    assert '>1</span><span class="stat__label">заметка' in html
    assert '<b>Последняя</b>' in html
    assert 'js/tabs.js' in html
