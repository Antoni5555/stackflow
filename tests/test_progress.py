"""Прогресс: API, перенос из браузера, статусы на страницах, профиль."""
from datetime import date, timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.courses.models import Exercise, Lesson
from apps.progress.models import ExerciseProgress, LessonView
from apps.progress.services import progress
from tests.factories import UserFactory


pytestmark = pytest.mark.django_db

GREETING = 'python/basics/hello/greeting'
HELLO = 'python/basics/hello'
COURSE_URL = reverse('courses:detail', args=['python'])


@pytest.fixture
def user(loaded_content):
    return UserFactory()


@pytest.fixture
def logged_in(client, user):
    client.force_login(user)
    return client


def solve(user, *slugs):
    for slug in slugs:
        progress.mark_solved(user, Exercise.objects.get(slug=slug))


# --- API ---

def test_solved_api_requires_login(client, loaded_content):
    response = client.post(reverse('progress:solved'), {'exercise': GREETING},
                           content_type='application/json')

    assert response.status_code == 403


def test_solved_api_marks_once(logged_in, user):
    for _ in range(2):
        response = logged_in.post(reverse('progress:solved'), {'exercise': GREETING},
                                  content_type='application/json')
        assert response.status_code == 200

    assert ExerciseProgress.objects.filter(user=user).count() == 1


@pytest.mark.parametrize('key, code', [
    ('python/basics/hello/nope', 404),
    ('../../etc/passwd', 400),
    ('python', 400),
])
def test_solved_api_bad_keys(logged_in, key, code):
    response = logged_in.post(reverse('progress:solved'), {'exercise': key},
                              content_type='application/json')

    assert response.status_code == code


def test_import_guest_progress(logged_in, user):
    """После входа прогресс гостя переносится; неизвестные ключи пропускаются."""
    payload = {'solved': [GREETING, 'python/basics/hello/guess', 'python/x/y/z'],
               'viewed': [HELLO, 'python/basics/nope']}

    response = logged_in.post(reverse('progress:import'), payload,
                              content_type='application/json')
    again = logged_in.post(reverse('progress:import'), payload,
                           content_type='application/json')

    assert response.json() == {'solved': 2, 'viewed': 1}
    assert again.status_code == 200          # повтор ничего не ломает
    assert ExerciseProgress.objects.filter(user=user).count() == 2
    assert LessonView.objects.filter(user=user).count() == 1


# --- страницы ---

def test_lesson_marked_viewed_only_for_logged_in(client, logged_in, user):
    lesson_url = reverse('courses:lesson', args=['python', 'basics', 'hello'])

    logged_in.get(lesson_url)

    assert LessonView.objects.filter(user=user, lesson__topic__slug='hello').exists()


def test_guest_page_has_keys_for_js(client, loaded_content):
    html = client.get(reverse('courses:lesson', args=['python', 'basics', 'hello'])
                      ).content.decode()

    assert f'data-exercise-key="{GREETING}"' in html
    assert f'data-current-lesson="{HELLO}"' in html
    assert 'data-auth="0"' in html


def test_sidebar_marks_solved_for_logged_in(logged_in, user):
    solve(user, 'greeting')

    html = logged_in.get(reverse('courses:lesson', args=['python', 'basics', 'hello'])
                         ).content.decode()

    assert ('class="lesson lesson--task lesson--done" '
            f'data-exercise-key="{GREETING}"') in html
    assert 'data-total="4">1/4</span>' in html


def test_course_page_progress_and_continue(logged_in, user):
    solve(user, 'greeting')

    html = logged_in.get(COURSE_URL).content.decode()

    assert 'Пройдено 1 из 4 задач' in html
    # урок «Привет» ещё не открыт — продолжить с него
    assert 'Следующая: «Привет, Python»' in html
    assert 'badge badge--current">0 / 2 тем' in html
    # начатый раздел только выделен: при загрузке все разделы свёрнуты
    assert 'class="module module--current">' in html
    assert ' open>' not in html


def test_course_done(logged_in, user):
    solve(user, 'greeting', 'guess', 'pick', 'fix-conf')
    for lesson in Lesson.objects.all():
        progress.mark_viewed(user, lesson)

    html = logged_in.get(COURSE_URL).content.decode()
    catalog = logged_in.get(reverse('courses:list')).content.decode()

    assert '✓ Курс пройден' in html and 'module module--done' in html
    assert 'course-card course-card--done' in catalog


def test_catalog_current_course(logged_in, user):
    solve(user, 'greeting')

    html = logged_in.get(reverse('courses:list')).content.decode()

    assert 'course-card course-card--accent' in html
    assert '1 из 4 задач' in html


def test_exercise_page_solved_badge(logged_in, user):
    url = reverse('trainers:exercise', args=['python', 'basics', 'hello', 'greeting'])
    assert 'data-solved-badge="python/basics/hello/greeting" hidden' in \
        logged_in.get(url).content.decode()

    solve(user, 'greeting')

    html = logged_in.get(url).content.decode()
    assert 'data-solved-badge="python/basics/hello/greeting">✓ Решена' in html


@pytest.mark.parametrize('topics', [1, 10])
def test_course_page_queries_logged_in(client, django_assert_max_num_queries, topics):
    """У вошедшего прогресс добавляет фиксированное число запросов, без N+1."""
    from tests.test_courses_views import make_course

    make_course(topics)
    client.force_login(UserFactory())

    with django_assert_max_num_queries(10):
        assert client.get(reverse('courses:detail', args=['big'])).status_code == 200


# --- профиль ---

def test_streak():
    today = date(2026, 10, 21)
    days = {today - timedelta(days=n) for n in (1, 2, 3, 5)}

    assert progress.streak(days, today) == 3            # вчера, позавчера, 3 дня назад
    assert progress.streak(days | {today}, today) == 4
    assert progress.streak(set(), today) == 0


def test_heatmap_levels():
    today = date(2026, 10, 21)
    cells = progress.heatmap({today: 7, today - timedelta(days=1): 1}, today)

    assert len(cells) == 35
    assert cells[-1] == {'day': today, 'count': 7, 'level': 3}
    assert cells[-2]['level'] == 1 and cells[0]['level'] == 0


def test_profile_stats(logged_in, user):
    solve(user, 'greeting', 'guess')

    html = logged_in.get(reverse('accounts:profile')).content.decode()

    assert '>2</span><span class="stat__label">задачи решены' in html
    assert '>1</span><span class="stat__label">день подряд' in html
    assert '<a href="/courses/python/">Python</a>' in html
    assert html.count('<i data-l=') == 35
    assert f'title="{timezone.localdate().day}' in html
