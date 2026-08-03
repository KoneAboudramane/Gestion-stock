from django.contrib import admin

from .models import Client, Credit, PaiementCredit


class CreditInline(admin.TabularInline):
    model = Credit
    extra = 0


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ("nom", "boutique", "telephone")
    search_fields = ("nom", "telephone")
    list_filter = ("boutique",)
    inlines = [CreditInline]


@admin.register(Credit)
class CreditAdmin(admin.ModelAdmin):
    list_display = ("client", "vente", "montant", "montant_paye", "solde", "echeance", "statut")
    search_fields = ("client__nom",)
    list_filter = ("statut",)


@admin.register(PaiementCredit)
class PaiementCreditAdmin(admin.ModelAdmin):
    list_display = ("credit", "montant", "mode", "date_creation")
    list_filter = ("mode",)
