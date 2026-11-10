"""Страницы тренажёров: задача и песочница.

Данные готовят функции из apps/courses/services/selectors.py.
"""

from django.conf import settings
from django.views.generic import TemplateView

from apps.courses.services import selectors
from apps.cheatsheets.services.notes import note_panel
from apps.progress.services import progress
from apps.courses.services.rendering import highlight


class EngineMixin:
    """Адрес Pyodide для страниц с Python-тренажёром."""

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['PYODIDE_URL'] = settings.PYODIDE_URL
        return context


class ExerciseView(EngineMixin, TemplateView):
    """Задача: условие, редактор, проверка в браузере."""

    template_name = 'trainers/exercise_detail.html'
    extra_context = {'active_nav': 'courses'}

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context.update(selectors.exercise_page(
            kwargs['course'], kwargs['section'], kwargs['topic'], kwargs['exercise'],
        ))
        exercise = context['exercise']
        progress.apply_to_outline(context['sections'], self.request.user)
        exercise.is_solved = any(
            item.is_solved for section in context['sections']
            for topic in section.topics.all() for item in topic.exercises.all()
            if item.pk == exercise.pk
        )
        context['exercise_key'] = progress.exercise_key(exercise)
        context['note'] = note_panel(
            self.request.user, context['course'], context['topic'],
            context['exercise_key'],
        )
        spec = exercise.spec
        # Код на странице — с подсветкой, как в уроке
        if exercise.type == exercise.Type.PREDICT:
            code = spec['code'].rstrip('\n')
            context['code_html'] = highlight(code, 'python')
            context['code_line_numbers'] = '\n'.join(
                str(n) for n in range(1, code.count('\n') + 2)
            )
        if spec.get('inputs'):
            context['inputs_html'] = highlight(spec['inputs'].rstrip('\n'), 'python')
        if exercise.type == exercise.Type.EXERCISE:
            solution = spec['solution'].rstrip('\n')
            context['solution_html'] = highlight(solution, 'python')

        # Данные для JS: тип и всё, что нужно проверке (подсказки уже в HTML страницы)
        context['exercise_data'] = {
            'type': exercise.type,
            **{key: value for key, value in exercise.spec.items() if key != 'hints'},
        }
        return context


class PlaygroundView(EngineMixin, TemplateView):
    """Тренажёр-песочница: свободный код без задач."""

    template_name = 'trainers/playground.html'
    extra_context = {'active_nav': 'playground'}

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context.update(selectors.playground('python'))
        course = context['course']
        if course:
            context['note'] = note_panel(self.request.user, course, None, course.slug)
            context['practice'] = selectors.practice_topics(context['sections'])
        return context


class PracticeView(TemplateView):
    """Задачи задачника одной темы — кусок HTML для плашки «Задачник»."""

    template_name = 'trainers/components/_practice_tasks.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['topic'] = selectors.practice_topic(
            kwargs['course'], kwargs['section'], kwargs['topic'],
        )
        return context
