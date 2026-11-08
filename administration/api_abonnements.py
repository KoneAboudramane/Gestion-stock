"""
API du lot 4 : paiements d'abonnement (déclarés à valider, registre, paiement
reçu hors appli, code d'activation hors ligne), demandes de réseau,
signalements, comptes et mots de passe des boutiques.

Toutes les règles métier restent dans comptes/services.py (les mêmes que
l'admin Django et l'Espace Admin du bureau) ; ce module ne fait qu'exposer,
contrôler les droits et journaliser.
"""
from datetime import timedelta
from decimal import Decimal

from django.apps import apps
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db.models import Count, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .api_boutiques import _date_fin, etat_abonnement
from .permissions import a_le_droit_admin
from .services import journaliser


def _modele(nom):
    return apps.get_model("comptes", nom)


def _services():
    from comptes import services

    return services


def _messages(erreur):
    if hasattr(erreur, "message_dict"):
        return " ".join(m for liste in erreur.message_dict.values() for m in liste)
    return " ".join(erreur.messages)


def _boutique_courte(b):
    return {
        "id": str(b.id),
        "nom": b.nom,
        "formule": b.formule,
        "date_expiration_abonnement": b.date_expiration_abonnement,
        "abonnement": etat_abonnement(b),
    }


# --- Paiements déclarés dans l'appli ---------------------------------------------

def _demande_json(d):
    return {
        "id": str(d.id),
        "date": d.date_creation,
        "boutique": _boutique_courte(d.boutique),
        "demandeur": (d.demandeur.get_full_name() or d.demandeur.username) if d.demandeur else "",
        "formule": d.formule,
        # Option payante déclarée (vide : l'abonnement) ; le libellé l'affiche à la place de la formule.
        "option": d.option,
        "formule_libelle": d.get_option_display() if d.option else d.get_formule_display(),
        "duree_mois": d.duree_mois,
        "duree_libelle": d.get_duree_mois_display(),
        "montant": d.montant,
        "mode": d.mode,
        "mode_libelle": d.get_mode_display(),
        "reference": d.reference,
        "note": d.note,
        "statut": d.statut,
        "statut_libelle": d.get_statut_display(),
        "motif_rejet": d.motif_rejet,
        "traitee_par": d.traitee_par.username if d.traitee_par else "",
        "date_traitement": d.date_traitement,
    }


class PaiementsDeclaresView(APIView):
    permission_classes = [a_le_droit_admin("paiements")]

    def get(self, request):
        statut = request.query_params.get("statut") or "en_attente"
        qs = _modele("DemandeRenouvellement").objects.filter(supprime=False).select_related(
            "boutique", "demandeur", "traitee_par"
        )
        if statut != "tous":
            qs = qs.filter(statut=statut)
        ordre = "date_creation" if statut == "en_attente" else "-date_creation"
        return Response([_demande_json(d) for d in qs.order_by(ordre)[:300]])


class TraiterPaiementDeclareView(APIView):
    """POST {action: "valider"} ou {action: "rejeter", motif}."""

    permission_classes = [a_le_droit_admin("paiements")]

    def post(self, request, pk):
        services = _services()
        demande = _modele("DemandeRenouvellement").objects.filter(pk=pk, supprime=False).select_related("boutique").first()
        if demande is None:
            return Response({"detail": "Paiement déclaré introuvable."}, status=status.HTTP_404_NOT_FOUND)
        action = request.data.get("action")
        try:
            if action == "valider":
                services.valider_demande_renouvellement(demande, par=request.user)
                demande.boutique.refresh_from_db()
                journaliser(
                    request, request.user, "paiement_valide", boutique=demande.boutique,
                    detail=f"{demande.montant} · {demande.get_mode_display()} · réf. {demande.reference} · "
                    f"jusqu'au {timezone.localdate(demande.boutique.date_expiration_abonnement):%d/%m/%Y}",
                )
            elif action == "rejeter":
                motif = str(request.data.get("motif") or "").strip()
                if not motif:
                    return Response({"detail": "Indiquez le motif du rejet (il est montré au commerçant)."},
                                    status=status.HTTP_400_BAD_REQUEST)
                services.rejeter_demande_renouvellement(demande, motif[:255], par=request.user)
                journaliser(request, request.user, "paiement_rejete", boutique=demande.boutique, detail=motif[:255])
            else:
                return Response({"detail": "Action inconnue."}, status=status.HTTP_400_BAD_REQUEST)
        except ValidationError as erreur:
            return Response({"detail": _messages(erreur)}, status=status.HTTP_400_BAD_REQUEST)
        demande.refresh_from_db()
        return Response(_demande_json(demande))


# --- Registre des abonnements ----------------------------------------------------

