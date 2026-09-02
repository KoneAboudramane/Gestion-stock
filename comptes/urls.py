from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

router = DefaultRouter()
router.register("roles", views.RoleViewSet, basename="role")
router.register("utilisateurs", views.UtilisateurViewSet, basename="utilisateur")

urlpatterns = [
    path("auth/inscription/", views.InscriptionView.as_view(), name="inscription"),
    path("auth/connexion/", views.ConnexionView.as_view(), name="connexion"),
    path("auth/verifier-acces-admin/", views.VerifierAccesAdminView.as_view(), name="verifier-acces-admin"),
    path("auth/verifier-session-admin/", views.VerifierSessionAdminView.as_view(), name="verifier-session-admin"),
    path("auth/appliquer-abonnement/", views.AppliquerAbonnementView.as_view(), name="appliquer-abonnement"),
    path(
        "auth/reinitialiser-mot-de-passe-admin/",
        views.ReinitialiserMotDePasseAdminView.as_view(),
        name="reinitialiser-mot-de-passe-admin",
    ),
    path("auth/lister-patrons/", views.ListerPatronsView.as_view(), name="lister-patrons"),
    path(
        "auth/enregistrer-boutique-locale/",
        views.EnregistrerBoutiqueLocaleView.as_view(),
        name="enregistrer-boutique-locale",
    ),
    path("auth/rafraichir/", TokenRefreshView.as_view(), name="rafraichir"),
    path("auth/moi/", views.MoiView.as_view(), name="moi"),
    path("auth/mot-de-passe-oublie/", views.DemandeReinitialisationView.as_view(), name="mot-de-passe-oublie"),
    path(
        "auth/reinitialiser-mot-de-passe/",
        views.ReinitialisationMotDePasseView.as_view(),
        name="reinitialiser-mot-de-passe",
    ),
    path("boutique/", views.BoutiqueDetailView.as_view(), name="boutique-detail"),
    path("", include(router.urls)),
]
