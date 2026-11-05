"""
Logique métier de l'app catalogue.
CLAUDE.md règle 5 : un produit simple a toujours au moins une variante par
défaut, car c'est la Variante qui porte le prix et le stock.
"""
import re
import unicodedata

from django.db import transaction
from django.db.models.functions import Trim

from .models import Produit, Variante


def cle_nom_article(nom):
    """Nom d'article comparable : sans accents, sans majuscules, espaces réduits (même règle que les clients)."""
    decompose = unicodedata.normalize("NFD", (nom or "").strip().lower())
    sans_accents = "".join(c for c in decompose if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", sans_accents)


def article_du_meme_nom(boutique_id, nom, sauf_produit_id=None):
    """Article non supprimé de la boutique portant déjà ce nom (ou None)."""
    cle = cle_nom_article(nom)
    produits = Produit.objects.filter(boutique_id=boutique_id, supprime=False)
    if sauf_produit_id is not None:
        produits = produits.exclude(pk=sauf_produit_id)
    return next((p for p in produits.only("id", "nom") if cle_nom_article(p.nom) == cle), None)


def variante_du_meme_code_barres(boutique_id, code_barres, sauf_variante_id=None):
    """Variante non supprimée de la boutique portant déjà ce code-barres (ou None ; vide = pas de contrôle)."""
    code = (code_barres or "").strip()
    if not code:
        return None
    variantes = (
        Variante.objects.filter(produit__boutique_id=boutique_id, produit__supprime=False, supprime=False)
        .annotate(code_nettoye=Trim("code_barres"))
        .filter(code_nettoye=code)
        .select_related("produit")
    )
    if sauf_variante_id is not None:
        variantes = variantes.exclude(pk=sauf_variante_id)
    return variantes.first()


@transaction.atomic
def creer_produit(boutique, donnees_produit, donnees_variante_defaut):
    """Crée un Produit et sa Variante par défaut (première variante vendable)."""
    produit = Produit.objects.create(boutique=boutique, **donnees_produit)
    Variante.objects.create(produit=produit, **donnees_variante_defaut)
    return produit
