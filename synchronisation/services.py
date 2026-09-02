"""
Moteur de synchronisation (push/pull). Cahier des charges §9 :
- push = upsert générique par UUID (aucune logique métier des autres apps —
  le client a déjà calculé ses lignes hors-ligne, on ne fait que les stocker) ;
- conflits : dernier qui écrit gagne, comparaison de date_modification ;
- stock : seuls les MouvementStock se synchronisent (ajout seul), Stock est
  recalculé, jamais poussé/tiré directement ;
- suppressions : soft delete (`supprime`), jamais de DELETE SQL.
"""
from collections import defaultdict
from datetime import datetime, timezone as dt_timezone

from django.db import transaction
from django.utils import timezone

from . import registre

CHAMPS_IGNORES = {"id", "date_creation", "date_modification", "synchronise", "date_synchronisation", "supprime"}


def _date_client(donnees):
    valeur = donnees.get("date_modification")
    if not valeur:
        return timezone.now()
    dt = datetime.fromisoformat(valeur)
    return timezone.make_aware(dt) if timezone.is_naive(dt) else dt


def _assigner_champs(model, obj, donnees, champs_proteges=frozenset()):
    for champ in model._meta.get_fields():
        if not getattr(champ, "concrete", False) or champ.name in CHAMPS_IGNORES:
            continue
        if champ.name in champs_proteges:
            continue
        if champ.name not in donnees:
            continue
        valeur = donnees[champ.name]
        if champ.is_relation:
            setattr(obj, champ.attname, valeur)
        else:
            setattr(obj, champ.name, valeur)


def _related_appartient_a_la_boutique(related_model, related_id, boutique):
    from comptes.models import Boutique

    if related_model is Boutique:
        return str(related_id) == str(boutique.pk)

    autre_entree = registre.resoudre(f"{related_model._meta.app_label}.{related_model.__name__}")
    if autre_entree is None:
        return True  # modèle hors registre (ex. Utilisateur) : pas de vérif ici

    if autre_entree.chemin_boutique == "__self__":
        return str(related_id) == str(boutique.pk)
    return related_model.objects.filter(pk=related_id).filter(
        **{autre_entree.chemin_boutique: boutique}
    ).exists()


def _chemin_valide(model, chemin_boutique, boutique, obj):
    """
    Vérifie l'appartenance à la boutique de TOUTES les FK de l'objet poussé —
    pas seulement la chaîne d'isolation "officielle" du modèle (ex. Variante →
    produit__boutique), mais aussi toute FK secondaire (ex. Produit.categorie) :
    une seule FK pointant vers une autre boutique doit tout refuser.
    Un seul niveau de résolution manuel (le modèle référencé) ; le reste de la
    chaîne est délégué à l'ORM via son propre `chemin_boutique` (lookup `__`),
    quelle que soit sa profondeur.
    """
    if chemin_boutique == "__self__":
        return str(obj.pk) == str(boutique.pk)

    for champ in model._meta.get_fields():
        if not getattr(champ, "concrete", False) or not champ.is_relation:
            continue
        fk_id = getattr(obj, champ.attname, None)
        if fk_id is None:
            continue
        if not _related_appartient_a_la_boutique(champ.related_model, fk_id, boutique):
            return False
    return True


def _resultat(table, enregistrement_id, statut, message=None):
    resultat = {"table": table, "enregistrement_id": enregistrement_id, "statut": statut}
    if message:
        resultat["message"] = message
    return resultat


def _journaliser(boutique, appareil, table, enregistrement_id, action, statut, donnees):
    from .models import JournalSync

    JournalSync.objects.create(
        boutique=boutique, appareil=appareil, table=table, enregistrement_id=enregistrement_id,
        action=action, statut=statut, donnees=donnees,
    )