class RegistreView(APIView):
    """Toutes les lignes du registre (toutes boutiques), filtrables, avec les totaux encaissés."""

    permission_classes = [a_le_droit_admin("paiements")]

    def get(self, request):
        PaiementAbonnement = _modele("PaiementAbonnement")
        qs = PaiementAbonnement.objects.filter(supprime=False).select_related("boutique", "enregistre_par")
        p = request.query_params
        if p.get("boutique"):
            qs = qs.filter(boutique_id=p["boutique"])
        if p.get("nature"):
            qs = qs.filter(nature=p["nature"])
        if du := parse_date(p.get("du") or ""):
            qs = qs.filter(date_creation__date__gte=du)
        if au := parse_date(p.get("au") or ""):
            qs = qs.filter(date_creation__date__lte=au)

        payes = qs.filter(nature=PaiementAbonnement.Nature.PAIEMENT)
        par_mode = [
            {"mode": l["mode"], "mode_libelle": PaiementAbonnement.Mode(l["mode"]).label if l["mode"] else "Non précisé",
             "total": l["total"], "nombre": l["n"]}
            for l in payes.values("mode").annotate(total=Sum("montant"), n=Count("id")).order_by("-total")
        ]
        return Response({
            "total_encaisse": payes.aggregate(t=Sum("montant"))["t"] or Decimal(0),
            "nombre_paiements": payes.count(),
            "par_mode": par_mode,
            "lignes": [
                {
                    "id": str(l.id),
                    "date": l.date_creation,
                    "boutique": {"id": str(l.boutique_id), "nom": l.boutique.nom},
                    "nature": l.nature,
                    "nature_libelle": l.get_nature_display(),
                    "formule_libelle": l.get_option_display() if l.option else l.get_formule_display(),
                    "date_debut": l.date_debut,
                    "date_fin": l.date_fin,
                    "montant": l.montant,
                    "mode_libelle": l.get_mode_display() if l.mode else "",
                    "reference": l.reference,
                    "note": l.note,
                    "enregistre_par": l.enregistre_par.username if l.enregistre_par else "",
                }
                for l in qs.order_by("-date_creation")[:500]
            ],
        })


class EnregistrementPeriodeSerializer(serializers.Serializer):
    boutique_id = serializers.UUIDField()
    nature = serializers.ChoiceField(choices=["paiement", "offert", "ajustement"])
    formule = serializers.ChoiceField(choices=["essentiel", "pro"])
    # Paiement / offert : durée en mois à partir de la fin en cours, OU une date de fin précise.
    duree_mois = serializers.IntegerField(required=False, min_value=1, max_value=36)
    date_fin = serializers.CharField(required=False, allow_blank=True)
    sans_limite = serializers.BooleanField(default=False)
    montant = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, default=0)
    mode = serializers.ChoiceField(
        choices=["wave", "orange_money", "mtn", "moov", "especes", "banque", "autre"], required=False, allow_blank=True
    )
    reference = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")

    def validate(self, d):
        if d["nature"] == "paiement" and not d.get("montant"):
            raise serializers.ValidationError({"montant": "Indiquez le montant reçu."})
        if d["nature"] == "paiement" and not d.get("mode"):
            raise serializers.ValidationError({"mode": "Indiquez comment le paiement a été reçu."})
        if not d["sans_limite"] and not d.get("duree_mois") and not d.get("date_fin"):
            raise serializers.ValidationError({"duree_mois": "Choisissez une durée ou une date de fin."})
        if d["nature"] != "paiement":
            d["montant"] = Decimal(0)
        return d


