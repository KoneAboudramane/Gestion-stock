from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("fournisseurs", views.FournisseurViewSet, basename="fournisseur")
router.register("dettes-fournisseur", views.DetteFournisseurViewSet, basename="dettefournisseur")

urlpatterns = [
    path("", include(router.urls)),
]
