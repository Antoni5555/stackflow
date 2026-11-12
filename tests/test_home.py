"""Главная и «О проекте»: цифры первого экрана, карта пути, CTA."""
import re

import pytest
from django.urls import reverse

from apps.courses.models import Exercise
from apps.progress.models import ExerciseProgress
from tests.factories import (
    CourseFactory, SectionFactory, TrackFactory, UserFactory, topic_with_lesson,
)


pytestmark = pytest.mark.django_db


@pytest.fixture
def courses():
    """Направление из трёх курсов: два открыты (по 2 задачи), третий — «скоро»."""
    track = TrackFactory(title='Backend')
    first = CourseFactory(track=track, title='Python')
    second = CourseFactory(track=track, title='Linux')
    soon = CourseFactory(track=track, title='Docker')
    topic_with_lesson(SectionFactory(course=first))
    topic_with_lesson(SectionFactory(course=second))
    return first, second, soon


def stops(html):
    """Станции карты пути: [(статус, html станции)]."""
    return re.findall(
        r'<li class="metro__stop metro__stop--(\w+)">(.*?)</li>', html, re.S,
    )


def test_numbers_count_courses_lessons_and_exercises(client, courses):
    html = client.get(reverse('pages:home')).content.decode()

    assert '<dt>3</dt><dd>курса в программе</dd>' in html   # «скоро» — тоже в программе
    assert '<dt>2</dt><dd>урока</dd>' in html
    assert '<dt>4</dt><dd>задачи</dd>' in html


def test_guest_path_starts_at_first_course(
    client, courses, django_assert_max_num_queries,
):
    with django_assert_max_num_queries(6):
        html = client.get(reverse('pages:home')).content.decode()

    (s1, first), (s2, second), (s3, soon) = stops(html)
    assert (s1, s2, s3) == ('current', 'open', 'soon')
    assert 'начни здесь' in first
    assert '2 задачи' in second
    assert 'скоро' in soon and '<a ' not in soon      # у курса «скоро» нет ссылки
    assert 'Путь обучения Backend' in html


def test_user_path_shows_done_and_current(client, courses):
    first, second, _ = courses
    user = UserFactory()
    for exercise in Exercise.objects.filter(topic__section__course=first):
        ExerciseProgress.objects.create(user=user, exercise=exercise)
    ExerciseProgress.objects.create(
        user=user, exercise=Exercise.objects.filter(topic__section__course=second)[0],
    )
    client.force_login(user)

    html = client.get(reverse('pages:home')).content.decode()

    (s1, first_html), (s2, second_html), _ = stops(html)
    assert (s1, s2) == ('done', 'current')
    assert '✓ пройден' in first_html
    assert 'вы здесь · 1 / 2' in second_html


def test_reveal_script_only_on_home_and_about(client, courses):
    """Появление блоков при прокрутке — только на главной и «О проекте»."""
    for name in ['pages:home', 'pages:about']:
        assert 'js/reveal.js' in client.get(reverse(name)).content.decode(), name
    assert 'js/reveal.js' not in client.get(reverse('courses:list')).content.decode()


def test_about_page(client, courses):
    """«О проекте»: CTA — на первый открытый курс, вопросы закрыты, ссылки автора."""
    first, _, _ = courses

    html = client.get(reverse('pages:about')).content.decode()

    assert f'href="{first.get_absolute_url()}"' in html
    assert 'Начать с Python' in html
    assert '<details class="faq__item" open' not in html
    assert 'href="https://github.com/Antoni5555"' not in html
    assert 'href="https://t.me/antonimikeladze"' in html
    assert 'img/author' in html


def test_modules_are_not_on_path(client, courses):
    first, _, _ = courses
    module = CourseFactory(track=first.track, title='Под капотом', kind='module')
    topic_with_lesson(SectionFactory(course=module))

    html = client.get(reverse('pages:home')).content.decode()

    assert len(stops(html)) == 3                       # станции — только основной путь
    assert 'Под капотом' not in ''.join(body for _, body in stops(html))
    assert 'class="pill">Под капотом</a>' in html
