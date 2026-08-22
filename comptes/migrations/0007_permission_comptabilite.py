"""
Migration de données : ajoute la clé de permission "consulter_comptabilite"
aux rôles déjà existants. ROLES_PAR_DEFAUT (comptes/services.py) ne
s'applique qu'à la création d'une nouvelle boutique — sans ce backfill, les
rôles Patron/Gérant des boutiques déjà créées se verraient refuser l'accès
à la Comptabilité (a_la_permission renvoie False si la clé est absente du
JSON). Voir comptes/migrations/0006_permissions_tresorerie.py pour le même
principe.
"""
from django.db import migrations

NOUVELLES_CLES = {
    "Patron": {"consulter_comptabilite": True},
    "Gérant": {"consulter_comptabilite": True},
    "Caissier": {"consulter_comptabilite": False},
}


def ajouter_permission_comptabilite(apps, schema_editor):
    Role = apps.get_model("comptes", "Role")
    for role in Role.objects.all():
        nouvelles = NOUVELLES_CLES.get(role.nom)
        if not nouvelles:
            continue
        role.permissions = {**role.permissions, **nouvelles}
        role.save(update_fields=["permissions"])


def retirer_permission_comptabilite(apps, schema_editor):
    Role = apps.get_model("comptes", "Role")
    for role in Role.objects.all():
        if "consulter_comptabilite" in role.permissions:
            role.permissions = {
                cle: valeur for cle, valeur in role.permissions.items() if cle != "consulter_comptabilite"
            }
            role.save(update_fields=["permissions"])


class Migration(migrations.Migration):
    dependencies = [
        ("comptes", "0006_permissions_tresorerie"),
    ]

    operations = [
        migrations.RunPython(ajouter_permission_comptabilite, retirer_permission_comptabilite),
    ]
