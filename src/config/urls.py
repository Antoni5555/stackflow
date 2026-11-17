"""Главный роутер: подключает URL всех приложений."""
from django.conf import settings
from django.contrib import admin
from django.contrib.sitemaps.views import sitemap
from django.contrib.staticfiles.urls import staticfiles_urlpatterns
from django.urls import include, path
from django.views.decorators.cache import cache_page

from apps.pages.sitemaps import SITEMAPS
from apps.pages.views import robots_txt
from core.views import health


handler404 = 'core.errors.page_not_found'
handler500 = 'core.errors.server_error'

urlpatterns = [
    path('admin/', admin.site.urls),
    path('health/', health, name='health'),
    path('robots.txt', robots_txt, name='robots'),
    # карта строится по базе; час в кэше — после load_content обновится сама
    path('sitemap.xml', cache_page(60 * 60)(sitemap), {'sitemaps': SITEMAPS},
         name='sitemap'),

    path('', include('apps.pages.urls')),
    path('courses/', include('apps.courses.urls')),
    path('cheatsheets/', include('apps.cheatsheets.urls')),
    # тренажёр подключён к корню: в нём будут и /playground/, и адреса задач
    path('', include('apps.trainers.urls')),
    path('accounts/', include('apps.accounts.urls')),   # профиль
    path('accounts/', include('allauth.urls')),         # вход, регистрация, пароль
    path('api/progress/', include('apps.progress.urls')),
    path('api/notes/', include('apps.cheatsheets.api_urls')),
    path('api/reports/', include('apps.feedback.api_urls')),
]

# Статика в разработке (runserver --nostatic); при DEBUG=False список пустой
urlpatterns += staticfiles_urlpatterns()

if settings.DEBUG:
    from apps.trainers.views import HtmlCheckView

    # Проверка эталонов задач на вёрстку — для сессии «Контент», только локально
    urlpatterns += [
        path('dev/html-check/', HtmlCheckView.as_view(), name='html_check'),
    ]
