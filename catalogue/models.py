"""
App catalogue : produits, catégories, unités et VARIANTES.
Le Produit est l'article général (ex. « T-shirt col rond »), la Variante est
l'article concret vendu et stocké (ex. « T-shirt Rouge M »). C'est la Variante
qui porte le prix et le code-barres ; le stock se compte au niveau Variante.
Un produit simple aura une seule variante par défaut.
"""
from django.db import models

from core.models import ModeleBase


class Categorie(ModeleBase):
    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="categories"
    )
    nom = models.CharField(max_length=150)
    categorie_parent = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="sous_categories",
    )

    def __str__(self):
        return self.nom


class Unite(ModeleBase):
    """Unité de mesure : pièce, kg, carton, litre..."""

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="unites"
    )
    nom = models.CharField(max_length=50)
    abreviation = models.CharField(max_length=10, blank=True)

    def __str__(self):
        return self.nom


class Produit(ModeleBase):
    """Article général (parent des variantes)."""

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="produits"
    )
    nom = models.CharField(max_length=200)
    categorie = models.ForeignKey(
        Categorie, on_delete=models.SET_NULL, null=True, blank=True
    )
    unite = models.ForeignKey(
        Unite, on_delete=models.SET_NULL, null=True, blank=True
    )
    description = models.TextField(blank=True)
    photo = models.ImageField(upload_to="produits/", null=True, blank=True)
    actif = models.BooleanField(default=True)

    def __str__(self):
        return self.nom


class Attribut(ModeleBase):
    """Type de variante : Taille, Couleur, Pointure..."""

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="attributs"
    )
    nom = models.CharField(max_length=50)

    def __str__(self):
        return self.nom


class ValeurAttribut(ModeleBase):
    """Valeur possible d'un attribut : S, M, L / Rouge, Bleu..."""

    attribut = models.ForeignKey(
        Attribut, on_delete=models.CASCADE, related_name="valeurs"
    )
    valeur = models.CharField(max_length=50)

    def __str__(self):
        return f"{self.attribut.nom} : {self.valeur}"


class Variante(ModeleBase):
    """Article concret vendu et stocké. Porte le prix et le code-barres."""

    produit = models.ForeignKey(
        Produit, on_delete=models.CASCADE, related_name="variantes"
    )
    reference = models.CharField(max_length=100, blank=True)  # SKU
    code_barres = models.CharField(max_length=100, blank=True)
    prix_achat = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    prix_vente = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    seuil_alerte = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    photo = models.ImageField(upload_to="variantes/", null=True, blank=True)
    actif = models.BooleanField(default=True)

    def __str__(self):
        details = ", ".join(v.valeur_attribut.valeur for v in self.valeurs.all())
        return f"{self.produit.nom}{(' - ' + details) if details else ''}"


class VarianteValeur(ModeleBase):
    """Relie une variante à sa combinaison d'attributs (ex. Rouge + M)."""

    variante = models.ForeignKey(
        Variante, on_delete=models.CASCADE, related_name="valeurs"
    )
    valeur_attribut = models.ForeignKey(ValeurAttribut, on_delete=models.CASCADE)

    class Meta:
        unique_together = ("variante", "valeur_attribut")
