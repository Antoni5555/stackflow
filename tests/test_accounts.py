"""Аккаунты: регистрация и вход по email (django-allauth), профиль, шапка."""
import re

import pytest
from allauth.account.models import EmailAddress
from django.contrib.auth import get_user_model
from django.core import mail
from django.urls import reverse

from tests.factories import UserFactory


pytestmark = pytest.mark.django_db

User = get_user_model()


def test_user_is_identified_by_email():
    user = User.objects.create_user(email='Anna@Example.com', password='x')

    assert user.email == 'Anna@example.com'   # домен — в нижнем регистре
    assert User.USERNAME_FIELD == 'email'
    assert user.display_name == 'Anna'
    assert user.initials == 'A'


def test_display_name_and_initials_from_full_name():
    user = User(email='ivan@example.com', first_name='Иван', last_name='Петров')

    assert user.display_name == 'Иван Петров'
    assert user.initials == 'ИП'


def test_create_superuser():
    admin = User.objects.create_superuser(email='admin@example.com', password='x')

    assert admin.is_staff and admin.is_superuser


SIGNUP = {
    'first_name': 'Анна', 'last_name': 'Смирнова', 'email': 'new@example.com',
    'password1': 'Long-enough-pass-1', 'age_confirmed': 'on', 'privacy_consent': 'on',
}


def test_signup_sends_confirmation_and_waits_for_it(client, settings):
    """Регистрация: имя и согласие сохранены, письмо ушло, вход — после ссылки."""
    settings.SITE_NAME = 'Тестовый сайт'

    response = client.post(reverse('account_signup'), SIGNUP)

    assert response.status_code == 302
    assert response.url == reverse('account_email_verification_sent')
    assert '_auth_user_id' not in client.session
    user = User.objects.get(email='new@example.com')
    assert (user.first_name, user.last_name) == ('Анна', 'Смирнова')
    assert user.privacy_consent_at is not None
    assert user.age_confirmed_at is not None

    letter = mail.outbox[0]
    assert letter.to == ['new@example.com']
    assert letter.subject == 'Подтвердите почту — Тестовый сайт'
    assert 'Здравствуйте, Анна!' in letter.body
    html, mimetype = letter.alternatives[0]
    assert mimetype == 'text/html' and 'Подтвердить почту' in html


def test_confirmation_link_verifies_and_logs_in(client):
    """Ссылка из письма подтверждает почту сразу (без второй кнопки) и входит."""
    client.post(reverse('account_signup'), SIGNUP)
    link = re.search(r'https?://\S+/confirm-email/\S+/', mail.outbox[0].body).group()

    response = client.get(link)

    assert response.status_code == 302
    assert response.url == reverse('accounts:profile')
    user = User.objects.get(email='new@example.com')
    assert client.session['_auth_user_id'] == str(user.pk)
    assert EmailAddress.objects.get(user=user).verified


def test_invalid_confirmation_link(client):
    response = client.get(reverse('account_confirm_email', args=['wrong-key']))

    assert 'Ссылка устарела' in response.content.decode()


def test_login_without_confirmation_resends_letter(client):
    UserFactory(email='anna@example.com', verified_email=False)

    response = client.post(reverse('account_login'), {
        'login': 'anna@example.com', 'password': 'secret-pass-123',
    })

    assert response.url == reverse('account_email_verification_sent')
    assert '_auth_user_id' not in client.session
    assert mail.outbox[0].to == ['anna@example.com']


def test_signup_requires_name_and_consent(client):
    data = {**SIGNUP, 'first_name': '', 'last_name': ' '}
    del data['privacy_consent']

    response = client.post(reverse('account_signup'), data)

    html = response.content.decode()
    assert html.count('field__error') == 3
    assert 'Без согласия зарегистрироваться нельзя.' in html
    assert not User.objects.filter(email='new@example.com').exists()


def test_signup_requires_age_14(client):
    data = {**SIGNUP}
    del data['age_confirmed']

    response = client.post(reverse('account_signup'), data)

    html = response.content.decode()
    assert 'Регистрация — с 14 лет.' in html
    assert not User.objects.filter(email='new@example.com').exists()


