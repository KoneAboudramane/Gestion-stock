"""
App synchronisation : journal des échanges entre l'appli locale et le serveur.
Sert à tracer les créations/modifications/suppressions et à résoudre les conflits.
"""
from django.db import models

from core.models import ModeleBase


class JournalSync(ModeleBase):
    class Action(models.TextChoices):
        CREE = "cree", "Créé"
        MODIFIE = "modifie", "Modifié"
        SUPPRIME = "supprime", "Supprimé"

    class Statut(models.TextChoices):
        EN_ATTENTE = "en_attente", "En attente"
        SYNCHRONISE = "synchronise", "Synchronisé"
        CONFLIT = "conflit", "Conflit"

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="journaux_sync"
    )
    appareil = models.CharField(max_length=150, blank=True)
    table = models.CharField(max_length=100)       # ex. "ventes.Vente"
    enregistrement_id = models.UUIDField()          # UUID de l'objet concerné
    action = models.CharField(max_length=15, choices=Action.choices)
    statut = models.CharField(
        max_length=15, choices=Statut.choices, default=Statut.EN_ATTENTE
    )
    donnees = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return f"{self.table} {self.enregistrement_id} ({self.get_action_display()})"
