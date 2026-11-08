"""
API du lot 3 : tableau de bord, boutiques (liste + fiche), inscriptions,
création d'une boutique.

Règle de confidentialité : on ne montre que des informations de COMPTE
(identité, contact, abonnement, accès, utilisateurs, dates de synchro et de
sauvegarde). Jamais de vente, de stock ni de client des boutiques.
"""
from datetime import timedelta

from django.apps import apps
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Max, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.dateparse import parse_datetime, parse_date
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import EstAdmin, a_le_droit_admin
from .services import a_le_droit, journaliser

BIENTOT = timedelta(days=7)


def _modele(nom):
    return apps.get_model("comptes", nom)


def _services():
    from comptes import services

    return services


# --- Abonnement : même lecture que l'admin Django (comptes/admin.py::etat_abonnement) ---

def etat_abonnement(boutique, maintenant=None):
    maintenant = maintenant or timezone.now()
    fin = boutique.fin_effective()
    grace = _services().DELAI_GRACE_ABONNEMENT
    if fin is None:
        return {"niveau": "illimite", "libelle": "Sans limite", "jours": None}
    if boutique.essai_en_cours(maintenant):
        jours = (boutique.essai_fin - maintenant).days
        return {
            "niveau": "bientot" if boutique.essai_fin - maintenant < BIENTOT else "ok",
            "libelle": f"Essai gratuit {boutique.get_essai_formule_display()} · {jours} jour(s) restant(s)",
            "jours": jours,
        }
    if fin >= maintenant:
        jours = (fin - maintenant).days
        niveau = "bientot" if fin - maintenant < BIENTOT else "ok"
        return {"niveau": niveau, "libelle": f"{jours} jour(s) restant(s)", "jours": jours}
    if fin >= maintenant - grace:
        return {"niveau": "grace", "libelle": "Délai de grâce", "jours": (fin - maintenant).days}
    return {"niveau": "bloque", "libelle": "Vente bloquée", "jours": (fin - maintenant).days}


def _filtre_niveau(niveau, maintenant):
    grace = _services().DELAI_GRACE_ABONNEMENT
    return {
        "illimite": Q(date_expiration_abonnement__isnull=True),
        "ok": Q(date_expiration_abonnement__gte=maintenant + BIENTOT),
        "bientot": Q(date_expiration_abonnement__gte=maintenant, date_expiration_abonnement__lt=maintenant + BIENTOT),
        "grace": Q(date_expiration_abonnement__lt=maintenant, date_expiration_abonnement__gte=maintenant - grace),
        "bloque": Q(date_expiration_abonnement__lt=maintenant - grace),
    }.get(niveau)


def _patron(boutique):
    return next((u for u in boutique.utilisateurs.all() if u.role_id and u.role.nom == "Patron"), None)


def _boutiques_annotees():
    # Sous-requêtes plutôt que jointures : le journal de synchro peut compter des
    # milliers de lignes par boutique, une jointure multiplierait les lignes.
    JournalSync = apps.get_model("synchronisation", "JournalSync")
    Utilisateur = _modele("Utilisateur")
    derniere = JournalSync.objects.filter(boutique=OuterRef("pk")).order_by("-date_creation").values("date_creation")[:1]
    nb = (
        Utilisateur.objects.filter(boutique=OuterRef("pk")).order_by().values("boutique")
        .annotate(n=Count("id")).values("n")
    )
    return (
        _modele("Boutique").objects.filter(supprime=False)
        .annotate(derniere_synchro=Subquery(derniere), nb_utilisateurs=Coalesce(Subquery(nb), 0))
        .prefetch_related("utilisateurs__role")
    )


def resume_boutique(b, maintenant=None):
    patron = _patron(b)
    return {
        "id": str(b.id),
        "nom": b.nom,
        "telephone": b.telephone,
        "email": b.email,
        "date_creation": b.date_creation,
        "actif": b.actif,
        "formule": b.formule,
        "formule_libelle": b.get_formule_display(),
        "date_expiration_abonnement": b.date_expiration_abonnement,
        "essai_formule": b.essai_formule,
        "essai_fin": b.essai_fin,
        "abonnement": etat_abonnement(b, maintenant),
        "synchro_autorisee": b.synchro_autorisee,
        "reseau_autorise": b.reseau_autorise,
        "appli_mobile_autorisee": b.appli_mobile_autorisee,
        "nb_utilisateurs": b.nb_utilisateurs if hasattr(b, "nb_utilisateurs") else b.utilisateurs.count(),
        "derniere_synchro": getattr(b, "derniere_synchro", None),
        "date_derniere_sauvegarde": b.date_derniere_sauvegarde,
        "patron": {
            "username": patron.username,
            "nom": patron.get_full_name(),
            "telephone": patron.telephone,
            "email": patron.email,
        } if patron else None,
    }


