"""
Logique métier de l'app clients.
Contrairement à fournisseurs.DetteFournisseur, chaque remboursement laisse
une trace (PaiementCredit), pas seulement une mutation du solde.
"""
from django.db import transaction
from rest_framework.exceptions import ValidationError

from .models import Credit, PaiementCredit


@transaction.atomic
def rembourser_credit(credit, montant, mode=""):
    if montant <= 0:
        raise ValidationError("Le montant remboursé doit être strictement positif.")
    if montant > credit.solde:
        raise ValidationError("Le montant remboursé ne peut pas dépasser le solde restant.")

    PaiementCredit.objects.create(credit=credit, montant=montant, mode=mode)

    credit.montant_paye = credit.montant_paye + montant
    credit.solde = credit.solde - montant
    if credit.solde == 0:
        credit.statut = Credit.Statut.SOLDE
    credit.save(update_fields=["montant_paye", "solde", "statut", "date_modification"])
    return credit
