from django.contrib import admin

from .models import CommandeAchat, EvenementCommande, LigneAchat, Reception


class LigneAchatInline(admin.TabularInline):
    model = LigneAchat
    extra = 0


@admin.register(CommandeAchat)
class CommandeAchatAdmin(admin.ModelAdmin):
    list_display = ("numero", "boutique", "fournisseur", "statut", "total", "date_creation")
    search_fields = ("numero", "fournisseur__nom")
    list_filter = ("boutique", "statut")
    inlines = [LigneAchatInline]


@admin.register(LigneAchat)
class LigneAchatAdmin(admin.ModelAdmin):
    list_display = ("commande", "variante", "quantite", "prix_achat", "sous_total")
    list_filter = ("commande__boutique",)


@admin.register(Reception)
class ReceptionAdmin(admin.ModelAdmin):
    list_display = ("commande", "depot", "utilisateur", "date_creation")
    list_filter = ("depot",)


@admin.register(EvenementCommande)
class EvenementCommandeAdmin(admin.ModelAdmin):
    list_display = ("commande", "type", "utilisateur", "montant", "date_creation")
    list_filter = ("type", "commande__boutique")
    search_fields = ("commande__numero",)
