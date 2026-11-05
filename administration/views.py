"""
API du site d'administration (client-admin) — socle : connexion en deux
étapes et profil de l'administrateur connecté. Les écrans (boutiques,
paiements, administrateurs…) s'appuient sur les permissions de permissions.py.
"""
from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .droits import DROITS, RESERVE_SUPERUSER
from .permissions import EstAdmin
from .services import (
    ErreurConnexionAdmin,
    demarrer_connexion,
    droits_de,
    emettre_jetons,
    journaliser,
    profil_de,
    utilisateur_du_jeton_etape,
    valider_code,
)

REFUS = "Identifiant ou mot de passe incorrect."


class ConnexionAdminView(APIView):
    """Étape 1 : identifiant + mot de passe d'un compte administrateur."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "admin_connexion"

    def post(self, request):
        utilisateur = authenticate(
            request,
            username=str(request.data.get("username") or ""),
            password=str(request.data.get("password") or ""),
        )
        if not (utilisateur and utilisateur.is_active and utilisateur.is_staff):
            # Jamais de détail : mauvais mot de passe et compte non-admin se ressemblent.
            return Response({"detail": REFUS}, status=status.HTTP_401_UNAUTHORIZED)
        resultat = demarrer_connexion(utilisateur)
        if resultat["etape"] == "terminee":
            update_last_login(None, utilisateur)
            journaliser(request, utilisateur, "connexion")
        return Response(resultat)


class CodeAdminView(APIView):
    """Étape 2 : code à 6 chiffres de l'appli d'authentification."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "admin_connexion"

    def post(self, request):
        try:
            utilisateur = utilisateur_du_jeton_etape(request.data.get("jeton_etape"))
            premiere_fois = valider_code(utilisateur, request.data.get("code"))
        except ErreurConnexionAdmin as erreur:
            if "utilisateur" in locals():
                journaliser(request, utilisateur, "code_refuse", detail=str(erreur))
            return Response({"detail": str(erreur)}, status=status.HTTP_401_UNAUTHORIZED)
        update_last_login(None, utilisateur)
        if premiere_fois:
            journaliser(request, utilisateur, "double_verification_configuree")
        journaliser(request, utilisateur, "connexion", detail="avec double vérification")
        return Response({"etape": "terminee", **emettre_jetons(utilisateur, verifie_2fa=True)})


class MoiAdminView(APIView):
    """Profil de l'administrateur connecté : de quoi construire son menu."""

    permission_classes = [EstAdmin]

    def get(self, request):
        user = request.user
        profil = profil_de(user)
        mes_droits = droits_de(user)
        catalogue = {**DROITS, **RESERVE_SUPERUSER} if user.is_superuser else DROITS
        return Response({
            "id": user.pk,
            "username": user.username,
            "nom": user.get_full_name(),
            "email": user.email,
            "superuser": user.is_superuser,
            "droits": mes_droits,
            "catalogue_droits": [{"cle": cle, "libelle": libelle} for cle, libelle in catalogue.items()],
            "double_verification_exigee": bool(profil and profil.double_verification_exigee),
            "double_verification_active": bool(profil and profil.totp_actif),
            # Mot de passe provisoire donné par le superuser : à remplacer avant tout le reste.
            "doit_changer_mot_de_passe": bool(user.doit_changer_mot_de_passe),
        })


class DeconnexionAdminView(APIView):
    """Trace la déconnexion (le site oublie lui-même ses jetons)."""

    permission_classes = [EstAdmin]

    def post(self, request):
        journaliser(request, request.user, "deconnexion")
        return Response(status=status.HTTP_204_NO_CONTENT)
