from django.contrib import admin

from .models import (
    Attribut,
    Categorie,
    Produit,
    Unite,
    ValeurAttribut,
    Variante,
    VarianteValeur,
)


@admin.register(Categorie)
class CategorieAdmin(admin.ModelAdmin):
    list_display = ("nom", "boutique", "categorie_parent")
    search_fields = ("nom",)
    list_filter = ("boutique",)


@admin.register(Unite)
class UniteAdmin(admin.ModelAdmin):
    list_display = ("nom", "abreviation", "boutique")
    search_fields = ("nom",)
    list_filter = ("boutique",)


@admin.register(Produit)
class ProduitAdmin(admin.ModelAdmin):
    list_display = ("nom", "boutique", "categorie", "unite", "actif")
    search_fields = ("nom",)
    list_filter = ("boutique", "categorie", "actif")


@admin.register(Attribut)
class AttributAdmin(admin.ModelAdmin):
    list_display = ("nom", "boutique")
    search_fields = ("nom",)
    list_filter = ("boutique",)


@admin.register(ValeurAttribut)
class ValeurAttributAdmin(admin.ModelAdmin):
    list_display = ("attribut", "valeur")
    search_fields = ("valeur",)
    list_filter = ("attribut",)


class VarianteValeurInline(admin.TabularInline):
    model = VarianteValeur
    extra = 1


@admin.register(Variante)
class VarianteAdmin(admin.ModelAdmin):
    list_display = (
        "__str__",
        "produit",
        "reference",
        "code_barres",
        "prix_achat",
        "prix_vente",
        "seuil_alerte",
        "actif",
    )
    search_fields = ("reference", "code_barres", "produit__nom")
    list_filter = ("produit__boutique", "actif")
    inlines = [VarianteValeurInline]


@admin.register(VarianteValeur)
class VarianteValeurAdmin(admin.ModelAdmin):
    list_display = ("variante", "valeur_attribut")
    list_filter = ("valeur_attribut__attribut",)
