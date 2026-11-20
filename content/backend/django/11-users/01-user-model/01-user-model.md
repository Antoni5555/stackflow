---
title: Модель пользователя
type: lesson
level: 2
reading_time: 12
---

## Теория
В Django есть готовая модель пользователя — `django.contrib.auth.models.User`: `username` (логин), `password` (хеш, не сам пароль), `email`, `first_name`, `last_name`, флаги `is_active`, `is_staff`, `is_superuser`, `last_login`, `date_joined`, группы и права. Вход — по `username`.

Магазину чаще нужен вход **по почте**, телефон, согласие на рассылку. Поля можно добавить отдельной моделью «профиль» со связью `OneToOneField(User)`, но заменить способ входа так нельзя. Поэтому документация Django советует **в каждом новом проекте сразу завести свою модель пользователя**, даже если сейчас её поля не отличаются от стандартных:
```
class User(AbstractUser):
    pass
```
и указать её в настройках — **`AUTH_USER_MODEL = "accounts.User"`** — **до первой миграции**. Причина: на таблицу пользователей ссылаются миграции встроенных приложений (`admin`, `auth`) и всех ваших моделей с `ForeignKey` на пользователя. Сменить модель после `migrate` — значит пересобирать базу и миграции, Django сам этого не сделает.

Два базовых класса:
- **`AbstractUser`** — всё, что есть у стандартного `User`; добавляете поля или убираете `username`. Подходит почти всегда;
- **`AbstractBaseUser`** (+ `PermissionsMixin` для прав) — только пароль и `last_login`, остальное пишете сами: поля, `is_staff`, менеджер. Нужен, когда модель совсем другая.

Для входа по почте у модели меняют **`USERNAME_FIELD = "email"`** (поле обязано быть `unique`), убирают `username = None`, а **`REQUIRED_FIELDS`** — поля, которые спросит `createsuperuser`, кроме логина и пароля. Стандартный менеджер `UserManager` требует `username`, поэтому нужен свой — от `BaseUserManager` с `create_user` и `create_superuser`.

В остальном коде модель не называют напрямую: в `ForeignKey` — **`settings.AUTH_USER_MODEL`**, в коде — **`get_user_model()`**. Тогда код работает с любой моделью пользователя.

Пароли Django хранит **хешем** (`pbkdf2_sha256$…` — алгоритм, число итераций, соль и хеш): задаёт пароль `set_password()`, проверяет `check_password()`. Записать пароль в поле напрямую (`user.password = "…"`) — значит сохранить его открытым текстом, и войти с ним не получится.

## Наглядно
**Таблица 1.** Варианты модели пользователя.

| Вариант | Что даёт | Когда |
|---|---|---|
| стандартный `User` | готово, вход по `username` | учебные проекты; сменить потом трудно |
| `User(AbstractUser)` + `AUTH_USER_MODEL` | все поля `User` + свои | **по умолчанию в новом проекте** |
| `AbstractUser`, `username = None`, `USERNAME_FIELD = "email"` | вход по почте | интернет-магазин |
| `AbstractBaseUser` + `PermissionsMixin` | только пароль; поля и менеджер — свои | модель совсем не похожа на `User` |
| профиль `OneToOneField(User)` | доп. поля без замены модели | поля нужны уже работающему проекту |

## На практике
Задача: магазин, где покупатель входит по почте. Это делается в начале проекта, в отдельном приложении `accounts`. Вывод ниже — из настоящего проекта Django 5.2 (в тренажёре своя модель пользователя не поддерживается: Django выбирает её один раз при старте).

### Шаг 1. Модель без настройки
Файл `accounts/models.py`:
```python
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    username = None
    email = models.EmailField("почта", unique=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []
```
Без `AUTH_USER_MODEL` в проекте две модели пользователя — `auth.User` и `accounts.User`, и их связи с группами и правами конфликтуют. `manage.py check` (фрагмент):
```
accounts.User.groups: (fields.E304) Reverse accessor 'Group.user_set' for 'accounts.User.groups' clashes with reverse accessor for 'auth.User.groups'.
```
и ещё три ошибки того же вида.

### Шаг 2. Настройка и менеджер
Файл `config/settings.py` (фрагмент):
```python
AUTH_USER_MODEL = "accounts.User"
```
Проверка проходит, миграция создаётся. Но `User.objects.create_user(email="anna@shop.example", password="x")`:
```
TypeError: UserManager.create_user() missing 1 required positional argument: 'username'
```
Стандартный менеджер ждёт `username`, которого больше нет. Свой менеджер:

