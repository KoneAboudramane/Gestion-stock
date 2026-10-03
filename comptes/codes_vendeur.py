"""
Code vendeur : abréviation du nom d'un utilisateur, unique dans sa boutique,
glissée dans les numéros des documents qu'il crée (VTE-20261002-AKO-0001).

Chaque poste numérote hors ligne sans voir les documents des autres : avec
le code de la personne dans le numéro, deux vendeurs ne peuvent plus produire
le même numéro. Module sans import de modèles : la migration qui remplit les
comptes existants s'en sert aussi.
"""

import re
import unicodedata

FORMAT_CODE_VENDEUR = re.compile(r"^[A-Z0-9]{1,6}$")


def _lettres(texte):
    sans_accents = unicodedata.normalize("NFD", texte or "")
    return "".join(c for c in sans_accents if c.isascii() and c.isalnum()).upper()


def calculer_code_vendeur(prenom, nom, username, codes_pris):
    """Initiale du prénom + 2 premières lettres du nom (Aboudramane Koné → AKO),
    sinon les 3 premières lettres disponibles ; suffixe 2, 3… si déjà pris."""
    p, n = _lettres(prenom), _lettres(nom)
    base = p[0] + n[:2] if p and n else (p or n or _lettres(username))[:3] or "U"
    pris = {c.upper() for c in codes_pris if c}
    code, suffixe = base, 2
    while code in pris:
        code = f"{base}{suffixe}"
        suffixe += 1
    return code
