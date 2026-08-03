from rest_framework import viewsets

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import Attribut, Categorie, Produit, Unite, ValeurAttribut, Variante
from .serializers import (
    AttributSerializer,
    CategorieSerializer,
    ProduitSerializer,
    UniteSerializer,
    ValeurAttributSerializer,
    VarianteSerializer,
)

PermissionEcritureCatalogue = a_la_permission("gerer_produits_stock_achats")


class _CatalogueViewSetBase(FiltreBoutiqueMixin, viewsets.ModelViewSet):
    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [EstMembreBoutique()]
        return [EstMembreBoutique(), PermissionEcritureCatalogue()]


class CategorieViewSet(_CatalogueViewSetBase):
    serializer_class = CategorieSerializer
    queryset = Categorie.objects.all()


class UniteViewSet(_CatalogueViewSetBase):
    serializer_class = UniteSerializer
    queryset = Unite.objects.all()


class AttributViewSet(_CatalogueViewSetBase):
    serializer_class = AttributSerializer
    queryset = Attribut.objects.all()


class ValeurAttributViewSet(_CatalogueViewSetBase):
    serializer_class = ValeurAttributSerializer
    queryset = ValeurAttribut.objects.all()
    chemin_boutique = "attribut__boutique"

    def get_queryset(self):
        queryset = super().get_queryset()
        attribut_id = self.request.query_params.get("attribut")
        if attribut_id:
            queryset = queryset.filter(attribut_id=attribut_id)
        return queryset


class ProduitViewSet(_CatalogueViewSetBase):
    serializer_class = ProduitSerializer
    queryset = Produit.objects.all().prefetch_related("variantes__valeurs")

    def perform_create(self, serializer):
        # ProduitSerializer.create() lit la boutique via le contexte (request)
        # et crée aussi la variante par défaut : pas d'assignation générique ici.
        serializer.save()


class VarianteViewSet(_CatalogueViewSetBase):
    serializer_class = VarianteSerializer
    queryset = Variante.objects.all().prefetch_related("valeurs")
    chemin_boutique = "produit__boutique"

    def get_queryset(self):
        queryset = super().get_queryset()
        produit_id = self.request.query_params.get("produit")
        if produit_id:
            queryset = queryset.filter(produit_id=produit_id)
        code_barres = self.request.query_params.get("code_barres")
        if code_barres:
            queryset = queryset.filter(code_barres=code_barres)
        return queryset
