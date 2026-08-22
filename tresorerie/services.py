"""
Logique métier de l'app tresorerie.
Contrairement à stock.Stock, le solde de caisse d'un dépôt n'est jamais
stocké : il se recalcule à la volée à partir de MouvementCaisse (agrégat
simple) — la caisse n'est pas lue sur le chemin chaud d'une vente comme
l'est le stock, donc pas besoin d'une table dédiée à tenir à jour.
"""
from django.db import transaction
from django.db.models import Sum
from rest_framework.exceptions import ValidationError

from ventes.models import Paiement, Vente

from .models import ClotureCaisse, Depense, MouvementCaisse, Transfert


@transaction.atomic
def enregistrer_mouvement(
    depot, type_mouvement, categorie, montant, motif="",
    utilisateur=None, reference_type="", reference_id=None,
):
    return MouvementCaisse.objects.create(
        depot=depot, type=type_mouvement, categorie=categorie, montant=montant,
        motif=motif, utilisateur=utilisateur,
        reference_type=reference_type, reference_id=reference_id,
    )


def solde_caisse(depot, jusqua=None):
    queryset = MouvementCaisse.objects.filter(depot=depot, supprime=False)
    if jusqua is not None:
        queryset = queryset.filter(date_creation__lte=jusqua)

    def _somme(type_mouvement):
        return queryset.filter(type=type_mouvement).aggregate(total=Sum("montant"))["total"] or 0

    entrees = _somme(MouvementCaisse.Type.ENTREE)
    sorties = _somme(MouvementCaisse.Type.SORTIE)
    ajustements = _somme(MouvementCaisse.Type.AJUSTEMENT)
    return entrees - sorties + ajustements


def mouvements_caisse(depot, debut=None, fin=None):
    queryset = MouvementCaisse.objects.filter(depot=depot, supprime=False)
    if debut is not None:
        queryset = queryset.filter(date_creation__gte=debut)
    if fin is not None:
        queryset = queryset.filter(date_creation__lte=fin)
    return queryset


@transaction.atomic
def enregistrer_depense(depot, categorie, montant, description="", utilisateur=None):
    if montant <= 0:
        raise ValidationError("Le montant de la dépense doit être strictement positif.")

    depense = Depense.objects.create(
        depot=depot, categorie=categorie, montant=montant,
        description=description, utilisateur=utilisateur,
    )
    enregistrer_mouvement(
        depot, MouvementCaisse.Type.SORTIE, MouvementCaisse.Categorie.DEPENSE, montant,
        motif=depense.get_categorie_display(), utilisateur=utilisateur,
        reference_type="tresorerie.Depense", reference_id=depense.id,
    )
    return depense


@transaction.atomic
def effectuer_retrait(depot, montant, motif="", utilisateur=None):
    if montant <= 0:
        raise ValidationError("Le montant du retrait doit être strictement positif.")
    return enregistrer_mouvement(
        depot, MouvementCaisse.Type.SORTIE, MouvementCaisse.Categorie.RETRAIT, montant,
        motif=motif, utilisateur=utilisateur,
    )


@transaction.atomic
def enregistrer_apport(depot, montant, motif="", utilisateur=None):
    if montant <= 0:
        raise ValidationError("Le montant de l'apport doit être strictement positif.")
    return enregistrer_mouvement(
        depot, MouvementCaisse.Type.ENTREE, MouvementCaisse.Categorie.APPORT, montant,
        motif=motif, utilisateur=utilisateur,
    )


@transaction.atomic
def ajuster_caisse(depot, montant_signe, motif, utilisateur=None):
    if montant_signe == 0:
        raise ValidationError("Un ajustement ne peut pas être nul.")
    return enregistrer_mouvement(
        depot, MouvementCaisse.Type.AJUSTEMENT, MouvementCaisse.Categorie.AJUSTEMENT,
        montant_signe, motif=motif, utilisateur=utilisateur,
    )


def solde_mobile_money_disponible(boutique, utilisateur_source, operateur):
    """
    Solde mobile money d'un vendeur pas encore reversé en caisse : la somme
    de ses paiements mobile money encaissés pour cet opérateur, moins ce qui
    a déjà été transféré. Rien n'est stocké, tout se déduit de ventes.Paiement
    et tresorerie.Transfert (voir CLAUDE.md/mémoire projet : le mobile money
    est toujours crédité à celui qui vend, jamais une ligne partagée).
    """
    encaisse = Paiement.objects.filter(
        mode=Paiement.Mode.MOBILE_MONEY, operateur=operateur,
        vente__boutique=boutique, vente__utilisateur=utilisateur_source,
    ).exclude(vente__statut=Vente.Statut.ANNULEE).aggregate(total=Sum("montant"))["total"] or 0

    transfere = Transfert.objects.filter(
        utilisateur_source=utilisateur_source, operateur=operateur,
        depot__boutique=boutique, supprime=False,
    ).aggregate(total=Sum("montant"))["total"] or 0

    return encaisse - transfere


@transaction.atomic
def effectuer_transfert(depot, utilisateur_source, operateur, montant, utilisateur=None):
    if montant <= 0:
        raise ValidationError("Le montant transféré doit être strictement positif.")

    disponible = solde_mobile_money_disponible(depot.boutique, utilisateur_source, operateur)
    if montant > disponible:
        raise ValidationError("Le montant transféré dépasse le solde mobile money disponible.")

    transfert = Transfert.objects.create(
        depot=depot, utilisateur_source=utilisateur_source, operateur=operateur,
        montant=montant, utilisateur=utilisateur,
    )
    enregistrer_mouvement(
        depot, MouvementCaisse.Type.ENTREE, MouvementCaisse.Categorie.TRANSFERT_MOBILE_MONEY, montant,
        motif=f"Transfert {transfert.get_operateur_display()} de {utilisateur_source}",
        utilisateur=utilisateur,
        reference_type="tresorerie.Transfert", reference_id=transfert.id,
    )
    return transfert


@transaction.atomic
def cloturer_caisse(depot, solde_compte, utilisateur=None):
    theorique = solde_caisse(depot)
    return ClotureCaisse.objects.create(
        depot=depot, solde_theorique=theorique, solde_compte=solde_compte,
        ecart=solde_compte - theorique, utilisateur=utilisateur,
    )
