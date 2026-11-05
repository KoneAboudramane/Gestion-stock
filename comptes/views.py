from django.utils import timezone
import base64
from django.contrib.auth import authenticate
from rest_framework import generics, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import Boutique, DemandeReseau, PaiementAbonnement, ReglagesPlateforme, Role, Utilisateur
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
    accepter_demandes_reseau,
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


def _refus_droit(admin, droit):
    """
    API de l'Espace Admin du bureau : les droits cochés par le superuser
    (administration/droits.py) s'y appliquent comme sur le site d'administration.
    None si l'admin a le droit, sinon la réponse 403.
    """
    from administration.services import a_le_droit

    if a_le_droit(admin, droit):
        return None
    return Response(
        {"detail": "Votre compte administrateur n'a pas le droit d'effectuer cette action."},
        status=status.HTTP_403_FORBIDDEN,
    )


def _journal_bureau(request, admin, action, boutique=None, detail="", donnees=None):
    from administration.services import journaliser

    journaliser(request, admin, action, boutique=boutique, detail=detail, donnees=donnees, origine="bureau")


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


class AdminAbonnementBoutiqueView(APIView):
    """
    Espace Admin → Gérer abonnement : état complet d'une boutique (abonnement,
    historique, paiements déclarés, tarifs), validation / rejet d'un paiement
    déclaré, code d'activation hors ligne. Identifiants administrateur
    revérifiés à chaque appel. Les changements de période passent par
    AppliquerAbonnementView (qui sait rejouer une modification faite hors ligne).
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        from django.core.exceptions import ValidationError as ErreurValidation

        from .models import DemandeRenouvellement
        from .services import rejeter_demande_renouvellement, valider_demande_renouvellement

        utilisateur = authenticate(
            request, username=request.data.get("username", ""), password=request.data.get("password", "")
        )
        if not (utilisateur and utilisateur.is_active and utilisateur.is_staff):
            return Response({"detail": "Accès refusé."}, status=status.HTTP_403_FORBIDDEN)
        if refus := _refus_droit(utilisateur, "paiements"):
            return refus
        boutique = Boutique.objects.filter(id=request.data.get("boutique_id")).first()
        if boutique is None:
            return Response({"detail": "Boutique introuvable."}, status=status.HTTP_404_NOT_FOUND)

        action = request.data.get("action") or "etat"
        code = None
        try:
            if action in ("valider", "rejeter"):
                demande = boutique.demandes_renouvellement.filter(id=request.data.get("demande_id")).first()
                if demande is None:
                    return Response({"detail": "Paiement déclaré introuvable."}, status=status.HTTP_404_NOT_FOUND)
                if action == "valider":
                    valider_demande_renouvellement(demande, par=utilisateur)
                    _journal_bureau(
                        request, utilisateur, "paiement_valide", boutique,
                        f"{demande.montant} · {demande.get_mode_display()} · réf. {demande.reference}",
                    )
                else:
                    motif = str(request.data.get("motif") or "").strip()
                    if not motif:
                        return Response({"detail": "Indiquez le motif du rejet."}, status=status.HTTP_400_BAD_REQUEST)
                    rejeter_demande_renouvellement(demande, motif[:255], par=utilisateur)
                    _journal_bureau(request, utilisateur, "paiement_rejete", boutique, motif)
                boutique.refresh_from_db()
            elif action == "code":
                from .activation import ErreurActivation, generer_code

                if boutique.date_expiration_abonnement is None:
                    return Response(
                        {"detail": "Pas de date de fin d'abonnement : renouvelez d'abord l'abonnement."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                try:
                    code = generer_code(
                        boutique.id, timezone.localdate(boutique.date_expiration_abonnement), boutique.formule
                    )
                except ErreurActivation as erreur:
                    return Response({"detail": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
                _journal_bureau(request, utilisateur, "code_activation", boutique)
        except ErreurValidation as erreur:
            return Response({"detail": " ".join(erreur.messages)}, status=status.HTTP_400_BAD_REQUEST)

        en_attente = boutique.demandes_renouvellement.filter(statut=DemandeRenouvellement.Statut.EN_ATTENTE).count()
        return Response({
            "boutique": BoutiqueSerializer(boutique).data,
            "paiements_en_attente": en_attente,
            **detail_abonnement(boutique),
            "code": code,
        })


class AdminReseauBoutiqueView(APIView):
    """
    Espace Admin → carte « Réseau de la boutique » : état du réseau et demandes
    de la boutique (action « etat »), refus d'une demande (« refuser »).
    L'activation / la désactivation passent par AppliquerAbonnementView
    (reseau_autorise), qui sait aussi rejouer une modification faite hors ligne.
    Identifiants administrateur revérifiés à chaque appel.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        utilisateur = authenticate(
            request, username=request.data.get("username", ""), password=request.data.get("password", "")
        )
        if not (utilisateur and utilisateur.is_active and utilisateur.is_staff):
            return Response({"detail": "Accès refusé."}, status=status.HTTP_403_FORBIDDEN)
        if refus := _refus_droit(utilisateur, "demandes_reseau"):
            return refus
        boutique = Boutique.objects.filter(id=request.data.get("boutique_id")).first()
        if boutique is None:
            return Response({"detail": "Boutique introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if request.data.get("action") == "refuser":
            from django.utils import timezone

            boutique.demandes_reseau.filter(statut=DemandeReseau.Statut.EN_ATTENTE).update(
                statut=DemandeReseau.Statut.REFUSEE, traitee_par=utilisateur, date_traitement=timezone.now()
            )
            _journal_bureau(request, utilisateur, "reseau_refuse", boutique)
        return Response({
            "reseau_autorise": boutique.reseau_autorise,
            "demandes": [
                {
                    "date": d.date_creation,
                    "demandeur": (d.demandeur.get_full_name() or d.demandeur.username) if d.demandeur else "",
                    "note": d.note,
                    "statut": d.statut,
                    "statut_libelle": d.get_statut_display(),
                    "date_traitement": d.date_traitement,
                }
                for d in boutique.demandes_reseau.select_related("demandeur")[:10]
            ],
        })


class SecoursSauvegardeView(APIView):
    """
    Clé de secours des sauvegardes (comptes/secours.py) : l'Espace Admin envoie
    la petite clé chiffrée lue dans une sauvegarde (jamais les données de la
    boutique) avec des identifiants administrateur, et reçoit la clé de la
    sauvegarde. Sert quand le patron a perdu son mot de passe.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        import logging

        from .secours import ErreurSecours, ouvrir_cle_secours

        utilisateur = authenticate(
            request, username=request.data.get("username", ""), password=request.data.get("password", "")
        )
        if not (utilisateur and utilisateur.is_active and utilisateur.is_staff):
            return Response({"detail": "Accès refusé."}, status=status.HTTP_403_FORBIDDEN)
        if refus := _refus_droit(utilisateur, "comptes"):
            return refus
        try:
            boutique_id, cle = ouvrir_cle_secours(str(request.data.get("cle_chiffree", "")))
        except ErreurSecours as erreur:
            return Response({"detail": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
        boutique = Boutique.objects.filter(id=boutique_id).first()
        _journal_bureau(request, utilisateur, "cle_secours_utilisee", boutique, "" if boutique else str(boutique_id))
        logging.getLogger(__name__).warning(
            "Clé de secours utilisée par %s pour la boutique %s", utilisateur.username, boutique or boutique_id
        )
        return Response({
            "cle": base64.b64encode(cle).decode(),
            "boutique_id": str(boutique.id) if boutique else boutique_id,
            "boutique_nom": boutique.nom if boutique else "",
        })


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
        synchro_modifiee = "synchro_autorisee" in donnees and donnees["synchro_autorisee"] != boutique.synchro_autorisee
        reseau_modifie = "reseau_autorise" in donnees and donnees["reseau_autorise"] != boutique.reseau_autorise
        # Tout est vérifié avant d'écrire : pas de modification à moitié faite.
        for besoin, droit in ((periode_modifiee or montant, "paiements"), (synchro_modifiee, "boutiques"),
                              (reseau_modifie, "demandes_reseau")):
            if besoin and (refus := _refus_droit(utilisateur, droit)):
                return refus
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
        if "reseau_autorise" in donnees:
            boutique.reseau_autorise = donnees["reseau_autorise"]
            boutique.save(update_fields=["reseau_autorise"])
            if boutique.reseau_autorise:
                accepter_demandes_reseau(boutique, utilisateur)

        if periode_modifiee or montant:
            boutique.refresh_from_db()
            _journal_bureau(
                request, utilisateur, "abonnement_modifie", boutique,
                f"{boutique.formule} jusqu'au {boutique.date_expiration_abonnement or 'illimité'}"
                + (f" · {montant}" if montant else ""),
            )
        if synchro_modifiee:
            _journal_bureau(request, utilisateur, "synchro_activee" if boutique.synchro_autorisee else "synchro_desactivee", boutique)
        if reseau_modifie:
            _journal_bureau(request, utilisateur, "reseau_active" if boutique.reseau_autorise else "reseau_desactive", boutique)
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
        if refus := _refus_droit(admin, "comptes"):
            return refus

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
        if refus := _refus_droit(admin, "comptes"):
            return refus

        # Tout compte de boutique (patron, gérant, vendeur…), jamais un compte administrateur.
        cible = Utilisateur.objects.filter(
            username=donnees["username_cible"], is_active=True, is_staff=False, is_superuser=False
        ).first()
        if not cible:
            return Response({"detail": "Compte introuvable (ou désactivé)."}, status=status.HTTP_404_NOT_FOUND)

        cible.set_password(donnees["nouveau_mot_de_passe"])
        cible.code_reinitialisation = ""
        cible.code_reinitialisation_expire_le = None
        cible.doit_changer_mot_de_passe = donnees["doit_changer"]
        cible.save(
            update_fields=["password", "code_reinitialisation", "code_reinitialisation_expire_le", "doit_changer_mot_de_passe"]
        )
        _journal_bureau(request, admin, "mot_de_passe_reinitialise", cible.boutique, cible.username)
        return Response({"detail": "Mot de passe réinitialisé.", "doit_changer_mot_de_passe": cible.doit_changer_mot_de_passe})


class ListerComptesView(APIView):
    """
    Espace Admin → Réinitialiser mot de passe : tous les comptes de toutes les
    boutiques (jamais les administrateurs), avec boutique, rôle et dernière
    connexion — l'admin choisit, rien n'est deviné.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        admin = authenticate(request, username=request.data.get("username", ""), password=request.data.get("password", ""))
        if not (admin and admin.is_active and admin.is_staff):
            return Response({"detail": "Accès refusé."}, status=status.HTTP_403_FORBIDDEN)
        if refus := _refus_droit(admin, "comptes"):
            return refus
        comptes = (
            Utilisateur.objects.filter(is_staff=False, is_superuser=False)
            .select_related("boutique", "role")
            .order_by("boutique__nom", "username")
        )
        return Response([
            {
                "username": u.username,
                "nom": u.get_full_name(),
                "boutique_id": str(u.boutique_id) if u.boutique_id else None,
                "boutique_nom": u.boutique.nom if u.boutique_id else "",
                "role": u.role.nom if u.role_id else "",
                "telephone": u.telephone,
                "email": u.email,
                "actif": u.is_active,
                "derniere_connexion": u.last_login,
                "doit_changer_mot_de_passe": u.doit_changer_mot_de_passe,
            }
            for u in comptes
        ])


class ChangerMotDePasseView(APIView):
    """
    L'utilisateur choisit son mot de passe — obligatoire après un mot de passe
    provisoire (doit_changer_mot_de_passe : l'ancien n'est alors pas redemandé,
    il vient de servir à se connecter), sinon avec l'ancien.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as ErreurValidation

        utilisateur = request.user
        nouveau = str(request.data.get("nouveau_mot_de_passe") or "")
        if not utilisateur.doit_changer_mot_de_passe and not utilisateur.check_password(
            str(request.data.get("ancien_mot_de_passe") or "")
        ):
            return Response({"detail": "Mot de passe actuel incorrect."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(nouveau, utilisateur)
        except ErreurValidation as erreur:
            return Response({"detail": " ".join(erreur.messages)}, status=status.HTTP_400_BAD_REQUEST)
        utilisateur.set_password(nouveau)
        utilisateur.doit_changer_mot_de_passe = False
        utilisateur.save(update_fields=["password", "doit_changer_mot_de_passe"])
        return Response({"detail": "Mot de passe changé."})


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
        if refus := _refus_droit(admin, "creer_boutique"):
            return refus

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
                "formule": donnees.get("formule") or Boutique.Formule.ESSENTIEL,
                "synchro_autorisee": donnees["synchro_autorisee"],
                "reseau_autorise": donnees["reseau_autorise"],
            },
            {
                "username": donnees["patron_username"],
                "password": donnees["patron_password"],
                "email": donnees["patron_email"],
                "telephone": donnees.get("patron_telephone", ""),
                "first_name": donnees.get("patron_first_name", ""),
                "last_name": donnees.get("patron_last_name", ""),
                "doit_changer_mot_de_passe": donnees["patron_doit_changer"],
            },
        )
        if donnees.get("date_fin"):
            # Abonnement choisi dans l'assistant (payé ou offert) au lieu de l'essai gratuit.
            enregistrer_periode_abonnement(
                boutique,
                donnees["date_fin"],
                boutique.formule,
                nature=donnees.get("nature") or PaiementAbonnement.Nature.OFFERT,
                montant=donnees.get("montant") or 0,
                mode=donnees.get("mode", ""),
                reference=donnees.get("reference", ""),
                note="Choisi à la création de la boutique",
                par=admin,
            )
        else:
            demarrer_essai(boutique, par=admin)
        _journal_bureau(request, admin, "boutique_creee", boutique, f"patron {utilisateur.username}")
        return Response({"boutique_id": str(boutique.id), "utilisateur_id": utilisateur.id})


class IdentifiantDisponibleView(APIView):
    """Assistant « Créer une boutique » : l'identifiant du patron est-il libre ? (administrateurs seulement)"""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        admin = authenticate(request, username=request.data.get("username", ""), password=request.data.get("password", ""))
        if not (admin and admin.is_active and admin.is_staff):
            return Response({"detail": "Accès refusé."}, status=status.HTTP_403_FORBIDDEN)
        if refus := _refus_droit(admin, "creer_boutique"):
            return refus
        identifiant =str(request.data.get("identifiant") or "").strip()
        return Response({"disponible": bool(identifiant) and not Utilisateur.objects.filter(username__iexact=identifiant).exists()})


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


class BoutiqueSauvegardeView(APIView):
    """Date de la dernière sauvegarde de la boutique (docs/plan_reseau_local.md, lot 7) :
    envoyée par l'appli après chaque sauvegarde réussie, même en mode 100 % local
    (c'est une date, pas une donnée de la boutique). Ne fait jamais reculer la date."""

    permission_classes = [EstMembreBoutique]

    def post(self, request):
        from django.utils import timezone
        from django.utils.dateparse import parse_datetime

        date = parse_datetime(str(request.data.get("date_derniere_sauvegarde") or "")) or timezone.now()
        if timezone.is_naive(date):
            date = timezone.make_aware(date)
        date = min(date, timezone.now())  # une horloge en avance ne fait pas croire à une sauvegarde future
        boutique = request.user.boutique
        if boutique.date_derniere_sauvegarde is None or date > boutique.date_derniere_sauvegarde:
            boutique.date_derniere_sauvegarde = date
            boutique.save(update_fields=["date_derniere_sauvegarde", "date_modification"])
        return Response({"date_derniere_sauvegarde": boutique.date_derniere_sauvegarde})


def detail_abonnement(boutique):
    """Historique, paiements déclarés, tarifs et moyens de paiement d'une boutique
    (carte « Abonnement » de l'appli et Espace Admin → Gérer abonnement)."""
    reglages = ReglagesPlateforme.obtenir()
    return {
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
                "id": str(d.id),
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
    }


class AbonnementBoutiqueView(APIView):
    """
    Carte « Abonnement » de l'appli : l'historique des périodes de la boutique
    (comptes.PaiementAbonnement) et où payer le renouvellement
    (comptes.ReglagesPlateforme). Lecture seule, réservée au responsable.
    """

    def get_permissions(self):
        return [EstMembreBoutique(), a_la_permission("gerer_utilisateurs_reglages")()]

    def get(self, request):
        return Response(detail_abonnement(request.user.boutique))


class DemandeReseauView(APIView):
    """
    Réseau de la boutique : état (activé ou non, demande en cours) et demande
    d'activation par le responsable. Le numéro WhatsApp de l'administrateur est
    renvoyé pour doubler la demande d'un message.
    """

    def get_permissions(self):
        return [EstMembreBoutique(), a_la_permission("gerer_utilisateurs_reglages")()]

    def _etat(self, boutique):
        demande = boutique.demandes_reseau.filter(statut=DemandeReseau.Statut.EN_ATTENTE).first()
        return {
            "reseau_autorise": boutique.reseau_autorise,
            "demande_en_attente": demande.date_creation if demande else None,
            "whatsapp": ReglagesPlateforme.obtenir().whatsapp,
        }

    def get(self, request):
        return Response(self._etat(request.user.boutique))

    def post(self, request):
        boutique = request.user.boutique
        if not boutique.reseau_autorise and not boutique.demandes_reseau.filter(
            statut=DemandeReseau.Statut.EN_ATTENTE
        ).exists():
            DemandeReseau.objects.create(
                boutique=boutique, demandeur=request.user, note=str(request.data.get("note") or "")[:255]
            )
        return Response(self._etat(boutique), status=status.HTTP_201_CREATED)


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
