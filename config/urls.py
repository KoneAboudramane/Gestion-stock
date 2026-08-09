from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("comptes.urls")),
    path("api/", include("catalogue.urls")),
    path("api/", include("stock.urls")),
    path("api/", include("ventes.urls")),
    path("api/", include("fournisseurs.urls")),
    path("api/", include("achats.urls")),
    path("api/", include("clients.urls")),
    path("api/", include("rapports.urls")),
    path("api/", include("synchronisation.urls")),
    path("api/", include("configuration.urls")),
    path("api/", include("paiements.urls")),
    path("api/", include("notifications.urls")),
]
