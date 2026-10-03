from datetime import timedelta

from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html

from .forms import (
    FormulaireAbonnement,
    FormulaireCreationBoutique,
    FormulaireRejetDemande,
    FormulaireRenouvellement,
)
from .models import (
    Boutique,
    DemandeInscription,
    DemandeRenouvellement,
    PaiementAbonnement,
    ReglagesPlateforme,
    Role,
    SignalementAbonnement,
    Utilisateur,
)
from .services import (
    approuver_inscription,
    demarrer_essai,
    enregistrer_periode_abonnement,
    inscrire_boutique,
    DELAI_GRACE_ABONNEMENT,
    DUREE_ESSAI,
    ajouter_mois,
    point_depart_renouvellement,
    rejeter_demande_renouvellement,
    rejeter_inscription,
    supprimer_boutique_definitivement,
    valider_demande_renouvellement,
)

DUREE_RENOUVELLEMENT_PAR_DEFAUT = timedelta(days=30)


class FiltreEcheanceAbonnement(admin.SimpleListFilter):
    """Suivi des abonnements : qui expire bientôt, qui est en délai de grâce, qui est bloqué."""

    title = "échéance de l'abonnement"
    parameter_name = "echeance"

    def lookups(self, request, model_admin):
        return [
            ("semaine", "Expire dans 7 jours"),
            ("grace", "Expiré, en délai de grâce"),
            ("bloque", "Expiré, vente bloquée"),
            ("illimite", "Sans date de fin"),
        ]

    def queryset(self, request, queryset):
        maintenant = timezone.now()
        if self.value() == "semaine":
            return queryset.filter(
                date_expiration_abonnement__gte=maintenant,
                date_expiration_abonnement__lte=maintenant + timedelta(days=7),
            )
        if self.value() == "grace":
            return queryset.filter(
                date_expiration_abonnement__lt=maintenant,
                date_expiration_abonnement__gte=maintenant - DELAI_GRACE_ABONNEMENT,
            )
        if self.value() == "bloque":
            return queryset.filter(date_expiration_abonnement__lt=maintenant - DELAI_GRACE_ABONNEMENT)
        if self.value() == "illimite":
            return queryset.filter(date_expiration_abonnement=None)
        return queryset


