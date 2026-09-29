from django.contrib import admin

from .models import (
    Depot,
    Destockage,
    Inventaire,
    OperationDestockage,
    LigneInventaire,
    MouvementStock,
    PerteStock,
    Detaillage,
    ReleveDormants,
    Stock,
    TransfertStock,
)


@admin.register(Depot)
class DepotAdmin(admin.ModelAdmin):
    list_display = ("nom", "boutique", "adresse")
    search_fields = ("nom",)
    list_filter = ("boutique",)


@admin.register(Stock)
class StockAdmin(admin.ModelAdmin):
    list_display = ("variante", "depot", "quantite")
    search_fields = ("variante__reference", "variante__produit__nom")
    list_filter = ("depot",)


@admin.register(MouvementStock)
class MouvementStockAdmin(admin.ModelAdmin):
    list_display = ("variante", "depot", "type", "quantite", "utilisateur", "date_creation")
    search_fields = ("variante__reference", "variante__produit__nom", "motif")
    list_filter = ("type", "depot")


@admin.register(TransfertStock)
class TransfertStockAdmin(admin.ModelAdmin):
    list_display = ("variante", "depot_source", "depot_destination", "quantite", "utilisateur")
    list_filter = ("depot_source", "depot_destination")


@admin.register(PerteStock)
class PerteStockAdmin(admin.ModelAdmin):
    list_display = ("variante", "depot", "quantite", "motif", "valeur", "utilisateur", "date_creation")
    list_filter = ("motif", "depot")


@admin.register(Detaillage)
class DetaillageAdmin(admin.ModelAdmin):
    list_display = ("type", "variante_source", "quantite_source", "variante_cible", "quantite_cible", "depot", "annulee", "date_creation")
    list_filter = ("type", "depot", "annulee")


@admin.register(ReleveDormants)
class ReleveDormantsAdmin(admin.ModelAdmin):
    list_display = ("boutique", "date", "jours_seuil", "nombre_articles", "valeur_immobilisee")
    list_filter = ("boutique",)


@admin.register(OperationDestockage)
class OperationDestockageAdmin(admin.ModelAdmin):
    list_display = ("nom", "boutique", "date_fin", "date_creation")


@admin.register(Destockage)
class DestockageAdmin(admin.ModelAdmin):
    list_display = (
        "variante", "operation", "prix_normal", "prix_destockage", "date_fin", "statut", "motif_fin", "date_creation",
    )
    list_filter = ("statut", "motif_fin")


class LigneInventaireInline(admin.TabularInline):
    model = LigneInventaire
    extra = 0


@admin.register(Inventaire)
class InventaireAdmin(admin.ModelAdmin):
    list_display = ("boutique", "depot", "statut", "utilisateur", "date_creation")
    list_filter = ("statut", "depot")
    inlines = [LigneInventaireInline]


@admin.register(LigneInventaire)
class LigneInventaireAdmin(admin.ModelAdmin):
    list_display = ("inventaire", "variante", "qte_theorique", "qte_physique", "ecart")
    list_filter = ("inventaire",)
