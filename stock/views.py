from django.db.models import F
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import Depot, Inventaire, LigneInventaire, MouvementStock, Stock, TransfertStock
from .serializers import (
    DepotSerializer,
    InventaireSerializer,
    LigneInventaireSerializer,
    MouvementStockSerializer,
    StockSerializer,
    TransfertStockSerializer,
)
from .services import valider_inventaire

PeutConsulterStock = a_la_permission("consulter_stock")
PeutGererStock = a_la_permission("gerer_produits_stock_achats")


class DepotViewSet(FiltreBoutiqueMixin, viewsets.ModelViewSet):
    serializer_class = DepotSerializer
    queryset = Depot.objects.all()

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [EstMembreBoutique()]
        return [EstMembreBoutique(), PeutGererStock()]


class _LectureStockMixin(FiltreBoutiqueMixin):
    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [EstMembreBoutique(), PeutConsulterStock()]
        return [EstMembreBoutique(), PeutGererStock()]


class StockViewSet(_LectureStockMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = StockSerializer
    queryset = Stock.objects.select_related("variante", "variante__produit", "depot")
    chemin_boutique = "depot__boutique"

    def get_queryset(self):
        queryset = super().get_queryset()
        depot_id = self.request.query_params.get("depot")
        if depot_id:
            queryset = queryset.filter(depot_id=depot_id)
        return queryset

    @action(detail=False)
    def ruptures(self, request):
        queryset = self.get_queryset().filter(quantite__lte=F("variante__seuil_alerte"))
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)


class MouvementStockViewSet(
    _LectureStockMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.CreateModelMixin, viewsets.GenericViewSet,
):
    serializer_class = MouvementStockSerializer
    queryset = MouvementStock.objects.select_related("variante", "depot", "utilisateur")
    chemin_boutique = "depot__boutique"

    def get_queryset(self):
        queryset = super().get_queryset()
        variante_id = self.request.query_params.get("variante")
        if variante_id:
            queryset = queryset.filter(variante_id=variante_id)
        return queryset


class TransfertStockViewSet(
    _LectureStockMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.CreateModelMixin, viewsets.GenericViewSet,
):
    serializer_class = TransfertStockSerializer
    queryset = TransfertStock.objects.select_related("variante", "depot_source", "depot_destination")
    chemin_boutique = "depot_source__boutique"


class InventaireViewSet(_LectureStockMixin, viewsets.ModelViewSet):
    serializer_class = InventaireSerializer
    queryset = Inventaire.objects.prefetch_related("lignes")
    chemin_boutique = "boutique"

    def perform_create(self, serializer):
        # InventaireSerializer.create() lit la boutique via le contexte (request)
        # et démarre l'inventaire (lignes pré-remplies) : pas d'assignation générique ici.
        serializer.save()

    @action(detail=True, methods=["post"])
    def valider(self, request, pk=None):
        inventaire = self.get_object()
        valider_inventaire(inventaire)
        return Response(self.get_serializer(inventaire).data)


class LigneInventaireViewSet(
    _LectureStockMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin, viewsets.GenericViewSet,
):
    serializer_class = LigneInventaireSerializer
    queryset = LigneInventaire.objects.select_related("inventaire", "variante")
    chemin_boutique = "inventaire__boutique"