def test_signup_form_links_to_legal_documents(client):
    html = client.get(reverse('account_signup')).content.decode()

    assert f'href="{reverse("pages:privacy")}"' in html
    assert f'href="{reverse("pages:consent")}"' in html


def test_signup_rejects_short_password(client):
    response = client.post(reverse('account_signup'), {**SIGNUP, 'password1': '123'})

    assert response.status_code == 200
    assert 'field__error' in response.content.decode()
    assert not User.objects.filter(email='new@example.com').exists()


def test_login_and_logout(client):
    UserFactory(email='anna@example.com')

    response = client.post(reverse('account_login'), {
        'login': 'anna@example.com', 'password': 'secret-pass-123',
    })
    assert response.url == reverse('accounts:profile')

    response = client.post(reverse('account_logout'))
    assert response.status_code == 302
    assert '_auth_user_id' not in client.session


def test_login_wrong_password_shows_error(client):
    UserFactory(email='anna@example.com')

    response = client.post(reverse('account_login'), {
        'login': 'anna@example.com', 'password': 'wrong',
    })

    assert response.status_code == 200
    assert 'alert--error' in response.content.decode()


def test_auth_pages_use_site_design(client):
    """Страницы allauth встроены в наш base.html и карточку входа."""
    for name in ['account_login', 'account_signup', 'account_reset_password']:
        html = client.get(reverse(name)).content.decode()
        assert 'class="auth__card"' in html, name
        assert 'class="header"' in html, name
        assert 'class="field__input' in html, name


def test_profile_requires_login(client):
    response = client.get(reverse('accounts:profile'))

    assert response.status_code == 302
    assert response.url.startswith(reverse('account_login'))


def test_profile_and_header_for_logged_in_user(client):
    user = UserFactory(email='ivan@example.com', first_name='Иван', last_name='Петров')
    client.force_login(user)

    html = client.get(reverse('accounts:profile')).content.decode()

    assert '<h1 class="page-title">Иван Петров</h1>' in html
    assert 'aria-label="Профиль">ИП</a>' in html      # аватар в шапке вместо «Войти»
    assert '>Войти</a>' not in html


def test_messages_shown_on_regular_pages(client):
    """Сообщения allauth («Вы вышли») видны на обычной странице, куда вернул выход."""
    client.force_login(UserFactory())

    response = client.post(reverse('account_logout'), follow=True)

    assert 'class="container stack-messages"' in response.content.decode()


def test_settings_change_name(client):
    user = UserFactory(first_name='Иван', last_name='Петров')
    client.force_login(user)

    response = client.post(reverse('accounts:settings'), {
        'first_name': 'Пётр', 'last_name': 'Иванов',
    })

    assert response.url == reverse('accounts:profile')
    user.refresh_from_db()
    assert user.display_name == 'Пётр Иванов'


def test_settings_name_is_required(client):
    user = UserFactory(first_name='Иван', last_name='Петров')
    client.force_login(user)

    response = client.post(
        reverse('accounts:settings'), {'first_name': '', 'last_name': ''},
    )

    assert response.content.decode().count('field__error') == 2
    user.refresh_from_db()
    assert user.first_name == 'Иван'


def test_settings_requires_login(client):
    response = client.get(reverse('accounts:settings'))

    assert response.url.startswith(reverse('account_login'))


@pytest.mark.parametrize('name', ['pages:privacy', 'pages:consent'])
def test_legal_pages_show_operator_from_settings(client, settings, name):
    settings.OPERATOR = {
        'name': 'Иванов Иван Иванович', 'inn': '123456789012',
        'city': 'г. Москва', 'email': 'pd@example.com',
    }

    html = client.get(reverse(name)).content.decode()

    assert 'Иванов Иван Иванович' in html and '123456789012' in html
    assert 'href="mailto:pd@example.com"' in html
    assert 'chip--active' in html


def test_legal_page_without_operator_says_what_to_set(client, settings):
    settings.OPERATOR = {'name': '', 'inn': '', 'city': '', 'email': ''}

    html = client.get(reverse('pages:privacy')).content.decode()

    assert 'OPERATOR_NAME' in html


def test_footer_links_to_legal_pages(client):
    html = client.get(reverse('pages:home')).content.decode()

    assert f'href="{reverse("pages:privacy")}"' in html
    assert f'href="{reverse("pages:consent")}"' in html
