"""
App comptes : boutiques, utilisateurs, rôles et permissions.
La Boutique est l'entité centrale : chaque donnée du projet lui est rattachée,
ce qui isole les commerçants entre eux.
"""
from django.contrib.auth.models import AbstractUser
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

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
    # Date de la dernière sauvegarde faite par le poste principal (docs/plan_reseau_local.md,
    # lot 7) — jamais le contenu, qui reste chiffré sur le Drive de la boutique. Envoyée
    # par l'appli (BoutiqueSauvegardeView), protégée de la synchro (synchronisation/registre.py).
    date_derniere_sauvegarde = models.DateTimeField(null=True, blank=True)
    # Réseau de la boutique (ordinateurs reliés sans internet, docs/plan_reseau_local.md) :
    # activé par l'administrateur à la demande de la boutique (DemandeReseau), désactivé
    # par défaut. Réglé dans l'admin Django ou dans l'Espace Admin de l'appli
    # (AppliquerAbonnementView) ; protégé de la synchro (synchronisation/registre.py).
    reseau_autorise = models.BooleanField(default=False)
    # Carte « 📱 Appli mobile » de Réglages (QR code de téléchargement de l'appli
    # Android) : cachée tant que l'administrateur ne l'active pas, boutique par
    # boutique (site d'administration, fiche boutique). Protégé de la synchro.
    appli_mobile_autorisee = models.BooleanField(default=False)
    # Essai gratuit donné par l'administrateur (Espace Admin → Gérer abonnement →
    # Essai gratuit), gardé À PART de l'abonnement payé (formule /
    # date_expiration_abonnement, jamais touchés) : tant que `essai_fin` n'est pas
    # passée, c'est `essai_formule` qui s'applique ; ensuite la boutique retrouve
    # d'elle-même sa formule et sa date payées. Aucune tâche programmée : le même
    # calcul est fait sur les postes, hors ligne (services/abonnement.ts). Protégés
    # de la synchro (synchronisation/registre.py).
    essai_formule = models.CharField(max_length=20, choices=Formule.choices, blank=True, default="")
    essai_fin = models.DateTimeField(null=True, blank=True)

    # --- Options payantes (formule Essentiel ; comprises dans Pro) ---------------
    # Une option est accessible (droit_option) si : la formule en vigueur est Pro
    # (essai Pro compris), OU elle est payée/offerte jusqu'à option_*_fin, OU elle
    # suit l'abonnement payé (option_*_suit : valable tant que
    # date_expiration_abonnement), OU l'administrateur l'accorde en exception sans
    # date (reseau_autorise, appli_mobile_autorisee, option_en_ligne_offerte —
    # c'est ainsi que les boutiques qui l'avaient avant les options la gardent).
    # L'envoi en ligne demande EN PLUS synchro_autorisee : le droit ne l'allume pas,
    # l'administrateur l'active sur demande du commerçant (certains refusent le cloud).
    # Même calcul sur les appareils, hors ligne (services/abonnement.ts). Protégés de la synchro.
    option_en_ligne_fin = models.DateTimeField(null=True, blank=True)
    option_en_ligne_suit = models.BooleanField(default=False)
    option_en_ligne_offerte = models.BooleanField(default=False)
    option_reseau_fin = models.DateTimeField(null=True, blank=True)
    option_reseau_suit = models.BooleanField(default=False)
    option_mobile_fin = models.DateTimeField(null=True, blank=True)
    option_mobile_suit = models.BooleanField(default=False)

    def __str__(self):
        return self.nom

    def essai_en_cours(self, maintenant=None):
        return bool(self.essai_fin and self.essai_fin > (maintenant or timezone.now()))

    def formule_effective(self, maintenant=None):
        """Formule qui s'applique maintenant : celle de l'essai pendant l'essai, sinon la formule payée."""
        if self.essai_en_cours(maintenant) and self.essai_formule:
            return self.essai_formule
        return self.formule

    def fin_effective(self):
        """
        Fin d'accès qui compte pour le bandeau, le délai de grâce et le blocage :
        la plus lointaine entre l'abonnement payé et l'essai (un essai fini laisse
        ainsi ses 3 jours de grâce). None : sans limite.
        """
        fin = self.date_expiration_abonnement
        if fin is None or self.essai_fin is None:
            return fin
        return max(fin, self.essai_fin)

    OPTIONS = ("en_ligne", "reseau", "mobile")
    # Exception sans date accordée par l'administrateur, pour chaque option.
    EXCEPTION_OPTION = {"en_ligne": "option_en_ligne_offerte", "reseau": "reseau_autorise", "mobile": "appli_mobile_autorisee"}

    def option_payee(self, cle, maintenant=None):
        """Option payée ou offerte encore valable (sa date, ou celle de l'abonnement si elle le suit)."""
        maintenant = maintenant or timezone.now()
        if getattr(self, f"option_{cle}_suit"):
            fin = self.date_expiration_abonnement
            return fin is None or fin > maintenant
        fin = getattr(self, f"option_{cle}_fin")
        return bool(fin and fin > maintenant)

    def droit_option(self, cle, maintenant=None):
        """La boutique a-t-elle droit à l'option ? (Pro, payée, liée à l'abonnement ou exception de l'admin)"""
        return (
            self.formule_effective(maintenant) == self.Formule.PRO
            or getattr(self, self.EXCEPTION_OPTION[cle])
            or self.option_payee(cle, maintenant)
        )

    def droits_options(self, maintenant=None):
        return {cle: self.droit_option(cle, maintenant) for cle in self.OPTIONS}

    def en_ligne_actif(self, maintenant=None):
        """Synchronisation réellement ouverte : allumée par l'admin ET droit à l'option En ligne."""
        return bool(self.synchro_autorisee and self.droit_option("en_ligne", maintenant))


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
    # Abréviation unique dans la boutique, dans les numéros de ses documents
    # (VTE-20261002-AKO-0001) : voir comptes/codes_vendeur.py.
    code_vendeur = models.CharField(max_length=6, blank=True, default="")
    # Mot de passe provisoire donné par l'administrateur (Espace Admin → Réinitialiser
    # mot de passe) : l'utilisateur choisit le sien à sa prochaine connexion.
    doit_changer_mot_de_passe = models.BooleanField(default=False)

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


