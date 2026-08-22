"""
App tresorerie : suivi de la caisse (espèces) d'un dépôt — séparé de l'écran
de vente ("Caisse"). Ce que le bénéfice (rapports) ne montre pas : combien
d'argent liquide existe réellement dans un dépôt, et pourquoi son solde a
bougé (vente en espèces, dépense, transfert mobile money, retrait, apport,
remboursement d'une dette fournisseur...).

Le solde d'un dépôt n'est jamais stocké : il se calcule à la volée à partir
de MouvementCaisse (voir tresorerie/services.py), sur le même principe que
stock.MouvementStock pour le stock.
"""
from django.db import models

from core.models import ModeleBase


class MouvementCaisse(ModeleBase):
    """Historique de tout ce qui entre, sort ou est ajusté dans la caisse d'un dépôt."""

    class Type(models.TextChoices):
        ENTREE = "entree", "Entrée"
        SORTIE = "sortie", "Sortie"
        AJUSTEMENT = "ajustement", "Ajustement"

    class Categorie(models.TextChoices):
        VENTE_ESPECES = "vente_especes", "Vente en espèces"
        REMBOURSEMENT_CREDIT = "remboursement_credit", "Règlement crédit client"
        TRANSFERT_MOBILE_MONEY = "transfert_mobile_money", "Transfert mobile money"
        APPORT = "apport", "Mise de fonds"
        DEPENSE = "depense", "Dépense"
        RETRAIT = "retrait", "Retrait"
        PAIEMENT_DETTE_FOURNISSEUR = "paiement_dette_fournisseur", "Paiement dette fournisseur"
        AJUSTEMENT = "ajustement", "Ajustement"

    depot = models.ForeignKey(
        "stock.Depot", on_delete=models.CASCADE, related_name="mouvements_caisse"
    )
    type = models.CharField(max_length=15, choices=Type.choices)
    categorie = models.CharField(max_length=30, choices=Categorie.choices)
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    motif = models.CharField(max_length=255, blank=True)
    # Référence libre vers la source (vente, dépense, transfert...) via son UUID
    reference_type = models.CharField(max_length=50, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return f"{self.get_type_display()} {self.montant} - {self.depot}"


class Depense(ModeleBase):
    """Sortie d'argent réelle de la caisse (transport, réparation, achat divers...)."""

    class Categorie(models.TextChoices):
        TRANSPORT = "transport", "Transport"
        REPARATION = "reparation", "Réparation"
        ACHAT_MARCHANDISE = "achat_marchandise", "Achat de marchandise"
        ACHAT_DIVERS = "achat_divers", "Achat divers"
        REMBOURSEMENT_CLIENT = "remboursement_client", "Remboursement client"
        AUTRE = "autre", "Autre"

    depot = models.ForeignKey(
        "stock.Depot", on_delete=models.CASCADE, related_name="depenses"
    )
    categorie = models.CharField(max_length=30, choices=Categorie.choices)
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    description = models.CharField(max_length=255, blank=True)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return f"{self.get_categorie_display()} : {self.montant}"


class Transfert(ModeleBase):
    """Transfert du solde mobile money d'un vendeur vers la caisse espèces d'un dépôt."""

    class Operateur(models.TextChoices):
        ORANGE_MONEY = "orange_money", "Orange Money"
        MTN_MONEY = "mtn_money", "MTN Money"
        MOOV_MONEY = "moov_money", "Moov Money"
        WAVE = "wave", "Wave"

    depot = models.ForeignKey(
        "stock.Depot", on_delete=models.CASCADE, related_name="transferts_caisse"
    )
    # Celui dont le solde mobile money est transféré : en pratique toujours le
    # vendeur qui a encaissé les paiements concernés (voir tresorerie/services.py
    # ::solde_mobile_money_disponible), jamais une ligne partagée.
    utilisateur_source = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="transferts_effectues",
    )
    operateur = models.CharField(max_length=20, choices=Operateur.choices)
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return f"Transfert {self.get_operateur_display()} {self.montant} -> {self.depot}"


class ClotureCaisse(ModeleBase):
    """
    Clôture journalière : comptage physique de la caisse d'un dépôt comparé au
    solde théorique (somme des MouvementCaisse à cet instant). Contrairement à
    stock.Inventaire, un seul montant à compter (pas de ligne par article) :
    pas de sous-modèle "LigneCloture", pas de statut en_cours/valide — figée
    dès sa création.
    """

    depot = models.ForeignKey(
        "stock.Depot", on_delete=models.CASCADE, related_name="clotures_caisse"
    )
    solde_theorique = models.DecimalField(max_digits=12, decimal_places=2)
    solde_compte = models.DecimalField(max_digits=12, decimal_places=2)
    ecart = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return f"Clôture {self.depot} : écart {self.ecart}"
