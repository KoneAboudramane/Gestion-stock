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


class EcheanceDette(ModeleBase):
    """Tranche prévue d'un échéancier de remboursement (date + montant). Les
    paiements restent libres : ils couvrent les tranches dans l'ordre des
    dates, le statut (payée, partielle, à venir, en retard) est calculé à
    l'affichage, jamais stocké. Replanifier retire (supprime) les tranches pas
    encore entièrement couvertes et en ajoute de nouvelles pour le reste dû."""

    dette = models.ForeignKey(DetteFournisseur, on_delete=models.CASCADE, related_name="echeances")
    date_echeance = models.DateField()
    montant = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        ordering = ["date_echeance"]

    def __str__(self):
        return f"{self.dette} : {self.montant} le {self.date_echeance}"


class MouvementCompteFournisseur(ModeleBase):
    """Compte du fournisseur : ce qu'il nous doit en marchandise ou en argent
    (avances versées, avoirs de retour). Solde calculé, jamais stocké :
    entrées (avance, avoir, annulation d'un paiement fait avec le compte)
    moins sorties (utilisation pour une réception ou une dette, argent que le
    fournisseur nous rend). Ajout seul."""

    class Type(models.TextChoices):
        AVANCE = "avance", "Avance versée"
        AVOIR = "avoir", "Avoir (retour)"
        UTILISATION = "utilisation", "Utilisation"
        REMBOURSEMENT = "remboursement", "Remboursé par le fournisseur"
        ANNULATION = "annulation", "Annulation (remis sur le compte)"

    ENTREES = ("avance", "avoir", "annulation")

    fournisseur = models.ForeignKey(Fournisseur, on_delete=models.CASCADE, related_name="mouvements_compte")
    type = models.CharField(max_length=15, choices=Type.choices)
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    mode = models.CharField(max_length=20, blank=True, default="")
    operateur = models.CharField(max_length=20, blank=True, default="")
    depot = models.ForeignKey("stock.Depot", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reception = models.ForeignKey("achats.Reception", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    retour = models.ForeignKey(
        "achats.RetourFournisseur", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    dette = models.ForeignKey(DetteFournisseur, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    motif = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["date_creation"]

    def __str__(self):
        return f"{self.fournisseur} : {self.get_type_display()} {self.montant}"
