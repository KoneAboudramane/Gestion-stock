from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("ventes", views.VenteViewSet, basename="vente")

urlpatterns = [
    path("", include(router.urls)),
]
