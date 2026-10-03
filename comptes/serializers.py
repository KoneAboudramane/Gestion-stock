from decimal import Decimal

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from stock.models import Depot

from .codes_vendeur import FORMAT_CODE_VENDEUR
from .models import Boutique, DemandeInscription, DemandeRenouvellement, PaiementAbonnement, Role, Utilisateur
from .services import (
    attribuer_code_vendeur,
    demande_en_attente_existe,
    demander_inscription,
    demander_reinitialisation_mot_de_passe,
    reinitialiser_mot_de_passe,
)


class EnregistrementBoutiqueLocaleSerializer(serializers.Serializer):
    """
    "Activer en ligne" une boutique créée hors-ligne depuis l'Espace Admin
    (voir EnregistrerBoutiqueLocaleView) : la boutique existe déjà en local
    (SQLite/IndexedDB) avec un UUID choisi côté client — on le réutilise tel
    quel ici (au lieu d'en générer un nouveau côté serveur) pour que les
    données déjà créées localement (ventes, stock...) restent cohérentes avec
    la boutique une fois synchronisées.
    """

    username = serializers.CharField()
    password = serializers.CharField()
    boutique_id = serializers.UUIDField()
    boutique_nom = serializers.CharField()
    boutique_adresse = serializers.CharField(required=False, allow_blank=True)
    boutique_telephone = serializers.CharField(required=False, allow_blank=True)
    boutique_email = serializers.CharField(required=False, allow_blank=True)
    boutique_devise = serializers.CharField(required=False, allow_blank=True)
    patron_username = serializers.CharField()
    patron_password = serializers.CharField(validators=[validate_password])
    patron_email = serializers.EmailField()
    patron_telephone = serializers.CharField(required=False, allow_blank=True)


class BoutiqueSerializer(serializers.ModelSerializer):
    class Meta:
        model = Boutique
        fields = [
            "id", "nom", "adresse", "telephone", "email", "logo",
            "devise", "actif", "date_expiration_abonnement", "formule",
            "synchro_autorisee", "date_creation",
        ]
        read_only_fields = [
            "id", "actif", "date_expiration_abonnement", "formule",
            "synchro_autorisee", "date_creation",
        ]


class AppliquerAbonnementSerializer(serializers.Serializer):
    """
    Utilisée par AppliquerAbonnementView (voir comptes/views.py) : verrou
    "Gérer abonnement" de l'Espace Admin, qui écrit directement sur les champs
    protégés de Boutique (formule, date_expiration_abonnement,
    synchro_autorisee — voir synchronisation/registre.py::champs_proteges,
    volontairement hors de portée d'un push client normal). Identifiants admin
    revérifiés ici pour ne jamais faire confiance à une vérification côté
    client faite plus tôt (hors-ligne notamment).
    """

    username = serializers.CharField()
    password = serializers.CharField()
    boutique_id = serializers.UUIDField()
    formule = serializers.ChoiceField(choices=Boutique.Formule.choices, required=False)
    date_expiration_abonnement = serializers.DateTimeField(required=False, allow_null=True)
    synchro_autorisee = serializers.BooleanField(required=False)
    # Inscrits au registre des abonnements (comptes.PaiementAbonnement) avec la nouvelle période.
    nature = serializers.ChoiceField(choices=PaiementAbonnement.Nature.choices, required=False)
    montant = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, min_value=0)
    mode = serializers.ChoiceField(choices=PaiementAbonnement.Mode.choices, required=False, allow_blank=True)
    reference = serializers.CharField(max_length=100, required=False, allow_blank=True)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)


class DemandeRenouvellementSerializer(serializers.Serializer):
    """Paiement déclaré par le commerçant (voir comptes/views.py::DemandeRenouvellementView)."""

    formule = serializers.ChoiceField(choices=Boutique.Formule.choices)
    duree_mois = serializers.ChoiceField(choices=DemandeRenouvellement.Duree.choices)
    montant = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("1"))
    mode = serializers.ChoiceField(choices=PaiementAbonnement.Mode.choices)
    reference = serializers.CharField(max_length=100)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate_reference(self, valeur):
        if not valeur.strip():
            raise serializers.ValidationError("Indiquez la référence de la transaction.")
        return valeur.strip()


