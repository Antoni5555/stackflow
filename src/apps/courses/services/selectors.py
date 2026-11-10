"""Выборки контента для страниц. Views только вызывают эти функции.

Каждая функция делает фиксированное число SQL-запросов, сколько бы ни было
разделов и тем (prefetch_related вместо запроса на каждую тему — без N+1).
"""
from dataclasses import dataclass

from django.db.models import Count, Prefetch, Q, Sum
from django.http import Http404
from django.shortcuts import get_object_or_404

from apps.courses.models import Course, Exercise, Section, Topic, Track


PUBLISHED_TOPICS = Q(sections__is_published=True, sections__topics__is_published=True)
PUBLISHED_EXERCISES = Q(sections__topics__exercises__is_published=True)


def published_courses():
    """Опубликованные курсы с числом тем и задач (для карточек)."""
    return (
        Course.objects.published()
        .filter(track__is_published=True)
        .select_related('track')
        .annotate(
            topic_count=Count(
                'sections__topics', filter=PUBLISHED_TOPICS, distinct=True,
            ),
            exercise_count=Count(
                'sections__topics__exercises',
                filter=PUBLISHED_TOPICS & PUBLISHED_EXERCISES,
                distinct=True,
            ),
        )
        .order_by('track__order', 'order')
    )


@dataclass
class CourseCard:
    """Курс в каталоге: номер шага в программе направления и «скоро».

    У дополнительного модуля шага нет (step=None).
    """

    course: Course
    step: int | None

    @property
    def is_soon(self):
        """Курс без опубликованных тем — карточка «скоро»."""
        return self.course.topic_count == 0


def catalog(track_slug=None):
    """Каталог: направления и курсы выбранного направления (по умолчанию — первого).

    Возвращает (направления, текущее направление, карточки курсов).
    """
    tracks = list(Track.objects.published())
    if not tracks:
        return [], None, []
    current = next((t for t in tracks if t.slug == track_slug), tracks[0])
    courses = published_courses().filter(track=current)
    return tracks, current, course_cards(courses)


def course_cards(courses):
    """Карточки: сначала основной путь с номерами шагов, затем модули без номера."""
    courses = list(courses)
    main = [course for course in courses if not course.is_module]
    modules = [course for course in courses if course.is_module]
    return (
        [CourseCard(course, step) for step, course in enumerate(main, start=1)]
        + [CourseCard(course, None) for course in modules]
    )


def split_cards(cards):
    """(основной путь, модули) — для каталога и карты пути на главной."""
    return (
        [card for card in cards if card.step],
        [card for card in cards if not card.step],
    )


def course_outline(course):
    """Разделы курса → темы → урок и задачи. 3 запроса на любой размер курса."""
    exercises = Exercise.objects.published().only('id', 'title', 'slug', 'topic_id')
    topics = (
        Topic.objects.published()
        .select_related('lesson')
        .prefetch_related(Prefetch('exercises', queryset=exercises))
    )
    sections = list(
        Section.objects.published()
        .filter(course=course)
        .prefetch_related(Prefetch('topics', queryset=topics))
    )
    # Курс уже загружен — кладём его в разделы, чтобы topic.get_absolute_url()
    # не делал по запросу на каждый раздел
    for section in sections:
        section.course = course
        # число задач раздела — для подписи «N задач»; считаем в Python, без запросов
        section.exercise_count = sum(
            len(topic.exercises.all()) for topic in section.topics.all()
        )
    return sections


def level_range(sections):
    """Уровни разделов курса для подписи: «основы → продвинутое» или «основы»."""
    levels = sorted({section.level for section in sections})
    if not levels:
        return ''
    labels = [Section.Level(levels[0]).label, Section.Level(levels[-1]).label]
    return labels[0] if labels[0] == labels[1] else ' → '.join(labels)


def course_detail(slug):
    """Курс, его программа и соседние шаги направления."""
    course = get_object_or_404(
        published_courses().filter(slug=slug)
    )
    sections = course_outline(course)
    # соседи — того же вида: у модуля «перед/после» — другие модули
    siblings = list(
        published_courses().filter(track=course.track, kind=course.kind)
    )
    index = next(i for i, c in enumerate(siblings) if c.pk == course.pk)
    reading_time = (
        Topic.objects.published()
        .filter(section__course=course, section__is_published=True,
                lesson__is_published=True)
        .aggregate(total=Sum('lesson__reading_time'))['total']
    ) or 0
    return {
        'course': course,
        'step': None if course.is_module else index + 1,
        'sections': sections,
        'first_topic': next(
            (topic for section in sections for topic in section.topics.all()), None,
        ),
        'level_range': level_range(sections),
        'reading_time': reading_time,
        'prev_course': siblings[index - 1] if index > 0 else None,
        'next_course': siblings[index + 1] if index + 1 < len(siblings) else None,
    }


