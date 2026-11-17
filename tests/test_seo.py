"""Поиск и превью ссылок: robots.txt, sitemap.xml, описания, canonical, noindex."""
import re

import pytest
from django.core.cache import cache
from django.urls import reverse

from apps.courses.models import Topic
from core.seo import shorten, summary


def meta(html, name):
    """content у <meta name|property="name">."""
    match = re.search(rf'<meta (?:name|property)="{name}" content="([^"]*)">', html)
    return match.group(1) if match else None


def canonical(html):
    return re.search(r'<link rel="canonical" href="([^"]*)">', html).group(1)


@pytest.fixture(autouse=True)
def fresh_cache():
    cache.clear()   # карта сайта кэшируется на час


def test_summary_takes_first_paragraph_as_text():
    html = '<h2>Теория</h2><p>Функция — <b>блок</b> &lt;кода&gt;.\n</p><p>Ещё.</p>'

    assert summary(html) == 'Функция — блок <кода>. Ещё.'   # короткий — со следующим
    assert summary('<pre>без абзацев</pre>', prefix='Задача. ') == 'Задача. без абзацев'
    long = f'<p>{"а" * 120}</p><p>Второй.</p>'
    assert 'Второй' not in summary(long)


def test_shorten_cuts_on_word():
    text = 'слово, ' * 40

    short = shorten(text)
    assert len(short) <= 160
    assert short.endswith('слово…')


def test_robots_txt(client):
    response = client.get('/robots.txt')
    text = response.content.decode()

    assert response.status_code == 200
    assert response['Content-Type'].startswith('text/plain')
    assert 'Disallow: /accounts/' in text and 'Disallow: /cheatsheets/' in text
    assert 'Disallow: /playground/practice/' in text
    assert 'Sitemap: http://testserver/sitemap.xml' in text


@pytest.mark.django_db
def test_sitemap_lists_published_content(client, loaded_content):
    Topic.objects.filter(slug='second').update(is_published=False)

    response = client.get('/sitemap.xml')
    xml = response.content.decode()

    assert response.status_code == 200
    lesson = '/courses/python/basics/hello/'
    pages = ['/', '/courses/', '/playground/', '/about/', '/courses/python/']
    for path in [*pages, lesson, f'{lesson}greeting/']:
        assert f'<loc>http://testserver{path}</loc>' in xml
    assert '/courses/soon/' not in xml               # курс «скоро» — без тем
    assert '/basics/second/' not in xml              # скрытая тема и её задачи
    assert '/accounts/' not in xml and '/cheatsheets/' not in xml


@pytest.mark.django_db
def test_lesson_exercise_course_have_own_description(client, loaded_content):
    lesson = client.get(reverse('courses:lesson', args=['python', 'basics', 'hello']))
    html = lesson.content.decode()
    # абзацы «Теории» без подписей и рисунков, пока текст короткий
    description = 'Первая программа. Код программы: Результат: Итог'
    assert meta(html, 'description') == description
    assert meta(html, 'og:description') == description
    assert meta(html, 'og:title') == 'Привет, Python — Python'

    exercise = client.get(
        reverse('trainers:exercise', args=['python', 'basics', 'hello', 'greeting']),
    ).content.decode()
    assert meta(exercise, 'description') == 'Задача. Выведите Привет.'

    course = client.get(reverse('courses:detail', args=['python'])).content.decode()
    assert meta(course, 'description') == 'Тестовый курс.'
    assert meta(course, 'og:title') == 'Python'


@pytest.mark.django_db
def test_canonical_without_query_and_noindex(client, loaded_content):
    playground = client.get('/playground/?engine=sql').content.decode()
    assert canonical(playground) == 'http://testserver/playground/'
    assert meta(playground, 'og:url') == 'http://testserver/playground/'
    assert meta(playground, 'robots') is None
    assert meta(playground, 'description').startswith('Песочница для Python')

    login = client.get(reverse('account_login')).content.decode()
    assert meta(login, 'robots') == 'noindex'
    missing = client.get('/nope/').content.decode()
    assert meta(missing, 'robots') == 'noindex'