# --- Tableau de bord -------------------------------------------------------------

class TableauDeBordView(APIView):
    """Chiffres de suivi de la plateforme (aucun chiffre d'affaires des boutiques)."""

    permission_classes = [EstAdmin]

    def get(self, request):
        maintenant = timezone.now()
        Boutique = _modele("Boutique")
        boutiques = Boutique.objects.filter(supprime=False)
        abonnements = {
            niveau: boutiques.filter(actif=True).filter(_filtre_niveau(niveau, maintenant)).count()
            for niveau in ("ok", "bientot", "grace", "bloque", "illimite")
        }
        debut_mois = maintenant.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        a_traiter = {
            "inscriptions": _modele("DemandeInscription").objects.filter(statut="en_attente", supprime=False).count(),
            "paiements": _modele("DemandeRenouvellement").objects.filter(statut="en_attente", supprime=False).count(),
            "demandes_reseau": _modele("DemandeReseau").objects.filter(statut="en_attente", supprime=False).count(),
            "signalements": _modele("SignalementAbonnement").objects.filter(traite=False, supprime=False).count(),
        }
        # Chaque compteur ne s'affiche que pour qui peut le traiter.
        a_traiter = {cle: n for cle, n in a_traiter.items() if a_le_droit(request.user, cle)}

        sans_sauvegarde = boutiques.filter(actif=True, synchro_autorisee=True).filter(
            Q(date_derniere_sauvegarde__isnull=True) | Q(date_derniere_sauvegarde__lt=maintenant - timedelta(days=7))
        ).count()
        a_surveiller = []
        if a_le_droit(request.user, "boutiques"):
            a_surveiller = [
                resume_boutique(b, maintenant)
                for b in _boutiques_annotees().filter(actif=True).filter(
                    _filtre_niveau("bientot", maintenant) | _filtre_niveau("grace", maintenant)
                ).order_by("date_expiration_abonnement")[:8]
            ]
        return Response({
            "boutiques": {
                "total": boutiques.count(),
                "actives": boutiques.filter(actif=True).count(),
                "nouvelles_ce_mois": boutiques.filter(date_creation__gte=debut_mois).count(),
                "synchro_activee": boutiques.filter(synchro_autorisee=True).count(),
                "sans_sauvegarde_recente": sans_sauvegarde,
            },
            "abonnements": abonnements,
            "a_traiter": a_traiter,
            "a_surveiller": a_surveiller,
        })


# --- Boutiques -------------------------------------------------------------------

class ListeBoutiquesView(APIView):
    permission_classes = [a_le_droit_admin("boutiques")]

    def get(self, request):
        maintenant = timezone.now()
        qs = _boutiques_annotees()
        recherche = (request.query_params.get("recherche") or "").strip()
        if recherche:
            qs = qs.filter(
                Q(nom__icontains=recherche) | Q(telephone__icontains=recherche) | Q(email__icontains=recherche)
                | Q(utilisateurs__username__icontains=recherche) | Q(utilisateurs__telephone__icontains=recherche)
            ).distinct()
        etat = request.query_params.get("etat") or ""
        if etat == "inactive":
            qs = qs.filter(actif=False)
        elif (filtre := _filtre_niveau(etat, maintenant)) is not None:
            qs = qs.filter(actif=True).filter(filtre)
        return Response([resume_boutique(b, maintenant) for b in qs.order_by("nom")[:500]])


