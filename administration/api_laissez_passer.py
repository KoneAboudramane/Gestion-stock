"""
API des laissez-passer admin (docs/plan_laissez_passer_admin.md, lot A).

- Site d'administration (droit « laissez_passer », superuser compris) :
  générer (mot de passe retapé, durée au choix ou illimitée), lister, révoquer.
  Un admin voit les siens ; le superuser voit tous les laissez-passer.
- Espace Admin de l'appli (bureau, mobile), avec internet : même génération,
  identifiants admin dans la requête comme les autres actions de cet espace
  (le serveur signe : aucune clé dans l'appli).
- Appareils (sans session) : au retour d'internet, l'appareil signale
  l'utilisation d'un laissez-passer (noté au journal) et apprend s'il vaut
  encore (révoqué, mot de passe changé, compte désactivé, expiré) — sinon il
  efface l'accès admin qu'il avait mémorisé.
"""
from datetime import timedelta

from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .laissez_passer import DUREES_PERMISES, ErreurLaissezPasser, fabriquer_code
from .models import LaissezPasser
from .permissions import a_le_droit_admin
from .services import a_le_droit, journaliser

LIBELLES_ETAT = {
    "actif": "Actif",
    "expire": "Expiré",
    "revoque": "Révoqué",
    "mot_de_passe_change": "Mot de passe changé depuis",
    "compte_desactive": "Compte désactivé",
}


def _json(lp):
    etat = lp.etat()
    return {
        "id": str(lp.id),
        "numero": lp.numero,
        "admin": lp.admin_identifiant,
        "date_creation": lp.date_creation,
        "date_fin": lp.date_fin,
        "illimite": lp.date_fin is None,
        "etat": etat,
        "etat_libelle": LIBELLES_ETAT.get(etat, etat),
        "utilisations": lp.utilisations,
        "derniere_utilisation": lp.derniere_utilisation,
        "date_revocation": lp.date_revocation,
    }


def _duree(valeur):
    """Durée demandée → nombre de jours, None (illimité) ou -1 (refusée)."""
    if valeur in ("", "illimite", None):
        return None
    try:
        jours = int(valeur)
    except (TypeError, ValueError):
        return -1
    return jours if jours in DUREES_PERMISES else -1