class ReinitialisationAdminSerializer(serializers.Serializer):
    """
    Réinitialisation directe (sans email/code) du mot de passe d'un Patron,
    depuis l'Espace Admin des clients (voir ReinitialiserMotDePasseAdminView) :
    l'identité de l'exploitant est déjà prouvée par ce verrou (identifiants
    admin), un code par email serait une friction redondante ici.
    """

    username = serializers.CharField()
    password = serializers.CharField()
    username_cible = serializers.CharField()
    nouveau_mot_de_passe = serializers.CharField(validators=[validate_password])


class ListerPatronsSerializer(serializers.Serializer):
    """
    Liste tous les Patrons (toutes boutiques confondues), voir
    ListerPatronsView : "Réinitialiser mot de passe" choisit toujours dans ce
    menu plutôt que de deviner/pré-sélectionner un compte — un admin gère
    potentiellement plusieurs boutiques, jamais évident de savoir laquelle il
    vise sans lui demander.
    """

    username = serializers.CharField()
    password = serializers.CharField()


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["id", "nom", "permissions"]
        read_only_fields = ["id"]

    def validate_nom(self, valeur):
        nom = valeur.strip()
        if not nom:
            raise serializers.ValidationError("Indiquez le nom du rôle.")
        # Le code s'appuie sur le nom « Patron » (mot de passe oublié, rôle
        # non retirable...) : il n'y en a qu'un, et il garde son nom.
        if self.instance is not None and self.instance.nom == "Patron":
            if nom != "Patron":
                raise serializers.ValidationError("Le rôle Patron ne peut pas être renommé.")
            return nom
        if nom.lower() == "patron":
            raise serializers.ValidationError("Le nom « Patron » est réservé.")
        doublons = Role.objects.filter(
            boutique=self.context["request"].user.boutique, supprime=False, nom__iexact=nom
        )
        if self.instance is not None:
            doublons = doublons.exclude(pk=self.instance.pk)
        if doublons.exists():
            raise serializers.ValidationError(f"Un rôle « {nom} » existe déjà.")
        return nom

    def validate_permissions(self, valeur):
        if not isinstance(valeur, dict) or not all(isinstance(v, bool) for v in valeur.values()):
            raise serializers.ValidationError("Permissions invalides.")
        return valeur

    def update(self, instance, validated_data):
        if (
            instance.nom == "Patron"
            and "permissions" in validated_data
            and validated_data["permissions"] != instance.permissions
        ):
            raise serializers.ValidationError(
                {"permissions": "Les permissions du rôle Patron ne peuvent pas être modifiées."}
            )
        return super().update(instance, validated_data)


class UtilisateurSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, validators=[validate_password])

    class Meta:
        model = Utilisateur
        fields = [
            "id", "username", "password", "first_name", "last_name",
            "email", "telephone", "role", "depot", "code_vendeur", "is_active", "date_joined",
        ]
        read_only_fields = ["id", "date_joined"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            self.fields["depot"].queryset = Depot.objects.filter(boutique=request.user.boutique)
            self.fields["role"].queryset = Role.objects.filter(boutique=request.user.boutique, supprime=False)

    def validate_code_vendeur(self, valeur):
        code = valeur.strip().upper()
        if not code:
            # Vide à la création : attribué automatiquement ; vide à la modification : inchangé.
            return self.instance.code_vendeur if self.instance is not None else ""
        if not FORMAT_CODE_VENDEUR.match(code):
            raise serializers.ValidationError("De 1 à 6 lettres ou chiffres, sans espace.")
        request = self.context.get("request")
        boutique_id = self.instance.boutique_id if self.instance is not None else request.user.boutique_id
        doublons = Utilisateur.objects.filter(boutique_id=boutique_id, code_vendeur__iexact=code)
        if self.instance is not None:
            doublons = doublons.exclude(pk=self.instance.pk)
        if doublons.exists():
            raise serializers.ValidationError(f"Le code « {code} » est déjà pris par un autre utilisateur.")
        return code

    def create(self, validated_data):
        mot_de_passe = validated_data.pop("password")
        utilisateur = Utilisateur(**validated_data)
        utilisateur.set_password(mot_de_passe)
        attribuer_code_vendeur(utilisateur)
        utilisateur.save()
        return utilisateur

    def update(self, instance, validated_data):
        nouveau_role = validated_data.get("role")
        if (
            instance.role_id
            and instance.role.nom == "Patron"
            and "role" in validated_data
            and nouveau_role != instance.role
        ):
            raise serializers.ValidationError({"role": "Le rôle Patron ne peut pas être retiré."})

        mot_de_passe = validated_data.pop("password", None)
        if mot_de_passe:
            instance.set_password(mot_de_passe)
        return super().update(instance, validated_data)


class InscriptionSerializer(serializers.Serializer):
    """
    Demande d'inscription publique d'un commerçant : n'ouvre pas de compte
    directement, enregistre une DemandeInscription en attente de validation
    par l'administrateur (voir comptes/services.py::demander_inscription).
    """

    # Boutique
    boutique_nom = serializers.CharField(max_length=200)
    boutique_adresse = serializers.CharField(max_length=255, required=False, allow_blank=True)
    boutique_telephone = serializers.CharField(max_length=30, required=False, allow_blank=True)
    boutique_email = serializers.EmailField(required=False, allow_blank=True)
    boutique_devise = serializers.CharField(max_length=10, required=False, default="FCFA")

    # Utilisateur (futur Patron)
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, validators=[validate_password])
    email = serializers.EmailField()
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    telephone = serializers.CharField(max_length=30, required=False, allow_blank=True)

    formule = serializers.ChoiceField(
        choices=Boutique.Formule.choices, required=False, default=Boutique.Formule.ESSENTIEL
    )

    def validate_username(self, value):
        if Utilisateur.objects.filter(username=value).exists():
            raise serializers.ValidationError("Ce nom d'utilisateur existe déjà.")
        if demande_en_attente_existe(username=value):
            raise serializers.ValidationError("Une demande avec ce nom d'utilisateur est déjà en attente.")
        return value

    def validate_email(self, value):
        # Requis pour permettre au Patron de récupérer son mot de passe par la
        # suite (lui seul n'a personne d'autre pour le réinitialiser).
        if Utilisateur.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Cet email est déjà utilisé par un autre compte.")
        if demande_en_attente_existe(email=value):
            raise serializers.ValidationError("Une demande avec cet email est déjà en attente.")
        return value

    def create(self, validated_data):
        donnees_boutique = {
            "nom": validated_data["boutique_nom"],
            "adresse": validated_data.get("boutique_adresse", ""),
            "telephone": validated_data.get("boutique_telephone", ""),
            "email": validated_data.get("boutique_email", ""),
            "devise": validated_data.get("boutique_devise") or "FCFA",
        }
        donnees_utilisateur = {
            "username": validated_data["username"],
            "password": validated_data["password"],
            "email": validated_data["email"],
            "first_name": validated_data.get("first_name", ""),
            "last_name": validated_data.get("last_name", ""),
            "telephone": validated_data.get("telephone", ""),
        }
        formule = validated_data.get("formule", Boutique.Formule.ESSENTIEL)
        return demander_inscription(donnees_boutique, donnees_utilisateur, formule)


class DemandeReinitialisationSerializer(serializers.Serializer):
    """Étape 1 : demande d'un code de réinitialisation, envoyé par email (Patron uniquement)."""

    email = serializers.EmailField()

    def save(self):
        demander_reinitialisation_mot_de_passe(self.validated_data["email"])


class ReinitialisationMotDePasseSerializer(serializers.Serializer):
    """Étape 2 : code reçu par email + nouveau mot de passe."""

    email = serializers.EmailField()
    code = serializers.CharField()
    nouveau_mot_de_passe = serializers.CharField(validators=[validate_password])

    def save(self):
        reinitialiser_mot_de_passe(
            self.validated_data["email"],
            self.validated_data["code"],
            self.validated_data["nouveau_mot_de_passe"],
        )


class ConnexionSerializer(TokenObtainPairSerializer):
    """Ajoute au token JWT le contexte boutique/rôle/permissions (utile hors-ligne)."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["boutique_id"] = str(user.boutique_id) if user.boutique_id else None
        token["boutique_nom"] = user.boutique.nom if user.boutique_id else None
        token["role"] = user.role.nom if user.role_id else None
        token["permissions"] = user.role.permissions if user.role_id else {}
        token["depot_id"] = str(user.depot_id) if user.depot_id else None
        token["depot_nom"] = user.depot.nom if user.depot_id else None
        token["code_vendeur"] = user.code_vendeur
        token["synchro_autorisee"] = bool(user.boutique.synchro_autorisee) if user.boutique_id else False
        return token
