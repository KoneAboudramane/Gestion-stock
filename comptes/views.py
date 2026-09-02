from django.contrib.auth import authenticate
from rest_framework import generics, permissions, serializers, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import Boutique, Role, Utilisateur
from .serializers import (
    AppliquerAbonnementSerializer,
    BoutiqueSerializer,
    ConnexionSerializer,
    DemandeReinitialisationSerializer,
    EnregistrementBoutiqueLocaleSerializer,
    InscriptionSerializer,
    ListerPatronsSerializer,
    ReinitialisationAdminSerializer,
    ReinitialisationMotDePasseSerializer,
    RoleSerializer,
    UtilisateurSerializer,
)
from .services import inscrire_boutique


class InscriptionView(APIView):
    """
    Demande d'inscription publique d'un commerçant : n'ouvre pas de compte
    directement, enregistre une demande en attente de validation par
    l'administrateur (voir comptes/services.py::demander_inscription).
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = InscriptionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            {"detail": "Votre demande a été envoyée. Vous serez contacté(e) après validation."},
            status=status.HTTP_202_ACCEPTED,
        )


class ConnexionView(TokenObtainPairView):
    serializer_class = ConnexionSerializer
    permission_classes = [permissions.AllowAny]


class VerifierAccesAdminView(APIView):
    """
    Vérifie que des identifiants correspondent à un compte administrateur
    (is_staff), sans ouvrir de session ni renvoyer de jeton — utilisée par le
    point d'accès caché "Créer une boutique" des clients (voir Connexion.tsx),
    réservé à l'exploitant de la plateforme, pas aux commerçants qui se
    connectent normalement. Réponse toujours {"autorise": bool}, jamais de
    détail sur la raison d'un refus (mauvais mot de passe vs. compte non-admin).
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        utilisateur = authenticate(
            request, username=request.data.get("username", ""), password=request.data.get("password", "")
        )
        autorise = bool(utilisateur and utilisateur.is_active and utilisateur.is_staff)
        return Response({"autorise": autorise})


class VerifierSessionAdminView(APIView):
    """
    Détecte une révocation d'accès admin (compte désactivé ou retiré du
    staff) pendant qu'un poste était hors-ligne : les clients gardent un
    jeton obtenu à la dernière vérification en ligne réussie de l'Espace
    Admin (voir electron/services/auth.ts::verifierRevocationAdmin) et
    l'utilisent ici dès qu'une connexion revient. `IsAuthenticated` suffit à
    lui seul à détecter un compte désactivé : JWTAuthentication vérifie
    `is_active` à chaque requête et refuse (401) si ce n'est plus le cas —
    inutile de le revérifier nous-mêmes ici.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({"autorise": bool(request.user.is_staff)})


class AppliquerAbonnementView(APIView):
    """
    Carte "Gérer abonnement" de l'Espace Admin (voir client Electron/web,
    AccesCreationBoutique.tsx) : écrit directement formule / date d'expiration
    / synchro_autorisee sur une Boutique, en contournant volontairement le
    push de synchro générique (ces champs sont protégés, voir
    synchronisation/registre.py::champs_proteges). Utilisée aussi bien pour une
    action faite en ligne que pour rejouer une modification faite hors-ligne
    sur le poste desktop — dans les deux cas les identifiants admin sont
    revérifiés ici, jamais fait confiance à une vérification client antérieure.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = AppliquerAbonnementSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        donnees = serializer.validated_data

        utilisateur = authenticate(request, username=donnees["username"], password=donnees["password"])
        if not (utilisateur and utilisateur.is_active and utilisateur.is_staff):
            return Response({"detail": "Accès refusé."}, status=status.HTTP_403_FORBIDDEN)

        try:
            boutique = Boutique.objects.get(id=donnees["boutique_id"])
        except Boutique.DoesNotExist:
            return Response({"detail": "Boutique introuvable."}, status=status.HTTP_404_NOT_FOUND)

        for champ in ("formule", "date_expiration_abonnement", "synchro_autorisee"):
            if champ in donnees:
                setattr(boutique, champ, donnees[champ])
        boutique.save(update_fields=[c for c in ("formule", "date_expiration_abonnement", "synchro_autorisee") if c in donnees])

        return Response(BoutiqueSerializer(boutique).data)


