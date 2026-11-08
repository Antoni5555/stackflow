"""Заметки и шпаргалки: очистка HTML, где написана заметка, выборки для страниц.

Где написана заметка, задаёт ключ источника (такой же, как у прогресса):
- «python» — тренажёр курса (группа «Из тренажёра»);
- «python/first-steps/strings» — урок темы;
- «python/first-steps/strings/sku-parts» — задача темы.
"""
import re
from dataclasses import dataclass, field

import nh3
from django.db.models import Count, Max
from django.http import Http404

from apps.courses.models import Course, Exercise, Section, Topic

from ..models import Note


# Что оставляем из HTML редактора: форматирование из панели кнопок и таблицы
# (их вставляют из конспектов). Ни атрибутов, ни ссылок, ни картинок:
# заметку пишет пользователь, а показывает сайт.
ALLOWED_TAGS = {'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
                'ul', 'ol', 'li', 'code', 'pre', 'h4',
                'table', 'thead', 'tbody', 'tr', 'th', 'td'}
MAX_BODY = 20_000
# Пустые абзацы, которые оставляет редактор (Enter перед списком, пустая строка)
EMPTY_PARAGRAPH = re.compile(r'<p>(\s|&nbsp;|<br>)*</p>')


def clean_html(html):
    """HTML из редактора → безопасный HTML (лишние теги и атрибуты удаляются)."""
    html = nh3.clean(html[:MAX_BODY], tags=ALLOWED_TAGS, attributes={})
    return EMPTY_PARAGRAPH.sub('', html).strip()


@dataclass
class NoteSource:
    """Где написана заметка."""

    course: Course
    topic: Topic | None = None
    exercise: Exercise | None = None


def resolve_source(key):
    """Ключ источника → NoteSource или None, если такого урока/задачи нет."""
    parts = key.split('/')
    if len(parts) == 1:
        course = Course.objects.published().filter(slug=parts[0]).first()
        return NoteSource(course) if course else None
    if len(parts) not in (3, 4):
        return None
    topic = (
        Topic.objects.published()
        .filter(slug=parts[2], section__slug=parts[1], section__is_published=True,
                section__course__slug=parts[0])
        .select_related('section__course')
        .first()
    )
    if topic is None:
        return None
    exercise = None
    if len(parts) == 4:
        exercise = (
            Exercise.objects.published().filter(topic=topic, slug=parts[3]).first()
        )
        if exercise is None:
            return None
    return NoteSource(topic.section.course, topic, exercise)


def create_note(user, source, title, body_html):
    return Note.objects.create(
        user=user, course=source.course, topic=source.topic, exercise=source.exercise,
        title=title.strip(), body_html=clean_html(body_html),
    )


def update_note(note, title, body_html):
    note.title = title.strip()
    note.body_html = clean_html(body_html)
    note.save(update_fields=['title', 'body_html', 'updated_at'])
    return note


def count_in_group(user, course, topic):
    """Сколько заметок в той же группе шпаргалки (тема или «Из тренажёра»)."""
    return Note.objects.filter(user=user, course=course, topic=topic).count()


def recent_notes(user, limit=3):
    """Последние заметки для профиля."""
    return list(
        Note.objects.filter(user=user)
        .select_related('course', 'topic', 'exercise')
        .order_by('-updated_at')[:limit]
    )


# --- список шпаргалок ---

@dataclass
class SheetCard:
    """Карточка шпаргалки курса: число заметок, темы, когда обновлялась."""

    course: Course
    step: int
    count: int = 0
    updated: object = None
    topics: list = field(default_factory=list)

    @property
    def shown_topics(self):
        return self.topics[:3]

    @property
    def more_topics(self):
        return max(len(self.topics) - 3, 0)


def sheet_cards(user, course_cards):
    """Карточки шпаргалок в порядке программы. course_cards — из selectors.catalog()."""
    stats = {
        row['course']: row
        for row in Note.objects.filter(user=user).values('course')
        .annotate(n=Count('id'), updated=Max('updated_at'))
    }
    topics = {}
    rows = (
        Note.objects.filter(user=user)
        .values_list('course', 'topic__title', 'topic__section__order', 'topic__order')
        .distinct()
        .order_by('course', 'topic__section__order', 'topic__order')
    )
    for course_id, title, _, _ in rows:
        topics.setdefault(course_id, []).append(title or 'Из тренажёра')

    cards = []
    for card in course_cards:
        course = card.course
        row = stats.get(course.pk)
        if card.is_soon and not row:
            continue
        cards.append(SheetCard(
            course, card.step,
            count=row['n'] if row else 0,
            updated=row['updated'] if row else None,
            topics=topics.get(course.pk, []),
        ))
    return cards


# --- шпаргалка курса ---

@dataclass
class SheetGroup:
    """Карточка темы в шпаргалке: подпись раздела, тема (ссылка на урок), заметки."""

    label: str
    topic: Topic | None
    notes: list


def cheatsheet(user, course_slug):
    """Шпаргалка курса: заметки по темам в порядке программы + «Из тренажёра»."""
    course = Course.objects.published().filter(slug=course_slug).first()
    if course is None:
        raise Http404('Курс не найден')

    notes = list(
        Note.objects.filter(user=user, course=course)
        # ссылки «из урока / из задачи» без запроса на каждую заметку
        .select_related('exercise__topic__section__course', 'topic__section__course')
        .order_by('created_at')
    )
    by_topic = {}
    for note in notes:
        by_topic.setdefault(note.topic_id, []).append(note)

    groups = []
    sections = (
        Section.objects.filter(course=course)
        .prefetch_related('topics')
        .order_by('order')
    )
    for number, section in enumerate(sections, start=1):
        section.course = course     # для topic.get_absolute_url() без лишних запросов
        for topic in section.topics.all():
            if topic.pk in by_topic:
                groups.append(SheetGroup(
                    f'Раздел {number} · {section.title}', topic, by_topic[topic.pk],
                ))
    if None in by_topic:
        groups.append(SheetGroup('Тренажёр', None, by_topic[None]))

    return {
        'course': course,
        'groups': groups,
        'count': len(notes),
        'updated': max((note.updated_at for note in notes), default=None),
    }


# --- плашка «Заметка» в правой панели ---

def note_panel(user, course, topic, source_key):
    """Данные для плашки «Заметка»: откуда она и сколько заметок уже в группе."""
    return {
        'source': source_key,
        'count': count_in_group(user, course, topic) if user.is_authenticated else 0,
    }
