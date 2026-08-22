"""
App comptabilite : comptabilité générale SYSCOHADA (Système Normal), en
partie double. Les écritures sont générées automatiquement à partir des
autres apps (ventes, achats, tresorerie, clients, fournisseurs) via des
signals (comptabilite/signals.py) — aucune autre app n'est modifiée pour
ça, comptabilite se contente d'écouter leurs sauvegardes.
"""
from django.db import models

from core.models import ModeleBase


class CompteComptable(ModeleBase):
    """Un compte du plan comptable SYSCOHADA (classes 1 à 9)."""

    class Classe(models.IntegerChoices):
        RESSOURCES_DURABLES = 1, "1 · Comptes de ressources durables"
        ACTIF_IMMOBILISE = 2, "2 · Comptes d'actif immobilisé"
        STOCKS = 3, "3 · Comptes de stocks"
        TIERS = 4, "4 · Comptes de tiers"
        TRESORERIE = 5, "5 · Comptes de trésorerie"
        CHARGES = 6, "6 · Comptes de charges des activités ordinaires"
        PRODUITS = 7, "7 · Comptes de produits des activités ordinaires"
        HAO = 8, "8 · Comptes des autres charges et produits (HAO)"
        ENGAGEMENTS = 9, "9 · Engagements hors bilan / comptabilité analytique"

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="comptes_comptables"
    )
    numero = models.CharField(max_length=8)
    libelle = models.CharField(max_length=200)
    classe = models.PositiveSmallIntegerField(choices=Classe.choices)
    compte_parent = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="sous_comptes"
    )
    actif = models.BooleanField(default=True)

    class Meta:
        unique_together = [("boutique", "numero")]
        ordering = ["numero"]

    def __str__(self):
        return f"{self.numero} · {self.libelle}"


class ExerciceComptable(ModeleBase):
    """Période comptable annuelle (exercice), ouverte ou clôturée."""

    class Statut(models.TextChoices):
        OUVERT = "ouvert", "Ouvert"
        CLOTURE = "cloture", "Clôturé"

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="exercices_comptables"
    )
    libelle = models.CharField(max_length=50)
    date_debut = models.DateField()
    date_fin = models.DateField()
    statut = models.CharField(max_length=10, choices=Statut.choices, default=Statut.OUVERT)

    class Meta:
        unique_together = [("boutique", "libelle")]
        ordering = ["-date_debut"]

    def __str__(self):
        return f"{self.libelle} ({self.boutique})"


class JournalComptable(ModeleBase):
    """Journal auxiliaire (Caisse, Banque, Achats, Ventes, Opérations diverses...)."""

    class Code(models.TextChoices):
        CAISSE = "CA", "Journal de caisse"
        BANQUE = "BQ", "Journal de banque"
        ACHATS = "AC", "Journal des achats"
        VENTES = "VE", "Journal des ventes"
        OPERATIONS_DIVERSES = "OD", "Journal des opérations diverses"

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="journaux_comptables"
    )
    code = models.CharField(max_length=5, choices=Code.choices)
    libelle = models.CharField(max_length=100)

    class Meta:
        unique_together = [("boutique", "code")]

    def __str__(self):
        return f"{self.code} · {self.libelle}"


class EcritureComptable(ModeleBase):
    """
    Une écriture comptable : un fait générateur (vente, achat, dépense...)
    traduit en lignes de débit/crédit équilibrées. Numérotée séquentiellement
    par exercice/journal, non modifiable une fois validée (une correction se
    fait par contre-passation, pas par édition).
    """

    class Statut(models.TextChoices):
        BROUILLON = "brouillon", "Brouillon"
        VALIDEE = "validee", "Validée"

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="ecritures_comptables"
    )
    exercice = models.ForeignKey(
        ExerciceComptable, on_delete=models.PROTECT, related_name="ecritures"
    )
    journal = models.ForeignKey(
        JournalComptable, on_delete=models.PROTECT, related_name="ecritures"
    )
    numero = models.PositiveIntegerField()
    date_ecriture = models.DateField()
    libelle = models.CharField(max_length=255)
    # Référence libre vers le fait générateur (vente, achat, dépense...) —
    # même principe que stock.MouvementStock.reference_id.
    reference_type = models.CharField(max_length=50, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)
    statut = models.CharField(max_length=10, choices=Statut.choices, default=Statut.VALIDEE)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        unique_together = [("exercice", "journal", "numero")]
        ordering = ["-date_ecriture", "-numero"]

    def __str__(self):
        return f"{self.journal.code}-{self.numero} du {self.date_ecriture}"


class LigneEcriture(ModeleBase):
    """Une ligne de débit ou de crédit dans une écriture (jamais les deux à la fois)."""

    ecriture = models.ForeignKey(
        EcritureComptable, on_delete=models.CASCADE, related_name="lignes"
    )
    compte = models.ForeignKey(
        CompteComptable, on_delete=models.PROTECT, related_name="lignes_ecriture"
    )
    libelle = models.CharField(max_length=255, blank=True)
    debit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credit = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    def __str__(self):
        return f"{self.compte.numero} D:{self.debit} C:{self.credit}"
