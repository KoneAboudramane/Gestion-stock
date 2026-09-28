"""
Logique métier de l'app stock.
Règle du cahier des charges (§8) : le niveau de stock est TOUJOURS recalculé à
partir des mouvements, jamais écrasé directement ; le stock négatif est interdit
par défaut.
"""
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Destockage, Inventaire, OperationDestockage, MouvementStock, PerteStock, Stock, TransfertStock


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
def annuler_perte(perte, utilisateur=None):
    """Perte saisie par erreur : remet la quantité en stock et marque la perte
    comme annulée (elle reste visible, hors des totaux)."""
    if perte.annulee:
        raise ValidationError("Cette perte est déjà annulée.")
    appliquer_mouvement(
        perte.variante, perte.depot, MouvementStock.Type.ENTREE, perte.quantite,
        motif=f"Annulation perte : {perte.get_motif_display()}", utilisateur=utilisateur,
        reference_type="stock.PerteStock", reference_id=perte.id,
    )
    perte.annulee = True
    perte.date_annulation = timezone.now()
    perte.save(update_fields=["annulee", "date_annulation", "date_modification"])
    return perte


# --- Déstockage (même logique que client-electron/electron/services/stock.ts) ---

def destockage_actif(variante):
    """Déstockage en cours et pas encore arrivé à sa date de fin, ou None."""
    aujourdhui = timezone.localdate()
    return (
        Destockage.objects.filter(variante=variante, statut=Destockage.Statut.EN_COURS)
        .exclude(date_fin__lt=aujourdhui)
        .order_by("-date_creation")
        .first()
    )


def _terminer(destockage, motif):
    destockage.statut = Destockage.Statut.TERMINE
    destockage.motif_fin = motif
    destockage.date_arret = timezone.now()
    destockage.save(update_fields=["statut", "motif_fin", "date_arret", "date_modification"])


@transaction.atomic
def demarrer_destockage(variante, prix_destockage, date_fin=None, utilisateur=None, operation=None):
    if prix_destockage <= 0:
        raise ValidationError("Le prix de déstockage doit être positif.")
    if prix_destockage >= variante.prix_vente:
        raise ValidationError("Le prix de déstockage doit être inférieur au prix de vente normal.")
    if date_fin and date_fin < timezone.localdate():
        raise ValidationError("La date de fin est déjà passée.")
    if destockage_actif(variante):
        raise ValidationError("Cet article est déjà en déstockage.")
    # Déstockages restés "en cours" mais dont la date de fin est passée : on les clôt.
    for ancien in Destockage.objects.filter(variante=variante, statut=Destockage.Statut.EN_COURS):
        _terminer(ancien, Destockage.MotifFin.DATE)
    return Destockage.objects.create(
        variante=variante, prix_normal=variante.prix_vente, prix_destockage=prix_destockage,
        date_fin=date_fin, utilisateur=utilisateur, operation=operation,
    )


@transaction.atomic
def demarrer_operation_destockage(boutique, nom, lignes, date_fin=None, utilisateur=None):
    """Déstocke plusieurs articles d'un coup sous un même nom. `lignes` :
    [{"variante": Variante, "prix_destockage": Decimal}]. Tout ou rien : si un
    article est refusé, aucun déstockage de l'opération n'est créé."""
    if not lignes:
        raise ValidationError("Choisissez au moins un article.")
    nom = (nom or "").strip()
    if not nom:
        raise ValidationError("Donnez un nom à l'opération de déstockage.")
    variantes = [l["variante"] for l in lignes]
    if len(set(v.id for v in variantes)) != len(variantes):
        raise ValidationError("Un même article apparaît deux fois.")
    operation = OperationDestockage.objects.create(
        boutique=boutique, nom=nom, date_fin=date_fin, utilisateur=utilisateur,
    )
    for ligne in lignes:
        try:
            demarrer_destockage(
                ligne["variante"], ligne["prix_destockage"], date_fin=date_fin,
                utilisateur=utilisateur, operation=operation,
            )
        except ValidationError as erreur:
            detail = erreur.detail[0] if isinstance(erreur.detail, list) else erreur.detail
            raise ValidationError(f"{ligne['variante']} : {detail}")
    return operation


def arreter_operation_destockage(operation):
    """Arrête tous les déstockages encore en cours de l'opération."""
    en_cours = [d for d in operation.destockages.all() if d.statut == Destockage.Statut.EN_COURS]
    if not en_cours:
        raise ValidationError("Cette opération est déjà terminée.")
    for destockage in en_cours:
        _terminer(destockage, Destockage.MotifFin.MANUEL)
    return operation


_NON_MODIFIE = object()


