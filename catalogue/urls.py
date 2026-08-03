from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("categories", views.CategorieViewSet, basename="categorie")
router.register("unites", views.UniteViewSet, basename="unite")
router.register("attributs", views.AttributViewSet, basename="attribut")
router.register("valeurs-attribut", views.ValeurAttributViewSet, basename="valeurattribut")
router.register("produits", views.ProduitViewSet, basename="produit")
router.register("variantes", views.VarianteViewSet, basename="variante")

urlpatterns = [
    path("", include(router.urls)),
]
