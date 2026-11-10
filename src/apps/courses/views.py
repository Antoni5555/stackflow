"""Страницы курсов. Views тонкие: данные готовят services/selectors.py
и apps/progress/services/progress.py (статусы пользователя)."""
from django.views.generic import TemplateView

from apps.cheatsheets.services.notes import note_panel
from apps.progress.services import progress

from .services import selectors


class CourseListView(TemplateView):
    """Каталог курсов направления: /courses/?track=backend."""

    template_name = 'courses/course_list.html'
    extra_context = {'active_nav': 'courses'}

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        tracks, track, cards = selectors.catalog(self.request.GET.get('track'))
        progress.apply_to_cards(cards, self.request.user)
        path_cards, module_cards = selectors.split_cards(cards)
        context.update(
            tracks=tracks, track=track, cards=path_cards, module_cards=module_cards,
        )
        return context


class CourseDetailView(TemplateView):
    """Курс: программа по разделам и темам, у вошедшего — прогресс и «Продолжить»."""

    template_name = 'courses/course_detail.html'
    extra_context = {'active_nav': 'courses'}

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context.update(selectors.course_detail(kwargs['course']))
        sections = context['sections']
        context['progress'] = progress.apply_to_outline(sections, self.request.user)
        if self.request.user.is_authenticated and context['progress']['solved']:
            items = selectors.course_items(sections)
            context['continue_item'] = progress.next_item(items)
        return context


class LessonView(TemplateView):
    """Урок темы с программой курса справа. У вошедшего урок отмечается прочитанным."""

    template_name = 'courses/lesson_detail.html'
    extra_context = {'active_nav': 'courses'}

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context.update(selectors.lesson_page(
            kwargs['course'], kwargs['section'], kwargs['topic'],
        ))
        if self.request.user.is_authenticated:
            progress.mark_viewed(self.request.user, context['lesson'])
        progress.apply_to_outline(context['sections'], self.request.user)
        context['note'] = note_panel(
            self.request.user, context['course'], context['topic'],
            progress.lesson_key(context['topic']),
        )
        return context
