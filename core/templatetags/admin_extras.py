"""
Tags utilisés par la surcharge de l'admin Django (voir templates/admin/*.html) :
chiffres clés de l'accueil admin. Lecture seule, aucune logique métier ici —
juste des comptages simples sur les modèles déjà existants.
"""
from datetime import timedelta

from django import template
from django.utils import timezone

register = template.Library()


@register.simple_tag
def get_admin_stats():
    from comptes.models import Boutique, DemandeInscription, Utilisateur

    maintenant = timezone.now()
    dans_7_jours = maintenant + timedelta(days=7)

    return {
        "boutiques_actives": Boutique.objects.filter(actif=True).count(),
        "boutiques_total": Boutique.objects.count(),
        "synchro_activee": Boutique.objects.filter(synchro_autorisee=True).count(),
        "demandes_en_attente": DemandeInscription.objects.filter(
            statut=DemandeInscription.Statut.EN_ATTENTE
        ).count(),
        "utilisateurs_actifs": Utilisateur.objects.filter(is_active=True).count(),
        "abonnements_bientot_expires": Boutique.objects.filter(
            actif=True,
            date_expiration_abonnement__isnull=False,
            date_expiration_abonnement__gte=maintenant,
            date_expiration_abonnement__lte=dans_7_jours,
        ).count(),
    }


@register.simple_tag
def get_dernieres_boutiques():
    from comptes.models import Boutique

    return Boutique.objects.order_by("-date_creation")[:6]
