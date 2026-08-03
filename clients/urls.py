from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("clients", views.ClientViewSet, basename="client")
router.register("credits", views.CreditViewSet, basename="credit")

urlpatterns = [
    path("", include(router.urls)),
]
