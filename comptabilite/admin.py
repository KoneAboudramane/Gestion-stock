from django.contrib import admin

from .models import (
    CompteComptable,
    EcritureComptable,
    ExerciceComptable,
    JournalComptable,
    LigneEcriture,
)


class LigneEcritureInline(admin.TabularInline):
    model = LigneEcriture
    extra = 2


@admin.register(CompteComptable)
class CompteComptableAdmin(admin.ModelAdmin):
    list_display = ("numero", "libelle", "classe", "boutique", "actif")
    search_fields = ("numero", "libelle")
    list_filter = ("boutique", "classe", "actif")
    ordering = ("numero",)


@admin.register(ExerciceComptable)
class ExerciceComptableAdmin(admin.ModelAdmin):
    list_display = ("libelle", "boutique", "date_debut", "date_fin", "statut")
    list_filter = ("boutique", "statut")


@admin.register(JournalComptable)
class JournalComptableAdmin(admin.ModelAdmin):
    list_display = ("code", "libelle", "boutique")
    list_filter = ("boutique", "code")


@admin.register(EcritureComptable)
class EcritureComptableAdmin(admin.ModelAdmin):
    list_display = ("numero", "journal", "date_ecriture", "libelle", "statut", "boutique")
    search_fields = ("libelle", "numero")
    list_filter = ("boutique", "journal", "statut", "exercice")
    inlines = [LigneEcritureInline]