class PaiementAbonnement(ModeleBase):
    """
    Registre des abonnements d'une boutique : chaque renouvellement, essai ou
    ajustement ajoute une ligne (jamais modifiée ensuite) et
    Boutique.date_expiration_abonnement en reprend la date de fin — voir
    comptes/services.py::enregistrer_periode_abonnement. Ne passe pas par la
    synchro : lu en ligne par le commerçant (comptes/views.py::AbonnementBoutiqueView).
    """

    class Nature(models.TextChoices):
        PAIEMENT = "paiement", "Paiement"
        ESSAI = "essai", "Essai gratuit"
        OFFERT = "offert", "Offert"
        AJUSTEMENT = "ajustement", "Ajustement (correction de date)"

    class Mode(models.TextChoices):
        WAVE = "wave", "Wave"
        ORANGE_MONEY = "orange_money", "Orange Money"
        MTN = "mtn", "MTN Mobile Money"
        MOOV = "moov", "Moov Money"
        ESPECES = "especes", "Espèces"
        BANQUE = "banque", "Banque"
        AUTRE = "autre", "Autre"

    boutique = models.ForeignKey(Boutique, on_delete=models.CASCADE, related_name="paiements_abonnement")
    class Option(models.TextChoices):
        EN_LIGNE = "en_ligne", "Option En ligne"
        RESEAU = "reseau", "Option Réseau"
        MOBILE = "mobile", "Option Mobile"

    nature = models.CharField(max_length=20, choices=Nature.choices, default=Nature.PAIEMENT)
    formule = models.CharField(max_length=20, choices=Boutique.Formule.choices)
    # Vide : la ligne porte sur la formule ; sinon, sur une option payante.
    option = models.CharField(max_length=20, choices=Option.choices, blank=True, default="")
    date_debut = models.DateTimeField()
    # NULL : sans limite (abonnement illimité).
    date_fin = models.DateTimeField(null=True, blank=True)
    montant = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    mode = models.CharField(max_length=20, choices=Mode.choices, blank=True)
    reference = models.CharField(max_length=100, blank=True)
    note = models.CharField(max_length=255, blank=True)
    enregistre_par = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["-date_creation"]

    def __str__(self):
        return f"{self.boutique.nom} · {self.get_nature_display()} · {self.montant}"


class SignalementAbonnement(ModeleBase):
    """
    Anomalie reçue par la synchro : vente datée après la fin du délai de grâce,
    dépôt au-delà de la formule… La donnée est acceptée (jamais de perte),
    seulement signalée à l'administrateur — l'appli bloque déjà ces cas, ils
    ne peuvent venir que d'un poste modifié. Voir synchronisation/services.py.
    """

    class Type(models.TextChoices):
        VENTE_HORS_ABONNEMENT = "vente_hors_abonnement", "Vente après la fin de l'abonnement"
        DEPOT_HORS_FORMULE = "depot_hors_formule", "Dépôt au-delà de la formule"

    boutique = models.ForeignKey(Boutique, on_delete=models.CASCADE, related_name="signalements_abonnement")
    type = models.CharField(max_length=30, choices=Type.choices)
    table = models.CharField(max_length=60)
    enregistrement_id = models.UUIDField()
    detail = models.CharField(max_length=255, blank=True)
    traite = models.BooleanField(default=False)

    class Meta:
        ordering = ["-date_creation"]

    def __str__(self):
        return f"{self.boutique.nom} · {self.get_type_display()}"