def _generer(request, admin, mot_de_passe, duree, origine):
    """Fabrique, enregistre et journalise un laissez-passer ; renvoie la réponse HTTP."""
    date_fin = None if duree is None else timezone.localdate() + timedelta(days=duree)
    try:
        code, numero = fabriquer_code(admin.username, mot_de_passe, date_fin)
    except ErreurLaissezPasser as erreur:
        return Response({"detail": str(erreur)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    lp = LaissezPasser.objects.create(
        admin=admin,
        admin_identifiant=admin.username,
        numero=numero,
        date_fin=date_fin,
        empreinte_compte=admin.password,
    )
    fin_texte = "illimité" if date_fin is None else "jusqu'au " + date_fin.strftime("%d/%m/%Y")
    journaliser(
        request,
        admin,
        "laissez_passer_genere",
        detail=f"n° {numero} · {fin_texte}",
        donnees={"numero": numero, "date_fin": date_fin.isoformat() if date_fin else None},
        origine=origine,
    )
    # Le code n'est montré qu'une fois : il n'est gardé nulle part.
    return Response({**_json(lp), "code": code}, status=status.HTTP_201_CREATED)


def _uuid(valeur):
    import uuid

    try:
        uuid.UUID(str(valeur))
    except (TypeError, ValueError):
        return False
    return True


def _revoquer(request, lp, admin, origine):
    if lp.revoque:
        return
    lp.revoque = True
    lp.date_revocation = timezone.now()
    lp.revoque_par = admin
    lp.save(update_fields=["revoque", "date_revocation", "revoque_par", "date_modification"])
    journaliser(
        request, admin, "laissez_passer_revoque", detail=f"n° {lp.numero} de {lp.admin_identifiant}", origine=origine
    )


class LaissezPasserView(APIView):
    permission_classes = [a_le_droit_admin("laissez_passer")]

    def get(self, request):
        qs = LaissezPasser.objects.select_related("admin")
        if not request.user.is_superuser:
            qs = qs.filter(admin=request.user)
        return Response({"laissez_passer": [_json(lp) for lp in qs[:200]], "durees": DUREES_PERMISES})

    def post(self, request):
        mot_de_passe = str(request.data.get("mot_de_passe") or "")
        if not request.user.check_password(mot_de_passe):
            return Response({"mot_de_passe": ["Mot de passe incorrect."]}, status=status.HTTP_400_BAD_REQUEST)
        duree = _duree(request.data.get("duree_jours"))
        if duree == -1:
            return Response({"duree_jours": ["Durée non proposée."]}, status=status.HTTP_400_BAD_REQUEST)
        return _generer(request, request.user, mot_de_passe, duree, "espace_admin")


class LaissezPasserAppliView(APIView):
    """
    Espace Admin de l'appli (bureau, mobile) avec internet : identifiants admin
    dans la requête, comme les autres actions de cet espace. Même droit, même
    journal (origine « Espace Admin de l'appli »). Réponse vague en cas de refus.
    `action` : absente = générer ; « lister » = ses laissez-passer (tous pour le
    superuser, comme sur le site) ; « revoquer » + `id`.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        mot_de_passe = str(request.data.get("password") or "")
        admin = authenticate(request, username=request.data.get("username", ""), password=mot_de_passe)
        if not (admin and admin.is_active and (admin.is_staff or admin.is_superuser)):
            return Response({"detail": "Identifiants administrateur refusés."}, status=status.HTTP_403_FORBIDDEN)
        if not a_le_droit(admin, "laissez_passer"):
            return Response(
                {"detail": "Votre compte administrateur n'a pas le droit de générer des laissez-passer."},
                status=status.HTTP_403_FORBIDDEN,
            )
        action = request.data.get("action")
        if action in ("lister", "revoquer"):
            qs = LaissezPasser.objects.select_related("admin")
            if not admin.is_superuser:
                qs = qs.filter(admin=admin)
            if action == "revoquer":
                lp = qs.filter(pk=str(request.data.get("id") or "")).first() if _uuid(request.data.get("id")) else None
                if lp is None:
                    return Response({"detail": "Laissez-passer introuvable."}, status=status.HTTP_404_NOT_FOUND)
                _revoquer(request, lp, admin, "bureau")
            return Response({"laissez_passer": [_json(lp) for lp in qs[:200]]})
        duree = _duree(request.data.get("duree_jours"))
        if duree == -1:
            return Response({"duree_jours": ["Durée non proposée."]}, status=status.HTTP_400_BAD_REQUEST)
        return _generer(request, admin, mot_de_passe, duree, "bureau")


class RevoquerLaissezPasserView(APIView):
    permission_classes = [a_le_droit_admin("laissez_passer")]

    def post(self, request, pk):
        qs = LaissezPasser.objects.select_related("admin")
        if not request.user.is_superuser:
            qs = qs.filter(admin=request.user)
        lp = qs.filter(pk=pk).first()
        if lp is None:
            return Response({"detail": "Laissez-passer introuvable."}, status=status.HTTP_404_NOT_FOUND)
        _revoquer(request, lp, request.user, "espace_admin")
        return Response(_json(lp))


class UtilisationLaissezPasserView(APIView):
    """
    Appel d'un appareil revenu sur internet (sans session : l'appareil n'a que
    le laissez-passer). Le numéro (8 octets aléatoires) est inscrit dans le
    code signé ; on ne répond rien d'autre que « vaut-il encore ».
    Corps : {numero, identifiant, utilisations: [{date, appareil, boutique}]}.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        numero = str(request.data.get("numero") or "").lower()
        identifiant = str(request.data.get("identifiant") or "")
        lp = LaissezPasser.objects.select_related("admin").filter(numero=numero).first()
        if lp is None or lp.admin_identifiant != identifiant:
            return Response({"valide": False, "etat": "inconnu"})
        utilisations = request.data.get("utilisations") or []
        if isinstance(utilisations, list) and utilisations:
            for u in utilisations[:50]:
                u = u if isinstance(u, dict) else {}
                journaliser(
                    request,
                    lp.admin,
                    "laissez_passer_utilise",
                    detail=f"n° {lp.numero} · {str(u.get('appareil') or '?')[:80]} · {str(u.get('boutique') or 'appareil neuf')[:80]}",
                    donnees={"numero": lp.numero, "date": str(u.get("date") or "")[:40]},
                    origine="bureau",
                )
            lp.utilisations += len(utilisations[:50])
            lp.derniere_utilisation = timezone.now()
            lp.save(update_fields=["utilisations", "derniere_utilisation", "date_modification"])
        etat = lp.etat()
        return Response({"valide": etat == "actif", "etat": etat, "etat_libelle": LIBELLES_ETAT.get(etat, etat)})
