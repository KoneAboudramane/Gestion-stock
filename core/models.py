"""
App core : modèle de base hérité par toutes les autres tables.
Fournit l'identifiant UUID (pour éviter les conflits lors de la synchronisation
entre l'appli locale SQLite et le serveur PostgreSQL) et le suivi de synchronisation.
"""
import uuid
from django.db import models


class ModeleBase(models.Model):
    """Classe abstraite : toutes les tables du projet en héritent."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    date_creation = models.DateTimeField(auto_now_add=True)
    date_modification = models.DateTimeField(auto_now=True)
    # Indicateurs utilisés par la synchronisation locale <-> serveur
    synchronise = models.BooleanField(default=False)
    supprime = models.BooleanField(default=False)  # soft delete (propagation via synchro)
    date_synchronisation = models.DateTimeField(null=True, blank=True)

    class Meta:
        abstract = True
        ordering = ["-date_creation"]
