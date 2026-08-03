"""
App stock : dépôts, niveaux de stock, mouvements, transferts et inventaires.
Le stock se compte par VARIANTE et par DÉPÔT (multi-dépôt).
"""
from django.db import models

from core.models import ModeleBase


class Depot(ModeleBase):
    """Point de vente ou entrepôt d'une boutique."""

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="depots"
    )
    nom = models.CharField(max_length=150)
    adresse = models.CharField(max_length=255, blank=True)

    def __str__(self):
        return self.nom


class Stock(ModeleBase):
    """Quantité actuelle d'une variante dans un dépôt."""

    variante = models.ForeignKey(
        "catalogue.Variante", on_delete=models.CASCADE, related_name="stocks"
    )
    depot = models.ForeignKey(Depot, on_delete=models.CASCADE, related_name="stocks")
    quantite = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        unique_together = ("variante", "depot")

    def __str__(self):
        return f"{self.variante} @ {self.depot} = {self.quantite}"


class MouvementStock(ModeleBase):
    """Historique de tout ce qui entre, sort ou est ajusté."""

    class Type(models.TextChoices):
        ENTREE = "entree", "Entrée"
        SORTIE = "sortie", "Sortie"
        AJUSTEMENT = "ajustement", "Ajustement"

    variante = models.ForeignKey(
        "catalogue.Variante", on_delete=models.CASCADE, related_name="mouvements"
    )
    depot = models.ForeignKey(Depot, on_delete=models.CASCADE, related_name="mouvements")
    type = models.CharField(max_length=15, choices=Type.choices)
    quantite = models.DecimalField(max_digits=12, decimal_places=2)
    motif = models.CharField(max_length=255, blank=True)
    # Référence libre vers la source (vente, achat, inventaire...) via son UUID
    reference_type = models.CharField(max_length=50, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return f"{self.get_type_display()} {self.quantite} - {self.variante}"


class TransfertStock(ModeleBase):
    """Transfert d'une variante d'un dépôt à un autre (multi-dépôt)."""

    variante = models.ForeignKey("catalogue.Variante", on_delete=models.CASCADE)
    depot_source = models.ForeignKey(
        Depot, on_delete=models.CASCADE, related_name="transferts_sortants"
    )
    depot_destination = models.ForeignKey(
        Depot, on_delete=models.CASCADE, related_name="transferts_entrants"
    )
    quantite = models.DecimalField(max_digits=12, decimal_places=2)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return f"{self.quantite} {self.variante} : {self.depot_source} -> {self.depot_destination}"


class Inventaire(ModeleBase):
    """Comptage physique du stock d'un dépôt."""

    class Statut(models.TextChoices):
        EN_COURS = "en_cours", "En cours"
        VALIDE = "valide", "Validé"

    boutique = models.ForeignKey("comptes.Boutique", on_delete=models.CASCADE)
    depot = models.ForeignKey(Depot, on_delete=models.CASCADE, related_name="inventaires")
    statut = models.CharField(
        max_length=15, choices=Statut.choices, default=Statut.EN_COURS
    )
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return f"Inventaire {self.depot} ({self.get_statut_display()})"


class LigneInventaire(ModeleBase):
    inventaire = models.ForeignKey(
        Inventaire, on_delete=models.CASCADE, related_name="lignes"
    )
    variante = models.ForeignKey("catalogue.Variante", on_delete=models.CASCADE)
    qte_theorique = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    qte_physique = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    ecart = models.DecimalField(max_digits=12, decimal_places=2, default=0)
