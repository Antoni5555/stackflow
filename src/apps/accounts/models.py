"""Пользователь сайта. Логин — email, username не нужен."""
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class UserManager(BaseUserManager):
    """Создание пользователей по email (стандартный менеджер требует username)."""

    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError('Нужен email')
        user = self.model(email=self.normalize_email(email), **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', False)
        extra_fields.setdefault('is_superuser', False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    """Пользователь: вход по email; имя и фамилия обязательны при регистрации."""

    username = None
    email = models.EmailField('email', unique=True)
    # Когда пользователь дал согласие на обработку персональных данных (152-ФЗ):
    # отметка в форме регистрации. NULL — создан не через регистрацию (админ).
    privacy_consent_at = models.DateTimeField(
        'согласие на обработку данных', null=True, blank=True,
    )
    # Когда пользователь подтвердил, что ему исполнилось 14 лет: с 14 лет согласие
    # на обработку данных можно дать самому. Дату рождения не собираем — только отметку.
    # NULL — зарегистрирован до этой отметки или создан не через регистрацию.
    age_confirmed_at = models.DateTimeField(
        'подтвердил возраст 14+', null=True, blank=True,
    )

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    objects = UserManager()

    class Meta:
        verbose_name = 'пользователь'
        verbose_name_plural = 'пользователи'

    def __str__(self):
        return self.email

    @property
    def display_name(self):
        """Имя для шапки и профиля: имя и фамилия или начало email."""
        return self.get_full_name() or self.email.split('@')[0]

    @property
    def initials(self):
        """Буквы для аватара: «Иван Петров» → «ИП», «anna@…» → «A»."""
        parts = self.get_full_name().split()
        if parts:
            return ''.join(part[0] for part in parts[:2]).upper()
        return self.email[:1].upper()


def user_display(user):
    """Как allauth называет пользователя в сообщениях (ACCOUNT_USER_DISPLAY)."""
    return user.display_name
