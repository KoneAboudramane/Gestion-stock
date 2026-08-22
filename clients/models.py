"""
App clients : fiches clients et carnet de crédit (ventes à crédit).
"""
from django.db import models

from core.models import ModeleBase


class Client(ModeleBase):
    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="clients"
    )
    nom = models.CharField(max_length=200)
    telephone = models.CharField(max_length=30, blank=True)
    adresse = models.CharField(max_length=255, blank=True)
    # Client régulier (fidélisé) vs client de passage saisi à la volée pour une
    # vente à crédit : ce dernier n'apparaît pas dans le répertoire clients,
    # seulement dans le carnet de crédit tant qu'il n'a pas soldé.
    est_permanent = models.BooleanField(default=True)

    def __str__(self):
        return self.nom


class Credit(ModeleBase):
    """Créance liée à une vente à crédit : ce que le client doit."""

    class Statut(models.TextChoices):
        EN_COURS = "en_cours", "En cours"
        SOLDE = "solde", "Soldé"

    client = models.ForeignKey(
        Client, on_delete=models.CASCADE, related_name="credits"
    )
    vente = models.ForeignKey(
        "ventes.Vente", on_delete=models.SET_NULL, null=True, blank=True
    )
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    montant_paye = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    solde = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    echeance = models.DateField(null=True, blank=True)
    statut = models.CharField(
        max_length=15, choices=Statut.choices, default=Statut.EN_COURS
    )

    def __str__(self):
        return f"Crédit {self.client} : solde {self.solde}"


class PaiementCredit(ModeleBase):
    """Règlement partiel ou total d'un crédit."""

    credit = models.ForeignKey(
        Credit, on_delete=models.CASCADE, related_name="paiements"
    )
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    mode = models.CharField(max_length=30, blank=True)