Файл `accounts/models.py` (фрагмент):
```python
class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save()
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self.create_user(email, password, **extra)


class User(AbstractUser):
    # … поля как выше
    objects = UserManager()
```
Теперь `create_user(email="Anna@SHOP.example", password="secret-123")` создаёт пользователя с почтой `Anna@shop.example`: `normalize_email` приводит к нижнему регистру только домен. Вход — `authenticate(email="Anna@shop.example", password="secret-123")` — находит пользователя, а `authenticate(email="anna@shop.example", …)` возвращает `None`: поиск чувствителен к регистру. Почту при регистрации обычно целиком переводят в нижний регистр.

### Шаг 3. Поле логина не уникально
Если убрать `unique=True` у почты:
```
accounts.User: (auth.E003) 'User.email' must be unique because it is named as the 'USERNAME_FIELD'.
```

### Шаг 4. Смена модели после migrate
Проект сначала запустили со стандартным `User` (`migrate`), потом добавили `accounts.User` и `AUTH_USER_MODEL`. `makemigrations` создаёт миграцию, а `migrate`:
```
django.db.migrations.exceptions.InconsistentMigrationHistory: Migration admin.0001_initial is applied before its dependency accounts.0001_initial on database 'default'.
```
Миграция админки уже применена, а она должна зависеть от таблицы пользователей, которой ещё нет. Дальше — только ручной перенос данных и пересборка миграций. Отсюда правило: своя модель — до первого `migrate`.

### Шаг 5. Ссылки на пользователя
Файл `shop/models.py` (фрагмент):
```python
from django.conf import settings


class Order(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="orders",
    )
```
В коде — `from django.contrib.auth import get_user_model` и `User = get_user_model()`.

## Частые ошибки
- **Своя модель после первой миграции.** `InconsistentMigrationHistory` — придётся пересоздавать базу или переносить данные вручную. Заводите `User(AbstractUser)` в начале проекта.
- **Нет `AUTH_USER_MODEL`.** Две модели пользователя — `fields.E304` о конфликте `Group.user_set`.
- **`USERNAME_FIELD` без `unique`.** `auth.E003`.
- **Стандартный менеджер без `username`.** `create_user()` требует `username`; нужен свой `BaseUserManager`.
- **`from django.contrib.auth.models import User` в коде проекта со своей моделью.** Ссылка на чужую таблицу; используйте `settings.AUTH_USER_MODEL` и `get_user_model()`.
- **`user.password = "…"`.** Пароль в базе открытым текстом и не проходит `check_password`. Только `set_password()`.

## Итог
**Своя модель**
- `class User(AbstractUser)` + `AUTH_USER_MODEL` — до первого `migrate`.
- Вход по почте: `username = None`, `email` с `unique=True`, `USERNAME_FIELD = "email"`, `REQUIRED_FIELDS`, свой менеджер.

**Ссылки и пароли**
- `settings.AUTH_USER_MODEL` в связях, `get_user_model()` в коде.
- Пароль — хеш: `set_password()`, `check_password()`.

## Вопросы на собеседовании
<details><summary>Почему свою модель пользователя заводят в начале проекта?</summary>

На таблицу пользователей ссылаются миграции `admin`, `auth` и всех моделей проекта. `AUTH_USER_MODEL` должен быть задан до первой миграции; сменить его позже — `InconsistentMigrationHistory`, ручной перенос данных и пересборка миграций. Поэтому даже без новых полей создают `class User(AbstractUser): pass`.
</details>

<details><summary>Чем `AbstractUser` отличается от `AbstractBaseUser`?</summary>

`AbstractUser` — полный набор полей стандартного `User` (username, email, имя, флаги, группы и права через `PermissionsMixin`); его расширяют полями. `AbstractBaseUser` — только `password`, `last_login` и методы работы с паролем; поля, `USERNAME_FIELD`, менеджер и права (`PermissionsMixin`) нужно описать самому.
</details>

<details><summary>Как Django хранит пароли?</summary>

Хешем с солью: строка `алгоритм$итерации$соль$хеш`, по умолчанию PBKDF2-SHA256 с большим числом итераций. `set_password()` вычисляет хеш, `check_password()` сравнивает. Алгоритмы задаёт `PASSWORD_HASHERS`; при смене первого в списке старые хеши обновляются при следующем входе.
</details>

## Глубже
Вход, выход и регистрация — следующая тема. Готовые регистрация, вход по почте и подтверждение адреса — библиотека django-allauth.
