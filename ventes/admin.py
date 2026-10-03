from django.contrib import admin

from .models import CommandeClient, LigneCommandeClient, LigneVente, Paiement, Vente


class LigneVenteInline(admin.TabularInline):
    model = LigneVente
    extra = 0


class PaiementInline(admin.TabularInline):
    model = Paiement
    extra = 0


@admin.register(Vente)
class VenteAdmin(admin.ModelAdmin):
    list_display = (
        "numero",
        "boutique",
        "depot",
        "client",
        "total_net",
        "statut",
        "date_creation",
    )
    search_fields = ("numero", "client__nom")
    list_filter = ("boutique", "depot", "statut")
    inlines = [LigneVenteInline, PaiementInline]


@admin.register(LigneVente)
class LigneVenteAdmin(admin.ModelAdmin):
    list_display = ("vente", "variante", "quantite", "prix_unitaire", "sous_total")
    list_filter = ("vente__boutique",)


@admin.register(Paiement)
class PaiementAdmin(admin.ModelAdmin):
    list_display = ("vente", "mode", "operateur", "montant")
    list_filter = ("mode", "operateur")


class LigneCommandeClientInline(admin.TabularInline):
    model = LigneCommandeClient
    extra = 0


@admin.register(CommandeClient)
class CommandeClientAdmin(admin.ModelAdmin):
    list_display = ("numero", "boutique", "client", "depot", "statut", "date_livraison_prevue", "total", "avance")
    search_fields = ("numero", "client__nom")
    list_filter = ("boutique", "statut")
    inlines = [LigneCommandeClientInline]
