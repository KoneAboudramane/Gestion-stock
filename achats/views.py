from rest_framework import mixins, viewsets

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import CommandeAchat, Reception
from .serializers import CommandeAchatSerializer, ReceptionSerializer

PeutGererAchats = a_la_permission("gerer_produits_stock_achats")


class CommandeAchatViewSet(FiltreBoutiqueMixin, viewsets.ModelViewSet):
    """Back-office uniquement : le Caissier n'a pas accès aux achats."""

    serializer_class = CommandeAchatSerializer
    queryset = CommandeAchat.objects.all().prefetch_related("lignes")
    http_method_names = ["get", "post", "patch", "put", "head", "options"]
    permission_classes = [EstMembreBoutique, PeutGererAchats]

    def perform_create(self, serializer):
        # CommandeAchatSerializer.create() lit la boutique via le contexte.
        serializer.save()


class ReceptionViewSet(
    FiltreBoutiqueMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.CreateModelMixin, viewsets.GenericViewSet,
):
    """Une réception est immuable (déclenche le stock) : create seulement."""

    serializer_class = ReceptionSerializer
    queryset = Reception.objects.select_related("commande", "depot")
    chemin_boutique = "commande__boutique"
    permission_classes = [EstMembreBoutique, PeutGererAchats]