class ListerPatronsView(APIView):
    """
    "Réinitialiser mot de passe" (voir client, ReinitialiserMotDePasseAdmin.tsx) :
    l'admin choisit toujours dans ce menu, jamais de pré-sélection devinée —
    un admin gère potentiellement plusieurs boutiques, jamais évident de
    savoir laquelle il vise sans lui demander.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = ListerPatronsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        donnees = serializer.validated_data

        admin = authenticate(request, username=donnees["username"], password=donnees["password"])
        if not (admin and admin.is_active and admin.is_staff):
            return Response({"detail": "Accès refusé."}, status=status.HTTP_403_FORBIDDEN)

        patrons = (
            Utilisateur.objects.filter(role__nom="Patron", is_active=True)
            .select_related("boutique")
            .order_by("boutique__nom")
        )
        return Response(
            [{"username": p.username, "boutique_nom": p.boutique.nom if p.boutique_id else ""} for p in patrons]
        )


class ReinitialiserMotDePasseAdminView(APIView):
    """
    Carte "Réinitialiser mot de passe" de l'Espace Admin (voir client
    Electron/web, AccesCreationBoutique.tsx) : réinitialise directement le mot
    de passe d'un Patron, sans code ni email — l'identité de l'exploitant est
    déjà prouvée par ce verrou (identifiants admin, revérifiés ici, jamais fait
    confiance à une vérification client antérieure faite hors-ligne).
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = ReinitialisationAdminSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        donnees = serializer.validated_data

        admin = authenticate(request, username=donnees["username"], password=donnees["password"])
        if not (admin and admin.is_active and admin.is_staff):
            return Response({"detail": "Accès refusé."}, status=status.HTTP_403_FORBIDDEN)

        cible = Utilisateur.objects.filter(
            username=donnees["username_cible"], role__nom="Patron", is_active=True
        ).first()
        if not cible:
            return Response({"detail": "Compte Patron introuvable."}, status=status.HTTP_404_NOT_FOUND)

        cible.set_password(donnees["nouveau_mot_de_passe"])
        cible.code_reinitialisation = ""
        cible.code_reinitialisation_expire_le = None
        cible.save(update_fields=["password", "code_reinitialisation", "code_reinitialisation_expire_le"])
        return Response({"detail": "Mot de passe réinitialisé."})


class EnregistrerBoutiqueLocaleView(APIView):
    """
    "Activer en ligne" une boutique créée hors-ligne (voir client, Espace
    Admin > "Créer une boutique" puis Réglages > Synchronisation) : enregistre
    pour de vrai, côté serveur, une boutique + son Patron qui n'existaient
    jusqu'ici qu'en local sur le poste — avec le même id (UUID) que celui déjà
    utilisé localement, pour que les données déjà créées (ventes, stock...)
    restent cohérentes une fois synchronisées. Identifiants admin revérifiés
    ici, jamais fait confiance à une vérification client antérieure.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = EnregistrementBoutiqueLocaleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        donnees = serializer.validated_data

        admin = authenticate(request, username=donnees["username"], password=donnees["password"])
        if not (admin and admin.is_active and admin.is_staff):
            return Response({"detail": "Accès refusé."}, status=status.HTTP_403_FORBIDDEN)

        if Boutique.objects.filter(id=donnees["boutique_id"]).exists():
            return Response({"detail": "Cette boutique est déjà enregistrée."}, status=status.HTTP_409_CONFLICT)
        if Utilisateur.objects.filter(username=donnees["patron_username"]).exists():
            return Response({"detail": "Ce nom d'utilisateur est déjà pris."}, status=status.HTTP_409_CONFLICT)

        boutique, utilisateur = inscrire_boutique(
            {
                "id": donnees["boutique_id"],
                "nom": donnees["boutique_nom"],
                "adresse": donnees.get("boutique_adresse", ""),
                "telephone": donnees.get("boutique_telephone", ""),
                "email": donnees.get("boutique_email", ""),
                "devise": donnees.get("boutique_devise") or "FCFA",
            },
            {
                "username": donnees["patron_username"],
                "password": donnees["patron_password"],
                "email": donnees["patron_email"],
                "telephone": donnees.get("patron_telephone", ""),
            },
        )
        return Response({"boutique_id": str(boutique.id), "utilisateur_id": utilisateur.id})


class DemandeReinitialisationView(APIView):
    """Étape 1 : envoie un code par email si un Patron actif porte cet email (réponse toujours générique)."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = DemandeReinitialisationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Si un compte existe avec cet email, un code de réinitialisation a été envoyé."})


