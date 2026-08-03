from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("transactions-mobile-money", views.TransactionMobileMoneyViewSet, basename="transactionmobilemoney")

urlpatterns = [
    path("", include(router.urls)),
]
