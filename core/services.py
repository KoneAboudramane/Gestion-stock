"""
Utilitaires métier partagés entre apps.
"""
from django.utils import timezone


def generer_numero_sequentiel(boutique, model, prefixe, champ_boutique="boutique"):
    """
    Numéro séquentiel par boutique et par jour (ex. "VTE-20260726-0001").
    Verrouille la ligne Boutique pour sérialiser l'attribution du numéro.
    """
    from comptes.models import Boutique  # import différé : core est chargé tôt

    Boutique.objects.select_for_update().get(pk=boutique.pk)
    aujourdhui = timezone.localdate()
    compteur = model.objects.filter(
        **{champ_boutique: boutique}, date_creation__date=aujourdhui
    ).count() + 1
    return f"{prefixe}-{aujourdhui:%Y%m%d}-{compteur:04d}"
