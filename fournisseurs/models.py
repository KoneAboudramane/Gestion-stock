"""
App fournisseurs : fiches fournisseurs et dettes fournisseurs.
"""
from django.db import models

from core.models import ModeleBase


class Fournisseur(ModeleBase):
    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="fournisseurs"
    )
    nom = models.CharField(max_length=200)
    telephone = models.CharField(max_length=30, blank=True)
    adresse = models.CharField(max_length=255, blank=True)
    contact = models.CharField(max_length=150, blank=True)

    def __str__(self):
        return self.nom


class DetteFournisseur(ModeleBase):
    """Ce que la boutique doit à un fournisseur (achat à crédit)."""

    class Statut(models.TextChoices):
        EN_COURS = "en_cours", "En cours"
        SOLDE = "solde", "Soldé"

    fournisseur = models.ForeignKey(
        Fournisseur, on_delete=models.CASCADE, related_name="dettes"
    )
    commande = models.ForeignKey(
        "achats.CommandeAchat", on_delete=models.SET_NULL, null=True, blank=True
    )
    # Réception qui a créé la dette (annulation / retour fournisseur la retrouvent ainsi).
    reception = models.ForeignKey(
        "achats.Reception", on_delete=models.SET_NULL, null=True, blank=True, related_name="dettes"
    )
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    montant_paye = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    solde = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    statut = models.CharField(
        max_length=15, choices=Statut.choices, default=Statut.EN_COURS
    )

    def __str__(self):
        return f"Dette {self.fournisseur} : solde {self.solde}"


class PaiementDetteFournisseur(ModeleBase):
    """Remboursement partiel ou total d'une dette fournisseur."""

    dette = models.ForeignKey(
        DetteFournisseur, on_delete=models.CASCADE, related_name="paiements"
    )
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    mode = models.CharField(max_length=30, blank=True)
    # Remboursement saisi par erreur (voir services.annuler_paiement_dette) :
    # reste visible, marqué annulé ; son montant revient dans le solde.
    annulee = models.BooleanField(default=False)
    date_annulation = models.DateTimeField(null=True, blank=True)
    annule_par = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    motif_annulation = models.CharField(max_length=255, blank=True)
