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


class PerteStock(ModeleBase):
    """Sortie de stock sans vente (périmé, casse, vol, don...) : une vraie perte,
    à distinguer d'un ajustement qui corrige une erreur de saisie. La valeur est
    figée au coût moyen (CUMP) du moment, pour que le rapport des pertes reste
    juste même si le prix d'achat évolue ensuite."""

    class Motif(models.TextChoices):
        PERIME = "perime", "Périmé"
        ABIME = "abime", "Abîmé / cassé"
        VOL = "vol", "Vol / disparu"
        DON = "don", "Don"
        CONSOMMATION = "consommation", "Consommation interne"
        AUTRE = "autre", "Autre"

    variante = models.ForeignKey("catalogue.Variante", on_delete=models.PROTECT)
    depot = models.ForeignKey(Depot, on_delete=models.PROTECT, related_name="pertes")
    quantite = models.DecimalField(max_digits=12, decimal_places=2)
    motif = models.CharField(max_length=20, choices=Motif.choices)
    detail = models.CharField(max_length=255, blank=True)
    valeur = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return f"Perte {self.quantite} {self.variante} ({self.get_motif_display()})"


class OperationDestockage(ModeleBase):
    """Groupe nommé de déstockages lancés ensemble (ex. « Liquidation fin
    d'année ») : bilan commun dans les rapports et arrêt en un clic. Chaque
    article reste un Destockage à part entière (prix, fin, bilan propres)."""

    boutique = models.ForeignKey("comptes.Boutique", on_delete=models.CASCADE, related_name="operations_destockage")
    nom = models.CharField(max_length=150)
    date_fin = models.DateField(null=True, blank=True)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return self.nom


class Destockage(ModeleBase):
    """Article mis en déstockage : vendu à un prix réduit, appliqué
    automatiquement en caisse, pour écouler un stock qui dort. S'arrête à la
    date de fin (optionnelle), quand le stock de l'article tombe à 0, ou à la
    main. prix_normal fige le prix de vente au démarrage : c'est la base du
    manque à gagner calculé sur les ventes liées (ventes.LigneVente.destockage)."""

    class Statut(models.TextChoices):
        EN_COURS = "en_cours", "En cours"
        TERMINE = "termine", "Terminé"

    class MotifFin(models.TextChoices):
        DATE = "date", "Date de fin atteinte"
        EPUISE = "epuise", "Stock épuisé"
        MANUEL = "manuel", "Arrêté à la main"

    variante = models.ForeignKey("catalogue.Variante", on_delete=models.PROTECT, related_name="destockages")
    prix_normal = models.DecimalField(max_digits=12, decimal_places=2)
    prix_destockage = models.DecimalField(max_digits=12, decimal_places=2)
    date_fin = models.DateField(null=True, blank=True)
    statut = models.CharField(max_length=15, choices=Statut.choices, default=Statut.EN_COURS)
    motif_fin = models.CharField(max_length=15, choices=MotifFin.choices, blank=True)
    date_arret = models.DateTimeField(null=True, blank=True)
    utilisateur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )
    operation = models.ForeignKey(
        OperationDestockage, on_delete=models.SET_NULL, null=True, blank=True, related_name="destockages"
    )

    def __str__(self):
        return f"Déstockage {self.variante} à {self.prix_destockage}"


class ReleveDormants(ModeleBase):
    """Photo quotidienne des produits dormants (sans vente depuis jours_seuil
    jours) : nombre d'articles et argent immobilisé, pour suivre l'évolution
    dans le temps. Pris par les clients à l'ouverture de l'appli (une fois par
    jour et par appareil : pas d'unicité par date, plusieurs appareils peuvent
    en prendre un le même jour — l'affichage garde le plus récent)."""

    boutique = models.ForeignKey("comptes.Boutique", on_delete=models.CASCADE, related_name="releves_dormants")
    date = models.DateField()
    jours_seuil = models.PositiveIntegerField(default=60)
    nombre_articles = models.PositiveIntegerField(default=0)
    valeur_immobilisee = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    def __str__(self):
        return f"Dormants {self.date} : {self.nombre_articles} articles, {self.valeur_immobilisee}"


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
