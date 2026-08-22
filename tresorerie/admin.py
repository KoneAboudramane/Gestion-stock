from django.contrib import admin

from .models import ClotureCaisse, Depense, MouvementCaisse, Transfert


@admin.register(MouvementCaisse)
class MouvementCaisseAdmin(admin.ModelAdmin):
    list_display = ("depot", "type", "categorie", "montant", "utilisateur", "date_creation")
    search_fields = ("motif",)
    list_filter = ("type", "categorie", "depot")


@admin.register(Depense)
class DepenseAdmin(admin.ModelAdmin):
    list_display = ("depot", "categorie", "montant", "utilisateur", "date_creation")
    search_fields = ("description",)
    list_filter = ("categorie", "depot")


@admin.register(Transfert)
class TransfertAdmin(admin.ModelAdmin):
    list_display = ("depot", "utilisateur_source", "operateur", "montant", "utilisateur", "date_creation")
    list_filter = ("operateur", "depot")


@admin.register(ClotureCaisse)
class ClotureCaisseAdmin(admin.ModelAdmin):
    list_display = ("depot", "solde_theorique", "solde_compte", "ecart", "utilisateur", "date_creation")
    list_filter = ("depot",)