class ReglagesPlateforme(ModeleBase):
    """
    Réglages de l'éditeur (une seule ligne, modifiable dans l'admin Django) :
    où le commerçant paie son abonnement. Affichés dans la carte « Abonnement »
    de l'appli (comptes/views.py::AbonnementBoutiqueView).
    """

    numero_wave = models.CharField(max_length=30, blank=True)
    numero_orange_money = models.CharField(max_length=30, blank=True)
    numero_mtn = models.CharField(max_length=30, blank=True)
    numero_moov = models.CharField(max_length=30, blank=True)
    # Numéro international sans « + » ni espaces, ex. 22507000000 (lien wa.me).
    whatsapp = models.CharField(max_length=30, blank=True)
    instructions = models.TextField(
        blank=True,
        help_text="Texte affiché au commerçant, ex. « Envoyez le montant puis la référence par WhatsApp ».",
    )

    # Tarifs (vides : pas affichés dans l'appli). Prix d'une durée = prix mensuel × mois − remise.
    prix_mensuel_essentiel = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    prix_mensuel_pro = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # Options payantes de la formule Essentiel (comprises dans Pro), mêmes remises par durée.
    prix_mensuel_option_en_ligne = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    prix_mensuel_option_reseau = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    prix_mensuel_option_mobile = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    remise_3_mois = models.DecimalField(
        "remise sur 3 mois (%)", max_digits=5, decimal_places=2, default=0,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    remise_6_mois = models.DecimalField(
        "remise sur 6 mois (%)", max_digits=5, decimal_places=2, default=0,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    remise_12_mois = models.DecimalField(
        "remise sur 12 mois (%)", max_digits=5, decimal_places=2, default=0,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )

    class Meta:
        verbose_name = "Réglages de la plateforme"
        verbose_name_plural = "Réglages de la plateforme"

    def __str__(self):
        return "Réglages de la plateforme"

    @classmethod
    def obtenir(cls):
        reglages = cls.objects.first()
        return reglages if reglages is not None else cls.objects.create()


class DemandeRenouvellement(ModeleBase):
    """
    Paiement déclaré par le commerçant depuis l'appli (fenêtre « Abonnement ») :
    il a envoyé l'argent par Mobile Money et saisit la référence de la
    transaction. L'administrateur vérifie et valide en un clic — la période est
    alors inscrite au registre (comptes/services.py::valider_demande_renouvellement).
    """

    class Statut(models.TextChoices):
        EN_ATTENTE = "en_attente", "En attente"
        VALIDEE = "validee", "Validée"
        REJETEE = "rejetee", "Rejetée"

    class Duree(models.IntegerChoices):
        UN_MOIS = 1, "1 mois"
        TROIS_MOIS = 3, "3 mois"
        SIX_MOIS = 6, "6 mois"
        UN_AN = 12, "12 mois"

    boutique = models.ForeignKey(Boutique, on_delete=models.CASCADE, related_name="demandes_renouvellement")
    formule = models.CharField(max_length=20, choices=Boutique.Formule.choices)
    duree_mois = models.PositiveSmallIntegerField(choices=Duree.choices)
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    mode = models.CharField(max_length=20, choices=PaiementAbonnement.Mode.choices)
    reference = models.CharField(max_length=100)
    note = models.CharField(max_length=255, blank=True)
    demandeur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    statut = models.CharField(max_length=20, choices=Statut.choices, default=Statut.EN_ATTENTE)
    motif_rejet = models.CharField(max_length=255, blank=True)
    traitee_par = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    date_traitement = models.DateTimeField(null=True, blank=True)
    paiement = models.ForeignKey(PaiementAbonnement, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        ordering = ["-date_creation"]

    def __str__(self):
        return f"{self.boutique.nom} · {self.montant} ({self.get_statut_display()})"


class DemandeReseau(ModeleBase):
    """
    Demande d'activation du réseau de la boutique, envoyée par le responsable
    depuis l'appli (Réseau de la boutique → « Demander l'activation »).
    L'administrateur l'accepte en un clic (Boutique.reseau_autorise) ou la refuse.
    """

    class Statut(models.TextChoices):
        EN_ATTENTE = "en_attente", "En attente"
        ACCEPTEE = "acceptee", "Acceptée"
        REFUSEE = "refusee", "Refusée"

    boutique = models.ForeignKey(Boutique, on_delete=models.CASCADE, related_name="demandes_reseau")
    demandeur = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    note = models.CharField(max_length=255, blank=True)
    statut = models.CharField(max_length=20, choices=Statut.choices, default=Statut.EN_ATTENTE)
    traitee_par = models.ForeignKey(
        "comptes.Utilisateur", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    date_traitement = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-date_creation"]
        verbose_name = "demande d'activation du réseau"
        verbose_name_plural = "demandes d'activation du réseau"

    def __str__(self):
        return f"{self.boutique.nom} · réseau ({self.get_statut_display()})"