def appliquer_changement(boutique, appareil, table, action, enregistrement_id, donnees, paires_stock_a_recalculer):
    entree = registre.resoudre(table)
    if entree is None:
        return _resultat(table, enregistrement_id, "erreur", "Table inconnue ou non synchronisable.")

    if entree.ajout_seul and action != "cree":
        resultat = _resultat(table, enregistrement_id, "erreur", "Cette table est en ajout seul.")
        _journaliser(boutique, appareil, table, enregistrement_id, action, "erreur", donnees)
        return resultat

    model = entree.modele()
    date_client = _date_client(donnees)

    try:
        objet_existant = model.objects.get(pk=enregistrement_id)
    except model.DoesNotExist:
        objet_existant = None

    if action == "supprime":
        if objet_existant is None:
            statut = "erreur"
        elif not _chemin_valide(model, entree.chemin_boutique, boutique, objet_existant):
            statut = "erreur"
        elif objet_existant.date_modification >= date_client:
            statut = "conflit"
        else:
            objet_existant.supprime = True
            objet_existant.save(update_fields=["supprime", "date_modification"])
            statut = "synchronise"
        _journaliser(boutique, appareil, table, enregistrement_id, action, statut, donnees)
        return _resultat(table, enregistrement_id, statut)

    if objet_existant is not None and objet_existant.date_modification >= date_client:
        _journaliser(boutique, appareil, table, enregistrement_id, action, "conflit", donnees)
        return _resultat(table, enregistrement_id, "conflit")

    obj = objet_existant or model(id=enregistrement_id)
    _assigner_champs(model, obj, donnees, entree.champs_proteges)

    # La boutique n'est jamais fournie par le client : comme dans l'API
    # interactive (FiltreBoutiqueMixin.perform_create), elle est assignée
    # depuis le contexte authentifié à la CRÉATION uniquement. Pour un objet
    # existant, on ne réassigne jamais son propriétaire : _chemin_valide doit
    # vérifier son appartenance d'origine, sinon un "modifie" sur l'UUID d'un
    # enregistrement d'une autre boutique serait accepté à tort.
    if objet_existant is None and entree.chemin_boutique == "boutique":
        obj.boutique_id = boutique.pk

    if not _chemin_valide(model, entree.chemin_boutique, boutique, obj):
        _journaliser(boutique, appareil, table, enregistrement_id, action, "erreur", donnees)
        return _resultat(table, enregistrement_id, "erreur", "N'appartient pas à votre boutique.")

    obj.synchronise = True
    obj.date_synchronisation = timezone.now()
    obj.save()

    if table == "stock.MouvementStock":
        paires_stock_a_recalculer.add((obj.variante_id, obj.depot_id))

    _journaliser(boutique, appareil, table, enregistrement_id, action, "synchronise", donnees)
    return _resultat(table, enregistrement_id, "synchronise")


def recalculer_stock(variante_id, depot_id):
    from stock.models import MouvementStock, Stock

    total = 0
    for type_mouvement, quantite in MouvementStock.objects.filter(
        variante_id=variante_id, depot_id=depot_id, supprime=False,
    ).values_list("type", "quantite"):
        total += -quantite if type_mouvement == MouvementStock.Type.SORTIE else quantite

    Stock.objects.update_or_create(
        variante_id=variante_id, depot_id=depot_id, defaults={"quantite": total},
    )


@transaction.atomic
def traiter_push(boutique, appareil, changements):
    par_table = defaultdict(list)
    for item in changements:
        par_table[item["table"]].append(item)

    resultats = []
    paires_stock = set()
    tables_traitees = set()

    for entree in registre.pour_pull():
        for item in par_table.get(entree.table, []):
            resultats.append(appliquer_changement(
                boutique, appareil, entree.table, item["action"], item["enregistrement_id"],
                item.get("donnees") or {}, paires_stock,
            ))
        tables_traitees.add(entree.table)

    for table, items in par_table.items():
        if table in tables_traitees:
            continue
        for item in items:
            resultats.append(appliquer_changement(
                boutique, appareil, table, item["action"], item["enregistrement_id"],
                item.get("donnees") or {}, paires_stock,
            ))

    for variante_id, depot_id in paires_stock:
        recalculer_stock(variante_id, depot_id)

    return resultats


def traiter_pull(boutique, depuis):
    from .serializers import serializer_lecture

    maintenant = timezone.now()
    if depuis is None:
        depuis = datetime.min.replace(tzinfo=dt_timezone.utc)

    tables = []
    for entree in registre.pour_pull():
        model = entree.modele()
        if entree.chemin_boutique == "__self__":
            queryset = model.objects.filter(pk=boutique.pk, date_modification__gt=depuis)
        else:
            queryset = model.objects.filter(
                **{entree.chemin_boutique: boutique}, date_modification__gt=depuis,
            )
        serializer_cls = serializer_lecture(model)
        tables.append({
            "table": entree.table,
            "enregistrements": serializer_cls(queryset, many=True).data,
        })

    return {"maintenant": maintenant, "tables": tables}
