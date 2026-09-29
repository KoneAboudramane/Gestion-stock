"""
Unités et attributs que la plupart des commerçants utilisent, créés à
l'inscription d'une boutique (voir comptes/services.py::inscrire_boutique).
Même liste que client-electron/src/lib/catalogueParDefaut.ts (bouton
« Ajouter les unités courantes » des boutiques existantes). Tout reste
modifiable ou supprimable par la boutique.
"""
from .models import Attribut, Unite, ValeurAttribut

UNITES_PAR_DEFAUT = [
    ("Pièce", "pce"),
    ("Carton", "ctn"),
    ("Paquet", "pqt"),
    ("Sachet", "sct"),
    ("Boîte", "bte"),
    ("Sac", "sac"),
    ("Fardeau", "fdo"),
    ("Douzaine", "dz"),
    ("Kilo", "kg"),
    ("Gramme", "g"),
    ("Litre", "L"),
    ("Bidon", "bid"),
    ("Mètre", "m"),
    ("Rouleau", "rlx"),
    ("Plaquette", "plq"),
]

ATTRIBUTS_PAR_DEFAUT = [
    ("Taille", ["XS", "S", "M", "L", "XL", "XXL"]),
    ("Couleur", ["Noir", "Blanc", "Rouge", "Bleu", "Vert", "Jaune", "Gris", "Marron"]),
    ("Pointure", [str(p) for p in range(36, 46)]),
    ("Contenance", ["25 cl", "33 cl", "50 cl", "1 L", "1,5 L", "5 L"]),
    ("Poids", ["250 g", "500 g", "1 kg", "5 kg", "25 kg", "50 kg"]),
]


def creer_catalogue_par_defaut(boutique):
    """Ajoute les unités et attributs courants qui manquent (sans doublon de nom)."""
    unites_existantes = {u.lower() for u in Unite.objects.filter(boutique=boutique).values_list("nom", flat=True)}
    for nom, abreviation in UNITES_PAR_DEFAUT:
        if nom.lower() not in unites_existantes:
            Unite.objects.create(boutique=boutique, nom=nom, abreviation=abreviation)

    for nom, valeurs in ATTRIBUTS_PAR_DEFAUT:
        attribut = Attribut.objects.filter(boutique=boutique, nom__iexact=nom).first()
        if attribut is None:
            attribut = Attribut.objects.create(boutique=boutique, nom=nom)
        valeurs_existantes = {v.lower() for v in attribut.valeurs.values_list("valeur", flat=True)}
        for valeur in valeurs:
            if valeur.lower() not in valeurs_existantes:
                ValeurAttribut.objects.create(attribut=attribut, valeur=valeur)
