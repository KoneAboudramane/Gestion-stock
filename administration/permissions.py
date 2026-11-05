"""
Permissions des API /api/admin/ (site client-admin).

Un jeton ordinaire de l'appli (connexion commerçant) ne suffit pas, même pour
un compte staff : il faut un jeton émis par la connexion du site
d'administration (« espace_admin »), encore dans sa journée de validité, et
passé par la double vérification si elle est exigée pour ce compte — même si
elle a été activée après la connexion.
"""
import time

from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission

from .services import a_le_droit, double_verification_exigee


class EstAdmin(BasePermission):
    message = "Accès réservé aux administrateurs."

    def has_permission(self, request, view):
        user = request.user
        jeton = request.auth
        if not (user and user.is_authenticated and user.is_active and (user.is_staff or user.is_superuser)):
            return False
        if jeton is None or not jeton.get("espace_admin"):
            return False
        if int(jeton.get("fin_session_admin") or 0) < time.time():
            raise AuthenticationFailed("Session terminée : reconnectez-vous.", code="session_admin_terminee")
        if double_verification_exigee(user) and not jeton.get("verifie_2fa"):
            raise AuthenticationFailed(
                "La double vérification est maintenant exigée : reconnectez-vous.", code="double_verification_requise"
            )
        return True


class EstSuperAdmin(EstAdmin):
    message = "Réservé à l'administrateur principal."

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.is_superuser


def a_le_droit_admin(cle):
    """Classe de permission : administrateur connecté au site ET droit `cle` coché."""

    class _ADroit(EstAdmin):
        message = "Vous n'avez pas le droit d'effectuer cette action."

        def has_permission(self, request, view):
            return super().has_permission(request, view) and a_le_droit(request.user, cle)

    _ADroit.__name__ = f"ADroitAdmin_{cle}"
    return _ADroit
