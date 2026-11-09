from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0002_privacy_consent'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='age_confirmed_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='подтвердил возраст 14+'),
        ),
    ]