class ModificationBoutiqueSerializer(serializers.Serializer):
    # Pas de « actif » ici : Boutique.actif n'est appliqué nulle part (connexion,
    # synchro), le proposer laisserait croire qu'on peut couper une boutique.
    synchro_autorisee = serializers.BooleanField(required=False)
    appli_mobile_autorisee = serializers.BooleanField(required=False)
    # Droit « demandes_reseau ».
    reseau_autorise = serializers.BooleanField(required=False)
    # Droit « paiements » : essai gratuit à part de l'abonnement payé (voir
    # comptes.Boutique.essai_fin) ; essai_fin null = arrêter l'essai.
    essai_fin = serializers.DateTimeField(required=False, allow_null=True)
    essai_formule = serializers.ChoiceField(choices=["essentiel", "pro"], required=False)

    def validate(self, d):
        if d.get("essai_fin") and not d.get("essai_formule"):
            raise serializers.ValidationError({"essai_formule": "Choisissez la formule de l'essai."})
        if d.get("essai_fin") and d["essai_fin"] <= timezone.now():
            raise serializers.ValidationError({"essai_fin": "La fin de l'essai doit être dans le futur."})
        return d

# Droit nécessaire pour chaque champ (en plus du droit « boutiques » de la fiche).
DROIT_CHAMP = {"reseau_autorise": "demandes_reseau", "essai_fin": "paiements", "essai_formule": "paiements"}


def _demande_reseau_courte(d):
    return {
        "id": str(d.id),
        "date": d.date_creation,
        "demandeur": (d.demandeur.get_full_name() or d.demandeur.username) if d.demandeur else "",
        "note": d.note,
        "statut": d.statut,
        "statut_libelle": d.get_statut_display(),
        "date_traitement": d.date_traitement,
    }


class FicheBoutiqueView(APIView):
    permission_classes = [a_le_droit_admin("boutiques")]

    def _boutique(self, pk):
        return _boutiques_annotees().filter(pk=pk).first()

    def get(self, request, pk):
        b = self._boutique(pk)
        if b is None:
            return Response({"detail": "Boutique introuvable."}, status=status.HTTP_404_NOT_FOUND)
        JournalSync = apps.get_model("synchronisation", "JournalSync")
        postes = (
            JournalSync.objects.filter(boutique=b).exclude(appareil="")
            .values("appareil").annotate(dernier=Max("date_creation")).order_by("-dernier")
        )
        fiche = {
            **resume_boutique(b),
            "adresse": b.adresse,
            "devise": b.devise,
            "utilisateurs": [
                {
                    "username": u.username,
                    "nom": u.get_full_name(),
                    "role": u.role.nom if u.role_id else "",
                    "telephone": u.telephone,
                    "actif": u.is_active,
                    "derniere_connexion": u.last_login,
                }
                for u in sorted(b.utilisateurs.all(), key=lambda u: (u.role.nom != "Patron" if u.role_id else True, u.username))
            ],
            "postes": [{"appareil": p["appareil"], "derniere_synchro": p["dernier"]} for p in postes[:20]],
            "demandes_reseau_en_attente": b.demandes_reseau.filter(statut="en_attente").count(),
            "essai_en_cours": b.essai_en_cours(),
            "formule_effective": b.formule_effective(),
            # Ce que cet administrateur peut faire depuis la fiche (le serveur revérifie à chaque action).
            "peut": {
                droit: a_le_droit(request.user, droit) for droit in ("paiements", "demandes_reseau", "comptes")
            },
        }
        if a_le_droit(request.user, "demandes_reseau"):
            fiche["demandes_reseau"] = [
                _demande_reseau_courte(d) for d in b.demandes_reseau.select_related("demandeur").order_by("-date_creation")[:10]
            ]
        if a_le_droit(request.user, "paiements"):
            fiche["tarifs"] = _services().grille_tarifs()
            fiche["paiements_declares_en_attente"] = b.demandes_renouvellement.filter(
                statut="en_attente", supprime=False
            ).count()
            fiche["registre_abonnement"] = [
                {
                    "date": p.date_creation,
                    "nature_libelle": p.get_nature_display(),
                    "formule_libelle": p.get_formule_display(),
                    "date_debut": p.date_debut,
                    "date_fin": p.date_fin,
                    "montant": p.montant,
                    "mode_libelle": p.get_mode_display() if p.mode else "",
                    "reference": p.reference,
                }
                for p in b.paiements_abonnement.filter(supprime=False)[:20]
            ]
        return Response(fiche)

    def patch(self, request, pk):
        b = self._boutique(pk)
        if b is None:
            return Response({"detail": "Boutique introuvable."}, status=status.HTTP_404_NOT_FOUND)
        serializer = ModificationBoutiqueSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        donnees = dict(serializer.validated_data)
        # Tout est vérifié avant d'écrire : pas de modification à moitié faite.
        for champ in donnees:
            droit = DROIT_CHAMP.get(champ)
            if droit and not a_le_droit(request.user, droit):
                return Response({"detail": "Vous n'avez pas le droit de faire cette modification."}, status=status.HTTP_403_FORBIDDEN)
        if "essai_fin" in donnees:
            essai_fin = donnees.pop("essai_fin")
            essai_formule = donnees.pop("essai_formule", "")
            if essai_fin != b.essai_fin or (essai_fin and essai_formule != b.essai_formule):
                _services().accorder_essai(b, essai_fin, essai_formule, par=request.user)
                journaliser(
                    request, request.user, "essai_accorde" if essai_fin else "essai_arrete", boutique=b,
                    detail=f"{b.get_essai_formule_display()} jusqu'au {timezone.localtime(essai_fin):%d/%m/%Y}" if essai_fin else "",
                )
        donnees.pop("essai_formule", None)
        champs = []
        for champ, valeur in donnees.items():
            if getattr(b, champ) != valeur:
                setattr(b, champ, valeur)
                champs.append(champ)
        if champs:
            b.save(update_fields=[*champs, "date_modification"])
            if "reseau_autorise" in champs and b.reseau_autorise:
                # Comme les autres écrans : les demandes en attente de la boutique sont acceptées.
                _services().accepter_demandes_reseau(b, request.user)
            for champ in champs:
                action = {
                    "synchro_autorisee": "synchro_activee" if b.synchro_autorisee else "synchro_desactivee",
                    "appli_mobile_autorisee": "appli_mobile_activee" if b.appli_mobile_autorisee else "appli_mobile_desactivee",
                    "reseau_autorise": "reseau_active" if b.reseau_autorise else "reseau_desactive",
                }[champ]
                journaliser(request, request.user, action, boutique=b)
        return self.get(request, pk)


