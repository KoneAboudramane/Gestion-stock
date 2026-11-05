"""
API du lot 5, réservée à l'administrateur principal (superuser) : gestion des
administrateurs (droits, double vérification), réglages de la plateforme,
journal des actions. Plus le changement de son propre mot de passe (tout admin).
"""
from django.apps import apps
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils.dateparse import parse_date
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .droits import DROITS, droits_valides
from .models import JournalAdmin, ProfilAdmin
from .permissions import EstAdmin, EstSuperAdmin
from .services import droits_de, journaliser


def _utilisateurs():
    return apps.get_model("comptes", "Utilisateur").objects


def _admin_json(u):
    profil = ProfilAdmin.objects.filter(utilisateur=u).first()
    return {
        "id": u.pk,
        "username": u.username,
        "nom": u.get_full_name(),
        "first_name": u.first_name,
        "last_name": u.last_name,
        "email": u.email,
        "telephone": u.telephone,
        "superuser": u.is_superuser,
        "actif": u.is_active,
        "droits": droits_de(u) if u.is_active else (profil.droits if profil else []),
        # Sans profil = créé avant les droits : il a tout (voir services.droits_de).
        "droits_herites": profil is None and not u.is_superuser,
        "double_verification_exigee": bool(profil and profil.double_verification_exigee),
        "double_verification_active": bool(profil and profil.totp_actif),
        "derniere_connexion": u.last_login,
        "date_creation": u.date_joined,
        "doit_changer_mot_de_passe": u.doit_changer_mot_de_passe,
    }


def _admins():
    return _utilisateurs().filter(Q(is_staff=True) | Q(is_superuser=True))


# --- Administrateurs --------------------------------------------------------------

class CreationAdminSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    telephone = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    password = serializers.CharField(max_length=128)
    droits = serializers.ListField(child=serializers.CharField(), default=list)
    double_verification_exigee = serializers.BooleanField(default=True)

    def validate_username(self, valeur):
        valeur = valeur.strip()
        if _utilisateurs().filter(username__iexact=valeur).exists():
            raise serializers.ValidationError("Cet identifiant est déjà pris.")
        return valeur

    def validate(self, d):
        try:
            validate_password(d["password"])
        except ValidationError as erreur:
            raise serializers.ValidationError({"password": list(erreur.messages)})
        return d


class AdministrateursView(APIView):
    permission_classes = [EstSuperAdmin]

    def get(self, request):
        return Response({
            "catalogue_droits": [{"cle": cle, "libelle": libelle} for cle, libelle in DROITS.items()],
            "administrateurs": [_admin_json(u) for u in _admins().order_by("-is_superuser", "-is_active", "username")],
        })

    def post(self, request):
        serializer = CreationAdminSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        with transaction.atomic():
            u = _utilisateurs().create_user(
                username=d["username"], password=d["password"], email=d["email"], first_name=d["first_name"],
                last_name=d["last_name"], telephone=d["telephone"], is_staff=True,
                # Il choisit son propre mot de passe à sa première connexion.
                doit_changer_mot_de_passe=True,
            )
            ProfilAdmin.objects.create(
                utilisateur=u, droits=droits_valides(d["droits"]),
                double_verification_exigee=d["double_verification_exigee"],
            )
        journaliser(request, request.user, "admin_cree", detail=u.username,
                    donnees={"droits": droits_valides(d["droits"]), "double_verification": d["double_verification_exigee"]})
        return Response(_admin_json(u), status=status.HTTP_201_CREATED)


class ModificationAdminSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    telephone = serializers.CharField(max_length=30, required=False, allow_blank=True)
    droits = serializers.ListField(child=serializers.CharField(), required=False)
    actif = serializers.BooleanField(required=False)
    double_verification_exigee = serializers.BooleanField(required=False)
    # Téléphone perdu : l'appli d'authentification sera reconfigurée à la prochaine connexion.
    reinitialiser_double_verification = serializers.BooleanField(required=False, default=False)
    nouveau_mot_de_passe = serializers.CharField(max_length=128, required=False, allow_blank=True)


