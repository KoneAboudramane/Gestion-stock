"""
App achats : commandes fournisseurs et réceptions de marchandise.
Une Réception génère automatiquement des entrées dans stock.MouvementStock
(logique dans les vues/services).
"""
from django.db import models

from core.models import ModeleBase


class CommandeAchat(ModeleBase):
    class Statut(models.TextChoices):
        BROUILLON = "brouillon", "Brouillon"
        COMMANDEE = "commandee", "Commandée"
        RECUE = "recue", "Reçue"
        ANNULEE = "annulee", "Annulée"

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="commandes_achat"
    )
    fournisseur = models.ForeignKey(
        "fournisseurs.Fournisseur", on_delete=models.PROTECT, related_name="commandes"
    )
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )
    numero = models.CharField(max_length=50, blank=True)
    statut = models.CharField(
        max_length=15, choices=Statut.choices, default=Statut.BROUILLON
    )
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    def __str__(self):
        return f"Commande {self.numero or self.id} - {self.fournisseur}"


class LigneAchat(ModeleBase):
    commande = models.ForeignKey(
        CommandeAchat, on_delete=models.CASCADE, related_name="lignes"
    )
    variante = models.ForeignKey("catalogue.Variante", on_delete=models.PROTECT)
    quantite = models.DecimalField(max_digits=12, decimal_places=2)
    prix_achat = models.DecimalField(max_digits=12, decimal_places=2)
    sous_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Cumul des quantités déjà réceptionnées (réception partielle possible sur
    # plusieurs livraisons) : la commande ne repasse au statut "recue" que
    # lorsque quantite_recue atteint quantite sur toutes ses lignes.
    quantite_recue = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    def __str__(self):
        return f"{self.quantite} x {self.variante}"


class Reception(ModeleBase):
    """Réception physique d'une commande dans un dépôt (déclenche l'entrée en
    stock) — partielle ou totale. valeur_recue/montant_paye couvrent
    uniquement ce qui a été livré à CETTE réception (pas le total de la
    commande) : comptabilite/signals.py s'en sert pour générer une écriture
    par réception plutôt qu'une seule à la clôture de la commande.
    """

    commande = models.ForeignKey(
        CommandeAchat, on_delete=models.CASCADE, related_name="receptions"
    )
    depot = models.ForeignKey("stock.Depot", on_delete=models.PROTECT)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )
    valeur_recue = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    montant_paye = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    def __str__(self):
        return f"Réception {self.commande}"
