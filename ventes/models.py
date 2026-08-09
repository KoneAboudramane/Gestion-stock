"""
App ventes : caisse (ventes, lignes de vente, paiements).
Une Vente porte sur des Variantes prélevées dans un Dépôt précis et génère
automatiquement des sorties dans stock.MouvementStock (logique dans les vues/services).
"""
from django.db import models

from core.models import ModeleBase


class Vente(ModeleBase):
    class Statut(models.TextChoices):
        PAYEE = "payee", "Payée"
        CREDIT = "credit", "À crédit"
        ANNULEE = "annulee", "Annulée"

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="ventes"
    )
    depot = models.ForeignKey(
        "stock.Depot", on_delete=models.PROTECT, related_name="ventes"
    )
    client = models.ForeignKey(
        "clients.Client", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="ventes",
    )
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )
    numero = models.CharField(max_length=50, blank=True)
    total_brut = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    remise = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_net = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    statut = models.CharField(
        max_length=15, choices=Statut.choices, default=Statut.PAYEE
    )

    def __str__(self):
        return f"Vente {self.numero or self.id} - {self.total_net}"


class LigneVente(ModeleBase):
    vente = models.ForeignKey(Vente, on_delete=models.CASCADE, related_name="lignes")
    variante = models.ForeignKey("catalogue.Variante", on_delete=models.PROTECT)
    quantite = models.DecimalField(max_digits=12, decimal_places=2)
    prix_unitaire = models.DecimalField(max_digits=12, decimal_places=2)
    cout_unitaire = models.DecimalField(max_digits=12, decimal_places=2, default=0)  # prix d'achat figé pour le calcul du bénéfice
    remise = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    sous_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    def __str__(self):
        return f"{self.quantite} x {self.variante}"


class Paiement(ModeleBase):
    class Mode(models.TextChoices):
        ESPECES = "especes", "Espèces"
        MOBILE_MONEY = "mobile_money", "Mobile Money"
        CREDIT = "credit", "Crédit"

    class Operateur(models.TextChoices):
        ORANGE_MONEY = "orange_money", "Orange Money"
        MTN_MONEY = "mtn_money", "MTN Money"
        MOOV_MONEY = "moov_money", "Moov Money"
        WAVE = "wave", "Wave"

    vente = models.ForeignKey(
        Vente, on_delete=models.CASCADE, related_name="paiements"
    )
    mode = models.CharField(max_length=20, choices=Mode.choices)
    # Renseigné uniquement quand mode == mobile_money.
    operateur = models.CharField(
        max_length=20, choices=Operateur.choices, blank=True
    )
    montant = models.DecimalField(max_digits=12, decimal_places=2)

    def __str__(self):
        return f"{self.get_mode_display()} : {self.montant}"