@dataclass
class CourseItem:
    """Шаг курса для «Назад / Дальше»: урок темы или задача."""

    title: str
    url: str
    topic: Topic
    exercise: Exercise | None = None


def course_items(sections):
    """Все шаги курса по порядку: урок темы → её задачи → урок следующей темы…"""
    items = []
    for section in sections:
        for topic in section.topics.all():
            lesson = getattr(topic, 'lesson', None)
            if lesson is not None and lesson.is_published:
                items.append(CourseItem(lesson.title, topic.get_absolute_url(), topic))
            for exercise in topic.exercises.all():
                items.append(CourseItem(
                    exercise.title, exercise.get_absolute_url(), topic, exercise,
                ))
    return items


def neighbours(items, index):
    """Предыдущий и следующий шаг курса."""
    prev_item = items[index - 1] if index > 0 else None
    next_item = items[index + 1] if index + 1 < len(items) else None
    return prev_item, next_item


def find_topic(sections, section_slug, topic_slug):
    """(раздел, тема) по slug из адреса или 404."""
    for section in sections:
        if section.slug != section_slug:
            continue
        for topic in section.topics.all():
            if topic.slug == topic_slug:
                return section, topic
    raise Http404('Тема не найдена')


def published_course(slug):
    return get_object_or_404(
        Course.objects.published().select_related('track'), slug=slug,
    )


def lesson_page(course_slug, section_slug, topic_slug):
    """Урок темы, программа курса для правой панели, соседние шаги."""
    course = published_course(course_slug)
    sections = course_outline(course)
    section, topic = find_topic(sections, section_slug, topic_slug)
    lesson = getattr(topic, 'lesson', None)
    if lesson is None or not lesson.is_published:
        raise Http404('У темы нет урока')

    items = course_items(sections)
    index = next(
        i for i, item in enumerate(items) if item.topic == topic and not item.exercise
    )
    prev_item, next_item = neighbours(items, index)
    return {
        'course': course,
        'section': section,
        'topic': topic,
        'lesson': lesson,
        'sections': sections,
        'prev_item': prev_item,
        'next_item': next_item,
    }


def exercise_page(course_slug, section_slug, topic_slug, exercise_slug):
    """Задача, её номер в курсе, программа курса и соседние шаги."""
    course = published_course(course_slug)
    sections = course_outline(course)
    section, topic = find_topic(sections, section_slug, topic_slug)

    items = course_items(sections)
    index = next(
        (i for i, item in enumerate(items)
         if item.topic == topic and item.exercise
         and item.exercise.slug == exercise_slug),

        None,
    )
    if index is None:
        raise Http404('Задача не найдена')

    # В программе курса у задач только название и slug — здесь нужны все поля
    exercise = Exercise.objects.get(pk=items[index].exercise.pk)
    exercise.topic = topic
    exercises = [item.exercise.pk for item in items if item.exercise]
    prev_item, next_item = neighbours(items, index)
    return {
        'course': course,
        'section': section,
        'topic': topic,
        'exercise': exercise,
        'number': exercises.index(exercise.pk) + 1,
        'sections': sections,
        'prev_item': prev_item,
        'next_item': next_item,
    }


def playground(engine):
    """Песочница движка: курс этого движка (первый по программе) и его программа."""
    course = (
        Course.objects.published()
        .filter(engine=engine, track__is_published=True)
        .select_related('track')
        .order_by('track__order', 'order')
        .first()
    )
    return {
        'course': course,
        'sections': course_outline(course) if course else [],
    }


def first_open_card(cards):
    """Первый курс основного пути, где уже есть темы, — кнопка «Начать с …»."""
    return next((card for card in cards if card.step and not card.is_soon), None)


def start_card():
    """Карточка первого открытого курса (для CTA на страницах без каталога)."""
    _, _, cards = catalog()
    return first_open_card(cards)


def home_summary():
    """Для главной: курсы направления (карта пути) и числа под кнопками первого экрана.

    Курсов — все, включая «скоро»: это программа направления. На карте пути — только
    основной путь, модули — отдельным списком. Уроков (= тем) и задач — опубликованные.
    """
    _, track, cards = catalog()
    path_cards, module_cards = split_cards(cards)
    return {
        'track': track,
        'cards': path_cards,
        'module_cards': module_cards,
        'first_card': first_open_card(cards),
        'numbers': {
            'courses': len(cards),
            'lessons': sum(card.course.topic_count for card in cards),
            'exercises': sum(card.course.exercise_count for card in cards),
        },
    }
