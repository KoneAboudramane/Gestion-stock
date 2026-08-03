from django.contrib import admin

from .models import JournalSync


@admin.register(JournalSync)
class JournalSyncAdmin(admin.ModelAdmin):
    list_display = ("table", "enregistrement_id", "action", "statut", "boutique", "appareil", "date_creation")
    search_fields = ("table", "enregistrement_id")
    list_filter = ("action", "statut", "boutique")
