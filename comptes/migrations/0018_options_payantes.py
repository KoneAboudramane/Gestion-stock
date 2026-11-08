from django.db import migrations, models


def garder_en_ligne_existant(apps, schema_editor):
    """Les boutiques qui avaient déjà l'envoi en ligne le gardent (exception de l'admin)."""
    Boutique = apps.get_model("comptes", "Boutique")
    Boutique.objects.filter(synchro_autorisee=True).update(option_en_ligne_offerte=True)


class Migration(migrations.Migration):
    dependencies = [
        ("comptes", "0017_essai_gratuit"),
    ]

    operations = [
        migrations.AddField(model_name="boutique", name="option_en_ligne_fin", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="boutique", name="option_en_ligne_suit", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="boutique", name="option_en_ligne_offerte", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="boutique", name="option_reseau_fin", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="boutique", name="option_reseau_suit", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="boutique", name="option_mobile_fin", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="boutique", name="option_mobile_suit", field=models.BooleanField(default=False)),
        migrations.AddField(
            model_name="paiementabonnement",
            name="option",
            field=models.CharField(
                blank=True,
                choices=[("en_ligne", "Option En ligne"), ("reseau", "Option Réseau"), ("mobile", "Option Mobile")],
                default="",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="reglagesplateforme",
            name="prix_mensuel_option_en_ligne",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="reglagesplateforme",
            name="prix_mensuel_option_reseau",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="reglagesplateforme",
            name="prix_mensuel_option_mobile",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.RunPython(garder_en_ligne_existant, migrations.RunPython.noop),
    ]
