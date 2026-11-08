from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("comptes", "0018_options_payantes"),
    ]

    operations = [
        migrations.AddField(
            model_name="demanderenouvellement",
            name="option",
            field=models.CharField(
                blank=True,
                choices=[("en_ligne", "Option En ligne"), ("reseau", "Option Réseau"), ("mobile", "Option Mobile")],
                default="",
                max_length=20,
            ),
        ),
    ]
