from django.contrib import admin

from .models import TransactionMobileMoney


@admin.register(TransactionMobileMoney)
class TransactionMobileMoneyAdmin(admin.ModelAdmin):
    list_display = ("paiement", "fournisseur", "numero_telephone", "statut", "montant", "date_creation")
    list_filter = ("fournisseur", "statut")
    search_fields = ("numero_telephone", "reference_externe")
