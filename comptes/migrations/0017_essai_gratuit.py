from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("comptes", "0016_appli_mobile_autorisee"),
    ]

    operations = [
        migrations.AddField(
            model_name="boutique",
            name="essai_formule",
            field=models.CharField(
                blank=True, choices=[("essentiel", "Essentiel"), ("pro", "Pro")], default="", max_length=20
            ),
        ),
        migrations.AddField(
            model_name="boutique",
            name="essai_fin",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
