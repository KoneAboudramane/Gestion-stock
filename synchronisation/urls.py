from django.urls import path

from . import views

urlpatterns = [
    path("sync/push/", views.PushView.as_view(), name="sync-push"),
    path("sync/pull/", views.PullView.as_view(), name="sync-pull"),
]
