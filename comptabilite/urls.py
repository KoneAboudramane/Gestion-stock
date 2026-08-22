from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("comptabilite/comptes", views.CompteComptableViewSet, basename="comptecomptable")

urlpatterns = [
    path("comptabilite/journal/", views.JournalView.as_view(), name="comptabilite-journal"),
    path("comptabilite/grand-livre/", views.GrandLivreView.as_view(), name="comptabilite-grand-livre"),
    path("comptabilite/balance/", views.BalanceGeneraleView.as_view(), name="comptabilite-balance"),
    path("comptabilite/compte-de-resultat/", views.CompteDeResultatView.as_view(), name="comptabilite-resultat"),
    path("comptabilite/bilan/", views.BilanView.as_view(), name="comptabilite-bilan"),
    path("", include(router.urls)),
]