class ReinitialisationMotDePasseView(APIView):
    """Étape 2 : code reçu par email + nouveau mot de passe."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = ReinitialisationMotDePasseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Mot de passe réinitialisé."})


class MoiView(APIView):
    """
    Infos à jour de l'utilisateur connecté : boutique, rôle, permissions et
    dépôt. Appelée par les clients à chaque démarrage pour rafraîchir la
    session en cache (voir auth.rafraichirPermissions côté client) sans
    obliger l'utilisateur à se déconnecter/reconnecter quand son rôle ou son
    dépôt change — même forme que ConnexionSerializer.get_token.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        return Response(
            {
                "utilisateur": UtilisateurSerializer(user).data,
                "boutique": BoutiqueSerializer(user.boutique).data if user.boutique_id else None,
                "role": RoleSerializer(user.role).data if user.role_id else None,
                "depot_id": str(user.depot_id) if user.depot_id else None,
                "depot_nom": user.depot.nom if user.depot_id else None,
            }
        )


class BoutiqueDetailView(generics.RetrieveUpdateAPIView):
    """Une seule boutique par utilisateur : pas de liste, seulement la sienne."""

    serializer_class = BoutiqueSerializer

    def get_permissions(self):
        if self.request.method in permissions.SAFE_METHODS:
            return [EstMembreBoutique()]
        return [EstMembreBoutique(), a_la_permission("gerer_utilisateurs_reglages")()]

    def get_object(self):
        return self.request.user.boutique


class RoleViewSet(FiltreBoutiqueMixin, viewsets.ModelViewSet):
    serializer_class = RoleSerializer
    queryset = Role.objects.all()

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [EstMembreBoutique()]
        return [EstMembreBoutique(), a_la_permission("gerer_utilisateurs_reglages")()]


class UtilisateurViewSet(FiltreBoutiqueMixin, viewsets.ModelViewSet):
    serializer_class = UtilisateurSerializer
    queryset = Utilisateur.objects.all()
    permission_classes = [EstMembreBoutique, a_la_permission("gerer_utilisateurs_reglages")]

    # Formule Essentiel/Pro (voir Boutique.Formule) : Essentiel plafonne à 2
    # comptes (le Patron + 1). Pas de plafond en Pro.
    LIMITE_UTILISATEURS_ESSENTIEL = 2

    def perform_create(self, serializer):
        boutique = self.request.user.boutique
        if (
            boutique.formule == Boutique.Formule.ESSENTIEL
            and Utilisateur.objects.filter(boutique=boutique, is_active=True).count()
            >= self.LIMITE_UTILISATEURS_ESSENTIEL
        ):
            raise serializers.ValidationError(
                {
                    "detail": (
                        "La formule Essentiel est limitée à 2 utilisateurs (le Patron + 1). "
                        "Passez à la formule Pro pour en ajouter d'autres."
                    )
                }
            )
        super().perform_create(serializer)

    def perform_destroy(self, instance):
        if instance.role_id and instance.role.nom == "Patron":
            raise serializers.ValidationError({"detail": "Le compte Patron ne peut pas être supprimé."})
        super().perform_destroy(instance)
