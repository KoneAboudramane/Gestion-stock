"""
App administration : profils des administrateurs de la plateforme et journal
de leurs actions. Aucune donnée métier des boutiques ici (ventes, stock,
clients restent privés). Absente de la synchronisation (usage serveur seul).
"""
from django.db import models

from core.models import ModeleBase


class ProfilAdmin(ModeleBase):
    """
    Réglages d'un administrateur (compte is_staff). Le superuser a tous les droits ;
    un administrateur sans profil (créé avant les droits) aussi, pour ne rien casser.
    """

    utilisateur = models.OneToOneField(
        "comptes.Utilisateur", on_delete=models.CASCADE, related_name="profil_admin"
    )
    # Clés de administration/droits.py::DROITS, cochées par le superuser.
    droits = models.JSONField(default=list, blank=True)
    # Activée par le superuser, admin par admin (y compris pour lui-même).
    double_verification_exigee = models.BooleanField(default=False)
    # Secret TOTP en base32. Tant que totp_actif est faux, il attend la première
    # saisie d'un code (configuration de l'appli d'authentification).
    totp_secret = models.CharField(max_length=64, blank=True, default="")
    totp_actif = models.BooleanField(default=False)
    # Dernier pas de temps accepté : un code ne sert qu'une fois.
    totp_dernier_pas = models.BigIntegerField(default=0)

    class Meta:
        verbose_name = "profil administrateur"
        verbose_name_plural = "profils administrateurs"

    def __str__(self):
        return f"Profil admin de {self.utilisateur}"


class JournalAdmin(ModeleBase):
    """Trace d'une action d'administrateur. Ajout seul, jamais modifiée."""

    class Origine(models.TextChoices):
        ESPACE_ADMIN = "espace_admin", "Site d'administration"
        BUREAU = "bureau", "Espace Admin de l'appli"

    admin = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Copiés au moment de l'action : la trace reste lisible si le compte ou la boutique disparaît.
    admin_identifiant = models.CharField(max_length=150)
    action = models.CharField(max_length=60)
    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    boutique_nom = models.CharField(max_length=200, blank=True)
    detail = models.CharField(max_length=500, blank=True)
    donnees = models.JSONField(default=dict, blank=True)
    origine = models.CharField(max_length=20, choices=Origine.choices, default=Origine.ESPACE_ADMIN)
    adresse_ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-date_creation"]
        verbose_name = "action d'administrateur"
        verbose_name_plural = "journal des actions"

    def __str__(self):
        return f"{self.admin_identifiant} · {self.action}"