# --- Inscriptions ----------------------------------------------------------------

def _demande_json(d):
    return {
        "id": str(d.id),
        "date": d.date_creation,
        "statut": d.statut,
        "statut_libelle": d.get_statut_display(),
        "boutique_nom": d.boutique_nom,
        "boutique_adresse": d.boutique_adresse,
        "boutique_telephone": d.boutique_telephone,
        "boutique_email": d.boutique_email,
        "boutique_devise": d.boutique_devise,
        "username": d.username,
        "nom": f"{d.first_name} {d.last_name}".strip(),
        "email": d.email,
        "telephone": d.telephone,
        "formule": d.formule,
        "formule_libelle": d.get_formule_display(),
    }


class ListeInscriptionsView(APIView):
    permission_classes = [a_le_droit_admin("inscriptions")]

    def get(self, request):
        statut = request.query_params.get("statut") or "en_attente"
        qs = _modele("DemandeInscription").objects.filter(supprime=False)
        if statut != "toutes":
            qs = qs.filter(statut=statut)
        return Response({
            "duree_essai_jours": _services().DUREE_ESSAI.days,
            "demandes": [_demande_json(d) for d in qs.order_by("-date_creation")[:200]],
        })


class TraiterInscriptionView(APIView):
    """POST {action: "approuver", formule?, date_fin?} ou {action: "rejeter"}."""

    permission_classes = [a_le_droit_admin("inscriptions")]

    def post(self, request, pk):
        services = _services()
        demande = _modele("DemandeInscription").objects.filter(pk=pk, supprime=False).first()
        if demande is None:
            return Response({"detail": "Demande introuvable."}, status=status.HTTP_404_NOT_FOUND)
        action = request.data.get("action")
        Utilisateur = _modele("Utilisateur")
        try:
            if action == "approuver":
                if Utilisateur.objects.filter(username__iexact=demande.username).exists():
                    return Response(
                        {"detail": f"L'identifiant « {demande.username} » est déjà pris : rejetez la demande et contactez le commerçant."},
                        status=status.HTTP_409_CONFLICT,
                    )
                formule = request.data.get("formule") or demande.formule
                if formule not in _modele("Boutique").Formule.values:
                    return Response({"detail": "Formule inconnue."}, status=status.HTTP_400_BAD_REQUEST)
                date_fin = _date_fin(request.data.get("date_fin")) or timezone.now() + services.DUREE_ESSAI
                boutique, _patron_cree = services.approuver_inscription(demande, date_fin, formule=formule)
                journaliser(request, request.user, "inscription_approuvee", boutique=boutique,
                            detail=f"patron {demande.username} · essai jusqu'au {timezone.localdate(date_fin):%d/%m/%Y}")
                demande.refresh_from_db()
                return Response({**_demande_json(demande), "boutique_id": str(boutique.id)})
            if action == "rejeter":
                services.rejeter_inscription(demande)
                journaliser(request, request.user, "inscription_rejetee", detail=f"{demande.boutique_nom} ({demande.username})")
                demande.refresh_from_db()
                return Response(_demande_json(demande))
        except ValidationError as erreur:
            return Response({"detail": " ".join(erreur.messages)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Action inconnue."}, status=status.HTTP_400_BAD_REQUEST)


def _date_fin(valeur):
    """Date de fin envoyée par le site : « AAAA-MM-JJ » (fin de journée) ou date-heure ISO."""
    if not valeur:
        return None
    if (dt := parse_datetime(str(valeur))) is not None:
        return dt if timezone.is_aware(dt) else timezone.make_aware(dt)
    if (d := parse_date(str(valeur))) is not None:
        from datetime import datetime, time

        return timezone.make_aware(datetime.combine(d, time(23, 59, 59)))
    raise ValidationError("Date de fin invalide.")


# --- Créer une boutique ----------------------------------------------------------

class CreationBoutiqueSerializer(serializers.Serializer):
    boutique_nom = serializers.CharField(max_length=200)
    boutique_adresse = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    boutique_telephone = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    boutique_email = serializers.EmailField(required=False, allow_blank=True, default="")
    boutique_devise = serializers.CharField(max_length=10, required=False, default="FCFA")
    formule = serializers.ChoiceField(choices=["essentiel", "pro"], default="essentiel")
    synchro_autorisee = serializers.BooleanField(default=False)

    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128)
    email = serializers.EmailField()
    telephone = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    doit_changer_mot_de_passe = serializers.BooleanField(default=True)

    def validate_username(self, valeur):
        valeur = valeur.strip()
        if _modele("Utilisateur").objects.filter(username__iexact=valeur).exists():
            raise serializers.ValidationError("Cet identifiant est déjà pris.")
        return valeur

    def validate_email(self, valeur):
        if _modele("Utilisateur").objects.filter(email__iexact=valeur).exists():
            raise serializers.ValidationError("Cet email est déjà utilisé par un autre compte.")
        return valeur

    def validate(self, donnees):
        try:
            validate_password(donnees["password"])
        except ValidationError as erreur:
            raise serializers.ValidationError({"password": list(erreur.messages)})
        return donnees


class CreerBoutiqueView(APIView):
    """Boutique + Patron créés directement (commerçant recruté sur le terrain), avec l'essai gratuit."""

    permission_classes = [a_le_droit_admin("creer_boutique")]

    def post(self, request):
        services = _services()
        serializer = CreationBoutiqueSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        with transaction.atomic():
            boutique, patron = services.inscrire_boutique(
                {
                    "nom": d["boutique_nom"].strip(),
                    "adresse": d["boutique_adresse"],
                    "telephone": d["boutique_telephone"],
                    "email": d["boutique_email"],
                    "devise": d["boutique_devise"] or "FCFA",
                    "formule": d["formule"],
                    "synchro_autorisee": d["synchro_autorisee"],
                },
                {
                    "username": d["username"],
                    "password": d["password"],
                    "email": d["email"],
                    "telephone": d["telephone"],
                    "first_name": d["first_name"],
                    "last_name": d["last_name"],
                    "doit_changer_mot_de_passe": d["doit_changer_mot_de_passe"],
                },
            )
            services.demarrer_essai(boutique, par=request.user)
        journaliser(request, request.user, "boutique_creee", boutique=boutique, detail=f"patron {patron.username}")
        boutique = _boutiques_annotees().get(pk=boutique.pk)
        return Response(resume_boutique(boutique), status=status.HTTP_201_CREATED)


class IdentifiantDisponibleAdminView(APIView):
    permission_classes = [a_le_droit_admin("creer_boutique")]

    def get(self, request):
        identifiant = (request.query_params.get("identifiant") or "").strip()
        libre = bool(identifiant) and not _modele("Utilisateur").objects.filter(username__iexact=identifiant).exists()
        return Response({"disponible": libre})