class AdministrateurView(APIView):
    permission_classes = [EstSuperAdmin]

    def patch(self, request, pk):
        u = _admins().filter(pk=pk).first()
        if u is None:
            return Response({"detail": "Administrateur introuvable."}, status=status.HTTP_404_NOT_FOUND)
        serializer = ModificationAdminSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        soi_meme = u.pk == request.user.pk

        if u.is_superuser and not soi_meme:
            return Response({"detail": "Un autre administrateur principal se gère dans l'admin Django."},
                            status=status.HTTP_403_FORBIDDEN)
        if soi_meme and ("actif" in d or "droits" in d):
            return Response({"detail": "Vous ne pouvez ni vous désactiver ni changer vos propres droits."},
                            status=status.HTTP_400_BAD_REQUEST)
        if d.get("nouveau_mot_de_passe"):
            try:
                validate_password(d["nouveau_mot_de_passe"], u)
            except ValidationError as erreur:
                return Response({"nouveau_mot_de_passe": erreur.messages}, status=status.HTTP_400_BAD_REQUEST)

        profil, _cree = ProfilAdmin.objects.get_or_create(
            utilisateur=u,
            # Profil créé à la première modification : il garde tout ce qu'il avait (droits hérités).
            defaults={"droits": [] if u.is_superuser else list(DROITS)},
        )
        changements = []
        champs_utilisateur = []
        for champ in ("first_name", "last_name", "email", "telephone"):
            if champ in d and getattr(u, champ) != d[champ]:
                setattr(u, champ, d[champ])
                champs_utilisateur.append(champ)
        if champs_utilisateur:
            changements.append("coordonnées")
        if "actif" in d and u.is_active != d["actif"]:
            u.is_active = d["actif"]
            champs_utilisateur.append("is_active")
            journaliser(request, request.user, "admin_reactive" if d["actif"] else "admin_desactive", detail=u.username)
        if d.get("nouveau_mot_de_passe"):
            u.set_password(d["nouveau_mot_de_passe"])
            u.doit_changer_mot_de_passe = True
            champs_utilisateur += ["password", "doit_changer_mot_de_passe"]
            journaliser(request, request.user, "admin_mot_de_passe_reinitialise", detail=u.username)
        if champs_utilisateur:
            u.save(update_fields=champs_utilisateur)

        champs_profil = []
        if "droits" in d and not u.is_superuser:
            nouveaux = droits_valides(d["droits"])
            if nouveaux != profil.droits:
                profil.droits = nouveaux
                champs_profil.append("droits")
                journaliser(request, request.user, "admin_droits_modifies", detail=u.username, donnees={"droits": nouveaux})
        if "double_verification_exigee" in d and profil.double_verification_exigee != d["double_verification_exigee"]:
            profil.double_verification_exigee = d["double_verification_exigee"]
            champs_profil.append("double_verification_exigee")
            journaliser(
                request, request.user,
                "double_verification_activee" if d["double_verification_exigee"] else "double_verification_desactivee",
                detail=u.username,
            )
        if d.get("reinitialiser_double_verification"):
            profil.totp_secret = ""
            profil.totp_actif = False
            profil.totp_dernier_pas = 0
            champs_profil += ["totp_secret", "totp_actif", "totp_dernier_pas"]
            journaliser(request, request.user, "double_verification_reinitialisee", detail=u.username)
        if champs_profil:
            profil.save(update_fields=[*champs_profil, "date_modification"])
        if changements:
            journaliser(request, request.user, "admin_modifie", detail=f"{u.username} : {', '.join(changements)}")
        u.refresh_from_db()
        return Response(_admin_json(u))


# --- Changer son propre mot de passe (tout administrateur) ------------------------

