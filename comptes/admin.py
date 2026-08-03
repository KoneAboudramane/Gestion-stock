from datetime import timedelta

from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html

from .forms import FormulaireAbonnement
from .models import Boutique, DemandeInscription, Role, Utilisateur
from .services import (
    approuver_inscription,
    point_depart_renouvellement,
    rejeter_inscription,
    renouveler_abonnement,
)

DUREE_ESSAI_A_L_APPROBATION = timedelta(days=30)
DUREE_RENOUVELLEMENT_PAR_DEFAUT = timedelta(days=30)


@admin.register(Boutique)
class BoutiqueAdmin(admin.ModelAdmin):
    list_display = (
        "nom", "telephone", "devise", "formule", "actif",
        "date_expiration_abonnement", "lien_renouveler", "date_creation",
    )
    search_fields = ("nom", "telephone", "email")
    list_filter = ("actif", "formule", "devise")
    actions = ["renouveler_abonnement_action"]

    def get_urls(self):
        return [
            path(
                "<uuid:boutique_id>/renouveler/",
                self.admin_site.admin_view(self.vue_renouvellement),
                name="comptes_boutique_renouveler",
            ),
        ] + super().get_urls()

    def lien_renouveler(self, obj):
        url = reverse("admin:comptes_boutique_renouveler", args=[obj.pk])
        return format_html('<a href="{}">Renouveler</a>', url)

    lien_renouveler.short_description = "Abonnement"

    @admin.action(description="Renouveler l'abonnement (choisir la durée et la formule)")
    def renouveler_abonnement_action(self, request, queryset):
        if queryset.count() != 1:
            self.message_user(
                request, "Sélectionnez une seule boutique à la fois pour renouveler son abonnement.",
                level=messages.ERROR,
            )
            return
        boutique = queryset.first()
        return HttpResponseRedirect(reverse("admin:comptes_boutique_renouveler", args=[boutique.pk]))

    def vue_renouvellement(self, request, boutique_id):
        boutique = self.get_object(request, boutique_id)
        if boutique is None:
            self.message_user(request, "Boutique introuvable.", level=messages.ERROR)
            return HttpResponseRedirect(reverse("admin:comptes_boutique_changelist"))

        if request.method == "POST":
            form = FormulaireAbonnement(request.POST)
            if form.is_valid():
                renouveler_abonnement(
                    boutique,
                    form.cleaned_data["date_expiration_abonnement"],
                    formule=form.cleaned_data["formule"],
                )
                self.message_user(request, f"Abonnement de « {boutique.nom} » renouvelé.")
                return HttpResponseRedirect(reverse("admin:comptes_boutique_changelist"))
        else:
            nouvelle_date = point_depart_renouvellement(boutique) + DUREE_RENOUVELLEMENT_PAR_DEFAUT
            form = FormulaireAbonnement(
                initial={"date_expiration_abonnement": nouvelle_date, "formule": boutique.formule},
            )

        return render(
            request,
            "admin/comptes/formulaire_abonnement.html",
            {
                **self.admin_site.each_context(request),
                "title": f"Renouveler l'abonnement — {boutique.nom}",
                "description": (
                    f"Abonnement actuel de « {boutique.nom} » : "
                    f"{boutique.get_formule_display()}, expire le "
                    f"{boutique.date_expiration_abonnement or 'jamais configuré'}."
                ),
                "form": form,
                "submit_label": "Confirmer le renouvellement",
                "back_url": reverse("admin:comptes_boutique_changelist"),
                "opts": self.model._meta,
            },
        )


@admin.register(DemandeInscription)
class DemandeInscriptionAdmin(admin.ModelAdmin):
    list_display = ("boutique_nom", "username", "email", "formule", "statut", "date_creation")
    list_filter = ("statut", "formule")
    search_fields = ("boutique_nom", "username", "email")
    readonly_fields = (
        "boutique_nom", "boutique_adresse", "boutique_telephone", "boutique_email", "boutique_devise",
        "username", "email", "telephone", "first_name", "last_name", "formule",
    )
    actions = ["approuver_les_demandes", "rejeter_les_demandes"]

    def get_urls(self):
        return [
            path(
                "<uuid:demande_id>/approuver/",
                self.admin_site.admin_view(self.vue_approbation),
                name="comptes_demandeinscription_approuver",
            ),
        ] + super().get_urls()

    @admin.action(description="Approuver (choisir la durée et la formule)")
    def approuver_les_demandes(self, request, queryset):
        if queryset.count() != 1:
            self.message_user(
                request, "Sélectionnez une seule demande à la fois pour l'approuver.", level=messages.ERROR,
            )
            return
        demande = queryset.first()
        if demande.statut != DemandeInscription.Statut.EN_ATTENTE:
            self.message_user(request, "Cette demande a déjà été traitée.", level=messages.ERROR)
            return
        return HttpResponseRedirect(reverse("admin:comptes_demandeinscription_approuver", args=[demande.pk]))

    @admin.action(description="Rejeter")
    def rejeter_les_demandes(self, request, queryset):
        traitees = 0
        for demande in queryset.filter(statut=DemandeInscription.Statut.EN_ATTENTE):
            rejeter_inscription(demande)
            traitees += 1
        self.message_user(request, f"{traitees} demande(s) rejetée(s).")

    def vue_approbation(self, request, demande_id):
        demande = self.get_object(request, demande_id)
        if demande is None or demande.statut != DemandeInscription.Statut.EN_ATTENTE:
            self.message_user(request, "Demande introuvable ou déjà traitée.", level=messages.ERROR)
            return HttpResponseRedirect(reverse("admin:comptes_demandeinscription_changelist"))

        if request.method == "POST":
            form = FormulaireAbonnement(request.POST)
            if form.is_valid():
                approuver_inscription(
                    demande,
                    form.cleaned_data["date_expiration_abonnement"],
                    formule=form.cleaned_data["formule"],
                )
                self.message_user(request, f"Demande de « {demande.boutique_nom} » approuvée.")
                return HttpResponseRedirect(reverse("admin:comptes_demandeinscription_changelist"))
        else:
            form = FormulaireAbonnement(
                initial={
                    "date_expiration_abonnement": timezone.now() + DUREE_ESSAI_A_L_APPROBATION,
                    "formule": demande.formule,
                },
            )

        return render(
            request,
            "admin/comptes/formulaire_abonnement.html",
            {
                **self.admin_site.each_context(request),
                "title": f"Approuver la demande — {demande.boutique_nom}",
                "description": (
                    f"Boutique : {demande.boutique_nom} — Contact : {demande.username} ({demande.email}, "
                    f"{demande.telephone or 'pas de téléphone'}) — Formule demandée : {demande.get_formule_display()}."
                ),
                "form": form,
                "submit_label": "Confirmer l'approbation",
                "back_url": reverse("admin:comptes_demandeinscription_changelist"),
                "opts": self.model._meta,
            },
        )


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("nom", "boutique")
    search_fields = ("nom",)
    list_filter = ("boutique",)


@admin.register(Utilisateur)
class UtilisateurAdmin(UserAdmin):
    list_display = ("username", "email", "boutique", "role", "is_staff")
    list_filter = UserAdmin.list_filter + ("boutique", "role")
    fieldsets = UserAdmin.fieldsets + (
        ("Boutique", {"fields": ("boutique", "role", "telephone")}),
    )
