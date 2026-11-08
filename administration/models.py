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


class LaissezPasser(ModeleBase):
    """
    Laissez-passer admin (docs/plan_laissez_passer_admin.md) : code signé qui
    ouvre l'Espace Admin d'un appareil SANS internet (avec le mot de passe de
    l'admin). Le code lui-même n'est jamais gardé ici, seulement de quoi le
    reconnaître (numéro) et décider s'il vaut encore, quand l'appareil revient
    sur internet.
    """

    admin = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.CASCADE, related_name="laissez_passer"
    )
    admin_identifiant = models.CharField(max_length=150)
    # 8 octets aléatoires en hexadécimal, inscrits dans le code.
    numero = models.CharField(max_length=16, unique=True)
    # Vide : illimité.
    date_fin = models.DateField(null=True, blank=True)
    # Mot de passe (haché par Django) au moment de la génération : s'il change,
    # le laissez-passer ne vaut plus (décision du 07/11/2026).
    empreinte_compte = models.CharField(max_length=256)
    revoque = models.BooleanField(default=False)
    date_revocation = models.DateTimeField(null=True, blank=True)
    revoque_par = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    utilisations = models.PositiveIntegerField(default=0)
    derniere_utilisation = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-date_creation"]
        verbose_name = "laissez-passer admin"
        verbose_name_plural = "laissez-passer admin"

    def __str__(self):
        return f"Laissez-passer {self.numero} de {self.admin_identifiant}"

    def etat(self, aujourdhui=None):
        """« actif », « expire », « revoque » ou « mot_de_passe_change » (ou compte désactivé)."""
        from datetime import date

        if self.revoque:
            return "revoque"
        admin = self.admin
        if not (admin.is_active and (admin.is_staff or admin.is_superuser)):
            return "compte_desactive"
        if admin.password != self.empreinte_compte:
            return "mot_de_passe_change"
        if self.date_fin is not None and self.date_fin < (aujourdhui or date.today()):
            return "expire"
        return "actif"


class PreferencesAdmin(ModeleBase):
    """
    Préférences d'affichage d'un administrateur sur le site d'administration
    (client-admin), attachées à son compte pour les retrouver sur tous ses
    appareils. À part de ProfilAdmin exprès : créer un ProfilAdmin vide pour y
    ranger le thème retirerait ses droits à un admin qui n'en a pas (sans profil
    = tous les droits non réservés).
    """

    class Theme(models.TextChoices):
        # Mêmes thèmes que l'appli (client-electron/src/lib/theme.ts).
        CLAIR = "clair", "Clair"
        SOMBRE = "sombre", "Sombre"
        NUIT = "nuit", "Nuit"
        ORANGE = "orange", "Orange"
        VERT = "vert", "Vert"
        BLEU = "bleu", "Bleu"
        GRIS = "gris", "Gris"

    utilisateur = models.OneToOneField(
        "comptes.Utilisateur", on_delete=models.CASCADE, related_name="preferences_admin"
    )
    theme = models.CharField(max_length=10, choices=Theme.choices, default=Theme.CLAIR)

    class Meta:
        verbose_name = "préférences d'administrateur"
        verbose_name_plural = "préférences d'administrateurs"

    def __str__(self):
        return f"Préférences de {self.utilisateur}"
