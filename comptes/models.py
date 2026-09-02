"""
App comptes : boutiques, utilisateurs, rôles et permissions.
La Boutique est l'entité centrale : chaque donnée du projet lui est rattachée,
ce qui isole les commerçants entre eux.
"""
from django.contrib.auth.models import AbstractUser
from django.db import models

from core.models import ModeleBase


class Boutique(ModeleBase):
    """Une boutique (un commerçant). Entité centrale du projet."""

    class Formule(models.TextChoices):
        ESSENTIEL = "essentiel", "Essentiel"
        PRO = "pro", "Pro"

    nom = models.CharField(max_length=200)
    adresse = models.CharField(max_length=255, blank=True)
    telephone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    logo = models.ImageField(upload_to="logos/", null=True, blank=True)
    devise = models.CharField(max_length=10, default="FCFA")
    actif = models.BooleanField(default=True)

    # Abonnement (voir comptes/services.py::approuver_inscription /
    # renouveler_abonnement, et comptes/admin.py pour les écrans dédiés) : date
    # NULL = pas encore configuré / illimité, on n'entrave jamais l'accès faute
    # de donnée. Synchronisée automatiquement vers le SQLite local de chaque
    # poste Electron (Boutique est déjà dans le registre de sync,
    # fields="__all__") pour que la vérification en caisse fonctionne aussi
    # hors-ligne.
    date_expiration_abonnement = models.DateTimeField(null=True, blank=True)
    formule = models.CharField(max_length=20, choices=Formule.choices, default=Formule.ESSENTIEL)

    # Off par défaut : certains commerçants ne veulent pas que leurs données
    # quittent leur poste (méfiance vis-à-vis du cloud — fisc, concurrent...).
    # L'appli reste 100% utilisable en local sans ça (le SQLite du poste est
    # déjà la source de vérité) ; seule la synchro serveur (push/pull, voir
    # synchronisation/views.py) est concernée. Activé uniquement à la main par
    # l'administrateur (espace admin Django), sur demande du commerçant faite
    # hors application (téléphone/WhatsApp) — pas de workflow de demande dans
    # l'appli elle-même.
    synchro_autorisee = models.BooleanField(default=False)

    def __str__(self):
        return self.nom


class Role(ModeleBase):
    """Rôle au sein d'une boutique (Patron, Gérant, Caissier...)."""

    boutique = models.ForeignKey(
        Boutique, on_delete=models.CASCADE, related_name="roles"
    )
    nom = models.CharField(max_length=50)
    # Permissions en JSON, ex. {"voir_benefices": true, "vendre": true}
    permissions = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return f"{self.nom} ({self.boutique.nom})"


class Utilisateur(AbstractUser):
    """
    Utilisateur de l'application. Hérite de AbstractUser (auth Django).
    À déclarer dans settings.py : AUTH_USER_MODEL = "comptes.Utilisateur"
    """

    boutique = models.ForeignKey(
        Boutique, on_delete=models.CASCADE, null=True, blank=True,
        related_name="utilisateurs",
    )
    role = models.ForeignKey(
        Role, on_delete=models.SET_NULL, null=True, blank=True
    )
    # Dépôt assigné : verrouille la Caisse sur ce dépôt pour cet utilisateur
    # (un caissier vend depuis son magasin, le Patron/Gérant depuis l'entrepôt).
    # Nullable : tant qu'aucun dépôt n'est assigné, la Caisse retombe sur un
    # sélecteur libre (compatibilité ascendante pour les comptes existants).
    depot = models.ForeignKey(
        "stock.Depot", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="utilisateurs",
    )
    telephone = models.CharField(max_length=30, blank=True)

    # Réinitialisation de mot de passe (Patron uniquement, voir comptes/services.py) :
    # code court à 5 chiffres envoyé par email, valable un temps limité.
    code_reinitialisation = models.CharField(max_length=5, blank=True, default="")
    code_reinitialisation_expire_le = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.get_full_name() or self.username


class DemandeInscription(ModeleBase):
    """
    Demande d'ouverture d'une nouvelle boutique, en attente de validation par
    l'administrateur (voir comptes/services.py::demander_inscription /
    approuver_inscription). Rien n'est créé dans Boutique/Utilisateur tant que
    le statut n'est pas "approuvee" — usage interne admin uniquement, n'est pas
    synchronisée vers les postes Electron (absente de synchronisation/registre.py).
    """

    class Statut(models.TextChoices):
        EN_ATTENTE = "en_attente", "En attente"
        APPROUVEE = "approuvee", "Approuvée"
        REJETEE = "rejetee", "Rejetée"

    # Boutique demandée
    boutique_nom = models.CharField(max_length=200)
    boutique_adresse = models.CharField(max_length=255, blank=True)
    boutique_telephone = models.CharField(max_length=30, blank=True)
    boutique_email = models.EmailField(blank=True)
    boutique_devise = models.CharField(max_length=10, default="FCFA")

    # Futur compte Patron
    username = models.CharField(max_length=150)
    email = models.EmailField()
    telephone = models.CharField(max_length=30, blank=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    # Hash (django.contrib.auth.hashers.make_password), jamais le mot de passe en clair.
    mot_de_passe_hash = models.CharField(max_length=255)

    formule = models.CharField(max_length=20, choices=Boutique.Formule.choices, default=Boutique.Formule.ESSENTIEL)
    statut = models.CharField(max_length=20, choices=Statut.choices, default=Statut.EN_ATTENTE)

    def __str__(self):
        return f"{self.boutique_nom} ({self.get_statut_display()})"
