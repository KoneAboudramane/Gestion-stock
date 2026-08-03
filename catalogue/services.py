"""
Logique métier de l'app catalogue.
CLAUDE.md règle 5 : un produit simple a toujours au moins une variante par
défaut, car c'est la Variante qui porte le prix et le stock.
"""
from django.db import transaction

from .models import Produit, Variante


@transaction.atomic
def creer_produit(boutique, donnees_produit, donnees_variante_defaut):
    """Crée un Produit et sa Variante par défaut (première variante vendable)."""
    produit = Produit.objects.create(boutique=boutique, **donnees_produit)
    Variante.objects.create(produit=produit, **donnees_variante_defaut)
    return produit
