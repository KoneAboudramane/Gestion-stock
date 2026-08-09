from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import Parametre
from .serializers import ParametreSerializer

PeutGererReglages = a_la_permission("gerer_utilisateurs_reglages")


class ParametreViewSet(FiltreBoutiqueMixin, viewsets.ModelViewSet):
    serializer_class = ParametreSerializer
    queryset = Parametre.objects.all()

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [EstMembreBoutique()]
        return [EstMembreBoutique(), PeutGererReglages()]

    @action(detail=False, methods=["post"])
    def definir(self, request):
        # unique_together(boutique, cle) : upsert par clé plutôt qu'un create()
        # qui échouerait sur une clé déjà existante — même sémantique que
        # client-electron/electron/services/reglages.ts::definirParametre.
        cle = (request.data.get("cle") or "").strip()
        valeur = request.data.get("valeur") or ""
        if not cle:
            return Response({"cle": "Ce champ est requis."}, status=400)
        parametre, _ = Parametre.objects.update_or_create(
            boutique=request.user.boutique, cle=cle, defaults={"valeur": valeur}
        )
        return Response(ParametreSerializer(parametre).data)
