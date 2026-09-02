"""
Permissions et mixins génériques d'isolation multi-boutique.
Réutilisés par toutes les apps (catalogue, stock, ventes...) : toute requête
doit être filtrée par la boutique de l'utilisateur connecté (règle 4 de CLAUDE.md).
"""
from rest_framework.permissions import BasePermission


class EstMembreBoutique(BasePermission):
    """Autorise uniquement les utilisateurs authentifiés rattachés à une boutique."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.boutique_id
        )


class SynchroAutorisee(BasePermission):
    """
    Réserve la synchro serveur (push/pull, voir synchronisation/views.py) aux
    boutiques explicitement activées par l'administrateur (comptes.Boutique.
    synchro_autorisee) — certains commerçants ne veulent pas que leurs données
    quittent leur poste. Le reste de l'appli fonctionne sans cette permission
    (SQLite local = source de vérité).
    """

    message = "La synchronisation n'est pas encore activée pour cette boutique."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.boutique_id
            and request.user.boutique.synchro_autorisee
        )


def a_la_permission(cle):
    """
    Fabrique une classe de permission DRF qui vérifie une clé dans
    `Role.permissions` (ex. "gerer_utilisateurs_reglages").
    """

    class _APermissionRole(BasePermission):
        message = f"Votre rôle ne permet pas : {cle}."

        def has_permission(self, request, view):
            user = request.user
            if not (user and user.is_authenticated and user.role_id):
                return False
            return bool(user.role.permissions.get(cle, False))

    _APermissionRole.__name__ = f"ALaPermission_{cle}"
    return _APermissionRole


class FiltreBoutiqueMixin:
    """
    Mixin de ViewSet : restreint le queryset à la boutique de l'utilisateur
    courant et l'assigne automatiquement à la création.

    `chemin_boutique` permet de gérer les modèles où la boutique n'est pas une
    FK directe (ex. "produit__boutique" pour Variante). Dans ce cas,
    l'assignation automatique n'a pas de sens : la validation d'appartenance à
    la boutique se fait alors dans le serializer (queryset des FK restreint).
    """

    chemin_boutique = "boutique"

    def _modele_a_soft_delete(self, model):
        # comptes.Utilisateur hérite d'AbstractUser (pas de ModeleBase, CLAUDE.md
        # règle 1) : pas de champ `supprime`, donc pas de soft delete pour lui.
        return any(champ.name == "supprime" for champ in model._meta.get_fields())

    def get_queryset(self):
        queryset = super().get_queryset().filter(**{self.chemin_boutique: self.request.user.boutique})
        if self._modele_a_soft_delete(queryset.model):
            queryset = queryset.filter(supprime=False)
        return queryset

    def perform_create(self, serializer):
        if self.chemin_boutique == "boutique":
            serializer.save(boutique=self.request.user.boutique)
        else:
            serializer.save()

    def perform_destroy(self, instance):
        # Suppression douce (CLAUDE.md/cahier des charges §9.3) : la synchro
        # propage les suppressions via `supprime`, jamais un DELETE SQL réel.
        if self._modele_a_soft_delete(type(instance)):
            instance.supprime = True
            instance.save(update_fields=["supprime", "date_modification"])
        else:
            instance.delete()
