"""
Logique métier de l'app stock.
Règle du cahier des charges (§8) : le niveau de stock est TOUJOURS recalculé à
partir des mouvements, jamais écrasé directement ; le stock négatif est interdit
par défaut.
"""
from django.db import transaction
from rest_framework.exceptions import ValidationError

from .models import Inventaire, MouvementStock, Stock, TransfertStock


def _delta_pour(type_mouvement, quantite):
    if type_mouvement == MouvementStock.Type.ENTREE:
        return quantite
    if type_mouvement == MouvementStock.Type.SORTIE:
        return -quantite
    return quantite  # ajustement : delta signé fourni tel quel


@transaction.atomic
def appliquer_mouvement(
    variante, depot, type_mouvement, quantite, motif="",
    utilisateur=None, reference_type="", reference_id=None,
):
    stock, _ = Stock.objects.select_for_update().get_or_create(
        variante=variante, depot=depot, defaults={"quantite": 0}
    )
    delta = _delta_pour(type_mouvement, quantite)
    nouvelle_quantite = stock.quantite + delta

    if nouvelle_quantite < 0:
        raise ValidationError("Stock insuffisant pour cette opération.")

    stock.quantite = nouvelle_quantite
    stock.save(update_fields=["quantite", "date_modification"])

    return MouvementStock.objects.create(
        variante=variante,
        depot=depot,
        type=type_mouvement,
        quantite=quantite,
        motif=motif,
        reference_type=reference_type,
        reference_id=reference_id,
        utilisateur=utilisateur,
    )


@transaction.atomic
def transferer_stock(variante, depot_source, depot_destination, quantite, utilisateur=None):
    transfert = TransfertStock.objects.create(
        variante=variante,
        depot_source=depot_source,
        depot_destination=depot_destination,
        quantite=quantite,
        utilisateur=utilisateur,
    )
    appliquer_mouvement(
        variante, depot_source, MouvementStock.Type.SORTIE, quantite,
        motif=f"Transfert vers {depot_destination.nom}", utilisateur=utilisateur,
        reference_type="stock.TransfertStock", reference_id=transfert.id,
    )
    appliquer_mouvement(
        variante, depot_destination, MouvementStock.Type.ENTREE, quantite,
        motif=f"Transfert depuis {depot_source.nom}", utilisateur=utilisateur,
        reference_type="stock.TransfertStock", reference_id=transfert.id,
    )
    return transfert


@transaction.atomic
def demarrer_inventaire(boutique, depot, utilisateur=None):
    from .models import LigneInventaire

    inventaire = Inventaire.objects.create(
        boutique=boutique, depot=depot, utilisateur=utilisateur,
        statut=Inventaire.Statut.EN_COURS,
    )
    lignes = [
        LigneInventaire(
            inventaire=inventaire,
            variante=stock.variante,
            qte_theorique=stock.quantite,
            qte_physique=stock.quantite,
            ecart=0,
        )
        for stock in Stock.objects.filter(depot=depot)
    ]
    LigneInventaire.objects.bulk_create(lignes)
    return inventaire


@transaction.atomic
def valider_inventaire(inventaire):
    if inventaire.statut == Inventaire.Statut.VALIDE:
        raise ValidationError("Cet inventaire est déjà validé.")

    for ligne in inventaire.lignes.all():
        if ligne.ecart != 0:
            appliquer_mouvement(
                ligne.variante, inventaire.depot, MouvementStock.Type.AJUSTEMENT,
                ligne.ecart, motif="Correction d'inventaire",
                utilisateur=inventaire.utilisateur,
                reference_type="stock.Inventaire", reference_id=inventaire.id,
            )

    inventaire.statut = Inventaire.Statut.VALIDE
    inventaire.save(update_fields=["statut", "date_modification"])
    return inventaire
