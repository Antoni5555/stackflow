"""Общие настройки для всех окружений.

development.py, production.py и test.py импортируют всё отсюда
и меняют только то, что отличается.
"""
import os
from pathlib import Path

from django.templatetags.static import static
from django.urls import reverse_lazy
from dotenv import load_dotenv


# src/ — здесь manage.py, приложения, шаблоны и статика
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# .env лежит в корне репозитория (на уровень выше src/).
# Переменные, уже заданные в окружении (например, Docker Compose), не перезаписываются.
load_dotenv(BASE_DIR.parent / '.env')


def env_list(name, default=''):
    """Читает из окружения список через запятую: 'a, b' → ['a', 'b']."""
    items = os.getenv(name, default).split(',')
    return [item.strip() for item in items if item.strip()]


SECRET_KEY = os.getenv('SECRET_KEY')
if not SECRET_KEY:
    raise ValueError('SECRET_KEY is not set')

DEBUG = False

ALLOWED_HOSTS = env_list('ALLOWED_HOSTS')

# Название сайта берём из .env, в шаблонах это {{ SITE_NAME }}
SITE_NAME = os.getenv('SITE_NAME', 'SITE_NAME')


INSTALLED_APPS = [
    # Оформление админки — до django.contrib.admin, чтобы его шаблоны были главнее
    'unfold',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    'allauth',
    'allauth.account',
    'rest_framework',

    'core.apps.CoreConfig',
    'apps.pages.apps.PagesConfig',
    'apps.courses.apps.CoursesConfig',
    'apps.cheatsheets.apps.CheatsheetsConfig',
    'apps.trainers.apps.TrainersConfig',
    'apps.accounts.apps.AccountsConfig',
    'apps.progress.apps.ProgressConfig',
    'apps.feedback.apps.FeedbackConfig',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'allauth.account.middleware.AccountMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'core.context_processors.site',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


# PostgreSQL во всех окружениях — чтобы не ловить различия SQLite и Postgres на сервере
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.getenv('POSTGRES_DB'),
        'USER': os.getenv('POSTGRES_USER'),
        'PASSWORD': os.getenv('POSTGRES_PASSWORD'),
        'HOST': os.getenv('DB_HOST', 'localhost'),
        'PORT': os.getenv('DB_PORT', '5432'),
    }
}

# Redis: один кэш на все воркеры Gunicorn (LocMem у каждого воркера свой)
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': os.getenv('REDIS_URL', 'redis://localhost:6379/0'),
    }
}


_VALIDATORS = 'django.contrib.auth.password_validation'
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': f'{_VALIDATORS}.UserAttributeSimilarityValidator'},
    {'NAME': f'{_VALIDATORS}.MinimumLengthValidator'},
    {'NAME': f'{_VALIDATORS}.CommonPasswordValidator'},
    {'NAME': f'{_VALIDATORS}.NumericPasswordValidator'},
]


LANGUAGE_CODE = 'ru-ru'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True


STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# --- Аккаунты: свой пользователь (вход по email) + django-allauth ---
AUTH_USER_MODEL = 'accounts.User'

AUTHENTICATION_BACKENDS = [
    'django.contrib.auth.backends.ModelBackend',
    'allauth.account.auth_backends.AuthenticationBackend',
]

ACCOUNT_LOGIN_METHODS = {'email'}
ACCOUNT_SIGNUP_FIELDS = ['email*', 'password1*']   # без повтора пароля и username
ACCOUNT_USER_MODEL_USERNAME_FIELD = None
# + имя, фамилия и согласие на обработку данных
ACCOUNT_FORMS = {'signup': 'apps.accounts.forms.SignupForm'}
ACCOUNT_ADAPTER = 'apps.accounts.adapter.AccountAdapter'
# В сообщениях allauth («Вы вошли как …») — имя, а не email
ACCOUNT_USER_DISPLAY = 'apps.accounts.models.user_display'
# Войти можно только после подтверждения почты: ссылка в письме подтверждает
# сразу при открытии (без второй кнопки) и, в том же браузере, сразу входит
ACCOUNT_EMAIL_VERIFICATION = 'mandatory'
ACCOUNT_CONFIRM_EMAIL_ON_GET = True
ACCOUNT_LOGIN_ON_EMAIL_CONFIRMATION = True
ACCOUNT_EMAIL_CONFIRMATION_EXPIRE_DAYS = 3
# Название сайта — в теме письма (шаблон *_subject.txt), префикс «[сайт]» не нужен
ACCOUNT_EMAIL_SUBJECT_PREFIX = ''
ACCOUNT_SESSION_REMEMBER = True
ACCOUNT_LOGOUT_REDIRECT_URL = '/'
LOGIN_URL = 'account_login'
LOGIN_REDIRECT_URL = 'accounts:profile'

DEFAULT_FROM_EMAIL = os.getenv('DEFAULT_FROM_EMAIL', 'noreply@localhost')

# Оператор персональных данных — для страниц «Политика конфиденциальности»
# и «Согласие на обработку данных». В .env, а не в коде: репозиторий публичный,
# а данные зависят от того, кто и где запускает сайт
OPERATOR = {
    'name': os.getenv('OPERATOR_NAME', ''),
    'inn': os.getenv('OPERATOR_INN', ''),
    'city': os.getenv('OPERATOR_CITY', ''),
    'email': os.getenv('OPERATOR_EMAIL', ''),
}


