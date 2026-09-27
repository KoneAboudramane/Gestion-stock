from django.db import migrations

CLE_FABRICATION_PROPRE = "fabrication_propre"


def activer_pour_boutiques_sans_fournisseur(apps, schema_editor):
    """Jusqu'ici, une boutique sans aucun fournisseur était considérée comme
    fabriquant elle-même ses produits (règle implicite côté clients). Le
    réglage explicite "fabrication_propre" la remplace : on l'active pour ces
    boutiques pour qu'elles ne perdent pas l'entrée de production."""
    Boutique = apps.get_model("comptes", "Boutique")
    Fournisseur = apps.get_model("fournisseurs", "Fournisseur")
    Parametre = apps.get_model("configuration", "Parametre")

    boutiques_avec_fournisseur = Fournisseur.objects.values_list("boutique_id", flat=True)
    for boutique in Boutique.objects.exclude(id__in=boutiques_avec_fournisseur):
        Parametre.objects.get_or_create(
            boutique=boutique, cle=CLE_FABRICATION_PROPRE, defaults={"valeur": "1"}
        )


class Migration(migrations.Migration):

    dependencies = [
        ("configuration", "0001_initial"),
        ("fournisseurs", "0002_paiementdettefournisseur"),
        ("comptes", "0008_boutique_synchro_autorisee"),
    ]

    operations = [
        migrations.RunPython(activer_pour_boutiques_sans_fournisseur, migrations.RunPython.noop),
    ]
