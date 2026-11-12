from django.conf import settings


def site(request):
    """Во всех шаблонах: {{ SITE_NAME }} и почта для связи {{ SITE_EMAIL }}."""
    return {'SITE_NAME': settings.SITE_NAME, 'SITE_EMAIL': settings.OPERATOR['email']}
