from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import api_abonnements, api_boutiques, api_laissez_passer, api_principal, views

urlpatterns = [
    # Socle (lot 1)
    path("admin/connexion/", views.ConnexionAdminView.as_view(), name="admin-connexion"),
    path("admin/connexion/code/", views.CodeAdminView.as_view(), name="admin-connexion-code"),
    path("admin/rafraichir/", TokenRefreshView.as_view(), name="admin-rafraichir"),
    path("admin/moi/", views.MoiAdminView.as_view(), name="admin-moi"),
    path("admin/deconnexion/", views.DeconnexionAdminView.as_view(), name="admin-deconnexion"),
    # Tableau de bord, boutiques, inscriptions (lot 3)
    path("admin/tableau-de-bord/", api_boutiques.TableauDeBordView.as_view(), name="admin-tableau-de-bord"),
    path("admin/boutiques/", api_boutiques.ListeBoutiquesView.as_view(), name="admin-boutiques"),
    path("admin/boutiques/creer/", api_boutiques.CreerBoutiqueView.as_view(), name="admin-creer-boutique"),
    path("admin/boutiques/<uuid:pk>/", api_boutiques.FicheBoutiqueView.as_view(), name="admin-fiche-boutique"),
    path(
        "admin/identifiant-disponible/",
        api_boutiques.IdentifiantDisponibleAdminView.as_view(),
        name="admin-identifiant-disponible",
    ),
    path("admin/inscriptions/", api_boutiques.ListeInscriptionsView.as_view(), name="admin-inscriptions"),
    path(
        "admin/inscriptions/<uuid:pk>/",
        api_boutiques.TraiterInscriptionView.as_view(),
        name="admin-traiter-inscription",
    ),
    # Paiements, réseau, signalements, comptes (lot 4)
    path("admin/paiements/declares/", api_abonnements.PaiementsDeclaresView.as_view(), name="admin-paiements-declares"),
    path(
        "admin/paiements/declares/<uuid:pk>/",
        api_abonnements.TraiterPaiementDeclareView.as_view(),
        name="admin-traiter-paiement",
    ),
    path("admin/paiements/registre/", api_abonnements.RegistreView.as_view(), name="admin-registre"),
    path("admin/paiements/enregistrer/", api_abonnements.EnregistrerPeriodeView.as_view(), name="admin-enregistrer-periode"),
    path("admin/paiements/boutiques/", api_abonnements.BoutiquesPourChoixView.as_view(), name="admin-boutiques-choix"),
    path(
        "admin/boutiques/<uuid:pk>/code-activation/",
        api_abonnements.CodeActivationView.as_view(),
        name="admin-code-activation",
    ),
    path("admin/demandes-reseau/", api_abonnements.DemandesReseauView.as_view(), name="admin-demandes-reseau"),
    path(
        "admin/demandes-reseau/<uuid:pk>/",
        api_abonnements.TraiterDemandeReseauView.as_view(),
        name="admin-traiter-demande-reseau",
    ),
    path("admin/signalements/", api_abonnements.SignalementsView.as_view(), name="admin-signalements"),
    path(
        "admin/signalements/<uuid:pk>/",
        api_abonnements.TraiterSignalementView.as_view(),
        name="admin-traiter-signalement",
    ),
    path("admin/comptes/", api_abonnements.ComptesView.as_view(), name="admin-comptes"),
    path(
        "admin/comptes/<int:pk>/mot-de-passe/",
        api_abonnements.ReinitialiserMotDePasseView.as_view(),
        name="admin-reinitialiser-mot-de-passe",
    ),
    # Administrateur principal (lot 5)
    path("admin/administrateurs/", api_principal.AdministrateursView.as_view(), name="admin-administrateurs"),
    path("admin/administrateurs/<int:pk>/", api_principal.AdministrateurView.as_view(), name="admin-administrateur"),
    path("admin/reglages/", api_principal.ReglagesView.as_view(), name="admin-reglages"),
    path("admin/journal/", api_principal.JournalView.as_view(), name="admin-journal"),
    path("admin/mon-mot-de-passe/", api_principal.MonMotDePasseView.as_view(), name="admin-mon-mot-de-passe"),
    # Laissez-passer admin (Espace Admin d'un appareil sans internet, docs/plan_laissez_passer_admin.md).
    path("admin/laissez-passer/", api_laissez_passer.LaissezPasserView.as_view(), name="admin-laissez-passer"),
    path(
        "admin/laissez-passer/<uuid:pk>/revoquer/",
        api_laissez_passer.RevoquerLaissezPasserView.as_view(),
        name="admin-laissez-passer-revoquer",
    ),
    path(
        "admin/laissez-passer/depuis-appli/",
        api_laissez_passer.LaissezPasserAppliView.as_view(),
        name="admin-laissez-passer-appli",
    ),
    path(
        "admin/laissez-passer/utilisation/",
        api_laissez_passer.UtilisationLaissezPasserView.as_view(),
        name="admin-laissez-passer-utilisation",
    ),
]
