"""
Logique métier de l'app ventes.
CLAUDE.md : une vente validée crée une sortie de stock par ligne (via
stock.services.appliquer_mouvement) et, si à crédit, une créance client.
Cahier des charges §8 : numérotation automatique, devise FCFA sans décimales
(montants arrondis à l'unité), bénéfice figé sur le coût au moment de la vente.
"""
from django.db import transaction
from rest_framework.exceptions import ValidationError

from clients.models import Credit
from core.services import generer_numero_sequentiel
from stock.models import MouvementStock
from stock.services import appliquer_mouvement

from .models import LigneVente, Paiement, Vente


def _generer_numero(boutique):
    return generer_numero_sequentiel(boutique, Vente, "VTE")


@transaction.atomic
def creer_vente(
    boutique, depot, utilisateur, client, statut,
    lignes_donnees, paiements_donnees, remise_globale=0,
):
    lignes_calculees = []
    total_brut = 0
    for donnee in lignes_donnees:
        variante = donnee["variante"]
        quantite = donnee["quantite"]
        prix_unitaire = donnee.get("prix_unitaire")
        if prix_unitaire is None:
            prix_unitaire = variante.prix_vente
        remise_ligne = donnee.get("remise") or 0
        sous_total = round(quantite * prix_unitaire - remise_ligne)
        if sous_total < 0:
            raise ValidationError("Une remise de ligne ne peut pas rendre le sous-total négatif.")
        total_brut += sous_total
        lignes_calculees.append({
            "variante": variante,
            "quantite": quantite,
            "prix_unitaire": prix_unitaire,
            "cout_unitaire": variante.prix_achat,
            "remise": remise_ligne,
            "sous_total": sous_total,
        })

    total_net = round(total_brut - remise_globale)
    if total_net < 0:
        raise ValidationError("La remise globale ne peut pas rendre le total négatif.")

    total_paiements = sum(p["montant"] for p in paiements_donnees)
    if total_paiements != total_net:
        raise ValidationError(
            f"La somme des paiements ({total_paiements}) doit être égale au total net ({total_net})."
        )

    numero = _generer_numero(boutique)
    vente = Vente.objects.create(
        boutique=boutique, depot=depot, client=client, utilisateur=utilisateur,
        numero=numero, total_brut=total_brut, remise=remise_globale, total_net=total_net,
        statut=statut,
    )

    for donnee in lignes_calculees:
        LigneVente.objects.create(vente=vente, **donnee)
        appliquer_mouvement(
            donnee["variante"], depot, MouvementStock.Type.SORTIE, donnee["quantite"],
            motif=f"Vente {numero}", utilisateur=utilisateur,
            reference_type="ventes.Vente", reference_id=vente.id,
        )

    for donnee_paiement in paiements_donnees:
        Paiement.objects.create(vente=vente, **donnee_paiement)

    if statut == Vente.Statut.CREDIT:
        montant_credit = sum(
            p["montant"] for p in paiements_donnees if p["mode"] == Paiement.Mode.CREDIT
        )
        if montant_credit > 0:
            Credit.objects.create(
                client=client, vente=vente, montant=montant_credit, solde=montant_credit,
            )

    return vente


@transaction.atomic
def annuler_vente(vente, utilisateur):
    if vente.statut == Vente.Statut.ANNULEE:
        raise ValidationError("Cette vente est déjà annulée.")

    for ligne in vente.lignes.all():
        appliquer_mouvement(
            ligne.variante, vente.depot, MouvementStock.Type.ENTREE, ligne.quantite,
            motif=f"Annulation vente {vente.numero}", utilisateur=utilisateur,
            reference_type="ventes.Vente", reference_id=vente.id,
        )

    for credit in Credit.objects.filter(vente=vente):
        credit.montant_paye = credit.montant
        credit.solde = 0
        credit.statut = Credit.Statut.SOLDE
        credit.save(update_fields=["montant_paye", "solde", "statut", "date_modification"])

    vente.statut = Vente.Statut.ANNULEE
    vente.save(update_fields=["statut", "date_modification"])
    return vente
