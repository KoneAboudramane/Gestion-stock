from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("parametres", views.ParametreViewSet, basename="parametre")

urlpatterns = [
    path("", include(router.urls)),
]
