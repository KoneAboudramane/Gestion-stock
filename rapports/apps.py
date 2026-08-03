from django.apps import AppConfig


class RapportsConfig(AppConfig):
    """
    App sans modèle (CLAUDE.md) : rapports lit les autres apps
    (ventes, catalogue, stock) au lieu de stocker ses propres données.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "rapports"
