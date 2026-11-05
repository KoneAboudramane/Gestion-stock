from django.apps import AppConfig


class AdministrationConfig(AppConfig):
    """
    Espace d'administration de la plateforme (site client-admin) : profils des
    administrateurs (droits, double vérification) et journal de leurs actions.
    Ne contient aucune donnée métier des boutiques.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "administration"
    verbose_name = "Administration de la plateforme"

    def ready(self):
        from django.contrib import admin

        # L'admin Django n'est plus qu'un outil de secours, réservé au superuser :
        # les autres administrateurs passent par le site client-admin, où leurs
        # droits et la double vérification s'appliquent.
        def superuser_seulement(request):
            return bool(request.user.is_active and request.user.is_superuser)

        admin.site.has_permission = superuser_seulement
