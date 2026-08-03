"""
App paiements (Phase 2) : intégration mobile money (Wave, Orange Money, MTN).
Une TransactionMobileMoney trace la tentative de paiement d'un ventes.Paiement
existant (mode="mobile_money") auprès d'un prestataire. Squelette avec
adaptateurs simulés (adaptateurs.py) en attendant les clés d'API réelles.
"""
from django.db import models

from core.models import ModeleBase


class TransactionMobileMoney(ModeleBase):
    class Fournisseur(models.TextChoices):
        WAVE = "wave", "Wave"
        ORANGE_MONEY = "orange_money", "Orange Money"
        MTN = "mtn", "MTN Mobile Money"

    class Statut(models.TextChoices):
        EN_ATTENTE = "en_attente", "En attente"
        REUSSIE = "reussie", "Réussie"
        ECHOUEE = "echouee", "Échouée"

    paiement = models.ForeignKey(
        "ventes.Paiement", on_delete=models.CASCADE, related_name="transactions_mobile_money"
    )
    fournisseur = models.CharField(max_length=20, choices=Fournisseur.choices)
    numero_telephone = models.CharField(max_length=30)
    reference_externe = models.CharField(max_length=100, blank=True)
    statut = models.CharField(max_length=15, choices=Statut.choices, default=Statut.EN_ATTENTE)
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    donnees_brutes = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return f"{self.get_fournisseur_display()} : {self.montant} ({self.statut})"
