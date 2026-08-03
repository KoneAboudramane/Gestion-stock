from rest_framework import generics, permissions, serializers, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import Role, Utilisateur
from .serializers import (
    BoutiqueSerializer,
    ConnexionSerializer,
    DemandeReinitialisationSerializer,
    InscriptionSerializer,
    ReinitialisationMotDePasseSerializer,
    RoleSerializer,
    UtilisateurSerializer,
)


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
    """Infos de l'utilisateur connecté : boutique, rôle et permissions."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        return Response(
            {
                "utilisateur": UtilisateurSerializer(user).data,
                "boutique": BoutiqueSerializer(user.boutique).data if user.boutique_id else None,
                "role": RoleSerializer(user.role).data if user.role_id else None,
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

    def perform_destroy(self, instance):
        if instance.role_id and instance.role.nom == "Patron":
            raise serializers.ValidationError({"detail": "Le compte Patron ne peut pas être supprimé."})
        super().perform_destroy(instance)
