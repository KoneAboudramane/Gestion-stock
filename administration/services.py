"""
Services de l'espace d'administration : droits, journal, connexion en deux
étapes (mot de passe puis code de l'appli d'authentification).
"""
import time
from datetime import timedelta

from django.apps import apps
from django.core import signing
from django.core.cache import cache

from . import totp
from .droits import DROITS, RESERVE_SUPERUSER

# Une session du site d'administration dure une journée de travail, même si le
# jeton est rafraîchi (borne absolue portée par le jeton, voir permissions.py).
DUREE_SESSION_ADMIN = timedelta(hours=12)
# Le jeton intermédiaire entre le mot de passe et le code ne vaut que 5 minutes.
DUREE_ETAPE_CODE = 300
SEL_ETAPE = "administration.connexion.etape"
# Après 5 codes faux, le compte attend 15 minutes avant de pouvoir réessayer.
ECHECS_MAX_CODE = 5
BLOCAGE_CODE = 15 * 60


class ErreurConnexionAdmin(Exception):
    pass


# --- Droits -------------------------------------------------------------------

def profil_de(utilisateur):
    ProfilAdmin = apps.get_model("administration", "ProfilAdmin")
    return ProfilAdmin.objects.filter(utilisateur=utilisateur).first()


def droits_de(utilisateur):
    """Liste des droits effectifs d'un administrateur (vide si ce n'en est pas un)."""
    if not (utilisateur and utilisateur.is_active and (utilisateur.is_staff or utilisateur.is_superuser)):
        return []
    if utilisateur.is_superuser:
        return list(DROITS) + list(RESERVE_SUPERUSER)
    profil = profil_de(utilisateur)
    if profil is None:
        # Administrateur créé avant les droits : il garde tout ce qu'il avait.
        return list(DROITS)
    return [cle for cle in profil.droits if cle in DROITS]


def a_le_droit(utilisateur, cle):
    return cle in droits_de(utilisateur)


# --- Journal ------------------------------------------------------------------

def adresse_ip(request):
    if request is None:
        return None
    transmise = request.META.get("HTTP_X_FORWARDED_FOR", "")
    ip = transmise.split(",")[0].strip() if transmise else request.META.get("REMOTE_ADDR")
    return ip or None


def journaliser(request, admin, action, boutique=None, detail="", donnees=None, origine="espace_admin"):
    """Ajoute une ligne au journal. Ne fait jamais échouer l'action journalisée."""
    import logging

    JournalAdmin = apps.get_model("administration", "JournalAdmin")
    try:
        return JournalAdmin.objects.create(
            admin=admin if admin is not None and admin.pk else None,
            admin_identifiant=getattr(admin, "username", "") or "?",
            action=action[:60],
            boutique=boutique,
            boutique_nom=boutique.nom if boutique is not None else "",
            detail=(detail or "")[:500],
            donnees=donnees or {},
            origine=origine,
            adresse_ip=adresse_ip(request),
        )
    except Exception:  # pragma: no cover - le journal ne doit jamais bloquer l'admin
        logging.getLogger(__name__).exception("Journal admin : écriture impossible (%s)", action)
        return None


# --- Connexion ----------------------------------------------------------------

def double_verification_exigee(utilisateur):
    profil = profil_de(utilisateur)
    return bool(profil and profil.double_verification_exigee)


def emettre_jetons(utilisateur, verifie_2fa):
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(utilisateur)
    refresh["espace_admin"] = True
    refresh["verifie_2fa"] = bool(verifie_2fa)
    refresh["fin_session_admin"] = int(time.time() + DUREE_SESSION_ADMIN.total_seconds())
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def jeton_etape(utilisateur):
    # L'empreinte du mot de passe lie le jeton au mot de passe actuel.
    return signing.dumps({"u": str(utilisateur.pk), "p": utilisateur.password[-16:]}, salt=SEL_ETAPE)


def utilisateur_du_jeton_etape(jeton):
    Utilisateur = apps.get_model("comptes", "Utilisateur")
    try:
        contenu = signing.loads(jeton or "", salt=SEL_ETAPE, max_age=DUREE_ETAPE_CODE)
    except signing.BadSignature:
        raise ErreurConnexionAdmin("Étape expirée : reconnectez-vous.")
    utilisateur = Utilisateur.objects.filter(pk=contenu.get("u"), is_active=True, is_staff=True).first()
    if utilisateur is None or utilisateur.password[-16:] != contenu.get("p"):
        raise ErreurConnexionAdmin("Étape expirée : reconnectez-vous.")
    return utilisateur


def demarrer_connexion(utilisateur):
    """
    Après un mot de passe correct. Renvoie soit les jetons (pas de double
    vérification), soit l'étape suivante : « code » (appli déjà configurée) ou
    « configuration » (première fois : secret à scanner).
    """
    if not double_verification_exigee(utilisateur):
        return {"etape": "terminee", **emettre_jetons(utilisateur, verifie_2fa=False)}
    profil = profil_de(utilisateur)
    if profil.totp_actif and profil.totp_secret:
        return {"etape": "code", "jeton_etape": jeton_etape(utilisateur)}
    # Nouveau secret à chaque tentative tant que la configuration n'est pas confirmée.
    profil.totp_secret = totp.generer_secret()
    profil.totp_dernier_pas = 0
    profil.save(update_fields=["totp_secret", "totp_dernier_pas", "date_modification"])
    return {
        "etape": "configuration",
        "jeton_etape": jeton_etape(utilisateur),
        "secret": profil.totp_secret,
        "uri": totp.uri_configuration(profil.totp_secret, utilisateur.username),
    }


def _cle_echecs(utilisateur):
    return f"admin_2fa_echecs:{utilisateur.pk}"


def valider_code(utilisateur, code):
    """Vérifie le code ; à la première réussite, la configuration est confirmée."""
    echecs = cache.get(_cle_echecs(utilisateur), 0)
    if echecs >= ECHECS_MAX_CODE:
        raise ErreurConnexionAdmin("Trop de codes faux : réessayez dans 15 minutes.")
    profil = profil_de(utilisateur)
    pas = totp.verifier_code(profil.totp_secret, code, profil.totp_dernier_pas) if profil else None
    if pas is None:
        cache.set(_cle_echecs(utilisateur), echecs + 1, BLOCAGE_CODE)
        raise ErreurConnexionAdmin("Code incorrect.")
    cache.delete(_cle_echecs(utilisateur))
    premiere_fois = not profil.totp_actif
    profil.totp_actif = True
    profil.totp_dernier_pas = pas
    profil.save(update_fields=["totp_actif", "totp_dernier_pas", "date_modification"])
    return premiere_fois
