"""
Logique métier de l'app clients.
Contrairement à fournisseurs.DetteFournisseur, chaque règlement laisse
une trace (PaiementCredit), pas seulement une mutation du solde.
"""
from django.db import transaction
from rest_framework.exceptions import ValidationError

from tresorerie.models import MouvementCaisse
from tresorerie.services import enregistrer_mouvement

from django.db.models import Sum

from .models import Credit, MouvementCompteClient, PaiementCredit

MODES_ARGENT = ("especes", "mobile_money", "banque")


@transaction.atomic
def rembourser_credit(credit, montant, mode="", depot=None, utilisateur=None):
    if montant <= 0:
        raise ValidationError("Le montant réglé doit être strictement positif.")
    if montant > credit.solde:
        raise ValidationError("Le montant réglé ne peut pas dépasser le solde restant.")
    if mode == "compte_client" and montant > solde_compte_client(credit.client):
        raise ValidationError("Le compte du client ne suffit pas.")

    paiement = PaiementCredit.objects.create(credit=credit, montant=montant, mode=mode, utilisateur=utilisateur)
    if mode == "compte_client":
        MouvementCompteClient.objects.create(
            client=credit.client, type=MouvementCompteClient.Type.UTILISATION, montant=montant,
            credit=credit, vente=credit.vente, utilisateur=utilisateur, motif="Règlement de crédit",
        )

    credit.montant_paye = credit.montant_paye + montant
    credit.solde = credit.solde - montant
    if credit.solde == 0:
        credit.statut = Credit.Statut.SOLDE
    credit.save(update_fields=["montant_paye", "solde", "statut", "date_modification"])

    if mode == "especes" and depot is not None:
        enregistrer_mouvement(
            depot, MouvementCaisse.Type.ENTREE, MouvementCaisse.Categorie.REMBOURSEMENT_CREDIT,
            montant, motif=f"Règlement crédit {credit.client}", utilisateur=utilisateur,
            reference_type="clients.PaiementCredit", reference_id=paiement.id,
        )
    return credit


# --- Compte client (porte-monnaie) ---

def solde_compte_client(client):
    """Argent du client disponible chez nous : entrées moins sorties."""
    mouvements = MouvementCompteClient.objects.filter(client=client, supprime=False)
    entrees = mouvements.filter(type__in=MouvementCompteClient.ENTREES).aggregate(t=Sum("montant"))["t"] or 0
    sorties = mouvements.exclude(type__in=MouvementCompteClient.ENTREES).aggregate(t=Sum("montant"))["t"] or 0
    return entrees - sorties


def _verifier_mode(mode, depot):
    if mode not in MODES_ARGENT:
        raise ValidationError("Mode de paiement inconnu.")
    if mode == "especes" and depot is None:
        raise ValidationError("Choisissez le dépôt dont la caisse reçoit ou donne l'argent.")


@transaction.atomic
def deposer_sur_compte_client(client, montant, mode, operateur="", depot=None, utilisateur=None, motif=""):
    """Le client laisse de l'argent d'avance. Espèces : entrée dans la caisse du
    dépôt ; Mobile Money : crédité à celui qui encaisse (comme une vente)."""
    if montant <= 0:
        raise ValidationError("Le montant doit être strictement positif.")
    _verifier_mode(mode, depot)
    mouvement = MouvementCompteClient.objects.create(
        client=client, type=MouvementCompteClient.Type.DEPOT, montant=montant, mode=mode,
        operateur=operateur if mode == "mobile_money" else "", depot=depot, utilisateur=utilisateur,
        motif=(motif or "").strip()[:255],
    )
    if mode == "especes":
        enregistrer_mouvement(
            depot, MouvementCaisse.Type.ENTREE, MouvementCaisse.Categorie.DEPOT_CLIENT, montant,
            motif=f"Dépôt de {client.nom}", utilisateur=utilisateur,
            reference_type="clients.MouvementCompteClient", reference_id=mouvement.id,
        )
    return mouvement


@transaction.atomic
def rendre_du_compte_client(client, montant, mode, operateur="", depot=None, utilisateur=None, motif=""):
    """On rend au client tout ou partie de son argent."""
    if montant <= 0:
        raise ValidationError("Le montant doit être strictement positif.")
    if montant > solde_compte_client(client):
        raise ValidationError("On ne peut pas rendre plus que ce que le client a sur son compte.")
    _verifier_mode(mode, depot)
    mouvement = MouvementCompteClient.objects.create(
        client=client, type=MouvementCompteClient.Type.RENDU, montant=montant, mode=mode,
        operateur=operateur if mode == "mobile_money" else "", depot=depot, utilisateur=utilisateur,
        motif=(motif or "").strip()[:255],
    )
    if mode == "especes":
        enregistrer_mouvement(
            depot, MouvementCaisse.Type.SORTIE, MouvementCaisse.Categorie.RENDU_CLIENT, montant,
            motif=f"Rendu à {client.nom}", utilisateur=utilisateur,
            reference_type="clients.MouvementCompteClient", reference_id=mouvement.id,
        )
    return mouvement
