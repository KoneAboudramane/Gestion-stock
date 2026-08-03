from django.urls import path

from . import views

urlpatterns = [
    path("rapports/ventes/synthese/", views.SyntheseVentesView.as_view(), name="rapport-synthese-ventes"),
    path("rapports/produits/top/", views.TopProduitsView.as_view(), name="rapport-top-produits"),
    path("rapports/stock/valeur/", views.ValeurStockView.as_view(), name="rapport-valeur-stock"),
    path("rapports/ventes/par-vendeur/", views.VentesParVendeurView.as_view(), name="rapport-ventes-par-vendeur"),
    path("rapports/ventes/par-categorie/", views.VentesParCategorieView.as_view(), name="rapport-ventes-par-categorie"),
    path(
        "rapports/ventes/par-mode-paiement/", views.VentesParModePaiementView.as_view(),
        name="rapport-ventes-par-mode-paiement",
    ),
    path("rapports/ventes/par-jour/", views.VentesParJourView.as_view(), name="rapport-ventes-par-jour"),
    path("rapports/clients/top/", views.TopClientsView.as_view(), name="rapport-top-clients"),
]
