from django.contrib import admin

from .models import DetteFournisseur, Fournisseur


class DetteFournisseurInline(admin.TabularInline):
    model = DetteFournisseur
    extra = 0


@admin.register(Fournisseur)
class FournisseurAdmin(admin.ModelAdmin):
    list_display = ("nom", "boutique", "telephone", "contact")
    search_fields = ("nom", "telephone")
    list_filter = ("boutique",)
    inlines = [DetteFournisseurInline]


@admin.register(DetteFournisseur)
class DetteFournisseurAdmin(admin.ModelAdmin):
    list_display = ("fournisseur", "commande", "montant", "montant_paye", "solde", "statut")
    search_fields = ("fournisseur__nom",)
    list_filter = ("statut",)
