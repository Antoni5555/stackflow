"""Карта сайта (/sitemap.xml): постоянные страницы, курсы, уроки, задачи.

Только опубликованное по всей цепочке (направление → курс → раздел → тема): то, что
«Контент» убрал из content/, скрыто и в карту не попадает. Курс «скоро» — тоже.
"""
from django.contrib.sitemaps import Sitemap
from django.urls import reverse

from apps.courses.models import Exercise, Lesson
from apps.courses.services.selectors import published_courses


# Опубликованная тема: курс, раздел, тема и направление видны на сайте
PUBLISHED_TOPIC = {
    'is_published': True,
    'section__is_published': True,
    'section__course__is_published': True,
    'section__course__track__is_published': True,
}


def topic_filter(prefix):
    return {f'{prefix}{key}': value for key, value in PUBLISHED_TOPIC.items()}


class StaticSitemap(Sitemap):
    """Постоянные страницы. Тренажёр — без ?engine: адрес у всех движков один."""

    def items(self):
        return ['pages:home', 'courses:list', 'trainers:playground', 'pages:about']

    def location(self, item):
        return reverse(item)


class CourseSitemap(Sitemap):
    def items(self):
        return [course for course in published_courses() if course.topic_count]


class LessonSitemap(Sitemap):
    def items(self):
        return (
            Lesson.objects.published()
            .filter(**topic_filter('topic__'))
            .select_related('topic__section__course')
            .order_by(
                'topic__section__course__order', 'topic__section__order',
                'topic__order',
            )
        )

    def location(self, lesson):
        return lesson.topic.get_absolute_url()


class ExerciseSitemap(Sitemap):
    def items(self):
        return (
            Exercise.objects.published()
            .filter(**topic_filter('topic__'))
            .select_related('topic__section__course')
            .order_by(
                'topic__section__course__order', 'topic__section__order',
                'topic__order', 'order',
            )
        )


SITEMAPS = {
    'pages': StaticSitemap,
    'courses': CourseSitemap,
    'lessons': LessonSitemap,
    'exercises': ExerciseSitemap,
}
