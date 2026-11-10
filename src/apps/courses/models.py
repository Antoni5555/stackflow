"""Контент: направление → курс → раздел → тема → урок и задачи.

Записи создаёт и обновляет только команда `manage.py load_content` из папки content/.
Удалённое из content/ не удаляется из БД, а скрывается (is_published=False):
так не теряется прогресс пользователей, привязанный к темам и задачам.
"""
from django.db import models
from django.urls import reverse


class PublishedQuerySet(models.QuerySet):
    """Общие выборки для контента."""

    def published(self):
        """Только то, что сейчас есть в content/."""
        return self.filter(is_published=True)


class ContentItem(models.Model):
    """Общие поля всех единиц контента."""

    slug = models.SlugField('slug', max_length=100)
    title = models.CharField('название', max_length=200)
    order = models.PositiveIntegerField('порядок', default=0)
    is_published = models.BooleanField('опубликовано', default=True)

    objects = PublishedQuerySet.as_manager()

    class Meta:
        abstract = True
        ordering = ['order', 'id']

    def __str__(self):
        return self.title


class Track(ContentItem):
    """Направление: Backend, позже Frontend, DevOps."""

    description = models.TextField('описание', blank=True)

    class Meta(ContentItem.Meta):
        verbose_name = 'направление'
        verbose_name_plural = 'направления'
        constraints = [
            models.UniqueConstraint(fields=['slug'], name='track_unique_slug'),
        ]


class Course(ContentItem):
    """Курс. order — шаг программы направления (10, 20, 30…)."""

    class Engine(models.TextChoices):
        PYTHON = 'python', 'Python в браузере'
        SQL = 'sql', 'PostgreSQL в браузере'
        DJANGO = 'django', 'Django в браузере'
        LINUX = 'linux', 'Терминал Linux в браузере'

    class Kind(models.TextChoices):
        MAIN = 'main', 'Основной путь'
        MODULE = 'module', 'Дополнительный модуль'

    track = models.ForeignKey(
        Track, on_delete=models.CASCADE, related_name='courses',
        verbose_name='направление',
    )
    description = models.TextField('описание', blank=True)
    # Пусто — курс без тренажёра: только задачи quiz и fix
    engine = models.CharField(
        'тренажёр', max_length=20, choices=Engine.choices, blank=True,
    )
    # Модуль — вне основного пути: без «Шаг N», в каталоге и на главной отдельно
    kind = models.CharField(
        'вид', max_length=10, choices=Kind.choices, default=Kind.MAIN,
    )

    class Meta(ContentItem.Meta):
        verbose_name = 'курс'
        verbose_name_plural = 'курсы'
        # slug курса — в адресе /courses/<slug>/, поэтому уникален на весь сайт
        constraints = [
            models.UniqueConstraint(fields=['slug'], name='course_unique_slug'),
        ]

    def get_absolute_url(self):
        return reverse('courses:detail', args=[self.slug])

    @property
    def is_module(self):
        return self.kind == self.Kind.MODULE


class Section(ContentItem):
    """Раздел курса. level — сложность: 1 основы, 2 применение, 3 продвинутое."""

    class Level(models.IntegerChoices):
        BASIC = 1, 'основы'
        APPLIED = 2, 'применение'
        ADVANCED = 3, 'продвинутое'

    course = models.ForeignKey(
        Course, on_delete=models.CASCADE, related_name='sections',
        verbose_name='курс',
    )
    level = models.PositiveSmallIntegerField(
        'уровень', choices=Level.choices, default=Level.BASIC,
    )

    class Meta(ContentItem.Meta):
        verbose_name = 'раздел'
        verbose_name_plural = 'разделы'
        constraints = [
            models.UniqueConstraint(
                fields=['course', 'slug'], name='section_unique_slug',
            ),
        ]


class Topic(ContentItem):
    """Тема: один урок и 2–5 задач."""

    section = models.ForeignKey(
        Section, on_delete=models.CASCADE, related_name='topics',
        verbose_name='раздел',
    )
    # Задачник темы (_practice.yaml): [{title, text, hint, answer}], тексты — HTML.
    # Без id и прогресса, поэтому хранится списком, а не отдельной моделью
    practice = models.JSONField('задачник', default=list, blank=True)

    class Meta(ContentItem.Meta):
        verbose_name = 'тема'
        verbose_name_plural = 'темы'
        constraints = [
            models.UniqueConstraint(
                fields=['section', 'slug'], name='topic_unique_slug',
            ),
        ]

    def get_absolute_url(self):
        """Адрес урока темы."""
        section = self.section
        return reverse(
            'courses:lesson', args=[section.course.slug, section.slug, self.slug],
        )


class Lesson(models.Model):
    """Урок темы. HTML собран из Markdown при загрузке контента."""

    topic = models.OneToOneField(
        Topic, on_delete=models.CASCADE, related_name='lesson', verbose_name='тема',
    )
    title = models.CharField('название', max_length=200)
    body_html = models.TextField('текст (HTML)')
    reading_time = models.PositiveSmallIntegerField('минут на чтение', default=5)
    is_published = models.BooleanField('опубликовано', default=True)

    objects = PublishedQuerySet.as_manager()

    class Meta:
        verbose_name = 'урок'
        verbose_name_plural = 'уроки'

    def __str__(self):
        return self.title


class Exercise(ContentItem):
    """Задача темы.

    Общие поля — колонками. Всё, что зависит от типа (код заготовки, тесты,
    варианты ответа, файлы конфига…), — в spec: так не нужен десяток колонок,
    пустых у половины типов.
    """

    class Type(models.TextChoices):
        EXERCISE = 'exercise', 'задача с тестами'
        PREDICT = 'predict', 'предскажи вывод'
        QUIZ = 'quiz', 'выбор ответа'
        FIX = 'fix', 'найди ошибку'

    topic = models.ForeignKey(
        Topic, on_delete=models.CASCADE, related_name='exercises',
        verbose_name='тема',
    )
    type = models.CharField('тип', max_length=20, choices=Type.choices)
    difficulty = models.PositiveSmallIntegerField('сложность', default=1)
    pitfall = models.TextField('подводный камень')
    statement_html = models.TextField('условие (HTML)')
    explanation_html = models.TextField('разбор (HTML)')
    spec = models.JSONField('данные задачи', default=dict)

    class Meta(ContentItem.Meta):
        verbose_name = 'задача'
        verbose_name_plural = 'задачи'
        constraints = [
            models.UniqueConstraint(
                fields=['topic', 'slug'], name='exercise_unique_slug',
            ),
        ]

    def get_absolute_url(self):
        topic = self.topic
        section = topic.section
        return reverse(
            'trainers:exercise',
            args=[section.course.slug, section.slug, topic.slug, self.slug],
        )
