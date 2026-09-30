"""
App clients : fiches clients et carnet de crédit (ventes à crédit).
"""
from django.db import models

from core.models import ModeleBase


class Client(ModeleBase):
    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="clients"
    )
    nom = models.CharField(max_length=200)
    telephone = models.CharField(max_length=30, blank=True)
    adresse = models.CharField(max_length=255, blank=True)
    # Client régulier (fidélisé) vs client de passage saisi à la volée pour une
    # vente à crédit : ce dernier n'apparaît pas dans le répertoire clients,
    # seulement dans le carnet de crédit tant qu'il n'a pas soldé.
    est_permanent = models.BooleanField(default=True)

    def __str__(self):
        return self.nom


class Credit(ModeleBase):
    """Créance liée à une vente à crédit : ce que le client doit."""

    class Statut(models.TextChoices):
        EN_COURS = "en_cours", "En cours"
        SOLDE = "solde", "Soldé"

    client = models.ForeignKey(
        Client, on_delete=models.CASCADE, related_name="credits"
    )
    vente = models.ForeignKey(
        "ventes.Vente", on_delete=models.SET_NULL, null=True, blank=True
    )
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    montant_paye = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    solde = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    echeance = models.DateField(null=True, blank=True)
    statut = models.CharField(
        max_length=15, choices=Statut.choices, default=Statut.EN_COURS
    )

    def __str__(self):
        return f"Crédit {self.client} : solde {self.solde}"


class EcheanceCredit(ModeleBase):
    """Tranche prévue d'un échéancier de remboursement d'un crédit client
    (même principe que fournisseurs.EcheanceDette) : les règlements couvrent
    les tranches dans l'ordre des dates, le statut est calculé à l'affichage."""

    credit = models.ForeignKey(Credit, on_delete=models.CASCADE, related_name="echeances")
    date_echeance = models.DateField()
    montant = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        ordering = ["date_echeance"]

    def __str__(self):
        return f"{self.credit} : {self.montant} le {self.date_echeance}"


class PaiementCredit(ModeleBase):
    """Règlement partiel ou total d'un crédit."""

    credit = models.ForeignKey(
        Credit, on_delete=models.CASCADE, related_name="paiements"
    )
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    mode = models.CharField(max_length=30, blank=True)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )


class MouvementCompteClient(ModeleBase):
    """Porte-monnaie du client : l'argent qu'il laisse d'avance à la boutique.
    Le solde n'est jamais stocké : entrées (dépôt, annulation d'une vente payée
    par le compte) moins sorties (utilisation en caisse ou pour un crédit,
    argent rendu). Ajout seul : on ne corrige pas, on contre-passe."""

    class Type(models.TextChoices):
        DEPOT = "depot", "Dépôt"
        UTILISATION = "utilisation", "Utilisation"
        RENDU = "rendu", "Argent rendu"
        ANNULATION = "annulation", "Annulation (remis sur le compte)"

    ENTREES = ("depot", "annulation")

    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="mouvements_compte")
    type = models.CharField(max_length=15, choices=Type.choices)
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    # Comment l'argent est entré / sorti (dépôt, rendu) : especes, mobile_money, banque.
    mode = models.CharField(max_length=20, blank=True, default="")
    operateur = models.CharField(max_length=20, blank=True, default="")
    depot = models.ForeignKey("stock.Depot", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    vente = models.ForeignKey("ventes.Vente", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    credit = models.ForeignKey(Credit, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    motif = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["date_creation"]

    def __str__(self):
        return f"{self.client} : {self.get_type_display()} {self.montant}"