def modifier_destockage(destockage, prix_destockage=None, date_fin=_NON_MODIFIE):
    """Change le prix et/ou la date de fin d'un déstockage en cours, sans
    l'arrêter (les ventes déjà faites gardent leur prix et restent dans son bilan)."""
    if destockage.statut != Destockage.Statut.EN_COURS or destockage_actif(destockage.variante) != destockage:
        raise ValidationError("Seul un déstockage en cours peut être modifié.")
    champs = []
    if prix_destockage is not None:
        if prix_destockage <= 0 or prix_destockage >= destockage.prix_normal:
            raise ValidationError("Le prix de déstockage doit être positif et inférieur au prix normal.")
        destockage.prix_destockage = prix_destockage
        champs.append("prix_destockage")
    if date_fin is not _NON_MODIFIE:
        if date_fin and date_fin < timezone.localdate():
            raise ValidationError("La date de fin est déjà passée.")
        destockage.date_fin = date_fin
        champs.append("date_fin")
    if champs:
        destockage.save(update_fields=[*champs, "date_modification"])
    return destockage


def arreter_destockage(destockage):
    if destockage.statut == Destockage.Statut.TERMINE:
        raise ValidationError("Ce déstockage est déjà terminé.")
    _terminer(destockage, Destockage.MotifFin.MANUEL)
    return destockage


def terminer_destockage_si_epuise(variante):
    """Appelé après une sortie de stock (vente, perte) : le déstockage s'arrête
    tout seul quand l'article n'a plus de stock, tous dépôts confondus."""
    destockage = destockage_actif(variante)
    if not destockage:
        return
    total = Stock.objects.filter(variante=variante).aggregate(total=Sum("quantite"))["total"] or 0
    if total <= 0:
        _terminer(destockage, Destockage.MotifFin.EPUISE)


@transaction.atomic
def declarer_perte(variante, depot, quantite, motif, detail="", utilisateur=None):
    """Sortie de stock sans vente, valorisée au CUMP courant de la variante.
    Même logique que client-electron/electron/services/stock.ts::declarerPerte."""
    if quantite <= 0:
        raise ValidationError("La quantité doit être strictement positive.")
    detail = (detail or "").strip()
    if motif == PerteStock.Motif.AUTRE and not detail:
        raise ValidationError("Précisez la raison de la perte.")
    perte = PerteStock.objects.create(
        variante=variante, depot=depot, quantite=quantite, motif=motif,
        detail=detail, valeur=round(quantite * variante.prix_achat),
        utilisateur=utilisateur,
    )
    libelle = PerteStock.Motif(motif).label
    appliquer_mouvement(
        variante, depot, MouvementStock.Type.SORTIE, quantite,
        motif=f"Perte : {libelle}" + (f" ({detail})" if detail else ""),
        utilisateur=utilisateur,
        reference_type="stock.PerteStock", reference_id=perte.id,
    )
    terminer_destockage_si_epuise(variante)
    return perte


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
def demarrer_inventaire(boutique, depot, utilisateur=None, a_zero=False):
    """a_zero : « comptage à zéro » — chaque article part de 0 et seul ce qui
    est compté compte (ce qui n'est pas compté sera considéré comme absent)."""
    from .models import LigneInventaire

    if Inventaire.objects.filter(depot=depot, statut=Inventaire.Statut.EN_COURS, supprime=False).exists():
        raise ValidationError("Un inventaire est déjà en cours sur ce dépôt : terminez-le ou reprenez-le avant d'en démarrer un autre.")
    inventaire = Inventaire.objects.create(
        boutique=boutique, depot=depot, utilisateur=utilisateur,
        statut=Inventaire.Statut.EN_COURS,
    )
    lignes = [
        LigneInventaire(
            inventaire=inventaire,
            variante=stock.variante,
            qte_theorique=stock.quantite,
            qte_physique=0 if a_zero else stock.quantite,
            ecart=-stock.quantite if a_zero else 0,
        )
        for stock in Stock.objects.filter(depot=depot)
    ]
    LigneInventaire.objects.bulk_create(lignes)
    return inventaire


def ajouter_ligne_inventaire(inventaire, variante, qte_physique=0):
    """Article trouvé sur place mais absent de la liste (jamais eu de stock
    dans ce dépôt) : ajouté pendant le comptage."""
    from .models import LigneInventaire

    if inventaire.statut == Inventaire.Statut.VALIDE:
        raise ValidationError("Cet inventaire est déjà validé.")
    if inventaire.lignes.filter(variante=variante).exists():
        raise ValidationError("Cet article est déjà dans l'inventaire.")
    stock = Stock.objects.filter(variante=variante, depot=inventaire.depot).first()
    theorique = stock.quantite if stock else 0
    return LigneInventaire.objects.create(
        inventaire=inventaire, variante=variante, qte_theorique=theorique,
        qte_physique=qte_physique, ecart=qte_physique - theorique,
    )


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