# --- API (DRF): его вызывает JS страниц, вход — обычной сессией сайта (с CSRF) ---
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    # Лимит для API с ScopedRateThrottle; счётчики — в кэше (Redis)
    'DEFAULT_THROTTLE_RATES': {'reports': '20/hour'},
}

# Уроки и задачи (папка content/ в корне репозитория). Загружаются командой
# manage.py load_content; в Docker папка подключена в /content
CONTENT_DIR = Path(os.getenv('CONTENT_DIR', BASE_DIR.parent / 'content'))

# Pyodide (Python в браузере) — с CDN jsDelivr: ~13 МБ, хранить в репозитории невыгодно.
# Версия 0.27 — внутри Python 3.12, как в формате контента (тексты ошибок совпадают).
PYODIDE_URL = os.getenv(
    'PYODIDE_URL', 'https://cdn.jsdelivr.net/pyodide/v0.27.8/full/',
)
# PGlite (PostgreSQL в браузере) — тоже с jsDelivr, ~3 МБ по сети. Версия 0.2.17 —
# внутри PostgreSQL 16, как в формате контента; та же версия — в package.json (тесты).
PGLITE_URL = os.getenv(
    'PGLITE_URL',
    'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2.17/dist/index.js',
)

# --- Админка (Unfold): своё меню по смыслу, а не по приложениям Django ---
# Иконки — Material Symbols (https://fonts.google.com/icons), подключает сам Unfold.
UNFOLD = {
    'SITE_TITLE': f'{SITE_NAME} — админка',
    'SITE_HEADER': SITE_NAME,
    'SITE_SUBHEADER': 'админка',
    'SITE_URL': '/',
    'SITE_ICON': lambda request: static('img/favicon.svg'),
    'SITE_FAVICONS': [
        {'rel': 'icon', 'type': 'image/svg+xml',
         'href': lambda request: static('img/favicon.svg')},
    ],
    'SHOW_HISTORY': True,
    'SHOW_VIEW_ON_SITE': True,
    'BORDER_RADIUS': '10px',
    'DASHBOARD_CALLBACK': 'core.admin_dashboard.dashboard_callback',
    # Палитра сайта: серые без оттенка + лайм. Кнопки — тёмный лайм (600):
    # на ярком лайме белый текст не читается
    'COLORS': {
        'base': {
            '50': 'oklch(98.5% 0 0)', '100': 'oklch(97% 0 0)',
            '200': 'oklch(92.2% 0 0)', '300': 'oklch(87% 0 0)',
            '400': 'oklch(70.8% 0 0)', '500': 'oklch(55.6% 0 0)',
            '600': 'oklch(43.9% 0 0)', '700': 'oklch(37.1% 0 0)',
            '800': 'oklch(26.9% 0 0)', '900': 'oklch(20.5% 0 0)',
            '950': 'oklch(14.5% 0 0)',
        },
        'primary': {
            '50': 'oklch(98.6% .03 120)', '100': 'oklch(96.5% .07 120)',
            '200': 'oklch(94% .12 120)', '300': 'oklch(91.5% .17 120)',
            '400': 'oklch(85% .18 122)', '500': 'oklch(72% .17 125)',
            '600': 'oklch(56% .15 128)', '700': 'oklch(48% .12 130)',
            '800': 'oklch(40% .1 130)', '900': 'oklch(34% .08 130)',
            '950': 'oklch(24% .06 130)',
        },
    },
    'SIDEBAR': {
        'show_search': True,
        'show_all_applications': False,
        'navigation': [
            {
                'title': 'Обратная связь',
                'items': [
                    {
                        'title': 'Сообщения об ошибках',
                        'icon': 'report',
                        'link': reverse_lazy('admin:feedback_contentreport_changelist'),
                        'badge': 'core.admin_dashboard.new_reports_badge',
                    },
                ],
            },
            {
                'title': 'Пользователи',
                'separator': True,
                'items': [
                    {
                        'title': 'Пользователи',
                        'icon': 'group',
                        'link': reverse_lazy('admin:accounts_user_changelist'),
                    },
                ],
            },
            {
                'title': 'Активность учеников',
                'separator': True,
                'items': [
                    {
                        'title': 'Заметки',
                        'icon': 'sticky_note_2',
                        'link': reverse_lazy('admin:cheatsheets_note_changelist'),
                    },
                    {
                        'title': 'Прочитанные уроки',
                        'icon': 'menu_book',
                        'link': reverse_lazy('admin:progress_lessonview_changelist'),
                    },
                    {
                        'title': 'Решённые задачи',
                        'icon': 'task_alt',
                        'link': reverse_lazy(
                            'admin:progress_exerciseprogress_changelist'),
                    },
                ],
            },
            {
                # Только просмотр: контент правится в файлах content/
                'title': 'Контент',
                'separator': True,
                'collapsible': True,
                'items': [
                    {
                        'title': 'Курсы',
                        'icon': 'school',
                        'link': reverse_lazy('admin:courses_course_changelist'),
                    },
                    {
                        'title': 'Темы',
                        'icon': 'topic',
                        'link': reverse_lazy('admin:courses_topic_changelist'),
                    },
                    {
                        'title': 'Задачи',
                        'icon': 'code',
                        'link': reverse_lazy('admin:courses_exercise_changelist'),
                    },
                ],
            },
        ],
    },
}
