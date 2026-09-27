"""Lecture des réglages de boutique (configuration.Parametre) utilisés par la
logique métier des autres apps."""

from .models import Parametre

# Boutique qui fabrique ses propres produits : seule autorisée à faire entrer
# du stock hors réception d'achat (entrée manuelle, entrée de production).
# Même clé que client-electron/electron/services/stock.ts et
# client-web/src/services/stock.ts (CLE_PARAMETRE_FABRICATION_PROPRE).
CLE_FABRICATION_PROPRE = "fabrication_propre"

MESSAGE_ENTREE_RESERVEE_FABRICATION = (
    "Cette boutique réapprovisionne par les Achats : l'entrée de stock manuelle "
    "est réservée aux boutiques qui fabriquent leurs produits "
    "(Réglages → Informations boutique)."
)


def fabrication_propre_active(boutique):
    return Parametre.objects.filter(
        boutique=boutique, cle=CLE_FABRICATION_PROPRE, valeur="1"
    ).exists()
