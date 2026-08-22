"""
Logique métier de l'app clients.
Contrairement à fournisseurs.DetteFournisseur, chaque règlement laisse
une trace (PaiementCredit), pas seulement une mutation du solde.
"""
from django.db import transaction
from rest_framework.exceptions import ValidationError

from tresorerie.models import MouvementCaisse
from tresorerie.services import enregistrer_mouvement

from .models import Credit, PaiementCredit


@transaction.atomic
def rembourser_credit(credit, montant, mode="", depot=None, utilisateur=None):
    if montant <= 0:
        raise ValidationError("Le montant réglé doit être strictement positif.")
    if montant > credit.solde:
        raise ValidationError("Le montant réglé ne peut pas dépasser le solde restant.")

    paiement = PaiementCredit.objects.create(credit=credit, montant=montant, mode=mode)

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
