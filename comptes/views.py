from django.contrib.auth import authenticate
from rest_framework import generics, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import Boutique, PaiementAbonnement, ReglagesPlateforme, Role, Utilisateur
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
    DemandeRenouvellementSerializer,
    RoleSerializer,
    UtilisateurSerializer,
)
from .services import (
    demander_renouvellement,
    demarrer_essai,
    enregistrer_periode_abonnement,
    grille_tarifs,
    inscrire_boutique,
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

        montant = donnees.get("montant") or 0
        periode_modifiee = (
            "date_expiration_abonnement" in donnees
            and donnees["date_expiration_abonnement"] != boutique.date_expiration_abonnement
        ) or ("formule" in donnees and donnees["formule"] != boutique.formule)
        # Une modification rejouée depuis un poste (déjà appliquée) n'ajoute pas de ligne au registre.
        if periode_modifiee or montant:
            enregistrer_periode_abonnement(
                boutique,
                donnees.get("date_expiration_abonnement", boutique.date_expiration_abonnement),
                donnees.get("formule", boutique.formule),
                nature=donnees.get("nature")
                or (PaiementAbonnement.Nature.PAIEMENT if montant else PaiementAbonnement.Nature.AJUSTEMENT),
                montant=montant,
                mode=donnees.get("mode", ""),
                reference=donnees.get("reference", ""),
                note=donnees.get("note", ""),
                par=utilisateur,
            )
        if "synchro_autorisee" in donnees:
            boutique.synchro_autorisee = donnees["synchro_autorisee"]
            boutique.save(update_fields=["synchro_autorisee"])

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
        demarrer_essai(boutique, par=admin)
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


class AbonnementBoutiqueView(APIView):
    """
    Carte « Abonnement » de l'appli : l'historique des périodes de la boutique
    (comptes.PaiementAbonnement) et où payer le renouvellement
    (comptes.ReglagesPlateforme). Lecture seule, réservée au responsable.
    """

    def get_permissions(self):
        return [EstMembreBoutique(), a_la_permission("gerer_utilisateurs_reglages")()]

    def get(self, request):
        boutique = request.user.boutique
        reglages = ReglagesPlateforme.obtenir()
        return Response({
            "historique": [
                {
                    "date": p.date_creation,
                    "nature": p.nature,
                    "nature_libelle": p.get_nature_display(),
                    "formule": p.formule,
                    "date_debut": p.date_debut,
                    "date_fin": p.date_fin,
                    "montant": p.montant,
                    "mode_libelle": p.get_mode_display() if p.mode else "",
                    "reference": p.reference,
                }
                for p in boutique.paiements_abonnement.filter(supprime=False)
            ],
            "demandes": [
                {
                    "date": d.date_creation,
                    "formule": d.formule,
                    "duree_libelle": d.get_duree_mois_display(),
                    "montant": d.montant,
                    "mode_libelle": d.get_mode_display(),
                    "reference": d.reference,
                    "statut": d.statut,
                    "statut_libelle": d.get_statut_display(),
                    "motif_rejet": d.motif_rejet,
                }
                for d in boutique.demandes_renouvellement.filter(supprime=False)[:10]
            ],
            "tarifs": grille_tarifs(),
            "renouvellement": {
                "numeros": [
                    {"operateur": libelle, "numero": numero}
                    for libelle, numero in (
                        ("Wave", reglages.numero_wave),
                        ("Orange Money", reglages.numero_orange_money),
                        ("MTN Mobile Money", reglages.numero_mtn),
                        ("Moov Money", reglages.numero_moov),
                    )
                    if numero
                ],
                "whatsapp": reglages.whatsapp,
                "instructions": reglages.instructions,
            },
        })


class DemandeRenouvellementView(APIView):
    """« J'ai payé » : le commerçant déclare son paiement Mobile Money, l'admin le valide ensuite."""

    def get_permissions(self):
        return [EstMembreBoutique(), a_la_permission("gerer_utilisateurs_reglages")()]

    def post(self, request):
        serializer = DemandeRenouvellementSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        demande = demander_renouvellement(request.user.boutique, request.user, **serializer.validated_data)
        return Response({"id": str(demande.id), "statut": demande.statut}, status=status.HTTP_201_CREATED)


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
                "code_vendeur": user.code_vendeur,
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

    def perform_destroy(self, instance):
        if instance.nom == "Patron":
            raise serializers.ValidationError({"detail": "Le rôle Patron ne peut pas être supprimé."})
        nombre = Utilisateur.objects.filter(role=instance).count()
        if nombre:
            raise serializers.ValidationError(
                {
                    "detail": (
                        f"{nombre} utilisateur{'s ont' if nombre > 1 else ' a'} ce rôle : "
                        "changez-leur de rôle avant de le supprimer."
                    )
                }
            )
        super().perform_destroy(instance)


class UtilisateurViewSet(FiltreBoutiqueMixin, viewsets.ModelViewSet):
    serializer_class = UtilisateurSerializer
    queryset = Utilisateur.objects.all()
    permission_classes = [EstMembreBoutique, a_la_permission("gerer_utilisateurs_reglages")]

    def get_permissions(self):
        # L'annuaire (noms seulement) est lisible par tout membre de la boutique :
        # il sert à afficher « Fait par » dans les historiques des clients.
        if self.action == "annuaire":
            return [EstMembreBoutique()]
        return super().get_permissions()

    @action(detail=False, methods=["get"])
    def annuaire(self, request):
        """Identifiant + nom affichable de chaque compte de la boutique, rien d'autre
        (pas d'e-mail, de téléphone ni de rôle)."""
        return Response([
            {"id": u.id, "nom": u.get_full_name() or u.username}
            for u in self.get_queryset().order_by("username")
        ])

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

    def perform_update(self, serializer):
        # Passage de Pro à Essentiel : rien n'est supprimé, mais un compte en
        # pause ne se réactive pas au-delà de la limite (le Patron choisit lesquels garder).
        boutique = self.request.user.boutique
        if (
            serializer.validated_data.get("is_active")
            and not serializer.instance.is_active
            and boutique.formule == Boutique.Formule.ESSENTIEL
            and Utilisateur.objects.filter(boutique=boutique, is_active=True).count()
            >= self.LIMITE_UTILISATEURS_ESSENTIEL
        ):
            raise serializers.ValidationError(
                {
                    "detail": (
                        "La formule Essentiel est limitée à 2 comptes actifs (le Patron + 1). "
                        "Mettez d'abord un autre compte en pause, ou passez à la formule Pro."
                    )
                }
            )
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        if instance.role_id and instance.role.nom == "Patron":
            raise serializers.ValidationError({"detail": "Le compte Patron ne peut pas être supprimé."})
        super().perform_destroy(instance)
