from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("depenses", views.DepenseViewSet, basename="depense")
router.register("transferts-caisse", views.TransfertViewSet, basename="transfertcaisse")
router.register("mouvements-caisse", views.MouvementCaisseViewSet, basename="mouvementcaisse")
router.register("clotures-caisse", views.ClotureCaisseViewSet, basename="cloturecaisse")

urlpatterns = [
    path("retraits-caisse/", views.RetraitView.as_view(), name="retrait-caisse"),
    path("apports-caisse/", views.ApportView.as_view(), name="apport-caisse"),
    path("ajustements-caisse/", views.AjustementView.as_view(), name="ajustement-caisse"),
    path("", include(router.urls)),
]
