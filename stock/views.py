from django.db.models import F
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from comptes.models import Boutique
from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import Depot, Destockage, Inventaire, OperationDestockage, LigneInventaire, MouvementStock, PerteStock, Stock, TransfertStock
from .serializers import (
    DepotSerializer,
    DestockageSerializer,
    InventaireSerializer,
    OperationDestockageSerializer,
    LigneInventaireSerializer,
    MouvementStockSerializer,
    PerteStockSerializer,
    StockSerializer,
    TransfertStockSerializer,
)
from .services import (
    ajouter_ligne_inventaire,
    annuler_perte,
    arreter_destockage,
    arreter_operation_destockage,
    modifier_destockage,
    valider_inventaire,
)

PeutConsulterStock = a_la_permission("consulter_stock")
PeutGererStock = a_la_permission("gerer_produits_stock_achats")


class DepotViewSet(FiltreBoutiqueMixin, viewsets.ModelViewSet):
    serializer_class = DepotSerializer
    queryset = Depot.objects.all()

    # Formule Essentiel/Pro (voir Boutique.Formule) : Essentiel plafonne à un
    # seul dépôt. Pas de plafond en Pro. Garde-fou côté API — l'appli crée
    # d'abord en local (SQLite/IndexedDB) et pousse via /sync/push/, où le
    # même plafond est appliqué côté client (voir services/stock.ts::creerDepot).
    LIMITE_DEPOTS_ESSENTIEL = 1

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [EstMembreBoutique()]
        return [EstMembreBoutique(), PeutGererStock()]

    def perform_create(self, serializer):
        boutique = self.request.user.boutique
        if (
            boutique.formule == Boutique.Formule.ESSENTIEL
            and Depot.objects.filter(boutique=boutique, supprime=False).count() >= self.LIMITE_DEPOTS_ESSENTIEL
        ):
            raise serializers.ValidationError(
                {
                    "detail": (
                        "La formule Essentiel est limitée à un seul dépôt. "
                        "Passez à la formule Pro pour en ajouter d'autres."
                    )
                }
            )
        super().perform_create(serializer)

    def perform_destroy(self, instance):
        # Même règle que les clients : on ne supprime pas un dépôt qui contient
        # encore de la marchandise (le stock deviendrait orphelin).
        if Stock.objects.filter(depot=instance, quantite__gt=0).exists():
            raise serializers.ValidationError(
                {"detail": "Ce dépôt contient encore du stock : transférez-le d'abord vers un autre dépôt."}
            )
        super().perform_destroy(instance)


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


class PerteStockViewSet(
    _LectureStockMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.CreateModelMixin, viewsets.GenericViewSet,
):
    serializer_class = PerteStockSerializer
    queryset = PerteStock.objects.select_related("variante", "depot", "utilisateur")
    chemin_boutique = "depot__boutique"

    @action(detail=True, methods=["post"])
    def annuler(self, request, pk=None):
        perte = annuler_perte(self.get_object(), utilisateur=request.user)
        return Response(PerteStockSerializer(perte).data)


class DestockageViewSet(
    _LectureStockMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.CreateModelMixin, viewsets.GenericViewSet,
):
    serializer_class = DestockageSerializer
    queryset = Destockage.objects.select_related("variante", "utilisateur")
    chemin_boutique = "variante__produit__boutique"

    @action(detail=True, methods=["post"])
    def arreter(self, request, pk=None):
        destockage = arreter_destockage(self.get_object())
        return Response(DestockageSerializer(destockage).data)

    @action(detail=True, methods=["post"])
    def modifier(self, request, pk=None):
        donnees = {}
        if "prix_destockage" in request.data:
            donnees["prix_destockage"] = serializers.DecimalField(max_digits=12, decimal_places=2).to_internal_value(
                request.data["prix_destockage"]
            )
        if "date_fin" in request.data:
            valeur = request.data["date_fin"]
            donnees["date_fin"] = serializers.DateField().to_internal_value(valeur) if valeur else None
        destockage = modifier_destockage(self.get_object(), **donnees)
        return Response(DestockageSerializer(destockage).data)


class OperationDestockageViewSet(
    _LectureStockMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.CreateModelMixin, viewsets.GenericViewSet,
):
    serializer_class = OperationDestockageSerializer
    queryset = OperationDestockage.objects.prefetch_related("destockages")
    chemin_boutique = "boutique"

    @action(detail=True, methods=["post"])
    def arreter(self, request, pk=None):
        operation = arreter_operation_destockage(self.get_object())
        return Response(OperationDestockageSerializer(operation, context={"request": request}).data)


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

    @action(detail=True, methods=["post"], url_path="ajouter-ligne")
    def ajouter_ligne(self, request, pk=None):
        """{"variante": id, "qte_physique": "3"} : article absent de la liste."""
        from catalogue.models import Variante

        variante = Variante.objects.filter(
            id=request.data.get("variante"), produit__boutique=request.user.boutique
        ).first()
        if variante is None:
            raise serializers.ValidationError("Article introuvable.")
        qte = serializers.DecimalField(max_digits=12, decimal_places=2).to_internal_value(
            request.data.get("qte_physique", 0)
        )
        ligne = ajouter_ligne_inventaire(self.get_object(), variante, qte)
        return Response(LigneInventaireSerializer(ligne).data)


class LigneInventaireViewSet(
    _LectureStockMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin, viewsets.GenericViewSet,
):
    serializer_class = LigneInventaireSerializer
    queryset = LigneInventaire.objects.select_related("inventaire", "variante")
    chemin_boutique = "inventaire__boutique"
