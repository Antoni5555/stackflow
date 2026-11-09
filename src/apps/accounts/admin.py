from allauth.account.models import EmailAddress
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group
from unfold.admin import ModelAdmin, TabularInline
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from .models import User

# Группы прав в проекте не используются; почта allauth показана в карточке
# пользователя, отдельный раздел «Адреса электронной почты» не нужен
admin.site.unregister(Group)
admin.site.unregister(EmailAddress)


class EmailAddressInline(TabularInline):
    """Почта пользователя из allauth: подтверждена ли (без этого не войти)."""

    model = EmailAddress
    fields = ['email', 'verified', 'primary']
    extra = 0


@admin.register(User)
class UserAdmin(BaseUserAdmin, ModelAdmin):
    """Пользователи: вход по email, username нет."""

    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm
    inlines = [EmailAddressInline]

    ordering = ['-date_joined']
    list_display = [
        'email', 'first_name', 'last_name', 'email_verified', 'is_staff', 'date_joined',
    ]
    list_filter = ['is_staff', 'is_active', 'date_joined']
    search_fields = ['email', 'first_name', 'last_name']
    readonly_fields = [
        'last_login', 'date_joined', 'age_confirmed_at', 'privacy_consent_at',
    ]
    fieldsets = [
        (None, {'fields': ['email', 'password']}),
        ('Имя', {'fields': ['first_name', 'last_name']}),
        ('Права', {'fields': ['is_active', 'is_staff', 'is_superuser']}),
        ('Даты', {'fields': [
            'date_joined', 'last_login', 'age_confirmed_at', 'privacy_consent_at',
        ]}),
    ]
    add_fieldsets = [
        (None, {'classes': ['wide'], 'fields': ['email', 'password1', 'password2']}),
    ]

    def get_queryset(self, request):
        # «Почта подтверждена» в списке — без запроса на каждого пользователя
        return super().get_queryset(request).prefetch_related('emailaddress_set')

    @admin.display(description='почта подтверждена', boolean=True)
    def email_verified(self, obj):
        return any(address.verified for address in obj.emailaddress_set.all())
