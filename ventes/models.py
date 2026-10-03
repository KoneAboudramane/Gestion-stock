"""
App ventes : caisse (ventes, lignes de vente, paiements) et commandes clients.
Une Vente porte sur des Variantes prélevées dans un Dépôt précis et génère
automatiquement des sorties dans stock.MouvementStock (logique dans les vues/services).
"""
from django.db import models

from core.models import ModeleBase


class CommandeClient(ModeleBase):
    """Commande d'un client, enregistrée avant d'être livrée. Le stock ne bouge
    qu'à la livraison (chaque livraison est une Vente rattachée) ; d'ici là,
    le restant à livrer est « réservé » dans le dépôt (affiché, la caisse
    avertit sans bloquer). L'avance éventuelle va dans le porte-monnaie du
    client (clients.MouvementCompteClient), `avance` n'en garde que le total
    versé au titre de cette commande, pour l'affichage."""

    class Statut(models.TextChoices):
        EN_ATTENTE = "en_attente", "En attente"
        PRETE = "prete", "Prête"
        PARTIELLE = "partielle", "Livrée en partie"
        LIVREE = "livree", "Livrée"
        ANNULEE = "annulee", "Annulée"

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="commandes_client"
    )
    client = models.ForeignKey(
        "clients.Client", on_delete=models.PROTECT, related_name="commandes"
    )
    depot = models.ForeignKey(
        "stock.Depot", on_delete=models.PROTECT, related_name="commandes_client"
    )
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    numero = models.CharField(max_length=50, blank=True)
    statut = models.CharField(max_length=15, choices=Statut.choices, default=Statut.EN_ATTENTE)
    date_livraison_prevue = models.DateField(null=True, blank=True)
    note = models.TextField(blank=True, default="")
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    avance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    date_annulation = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-date_creation"]

    def __str__(self):
        return f"Commande {self.numero or self.id} - {self.client}"


class LigneCommandeClient(ModeleBase):
    commande = models.ForeignKey(CommandeClient, on_delete=models.CASCADE, related_name="lignes")
    variante = models.ForeignKey("catalogue.Variante", on_delete=models.PROTECT, related_name="+")
    quantite = models.DecimalField(max_digits=12, decimal_places=2)
    quantite_livree = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Prix promis au client, figé à la commande (modifiable tant que non livrée).
    prix_unitaire = models.DecimalField(max_digits=12, decimal_places=2)
    sous_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    def __str__(self):
        return f"{self.quantite} x {self.variante}"


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
    # Livraison d'une commande client (null pour une vente directe en caisse).
    commande_client = models.ForeignKey(
        CommandeClient, on_delete=models.SET_NULL, null=True, blank=True, related_name="livraisons"
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
    # Vendue pendant un déstockage : prix normal du moment (pour le manque à
    # gagner) et lien vers le déstockage (pour son bilan). Vides sinon.
    prix_normal = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    destockage = models.ForeignKey(
        "stock.Destockage", on_delete=models.SET_NULL, null=True, blank=True, related_name="lignes_vente"
    )

    def __str__(self):
        return f"{self.quantite} x {self.variante}"


class Paiement(ModeleBase):
    class Mode(models.TextChoices):
        ESPECES = "especes", "Espèces"
        MOBILE_MONEY = "mobile_money", "Mobile Money"
        CREDIT = "credit", "Crédit"
        COMPTE_CLIENT = "compte_client", "Compte client"

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