class PaiementAbonnementInline(admin.TabularInline):
    model = PaiementAbonnement
    extra = 0
    can_delete = False
    fields = ("date_creation", "nature", "formule", "date_debut", "date_fin", "montant", "mode", "reference", "note")
    readonly_fields = fields
    verbose_name_plural = "Registre des abonnements (ajout par « Renouveler »)"

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Boutique)
class BoutiqueAdmin(admin.ModelAdmin):
    list_display = (
        "nom", "telephone", "devise", "formule", "actif",
        "date_expiration_abonnement", "etat_abonnement", "demandes", "signalements", "synchro_autorisee",
        "lien_renouveler", "lien_supprimer", "date_creation",
    )
    list_editable = ("synchro_autorisee",)
    search_fields = ("nom", "telephone", "email")
    list_filter = (FiltreEcheanceAbonnement, "actif", "formule", "devise", "synchro_autorisee")
    inlines = [PaiementAbonnementInline]

    @admin.display(description="État")
    def etat_abonnement(self, obj):
        fin = obj.date_expiration_abonnement
        if fin is None:
            return "Sans limite"
        maintenant = timezone.now()
        if fin >= maintenant:
            jours = (fin - maintenant).days
            couleur = "#b45309" if jours < 7 else "#15803d"
            return format_html('<span style="color:{}">{} jour(s) restant(s)</span>', couleur, jours)
        if fin >= maintenant - DELAI_GRACE_ABONNEMENT:
            return format_html('<span style="color:#b91c1c">{}</span>', "Délai de grâce")
        return format_html('<strong style="color:#b91c1c">{}</strong>', "Vente bloquée")

    @admin.display(description="Paiements déclarés")
    def demandes(self, obj):
        nombre = obj.demandes_renouvellement.filter(statut=DemandeRenouvellement.Statut.EN_ATTENTE).count()
        if not nombre:
            return "—"
        url = reverse("admin:comptes_demanderenouvellement_changelist") + f"?boutique__id__exact={obj.pk}&statut__exact=en_attente"
        return format_html('<a href="{}" style="font-weight:bold">{} à valider</a>', url, nombre)

    @admin.display(description="Signalements")
    def signalements(self, obj):
        nombre = obj.signalements_abonnement.filter(traite=False).count()
        if not nombre:
            return "—"
        url = reverse("admin:comptes_signalementabonnement_changelist") + f"?boutique__id__exact={obj.pk}&traite__exact=0"
        return format_html('<a href="{}" style="color:#b91c1c;font-weight:bold">{} à voir</a>', url, nombre)
    actions = ["renouveler_abonnement_action"]

    def has_delete_permission(self, request, obj=None):
        # Le "Supprimer" standard de l'admin échoue systématiquement dès qu'une
        # boutique a une vente/un achat/une écriture comptable : Depot, Variante,
        # Fournisseur et consorts sont en PROTECT (voir supprimer_boutique_definitivement).
        # On désactive donc l'action native et on passe par lien_supprimer /
        # vue_suppression_definitive, qui gère cette cascade correctement.
        return False

    def get_urls(self):
        return [
            path(
                "creer/",
                self.admin_site.admin_view(self.vue_creation_boutique),
                name="comptes_boutique_creer",
            ),
            path(
                "<uuid:boutique_id>/renouveler/",
                self.admin_site.admin_view(self.vue_renouvellement),
                name="comptes_boutique_renouveler",
            ),
            path(
                "<uuid:boutique_id>/supprimer/",
                self.admin_site.admin_view(self.vue_suppression_definitive),
                name="comptes_boutique_supprimer",
            ),
        ] + super().get_urls()

    def vue_creation_boutique(self, request):
        """Création directe boutique + Patron, sans DemandeInscription — pour
        un commerçant recruté hors-ligne (visite terrain, appel), dont le
        compte doit être remis directement plutôt que d'attendre une demande.
        Voir aussi comptes/forms.py::FormulaireCreationBoutique."""
        if request.method == "POST":
            form = FormulaireCreationBoutique(request.POST)
            if form.is_valid():
                boutique, _utilisateur = inscrire_boutique(
                    {
                        "nom": form.cleaned_data["boutique_nom"],
                        "adresse": form.cleaned_data["boutique_adresse"],
                        "telephone": form.cleaned_data["boutique_telephone"],
                        "devise": form.cleaned_data["boutique_devise"] or "FCFA",
                    },
                    {
                        "username": form.cleaned_data["username"],
                        "password": form.cleaned_data["password"],
                        "email": form.cleaned_data["email"],
                        "telephone": form.cleaned_data["telephone"],
                    },
                )
                demarrer_essai(boutique, par=request.user)
                self.message_user(
                    request,
                    f"Boutique « {boutique.nom} » créée, prête à être remise "
                    f"(essai gratuit jusqu'au {timezone.localtime(boutique.date_expiration_abonnement):%d/%m/%Y}).",
                )
                return HttpResponseRedirect(reverse("admin:comptes_boutique_change", args=[boutique.pk]))
        else:
            form = FormulaireCreationBoutique()

        return render(
            request,
            "admin/comptes/formulaire_abonnement.html",
            {
                **self.admin_site.each_context(request),
                "title": "Créer une boutique",
                "description": (
                    "Crée la boutique et son premier utilisateur (Patron) immédiatement — sans attendre une "
                    "demande d'inscription. À utiliser quand le compte doit être remis directement au commerçant."
                ),
                "form": form,
                "submit_label": "Créer la boutique",
                "back_url": reverse("admin:index"),
                "opts": self.model._meta,
            },
        )

    def lien_renouveler(self, obj):
        url = reverse("admin:comptes_boutique_renouveler", args=[obj.pk])
        return format_html('<a href="{}">Renouveler</a>', url)

    lien_renouveler.short_description = "Abonnement"

    def lien_supprimer(self, obj):
        url = reverse("admin:comptes_boutique_supprimer", args=[obj.pk])
        return format_html('<a href="{}" style="color: #ba2121;">Supprimer</a>', url)

    lien_supprimer.short_description = "Suppression"

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
            form = FormulaireRenouvellement(request.POST)
            if form.is_valid():
                enregistrer_periode_abonnement(
                    boutique,
                    form.cleaned_data["date_expiration_abonnement"],
                    form.cleaned_data["formule"],
                    nature=form.cleaned_data["nature"],
                    montant=form.cleaned_data["montant"] or 0,
                    mode=form.cleaned_data["mode"],
                    reference=form.cleaned_data["reference"],
                    note=form.cleaned_data["note"],
                    par=request.user,
                )
                self.message_user(request, f"Abonnement de « {boutique.nom} » renouvelé.")
                return HttpResponseRedirect(reverse("admin:comptes_boutique_changelist"))
        else:
            nouvelle_date = point_depart_renouvellement(boutique) + DUREE_RENOUVELLEMENT_PAR_DEFAUT
            form = FormulaireRenouvellement(
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
                    f"{boutique.get_formule_display()}, "
                    + (
                        f"expire le {timezone.localtime(boutique.date_expiration_abonnement):%d/%m/%Y à %H:%M}."
                        if boutique.date_expiration_abonnement
                        else "sans date de fin."
                    )
                ),
                "form": form,
                "submit_label": "Confirmer le renouvellement",
                "back_url": reverse("admin:comptes_boutique_changelist"),
                "opts": self.model._meta,
            },
        )

    def vue_suppression_definitive(self, request, boutique_id):
        """Suppression réelle d'une boutique et de tout son contenu (le
        "Supprimer" natif de l'admin est désactivé, voir has_delete_permission) :
        simple page de confirmation avant d'appeler supprimer_boutique_definitivement,
        qui gère l'ordre de suppression imposé par les FK PROTECT (Depot, Variante,
        Fournisseur, comptabilité)."""
        if not request.user.has_perm("comptes.delete_boutique"):
            self.message_user(request, "Vous n'avez pas la permission de supprimer une boutique.", level=messages.ERROR)
            return HttpResponseRedirect(reverse("admin:comptes_boutique_changelist"))

        boutique = self.get_object(request, boutique_id)
        if boutique is None:
            self.message_user(request, "Boutique introuvable.", level=messages.ERROR)
            return HttpResponseRedirect(reverse("admin:comptes_boutique_changelist"))

        if request.method == "POST":
            nom = boutique.nom
            supprimer_boutique_definitivement(boutique)
            self.message_user(request, f"Boutique « {nom} » et tout son contenu ont été supprimés définitivement.")
            return HttpResponseRedirect(reverse("admin:comptes_boutique_changelist"))

        compteurs = {
            "Ventes": boutique.ventes.count(),
            "Commandes d'achat": boutique.commandes_achat.count(),
            "Clients": boutique.clients.count(),
            "Fournisseurs": boutique.fournisseurs.count(),
            "Dépôts": boutique.depots.count(),
            "Utilisateurs": boutique.utilisateurs.count(),
        }
        detail_contenu = " · ".join(f"{libelle} : {nombre}" for libelle, nombre in compteurs.items())

        return render(
            request,
            "admin/comptes/confirmation.html",
            {
                **self.admin_site.each_context(request),
                "title": f"Supprimer définitivement — {boutique.nom}",
                "description": (
                    f"Action irréversible : supprime la boutique « {boutique.nom} » et absolument tout son "
                    f"contenu (ventes, achats, stock, clients, comptabilité...). {detail_contenu}."
                ),
                "submit_label": "Supprimer définitivement",
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
                    "date_expiration_abonnement": timezone.now() + DUREE_ESSAI,
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


@admin.register(PaiementAbonnement)
class PaiementAbonnementAdmin(admin.ModelAdmin):
    """Registre des abonnements : lecture seule (on ajoute par « Renouveler » sur la boutique), totaux par mois."""

    list_display = (
        "date_creation", "boutique", "nature", "formule", "date_debut", "date_fin", "montant", "mode", "reference",
    )
    list_filter = ("nature", "mode", "formule")
    search_fields = ("boutique__nom", "reference")
    date_hierarchy = "date_creation"
    change_list_template = "admin/comptes/paiementabonnement/change_list.html"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        # Regroupé en Python : TruncMonth sous MySQL (o2switch) renvoie NULL sans les tables de fuseaux horaires.
        debut = (timezone.localtime() - timedelta(days=366)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        totaux = {}
        for date, montant in PaiementAbonnement.objects.filter(
            nature=PaiementAbonnement.Nature.PAIEMENT, date_creation__gte=debut
        ).values_list("date_creation", "montant"):
            mois = timezone.localtime(date).date().replace(day=1)
            totaux[mois] = totaux.get(mois, 0) + montant
        par_mois = [{"mois": mois, "total": totaux[mois]} for mois in sorted(totaux, reverse=True)]
        return super().changelist_view(request, extra_context={**(extra_context or {}), "encaisse_par_mois": par_mois})


@admin.register(SignalementAbonnement)
class SignalementAbonnementAdmin(admin.ModelAdmin):
    list_display = ("date_creation", "boutique", "type", "table", "enregistrement_id", "detail", "traite")
    list_filter = ("traite", "type")
    list_editable = ("traite",)
    search_fields = ("boutique__nom", "detail")

    def has_add_permission(self, request):
        return False


@admin.register(ReglagesPlateforme)
class ReglagesPlateformeAdmin(admin.ModelAdmin):
    """Une seule ligne : la liste ouvre directement sa fiche."""

    fieldsets = (
        ("Où le commerçant paie son abonnement", {
            "fields": ("numero_wave", "numero_orange_money", "numero_mtn", "numero_moov", "whatsapp", "instructions"),
        }),
        ("Tarifs (laisser vide pour ne pas les afficher dans l'appli)", {
            "fields": ("prix_mensuel_essentiel", "prix_mensuel_pro", "remise_3_mois", "remise_6_mois", "remise_12_mois"),
            "description": "Prix d'une durée = prix mensuel × nombre de mois, moins la remise.",
        }),
    )

    def has_add_permission(self, request):
        return not ReglagesPlateforme.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        reglages = ReglagesPlateforme.obtenir()
        return HttpResponseRedirect(reverse("admin:comptes_reglagesplateforme_change", args=[reglages.pk]))


class FiltreStatutDemande(admin.SimpleListFilter):
    """Par défaut, seulement les paiements déclarés à valider."""

    title = "statut"
    parameter_name = "statut__exact"

    def lookups(self, request, model_admin):
        return [("tous", "Tous")] + list(DemandeRenouvellement.Statut.choices)

    def choices(self, changelist):
        valeur = self.value() or DemandeRenouvellement.Statut.EN_ATTENTE
        for code, libelle in self.lookup_choices:
            yield {
                "selected": valeur == code,
                "query_string": changelist.get_query_string({self.parameter_name: code}),
                "display": libelle,
            }

    def queryset(self, request, queryset):
        valeur = self.value() or DemandeRenouvellement.Statut.EN_ATTENTE
        return queryset if valeur == "tous" else queryset.filter(statut=valeur)


@admin.register(DemandeRenouvellement)
class DemandeRenouvellementAdmin(admin.ModelAdmin):
    """Paiements déclarés par les commerçants dans l'appli : vérifier la référence, puis valider ou rejeter."""

    list_display = (
        "date_creation", "boutique", "formule", "duree_mois", "montant", "mode", "reference", "statut", "traiter",
    )
    list_filter = (FiltreStatutDemande, "mode")
    search_fields = ("boutique__nom", "reference")
    actions = ["valider_selection"]
    readonly_fields = [f.name for f in DemandeRenouvellement._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="Traiter")
    def traiter(self, obj):
        if obj.statut != DemandeRenouvellement.Statut.EN_ATTENTE:
            return obj.motif_rejet or "—"
        valider = reverse("admin:comptes_demanderenouvellement_valider", args=[obj.pk])
        rejeter = reverse("admin:comptes_demanderenouvellement_rejeter", args=[obj.pk])
        return format_html(
            '<a class="button" href="{}">Valider</a> <a href="{}" style="color:#ba2121">Rejeter</a>', valider, rejeter
        )

    def get_urls(self):
        return [
            path("<uuid:demande_id>/valider/", self.admin_site.admin_view(self.vue_valider),
                 name="comptes_demanderenouvellement_valider"),
            path("<uuid:demande_id>/rejeter/", self.admin_site.admin_view(self.vue_rejeter),
                 name="comptes_demanderenouvellement_rejeter"),
        ] + super().get_urls()

    def _liste(self):
        return HttpResponseRedirect(reverse("admin:comptes_demanderenouvellement_changelist"))

    def _description(self, demande):
        fin = ajouter_mois(point_depart_renouvellement(demande.boutique), demande.duree_mois)
        return (
            f"« {demande.boutique.nom} » déclare {demande.montant} par {demande.get_mode_display()} "
            f"(référence {demande.reference}) pour {demande.get_formule_display()}, {demande.get_duree_mois_display()}. "
            f"Vérifiez la transaction : une fois validée, l'abonnement ira jusqu'au "
            f"{timezone.localtime(fin):%d/%m/%Y}."
        )

    def vue_valider(self, request, demande_id):
        demande = self.get_object(request, demande_id)
        if demande is None or demande.statut != DemandeRenouvellement.Statut.EN_ATTENTE:
            self.message_user(request, "Demande introuvable ou déjà traitée.", level=messages.ERROR)
            return self._liste()
        if request.method == "POST":
            valider_demande_renouvellement(demande, par=request.user)
            self.message_user(request, f"Paiement validé : abonnement de « {demande.boutique.nom} » prolongé.")
            return self._liste()
        return render(request, "admin/comptes/confirmation.html", {
            **self.admin_site.each_context(request),
            "title": "Valider le paiement déclaré",
            "description": self._description(demande),
            "submit_label": "Valider le paiement",
            "back_url": reverse("admin:comptes_demanderenouvellement_changelist"),
            "opts": self.model._meta,
        })

    def vue_rejeter(self, request, demande_id):
        demande = self.get_object(request, demande_id)
        if demande is None or demande.statut != DemandeRenouvellement.Statut.EN_ATTENTE:
            self.message_user(request, "Demande introuvable ou déjà traitée.", level=messages.ERROR)
            return self._liste()
        if request.method == "POST":
            form = FormulaireRejetDemande(request.POST)
            if form.is_valid():
                rejeter_demande_renouvellement(demande, form.cleaned_data["motif"], par=request.user)
                self.message_user(request, f"Paiement de « {demande.boutique.nom} » rejeté.")
                return self._liste()
        else:
            form = FormulaireRejetDemande()
        return render(request, "admin/comptes/formulaire_abonnement.html", {
            **self.admin_site.each_context(request),
            "title": "Rejeter le paiement déclaré",
            "description": self._description(demande).split(" Vérifiez")[0] + " Le commerçant verra le motif.",
            "form": form,
            "submit_label": "Rejeter",
            "back_url": reverse("admin:comptes_demanderenouvellement_changelist"),
            "opts": self.model._meta,
        })

    @admin.action(description="Valider les paiements sélectionnés")
    def valider_selection(self, request, queryset):
        nombre = 0
        for demande in queryset.filter(statut=DemandeRenouvellement.Statut.EN_ATTENTE).select_related("boutique"):
            valider_demande_renouvellement(demande, par=request.user)
            nombre += 1
        self.message_user(request, f"{nombre} paiement(s) validé(s).")
