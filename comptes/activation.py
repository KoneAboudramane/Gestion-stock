"""
Codes d'activation de l'abonnement (docs/plan_reseau_local.md, lot 6) : le
secours d'une boutique qui n'a pas internet au moment de renouveler.

Un code contient la boutique, la nouvelle date de fin et la formule, avec une
signature Ed25519 : l'appli la vérifie SANS internet avec la clé publique
qu'elle embarque (client-electron/electron/services/activation.ts), sans
pouvoir en fabriquer — seule la clé privée du serveur (variable
d'environnement ACTIVATION_CLE_PRIVEE, jamais dans le dépôt) le peut.

Ed25519 est implémenté ici en Python pur (RFC 8032, §6, algorithme de
référence) pour ne pas ajouter de dépendance compilée à installer sur
l'hébergement mutualisé ; les tests vérifient qu'un code signé ici est
accepté par la vérification de Node (client Electron).
"""
import base64
import hashlib
import os
import secrets
from datetime import date, timedelta

# --- Ed25519 (RFC 8032, §6) ---

_P = 2**255 - 19
_L = 2**252 + 27742317777372353535851937790883648493


def _sha512(message):
    return hashlib.sha512(message).digest()


def _inv(x):
    return pow(x, _P - 2, _P)


_D = -121665 * _inv(121666) % _P
_RACINE_MOINS_UN = pow(2, (_P - 1) // 4, _P)


def _additionner(P, Q):
    A = (P[1] - P[0]) * (Q[1] - Q[0]) % _P
    B = (P[1] + P[0]) * (Q[1] + Q[0]) % _P
    C = 2 * P[3] * Q[3] * _D % _P
    D = 2 * P[2] * Q[2] % _P
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F % _P, G * H % _P, F * G % _P, E * H % _P)


def _multiplier(s, P):
    Q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            Q = _additionner(Q, P)
        P = _additionner(P, P)
        s >>= 1
    return Q


def _egaux(P, Q):
    return (P[0] * Q[2] - Q[0] * P[2]) % _P == 0 and (P[1] * Q[2] - Q[1] * P[2]) % _P == 0


def _retrouver_x(y, signe):
    if y >= _P:
        return None
    x2 = (y * y - 1) * _inv(_D * y * y + 1)
    if x2 == 0:
        return None if signe else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0:
        x = x * _RACINE_MOINS_UN % _P
    if (x * x - x2) % _P != 0:
        return None
    if (x & 1) != signe:
        x = _P - x
    return x


_GY = 4 * _inv(5) % _P
_GX = _retrouver_x(_GY, 0)
_G = (_GX, _GY, 1, _GX * _GY % _P)


def _compresser(P):
    zinv = _inv(P[2])
    x, y = P[0] * zinv % _P, P[1] * zinv % _P
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _decompresser(octets):
    y = int.from_bytes(octets, "little")
    signe = y >> 255
    y &= (1 << 255) - 1
    x = _retrouver_x(y, signe)
    return None if x is None else (x, y, 1, x * y % _P)


def _developper_secret(secret):
    h = _sha512(secret)
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return a, h[32:]


def cle_publique(secret):
    """Clé publique (32 octets) d'une clé privée Ed25519 (graine de 32 octets)."""
    a, _ = _developper_secret(secret)
    return _compresser(_multiplier(a, _G))


def signer(secret, message):
    a, prefixe = _developper_secret(secret)
    A = _compresser(_multiplier(a, _G))
    r = int.from_bytes(_sha512(prefixe + message), "little") % _L
    R = _compresser(_multiplier(r, _G))
    h = int.from_bytes(_sha512(R + A + message), "little") % _L
    return R + int.to_bytes((r + h * a) % _L, 32, "little")


def verifier(publique, message, signature):
    if len(publique) != 32 or len(signature) != 64:
        return False
    A = _decompresser(publique)
    R = _decompresser(signature[:32])
    s = int.from_bytes(signature[32:], "little")
    if A is None or R is None or s >= _L:
        return False
    h = int.from_bytes(_sha512(signature[:32] + publique + message), "little") % _L
    return _egaux(_multiplier(s, _G), _additionner(R, _multiplier(h, A)))


# --- Format du code ---

PREFIXE_SIGNATURE = b"gestion-stock/activation/v1"
VERSION = 1
ORIGINE_DATES = date(2020, 1, 1)
FORMULES = {"essentiel": 0, "pro": 1}


class ErreurActivation(Exception):
    pass


def cle_privee_configuree():
    """Graine Ed25519 (32 octets) de ACTIVATION_CLE_PRIVEE (base64), ou None si absente."""
    valeur = os.environ.get("ACTIVATION_CLE_PRIVEE", "").strip()
    if not valeur:
        return None
    graine = base64.b64decode(valeur)
    if len(graine) != 32:
        raise ErreurActivation("ACTIVATION_CLE_PRIVEE doit être une graine Ed25519 de 32 octets (base64).")
    return graine


def generer_code(boutique_id, date_fin, formule, secret=None):
    """
    Code d'activation : « GS-XXXXX-XXXXX-… » (base32 du contenu + signature,
    par groupes de 5) — à copier dans WhatsApp ou un SMS, pas à dicter.
    Contenu (24 octets) : version, boutique (UUID), date de fin (jours depuis
    le 01/01/2020), formule, numéro aléatoire (deux codes jamais identiques).
    """
    secret = secret or cle_privee_configuree()
    if secret is None:
        raise ErreurActivation(
            "Clé d'activation absente : définissez ACTIVATION_CLE_PRIVEE (voir manage.py generer_cle_activation)."
        )
    jours = (date_fin - ORIGINE_DATES).days
    if not 0 <= jours < 2**16:
        raise ErreurActivation("Date de fin hors limites.")
    contenu = (
        bytes([VERSION])
        + boutique_id.bytes
        + jours.to_bytes(2, "big")
        + bytes([FORMULES.get(formule, 0)])
        + secrets.token_bytes(4)
    )
    brut = base64.b32encode(contenu + signer(secret, PREFIXE_SIGNATURE + contenu)).decode().rstrip("=")
    return "GS-" + "-".join(brut[i:i + 5] for i in range(0, len(brut), 5))


def lire_code(code, publique):
    """Vérifie un code (miroir de la lecture côté appli) : (boutique_id UUID, date_fin, formule)."""
    import uuid

    brut = "".join(code.upper().split()).replace("-", "")
    if brut.startswith("GS"):
        brut = brut[2:]
    brut += "=" * (-len(brut) % 8)
    octets = base64.b32decode(brut)
    contenu, signature = octets[:24], octets[24:]
    if len(contenu) != 24 or contenu[0] != VERSION or not verifier(publique, PREFIXE_SIGNATURE + contenu, signature):
        raise ErreurActivation("Code d'activation invalide.")
    formule = {v: k for k, v in FORMULES.items()}.get(contenu[19], "essentiel")
    return uuid.UUID(bytes=contenu[1:17]), ORIGINE_DATES + timedelta(days=int.from_bytes(contenu[17:19], "big")), formule
