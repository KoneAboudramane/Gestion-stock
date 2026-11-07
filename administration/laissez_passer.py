"""
Laissez-passer admin (docs/plan_laissez_passer_admin.md) : ouvrir l'Espace Admin
d'un appareil qui n'a JAMAIS vu internet (installation en zone sans réseau).

Le code est fabriqué ici, avec internet, puis vérifié SANS internet par les
applis (client-electron/electron/services/laissezPasser.ts,
client-web/src/services/laissezPasser.ts), qui n'ont que la clé publique :
impossible d'en fabriquer un en ouvrant l'appli. Même clé que les codes
d'activation (ACTIVATION_CLE_PRIVEE), préfixe de signature distinct.

Le code ne suffit pas seul : il porte une EMPREINTE du mot de passe de l'admin
(PBKDF2-SHA256, 100 000 tours, sel aléatoire) ; l'appareil exige aussi le mot
de passe. Le mot de passe en clair n'y est jamais.

Contenu signé : version (1 o) · numéro (8 o) · jours de fin depuis le
01/01/2020 (2 o, 0xFFFF = illimité) · sel (16 o) · empreinte (32 o) · longueur
de l'identifiant (1 o) · identifiant (UTF-8). Puis la signature Ed25519 (64 o).
Écrit « LP-XXXXX-XXXXX-… » (base32, groupes de 5) : à copier, pas à dicter.
"""
import base64
import hashlib
import secrets
from datetime import date, timedelta

from comptes.activation import ErreurActivation, cle_privee_configuree, signer, verifier

PREFIXE_SIGNATURE = b"gestion-stock/laissez-passer/v1"
VERSION = 1
ORIGINE_DATES = date(2020, 1, 1)
ILLIMITE = 0xFFFF
ITERATIONS = 100_000
DUREES_PERMISES = (1, 7, 15, 30, 90, None)  # None : illimité


class ErreurLaissezPasser(Exception):
    pass


def empreinte_mot_de_passe(mot_de_passe, sel):
    """Même calcul que les applis (PBKDF2-SHA256, 100 000 tours, 32 octets)."""
    return hashlib.pbkdf2_hmac("sha256", mot_de_passe.encode("utf-8"), sel, ITERATIONS, 32)


def fabriquer_code(identifiant, mot_de_passe, date_fin, secret=None, numero=None, sel=None):
    """
    Code signé. `date_fin` None = illimité. `secret` (graine Ed25519) : celle de
    ACTIVATION_CLE_PRIVEE par défaut. Renvoie (code, numéro hexadécimal).
    """
    try:
        secret = secret or cle_privee_configuree()
    except ErreurActivation as erreur:
        raise ErreurLaissezPasser(str(erreur)) from erreur
    if secret is None:
        raise ErreurLaissezPasser(
            "Clé de signature absente : définissez ACTIVATION_CLE_PRIVEE (voir manage.py generer_cle_activation)."
        )
    nom = identifiant.encode("utf-8")
    if not 0 < len(nom) <= 150:
        raise ErreurLaissezPasser("Identifiant invalide.")
    if date_fin is None:
        jours = ILLIMITE
    else:
        jours = (date_fin - ORIGINE_DATES).days
        if not 0 <= jours < ILLIMITE:
            raise ErreurLaissezPasser("Date de fin hors limites.")
    numero = numero or secrets.token_bytes(8)
    sel = sel or secrets.token_bytes(16)
    contenu = (
        bytes([VERSION])
        + numero
        + jours.to_bytes(2, "big")
        + sel
        + empreinte_mot_de_passe(mot_de_passe, sel)
        + bytes([len(nom)])
        + nom
    )
    brut = base64.b32encode(contenu + signer(secret, PREFIXE_SIGNATURE + contenu)).decode().rstrip("=")
    return "LP-" + "-".join(brut[i:i + 5] for i in range(0, len(brut), 5)), numero.hex()


def lire_code(code, publique):
    """
    Vérifie la signature (miroir de la lecture des applis) :
    {numero, identifiant, date_fin (None = illimité), sel, empreinte}.
    """
    brut = "".join(code.upper().split()).replace("-", "")
    if brut.startswith("LP"):
        brut = brut[2:]
    brut += "=" * (-len(brut) % 8)
    try:
        octets = base64.b32decode(brut)
    except Exception as erreur:
        raise ErreurLaissezPasser("Laissez-passer invalide.") from erreur
    if len(octets) < 60 + 64 + 1:
        raise ErreurLaissezPasser("Laissez-passer invalide.")
    longueur_nom = octets[59]
    fin_contenu = 60 + longueur_nom
    contenu, signature = octets[:fin_contenu], octets[fin_contenu:]
    if contenu[0] != VERSION or len(signature) != 64 or not verifier(publique, PREFIXE_SIGNATURE + contenu, signature):
        raise ErreurLaissezPasser("Laissez-passer invalide.")
    jours = int.from_bytes(contenu[9:11], "big")
    return {
        "numero": contenu[1:9].hex(),
        "date_fin": None if jours == ILLIMITE else ORIGINE_DATES + timedelta(days=jours),
        "sel": contenu[11:27],
        "empreinte": contenu[27:59],
        "identifiant": contenu[60:fin_contenu].decode("utf-8"),
    }
