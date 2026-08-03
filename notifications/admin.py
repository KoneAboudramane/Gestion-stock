from django.contrib import admin

from .models import Message, Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("type", "depot", "message", "date_creation")
    list_filter = ("type", "depot")
    search_fields = ("message",)


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("type", "depot", "utilisateur", "canal", "destinataire", "statut", "date_creation", "date_envoi")
    list_filter = ("type", "canal", "statut", "depot")
    search_fields = ("destinataire", "message")
