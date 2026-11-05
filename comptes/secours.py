"""
Clé de secours des sauvegardes (docs/plan_reseau_local.md, lot 7) : option
choisie avec l'accord du patron. La clé de chaque sauvegarde est aussi
chiffrée avec la clé PUBLIQUE de l'administrateur (intégrée à l'appli) ; la clé
PRIVÉE ne quitte jamais le serveur (variable d'environnement SECOURS_CLE_PRIVEE).
Si le patron perd son mot de passe, l'Espace Admin envoie cette petite clé
chiffrée (jamais les données de la boutique) avec les identifiants admin, et
reçoit la clé de la sauvegarde.

RSA-OAEP (SHA-256, MGF1-SHA-256, sans étiquette) en Python pur, comme
comptes/activation.py : aucune dépendance à installer sur l'hébergement.
"""

import base64
import hashlib
import json
import os
import secrets

TAILLE_HASH = 32
EXPOSANT_PUBLIC = 65537


class ErreurSecours(Exception):
    pass


# --- Génération des clés (commande generer_cle_secours) ---

def _est_premier(n, tours=40):
    if n < 2:
        return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % p == 0:
            return n == p
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for _ in range(tours):
        a = secrets.randbelow(n - 3) + 2
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def _premier(bits):
    while True:
        candidat = secrets.randbits(bits) | (1 << (bits - 1)) | (1 << (bits - 2)) | 1
        if candidat % EXPOSANT_PUBLIC != 1 and _est_premier(candidat):
            return candidat


def generer_paire(bits=3072):
    """Nouvelle paire RSA : dict n, e, d, p, q (entiers)."""
    while True:
        p, q = _premier(bits // 2), _premier(bits // 2)
        n = p * q
        if p != q and n.bit_length() == bits:
            break
    phi = (p - 1) * (q - 1)
    d = pow(EXPOSANT_PUBLIC, -1, phi)
    return {"n": n, "e": EXPOSANT_PUBLIC, "d": d, "p": p, "q": q}


def _b64url(entier):
    octets = entier.to_bytes((entier.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(octets).rstrip(b"=").decode()


def cle_publique_jwk(paire):
    """Clé publique au format JWK (n, e), pour l'appli (crypto.createPublicKey)."""
    return {"kty": "RSA", "n": _b64url(paire["n"]), "e": _b64url(paire["e"])}


def cle_privee_jwk(paire):
    """Clé privée JWK complète (tests côté appli seulement)."""
    p, q, d = paire["p"], paire["q"], paire["d"]
    return {
        **cle_publique_jwk(paire),
        "d": _b64url(d), "p": _b64url(p), "q": _b64url(q),
        "dp": _b64url(d % (p - 1)), "dq": _b64url(d % (q - 1)), "qi": _b64url(pow(q, -1, p)),
    }


def valeur_variable_environnement(paire):
    """Valeur de SECOURS_CLE_PRIVEE : base64 de {"n": hex, "d": hex}."""
    return base64.b64encode(json.dumps({"n": format(paire["n"], "x"), "d": format(paire["d"], "x")}).encode()).decode()


# --- Déchiffrement ---

def lire_cle_privee(valeur=None):
    valeur = valeur if valeur is not None else os.environ.get("SECOURS_CLE_PRIVEE", "")
    if not valeur:
        raise ErreurSecours("Clé de secours non configurée sur le serveur (SECOURS_CLE_PRIVEE).")
    try:
        brut = json.loads(base64.b64decode(valeur))
        return int(brut["n"], 16), int(brut["d"], 16)
    except (ValueError, KeyError, TypeError) as erreur:
        raise ErreurSecours("SECOURS_CLE_PRIVEE illisible.") from erreur


def cle_secours_configuree():
    try:
        lire_cle_privee()
        return True
    except ErreurSecours:
        return False


def _mgf1(graine, longueur):
    sortie = b""
    compteur = 0
    while len(sortie) < longueur:
        sortie += hashlib.sha256(graine + compteur.to_bytes(4, "big")).digest()
        compteur += 1
    return sortie[:longueur]


def dechiffrer_oaep(chiffre, n, d):
    """RSA-OAEP SHA-256 (RFC 8017, §7.1.2), étiquette vide."""
    k = (n.bit_length() + 7) // 8
    if len(chiffre) != k or k < 2 * TAILLE_HASH + 2:
        raise ErreurSecours("Clé de secours chiffrée invalide.")
    c = int.from_bytes(chiffre, "big")
    if c >= n:
        raise ErreurSecours("Clé de secours chiffrée invalide.")
    em = pow(c, d, n).to_bytes(k, "big")
    y, graine_masquee, db_masque = em[0], em[1:1 + TAILLE_HASH], em[1 + TAILLE_HASH:]
    graine = bytes(a ^ b for a, b in zip(graine_masquee, _mgf1(db_masque, TAILLE_HASH)))
    db = bytes(a ^ b for a, b in zip(db_masque, _mgf1(graine, k - TAILLE_HASH - 1)))
    if y != 0 or not secrets.compare_digest(db[:TAILLE_HASH], hashlib.sha256(b"").digest()):
        raise ErreurSecours("Cette clé de secours ne correspond pas à la clé de l'administrateur.")
    reste = db[TAILLE_HASH:].lstrip(b"\x00")
    if not reste or reste[0] != 1:
        raise ErreurSecours("Cette clé de secours ne correspond pas à la clé de l'administrateur.")
    return reste[1:]


def ouvrir_cle_secours(cle_chiffree_b64, valeur=None):
    """→ (boutique_id hex UUID, clé de la sauvegarde en octets)."""
    n, d = lire_cle_privee(valeur)
    try:
        chiffre = base64.b64decode(cle_chiffree_b64, validate=True)
    except (ValueError, TypeError) as erreur:
        raise ErreurSecours("Clé de secours chiffrée invalide.") from erreur
    clair = dechiffrer_oaep(chiffre, n, d)
    if len(clair) != 48:
        raise ErreurSecours("Clé de secours chiffrée invalide.")
    return clair[:16].hex(), clair[16:]