class EnregistrerPeriodeView(APIView):
    """Paiement reçu hors appli (espèces, virement…), mois offerts ou correction de date."""

    permission_classes = [a_le_droit_admin("paiements")]

    def post(self, request):
        services = _services()
        serializer = EnregistrementPeriodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        boutique = _modele("Boutique").objects.filter(pk=d["boutique_id"], supprime=False).first()
        if boutique is None:
            return Response({"detail": "Boutique introuvable."}, status=status.HTTP_404_NOT_FOUND)
        reference = d.get("reference", "").strip()
        PaiementAbonnement = _modele("PaiementAbonnement")
        if reference and (
            PaiementAbonnement.objects.filter(reference__iexact=reference).exists()
            or _modele("DemandeRenouvellement").objects.filter(reference__iexact=reference).exclude(statut="rejetee").exists()
        ):
            return Response({"reference": ["Cette référence de transaction est déjà enregistrée."]},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            if d["sans_limite"]:
                fin = None
            elif d.get("date_fin"):
                fin = _date_fin(d["date_fin"])
                if fin <= timezone.now():
                    return Response({"date_fin": ["La date de fin doit être dans le futur."]},
                                    status=status.HTTP_400_BAD_REQUEST)
            elif d["nature"] == "ajustement":
                fin = services.ajouter_mois(timezone.now(), d["duree_mois"])
            else:
                fin = services.ajouter_mois(services.point_depart_renouvellement(boutique), d["duree_mois"])
        except ValidationError as erreur:
            return Response({"date_fin": erreur.messages}, status=status.HTTP_400_BAD_REQUEST)

        services.enregistrer_periode_abonnement(
            boutique, fin, d["formule"], nature=d["nature"], montant=d["montant"], mode=d.get("mode", ""),
            reference=reference, note=d.get("note", ""), par=request.user,
        )
        boutique.refresh_from_db()
        journaliser(
            request, request.user, f"abonnement_{d['nature']}", boutique=boutique,
            detail=f"{boutique.get_formule_display()} jusqu'au "
            f"{timezone.localdate(fin):%d/%m/%Y}" if fin else f"{boutique.get_formule_display()} sans limite",
            donnees={"montant": str(d["montant"]), "mode": d.get("mode", ""), "reference": reference},
        )
        return Response(_boutique_courte(boutique), status=status.HTTP_201_CREATED)


class CodeActivationView(APIView):
    """Code à envoyer par WhatsApp/SMS quand la boutique n'a pas internet (appli bloquée)."""

    permission_classes = [a_le_droit_admin("paiements")]

    def post(self, request, pk):
        from comptes.activation import ErreurActivation, generer_code

        boutique = _modele("Boutique").objects.filter(pk=pk, supprime=False).first()
        if boutique is None:
            return Response({"detail": "Boutique introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if boutique.date_expiration_abonnement is None:
            return Response({"detail": "Abonnement sans limite : pas besoin de code."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            date_fin = timezone.localdate(boutique.date_expiration_abonnement)
            code = generer_code(
                boutique.id, date_fin, boutique.formule, options=_services().options_pour_code(boutique, date_fin)
            )
        except ErreurActivation as erreur:
            return Response({"detail": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
        journaliser(request, request.user, "code_activation", boutique=boutique)
        return Response({"code": code, "boutique": _boutique_courte(boutique)})


class BoutiquesPourChoixView(APIView):
    """Liste courte (id, nom) pour les menus déroulants « boutique »."""

    permission_classes = [a_le_droit_admin("paiements")]

    def get(self, request):
        return Response([
            {"id": str(b.id), "nom": b.nom, "formule": b.formule}
            for b in _modele("Boutique").objects.filter(supprime=False).order_by("nom")
        ])


# --- Demandes de réseau ----------------------------------------------------------

def _demande_reseau_json(d):
    return {
        "id": str(d.id),
        "date": d.date_creation,
        "boutique": {**_boutique_courte(d.boutique), "reseau_autorise": d.boutique.reseau_autorise},
        "demandeur": (d.demandeur.get_full_name() or d.demandeur.username) if d.demandeur else "",
        "note": d.note,
        "statut": d.statut,
        "statut_libelle": d.get_statut_display(),
        "traitee_par": d.traitee_par.username if d.traitee_par else "",
        "date_traitement": d.date_traitement,
    }


class DemandesReseauView(APIView):
    permission_classes = [a_le_droit_admin("demandes_reseau")]

    def get(self, request):
        statut = request.query_params.get("statut") or "en_attente"
        qs = _modele("DemandeReseau").objects.filter(supprime=False).select_related("boutique", "demandeur", "traitee_par")
        if statut != "toutes":
            qs = qs.filter(statut=statut)
        return Response([_demande_reseau_json(d) for d in qs.order_by("-date_creation")[:300]])


class TraiterDemandeReseauView(APIView):
    """POST {action: "accepter"} (active le réseau de la boutique) ou {action: "refuser"}."""

    permission_classes = [a_le_droit_admin("demandes_reseau")]

    def post(self, request, pk):
        demande = _modele("DemandeReseau").objects.filter(pk=pk, supprime=False).select_related("boutique").first()
        if demande is None:
            return Response({"detail": "Demande introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if demande.statut != "en_attente":
            return Response({"detail": "Cette demande a déjà été traitée."}, status=status.HTTP_400_BAD_REQUEST)
        boutique = demande.boutique
        action = request.data.get("action")
        if action == "accepter":
            boutique.reseau_autorise = True
            boutique.save(update_fields=["reseau_autorise", "date_modification"])
            # Comme l'admin Django : toutes les demandes en attente de la boutique sont acceptées.
            _services().accepter_demandes_reseau(boutique, request.user)
            journaliser(request, request.user, "reseau_active", boutique=boutique)
        elif action == "refuser":
            demande.statut = "refusee"
            demande.traitee_par = request.user
            demande.date_traitement = timezone.now()
            demande.save(update_fields=["statut", "traitee_par", "date_traitement", "date_modification"])
            journaliser(request, request.user, "reseau_refuse", boutique=boutique)
        else:
            return Response({"detail": "Action inconnue."}, status=status.HTTP_400_BAD_REQUEST)
        demande.refresh_from_db()
        return Response(_demande_reseau_json(demande))


# --- Signalements ----------------------------------------------------------------

class SignalementsView(APIView):
    permission_classes = [a_le_droit_admin("signalements")]

    def get(self, request):
        traites = request.query_params.get("traites") == "1"
        qs = _modele("SignalementAbonnement").objects.filter(supprime=False, traite=traites).select_related("boutique")
        return Response([
            {
                "id": str(s.id),
                "date": s.date_creation,
                "boutique": _boutique_courte(s.boutique),
                "type": s.type,
                "type_libelle": s.get_type_display(),
                "detail": s.detail,
                "traite": s.traite,
            }
            for s in qs.order_by("-date_creation")[:300]
        ])


class TraiterSignalementView(APIView):
    """POST {traite: true|false}."""

    permission_classes = [a_le_droit_admin("signalements")]

    def post(self, request, pk):
        s = _modele("SignalementAbonnement").objects.filter(pk=pk, supprime=False).select_related("boutique").first()
        if s is None:
            return Response({"detail": "Signalement introuvable."}, status=status.HTTP_404_NOT_FOUND)
        s.traite = bool(request.data.get("traite", True))
        s.save(update_fields=["traite", "date_modification"])
        journaliser(request, request.user, "signalement_traite" if s.traite else "signalement_rouvert",
                    boutique=s.boutique, detail=s.get_type_display())
        return Response({"id": str(s.id), "traite": s.traite})


# --- Comptes et mots de passe ----------------------------------------------------

def _compte_json(u):
    return {
        "id": u.pk,
        "username": u.username,
        "nom": u.get_full_name(),
        "boutique": {"id": str(u.boutique_id), "nom": u.boutique.nom} if u.boutique_id else None,
        "role": u.role.nom if u.role_id else "",
        "telephone": u.telephone,
        "email": u.email,
        "actif": u.is_active,
        "derniere_connexion": u.last_login,
        "doit_changer_mot_de_passe": u.doit_changer_mot_de_passe,
    }


def _comptes_des_boutiques():
    # Jamais les administrateurs : ils se gèrent dans la rubrique « Administrateurs ».
    return _modele("Utilisateur").objects.filter(is_staff=False, is_superuser=False).select_related("boutique", "role")


class ComptesView(APIView):
    permission_classes = [a_le_droit_admin("comptes")]

    def get(self, request):
        qs = _comptes_des_boutiques()
        recherche = (request.query_params.get("recherche") or "").strip()
        if recherche:
            qs = qs.filter(
                Q(username__icontains=recherche) | Q(first_name__icontains=recherche) | Q(last_name__icontains=recherche)
                | Q(telephone__icontains=recherche) | Q(email__icontains=recherche) | Q(boutique__nom__icontains=recherche)
            )
        if request.query_params.get("boutique"):
            qs = qs.filter(boutique_id=request.query_params["boutique"])
        return Response([_compte_json(u) for u in qs.order_by("boutique__nom", "username")[:500]])


class ReinitialiserMotDePasseView(APIView):
    """POST {nouveau_mot_de_passe, doit_changer} : même effet que l'Espace Admin du bureau."""

    permission_classes = [a_le_droit_admin("comptes")]

    def post(self, request, pk):
        cible = _comptes_des_boutiques().filter(pk=pk).first()
        if cible is None:
            return Response({"detail": "Compte introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if not cible.is_active:
            return Response({"detail": "Ce compte est désactivé."}, status=status.HTTP_400_BAD_REQUEST)
        nouveau = str(request.data.get("nouveau_mot_de_passe") or "")
        try:
            validate_password(nouveau, cible)
        except ValidationError as erreur:
            return Response({"nouveau_mot_de_passe": erreur.messages}, status=status.HTTP_400_BAD_REQUEST)
        cible.set_password(nouveau)
        cible.code_reinitialisation = ""
        cible.code_reinitialisation_expire_le = None
        cible.doit_changer_mot_de_passe = bool(request.data.get("doit_changer", True))
        cible.save(update_fields=[
            "password", "code_reinitialisation", "code_reinitialisation_expire_le", "doit_changer_mot_de_passe"
        ])
        journaliser(request, request.user, "mot_de_passe_reinitialise", boutique=cible.boutique, detail=cible.username)
        return Response(_compte_json(cible))
