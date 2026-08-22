"""
Migration de données : ajoute les clés de permission liées à la Trésorerie
(consulter_tresorerie, enregistrer_depense, gerer_tresorerie) aux rôles déjà
existants. ROLES_PAR_DEFAUT (comptes/services.py) ne s'applique qu'à la
création d'une nouvelle boutique — sans ce backfill, les rôles Patron/Gérant
des boutiques déjà créées se verraient refuser l'accès à la Trésorerie
(a_la_permission renvoie False si la clé est absente du JSON).
"""
from django.db import migrations

NOUVELLES_CLES = {
    "Patron": {"consulter_tresorerie": True, "enregistrer_depense": True, "gerer_tresorerie": True},
    "Gérant": {"consulter_tresorerie": True, "enregistrer_depense": True, "gerer_tresorerie": True},
    "Caissier": {"consulter_tresorerie": True, "enregistrer_depense": True, "gerer_tresorerie": False},
}


def ajouter_permissions_tresorerie(apps, schema_editor):
    Role = apps.get_model("comptes", "Role")
    for role in Role.objects.all():
        nouvelles = NOUVELLES_CLES.get(role.nom)
        if not nouvelles:
            continue
        role.permissions = {**role.permissions, **nouvelles}
        role.save(update_fields=["permissions"])


def retirer_permissions_tresorerie(apps, schema_editor):
    Role = apps.get_model("comptes", "Role")
    cles = {"consulter_tresorerie", "enregistrer_depense", "gerer_tresorerie"}
    for role in Role.objects.all():
        if cles & role.permissions.keys():
            role.permissions = {cle: valeur for cle, valeur in role.permissions.items() if cle not in cles}
            role.save(update_fields=["permissions"])


class Migration(migrations.Migration):
    dependencies = [
        ("comptes", "0005_boutique_formule"),
    ]

    operations = [
        migrations.RunPython(ajouter_permissions_tresorerie, retirer_permissions_tresorerie),
    ]
