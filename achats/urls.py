from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("commandes-achat", views.CommandeAchatViewSet, basename="commandeachat")
router.register("receptions", views.ReceptionViewSet, basename="reception")

urlpatterns = [
    path("", include(router.urls)),
]
