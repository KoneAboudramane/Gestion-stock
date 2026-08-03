from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("depots", views.DepotViewSet, basename="depot")
router.register("stocks", views.StockViewSet, basename="stock")
router.register("mouvements", views.MouvementStockViewSet, basename="mouvement")
router.register("transferts", views.TransfertStockViewSet, basename="transfert")
router.register("inventaires", views.InventaireViewSet, basename="inventaire")
router.register("lignes-inventaire", views.LigneInventaireViewSet, basename="ligneinventaire")

urlpatterns = [
    path("", include(router.urls)),
]
