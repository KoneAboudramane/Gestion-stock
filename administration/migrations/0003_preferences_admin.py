import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("administration", "0002_laissez_passer"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PreferencesAdmin",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("date_creation", models.DateTimeField(auto_now_add=True)),
                ("date_modification", models.DateTimeField(auto_now=True)),
                ("synchronise", models.BooleanField(default=False)),
                ("date_synchronisation", models.DateTimeField(blank=True, null=True)),
                ("supprime", models.BooleanField(default=False)),
                (
                    "theme",
                    models.CharField(
                        choices=[
                            ("clair", "Clair"), ("sombre", "Sombre"), ("nuit", "Nuit"), ("orange", "Orange"),
                            ("vert", "Vert"), ("bleu", "Bleu"), ("gris", "Gris"),
                        ],
                        default="clair",
                        max_length=10,
                    ),
                ),
                (
                    "utilisateur",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="preferences_admin",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "préférences d'administrateur",
                "verbose_name_plural": "préférences d'administrateurs",
            },
        ),
    ]
