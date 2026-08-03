from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import Vente
from .serializers import VenteSerializer
from .services import annuler_vente

PeutVendre = a_la_permission("vendre")
PeutAnnulerVente = a_la_permission("annuler_vente")


class VenteViewSet(
    FiltreBoutiqueMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.CreateModelMixin, viewsets.GenericViewSet,
):
    """Une vente est immuable une fois créée : correction = annulation, pas d'update."""

    serializer_class = VenteSerializer
    queryset = Vente.objects.all().prefetch_related("lignes", "paiements")

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [EstMembreBoutique()]
        if self.action == "annuler":
            return [EstMembreBoutique(), PeutAnnulerVente()]
        return [EstMembreBoutique(), PeutVendre()]

    def perform_create(self, serializer):
        # VenteSerializer.create() lit la boutique via le contexte (request)
        # et orchestre toute la vente (lignes, paiements, stock, crédit).
        serializer.save()

    @action(detail=True, methods=["post"])
    def annuler(self, request, pk=None):
        vente = self.get_object()
        annuler_vente(vente, utilisateur=request.user)
        return Response(self.get_serializer(vente).data)
