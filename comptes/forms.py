from django import forms

from .models import Boutique


class FormulaireAbonnement(forms.Form):
    """Utilisé par les écrans d'admin dédiés (approbation d'une demande,
    renouvellement d'une boutique) — voir comptes/admin.py."""

    date_expiration_abonnement = forms.DateTimeField(
        label="Date d'expiration de l'abonnement",
        widget=forms.DateTimeInput(attrs={"type": "datetime-local"}, format="%Y-%m-%dT%H:%M"),
        input_formats=["%Y-%m-%dT%H:%M"],
    )
    formule = forms.ChoiceField(label="Formule", choices=Boutique.Formule.choices)
