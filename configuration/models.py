"""
App configuration : réglages dynamiques par boutique (devise, TVA, format ticket...).
Stocke des paramètres, PAS l'interface (celle-ci reste dans le code React).
"""
from django.db import models

from core.models import ModeleBase


class Parametre(ModeleBase):
    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="parametres"
    )
    cle = models.CharField(max_length=100)
    valeur = models.TextField(blank=True)

    class Meta:
        unique_together = ("boutique", "cle")

    def __str__(self):
        return f"{self.cle} = {self.valeur}"
