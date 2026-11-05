"""Admin Django (secours, superuser seul) : profils admin et journal en lecture seule."""
from django.contrib import admin

from .models import JournalAdmin, ProfilAdmin


@admin.register(ProfilAdmin)
class ProfilAdminAdmin(admin.ModelAdmin):
    list_display = ("utilisateur", "double_verification_exigee", "totp_actif", "date_modification")
    list_filter = ("double_verification_exigee", "totp_actif")
    search_fields = ("utilisateur__username",)
    # Le secret ne s'affiche jamais ; décocher « totp_actif » oblige à reconfigurer l'appli.
    exclude = ("totp_secret", "totp_dernier_pas", "synchronise", "supprime", "date_synchronisation")
    raw_id_fields = ("utilisateur",)


@admin.register(JournalAdmin)
class JournalAdminAdmin(admin.ModelAdmin):
    list_display = ("date_creation", "admin_identifiant", "action", "boutique_nom", "origine", "adresse_ip")
    list_filter = ("origine", "action")
    search_fields = ("admin_identifiant", "boutique_nom", "detail")
    date_hierarchy = "date_creation"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
