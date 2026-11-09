"""Формы аккаунта: регистрация (поверх формы allauth) и настройки профиля."""
from allauth.account.forms import SignupForm as AllauthSignupForm
from django import forms
from django.utils import timezone

from .models import User


class SignupForm(AllauthSignupForm):
    """Регистрация: имя, фамилия, email, пароль, возраст 14+ и согласие на обработку.

    Имя и фамилию allauth сам записывает в пользователя (adapter.save_user
    берёт first_name и last_name из cleaned_data).
    """

    first_name = forms.CharField(
        label='Имя', max_length=150,
        widget=forms.TextInput(attrs={'autocomplete': 'given-name'}),
    )
    last_name = forms.CharField(
        label='Фамилия', max_length=150,
        widget=forms.TextInput(attrs={'autocomplete': 'family-name'}),
    )
    # С 14 лет согласие на обработку данных можно дать самому; младше — только родитель.
    # Дату рождения не спрашиваем: лишние данные, а проверить её всё равно нечем.
    age_confirmed = forms.BooleanField(
        label='Подтверждаю, что мне есть 14 лет',
        error_messages={
            'required': 'Регистрация — с 14 лет. Уроки и задачи доступны без аккаунта.',
        },
    )
    # Подпись со ссылками на документы — в шаблоне account/_consent_label.html
    privacy_consent = forms.BooleanField(
        label='Согласие на обработку персональных данных',
        error_messages={'required': 'Без согласия зарегистрироваться нельзя.'},
    )

    field_order = [
        'first_name', 'last_name', 'email', 'password1',
        'privacy_consent', 'age_confirmed',
    ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # подписи и подсказки — как в макете, а не стандартные allauth
        self.fields['email'].label = 'Email'
        self.fields['email'].widget.attrs['placeholder'] = 'you@example.com'
        self.fields['password1'].widget.attrs.pop('placeholder', None)

    def custom_signup(self, request, user):
        """Запоминаем, когда подтверждён возраст и дано согласие (после создания)."""
        user.age_confirmed_at = user.privacy_consent_at = timezone.now()
        user.save(update_fields=['age_confirmed_at', 'privacy_consent_at'])


class ProfileForm(forms.ModelForm):
    """Настройки профиля: имя и фамилия (email меняется отдельно, с подтверждением)."""

    class Meta:
        model = User
        fields = ['first_name', 'last_name']
        labels = {'first_name': 'Имя', 'last_name': 'Фамилия'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # в модели (AbstractUser) поля необязательные, на сайте — обязательные
        for field in self.fields.values():
            field.required = True
