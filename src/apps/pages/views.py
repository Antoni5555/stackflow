from django.conf import settings
from django.http import HttpResponse
from django.urls import reverse
from django.views.decorators.http import require_GET
from django.views.generic import TemplateView

from apps.courses.services.selectors import home_summary, start_card
from apps.progress.services import progress


class HomeView(TemplateView):
    """Главная."""

    template_name = 'home/home.html'
    extra_context = {'active_nav': 'home'}

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        summary = home_summary()
        progress.apply_to_path(summary['cards'], self.request.user)
        context.update(summary)
        return context


class AboutView(TemplateView):
    """О проекте."""

    template_name = 'about/about.html'
    extra_context = {'active_nav': 'about'}

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['first_card'] = start_card()   # кнопка «Начать с …» в CTA
        context['meta_description'] = (
            f'Зачем сделан {settings.SITE_NAME}, как устроен сайт — код выполняется '
            'прямо в браузере — и кто его автор.'
        )
        return context


# Закрыто от поиска: служебное (админка, API), личное (аккаунт, шпаргалки — заметки
# ученика) и кусочки страниц (задачник тренажёра подгружается фрагментами HTML)
ROBOTS_DISALLOW = (
    '/admin/', '/api/', '/accounts/', '/cheatsheets/', '/playground/practice/', '/dev/',
)


@require_GET
def robots_txt(request):
    """robots.txt: что не индексировать и где карта сайта."""
    lines = ['User-agent: *', *(f'Disallow: {path}' for path in ROBOTS_DISALLOW), '']
    lines.append(f'Sitemap: {request.build_absolute_uri(reverse("sitemap"))}')
    text = '\n'.join(lines) + '\n'
    return HttpResponse(text, content_type='text/plain; charset=utf-8')


class LegalView(TemplateView):
    """Юридический документ: политика конфиденциальности или согласие на обработку.

    Реквизиты оператора — из настроек (OPERATOR в .env), не из шаблона.
    """

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['operator'] = settings.OPERATOR
        return context
