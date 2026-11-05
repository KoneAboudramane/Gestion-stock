"""
Codes à 6 chiffres des applications d'authentification (Google Authenticator,
Microsoft Authenticator…) — norme TOTP (RFC 6238), pas de dépendance externe.
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

PERIODE = 30  # secondes
CHIFFRES = 6


def generer_secret():
    """Secret aléatoire de 160 bits, en base32 (format attendu par les applis)."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code_pour_pas(secret, pas):
    cle = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    empreinte = hmac.new(cle, struct.pack(">Q", pas), hashlib.sha1).digest()
    decalage = empreinte[-1] & 0x0F
    valeur = struct.unpack(">I", empreinte[decalage:decalage + 4])[0] & 0x7FFFFFFF
    return str(valeur % 10**CHIFFRES).zfill(CHIFFRES)


def pas_actuel(maintenant=None):
    return int((maintenant if maintenant is not None else time.time()) // PERIODE)


def verifier_code(secret, code, dernier_pas=0, maintenant=None):
    """
    Renvoie le pas de temps accepté, ou None. Tolère une période d'écart (horloge
    du téléphone un peu en avance ou en retard) et refuse un code déjà utilisé
    (pas <= dernier_pas), pour qu'un code vu par-dessus l'épaule ne resserve pas.
    """
    code = "".join(c for c in str(code or "") if c.isdigit())
    if not secret or len(code) != CHIFFRES:
        return None
    courant = pas_actuel(maintenant)
    for pas in (courant - 1, courant, courant + 1):
        if pas > dernier_pas and hmac.compare_digest(_code_pour_pas(secret, pas), code):
            return pas
    return None


def uri_configuration(secret, identifiant, emetteur="Gestion Stock Admin"):
    """Lien otpauth:// à afficher en QR code dans l'appli d'authentification."""
    libelle = quote(f"{emetteur}:{identifiant}")
    return f"otpauth://totp/{libelle}?secret={secret}&issuer={quote(emetteur)}&digits={CHIFFRES}&period={PERIODE}"
