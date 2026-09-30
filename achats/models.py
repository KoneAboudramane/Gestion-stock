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
    # Comment `montant_paye` a été réglé à la livraison : espèces (sortie de
    # caisse du dépôt), Mobile Money (opérateur) ou banque. Vide pour les
    # réceptions antérieures à ce suivi.
    mode_paiement = models.CharField(max_length=20, blank=True, default="")
    operateur_paiement = models.CharField(max_length=20, blank=True, default="")
    # Réception saisie par erreur (voir services.annuler_reception) : reste
    # visible, marquée annulée.
    annulee = models.BooleanField(default=False)
    date_annulation = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Réception {self.commande}"

class RetourFournisseur(ModeleBase):
    """Marchandise d'une réception renvoyée au fournisseur (abîmée, erreur de
    livraison...). La dette de la réception baisse du montant retourné ; ce
    qui dépasse son solde (déjà payé) est un avoir à récupérer."""

    commande = models.ForeignKey(CommandeAchat, on_delete=models.CASCADE, related_name="retours")
    reception = models.ForeignKey(Reception, on_delete=models.CASCADE, related_name="retours")
    depot = models.ForeignKey("stock.Depot", on_delete=models.PROTECT)
    motif = models.CharField(max_length=255, blank=True)
    montant = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    avoir = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return f"Retour {self.commande} : {self.montant}"


class LigneRetourFournisseur(ModeleBase):
    retour = models.ForeignKey(RetourFournisseur, on_delete=models.CASCADE, related_name="lignes")
    variante = models.ForeignKey("catalogue.Variante", on_delete=models.PROTECT)
    quantite = models.DecimalField(max_digits=12, decimal_places=2)
    prix_achat = models.DecimalField(max_digits=12, decimal_places=2)
    sous_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    def __str__(self):
        return f"{self.quantite} x {self.variante}"


class EvenementCommande(ModeleBase):
    """Journal des étapes d'une commande (créée, commandée, modifiée, reçue,
    réception annulée, retour, paiement, annulée) : qui, quand, quoi. Ajout
    seul — une ligne n'est jamais modifiée. `reference_id` pointe vers la
    réception, le retour ou le paiement concerné (évite de le reconstituer
    une seconde fois à l'affichage pour les commandes plus anciennes)."""

    class Type(models.TextChoices):
        CREEE = "creee", "Créée"
        MODIFIEE = "modifiee", "Modifiée"
        COMMANDEE = "commandee", "Passée en commandée"
        RECEPTION = "reception", "Réception"
        RECEPTION_ANNULEE = "reception_annulee", "Réception annulée"
        RETOUR = "retour", "Retour fournisseur"
        PAIEMENT = "paiement", "Paiement"
        PAIEMENT_ANNULE = "paiement_annule", "Paiement annulé"
        ANNULEE = "annulee", "Annulée"

    commande = models.ForeignKey(CommandeAchat, on_delete=models.CASCADE, related_name="evenements")
    type = models.CharField(max_length=20, choices=Type.choices)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )
    detail = models.CharField(max_length=255, blank=True)
    montant = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["date_creation"]

    def __str__(self):
        return f"{self.commande} : {self.get_type_display()}"