class MonMotDePasseView(APIView):
    permission_classes = [EstAdmin]

    def post(self, request):
        u = request.user
        actuel = str(request.data.get("ancien_mot_de_passe") or "")
        nouveau = str(request.data.get("nouveau_mot_de_passe") or "")
        if not u.check_password(actuel):
            return Response({"ancien_mot_de_passe": ["Mot de passe actuel incorrect."]}, status=status.HTTP_400_BAD_REQUEST)
        if nouveau == actuel:
            return Response({"nouveau_mot_de_passe": ["Choisissez un mot de passe différent de l'actuel."]},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(nouveau, u)
        except ValidationError as erreur:
            return Response({"nouveau_mot_de_passe": erreur.messages}, status=status.HTTP_400_BAD_REQUEST)
        u.set_password(nouveau)
        u.doit_changer_mot_de_passe = False
        u.save(update_fields=["password", "doit_changer_mot_de_passe"])
        journaliser(request, u, "mot_de_passe_change")
        return Response({"detail": "Mot de passe changé."})


# --- Réglages de la plateforme ----------------------------------------------------

class ReglagesSerializer(serializers.ModelSerializer):
    class Meta:
        model = apps.get_model("comptes", "ReglagesPlateforme")
        fields = [
            "numero_wave", "numero_orange_money", "numero_mtn", "numero_moov", "whatsapp", "instructions",
            "prix_mensuel_essentiel", "prix_mensuel_pro", "remise_3_mois", "remise_6_mois", "remise_12_mois",
        ]

    def validate_whatsapp(self, valeur):
        chiffres = "".join(c for c in valeur if c.isdigit())
        if valeur and len(chiffres) < 8:
            raise serializers.ValidationError("Numéro international sans « + » ni espaces, ex. 22507000000.")
        return chiffres


class ReglagesView(APIView):
    permission_classes = [EstSuperAdmin]

    def get(self, request):
        from comptes.services import grille_tarifs

        reglages = apps.get_model("comptes", "ReglagesPlateforme").obtenir()
        return Response({**ReglagesSerializer(reglages).data, "grille_tarifs": grille_tarifs()})

    def patch(self, request):
        from comptes.services import grille_tarifs

        reglages = apps.get_model("comptes", "ReglagesPlateforme").obtenir()
        avant = ReglagesSerializer(reglages).data
        serializer = ReglagesSerializer(reglages, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        apres = ReglagesSerializer(reglages).data
        modifies = {cle: {"avant": avant[cle], "apres": apres[cle]} for cle in apres if avant[cle] != apres[cle]}
        if modifies:
            journaliser(request, request.user, "reglages_modifies", detail=", ".join(modifies), donnees=modifies)
        return Response({**apres, "grille_tarifs": grille_tarifs()})


# --- Journal ----------------------------------------------------------------------

class JournalView(APIView):
    permission_classes = [EstSuperAdmin]

    def get(self, request):
        p = request.query_params
        qs = JournalAdmin.objects.all()
        if p.get("admin"):
            qs = qs.filter(admin_identifiant=p["admin"])
        if p.get("action"):
            qs = qs.filter(action=p["action"])
        if p.get("origine"):
            qs = qs.filter(origine=p["origine"])
        if p.get("recherche"):
            r = p["recherche"].strip()
            qs = qs.filter(Q(boutique_nom__icontains=r) | Q(detail__icontains=r) | Q(admin_identifiant__icontains=r))
        if du := parse_date(p.get("du") or ""):
            qs = qs.filter(date_creation__date__gte=du)
        if au := parse_date(p.get("au") or ""):
            qs = qs.filter(date_creation__date__lte=au)
        return Response({
            "admins": sorted(set(JournalAdmin.objects.values_list("admin_identifiant", flat=True))),
            "actions": sorted(set(JournalAdmin.objects.values_list("action", flat=True))),
            "lignes": [
                {
                    "id": str(j.id),
                    "date": j.date_creation,
                    "admin": j.admin_identifiant,
                    "action": j.action,
                    "boutique": {"id": str(j.boutique_id), "nom": j.boutique_nom} if j.boutique_id else
                    ({"id": None, "nom": j.boutique_nom} if j.boutique_nom else None),
                    "detail": j.detail,
                    "donnees": j.donnees,
                    "origine": j.origine,
                    "origine_libelle": j.get_origine_display(),
                    "adresse_ip": j.adresse_ip,
                }
                for j in qs.order_by("-date_creation")[:500]
            ],
        })
