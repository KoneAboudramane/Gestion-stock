from django.contrib.auth.password_validation import validate_password
from django import forms

from .models import Boutique, PaiementAbonnement, Utilisateur


class FormulaireAbonnement(forms.Form):
    """Utilisé par les écrans d'admin dédiés (approbation d'une demande,
    renouvellement d'une boutique) — voir comptes/admin.py."""

    date_expiration_abonnement = forms.DateTimeField(
        label="Date d'expiration de l'abonnement",
        widget=forms.DateTimeInput(attrs={"type": "datetime-local"}, format="%Y-%m-%dT%H:%M"),
        input_formats=["%Y-%m-%dT%H:%M"],
    )
    formule = forms.ChoiceField(label="Formule", choices=Boutique.Formule.choices)


class FormulaireRenouvellement(FormulaireAbonnement):
    """Renouvellement depuis l'admin : la période est inscrite au registre des
    abonnements avec ce qui a été payé (voir services.enregistrer_periode_abonnement)."""

    nature = forms.ChoiceField(
        label="Nature", choices=PaiementAbonnement.Nature.choices, initial=PaiementAbonnement.Nature.PAIEMENT
    )
    montant = forms.DecimalField(label="Montant reçu", max_digits=12, decimal_places=2, required=False, min_value=0)
    mode = forms.ChoiceField(label="Payé par", choices=[("", "—")] + PaiementAbonnement.Mode.choices, required=False)
    reference = forms.CharField(label="Référence (transaction Mobile Money…)", max_length=100, required=False)
    note = forms.CharField(label="Note", max_length=255, required=False)

    def clean(self):
        donnees = super().clean()
        if donnees.get("nature") == PaiementAbonnement.Nature.PAIEMENT and not donnees.get("montant"):
            self.add_error("montant", "Indiquez le montant reçu pour un paiement.")
        return donnees


class FormulaireCreationBoutique(forms.Form):
    """Création directe d'une boutique + son premier utilisateur (Patron) par
    l'administrateur, sans passer par une DemandeInscription — voir
    comptes/admin.py::vue_creation_boutique et comptes/services.py::inscrire_boutique.
    Utile quand le commerçant a été recruté hors-ligne (visite terrain, appel) :
    le compte est prêt à être remis directement, sans attendre une demande."""

    boutique_nom = forms.CharField(label="Nom de la boutique", max_length=200)
    boutique_adresse = forms.CharField(label="Adresse", max_length=255, required=False)
    boutique_telephone = forms.CharField(label="Téléphone boutique", max_length=30, required=False)
    boutique_devise = forms.CharField(label="Devise", max_length=10, initial="FCFA")

    username = forms.CharField(label="Nom d'utilisateur (Patron)", max_length=150)
    password = forms.CharField(label="Mot de passe", widget=forms.PasswordInput, validators=[validate_password])
    email = forms.EmailField(label="Email (Patron)")
    telephone = forms.CharField(label="Téléphone (Patron)", max_length=30, required=False)

    def clean_username(self):
        username = self.cleaned_data["username"]
        if Utilisateur.objects.filter(username=username).exists():
            raise forms.ValidationError("Ce nom d'utilisateur existe déjà.")
        return username

    def clean_email(self):
        email = self.cleaned_data["email"]
        if Utilisateur.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError("Cet email est déjà utilisé par un autre compte.")
        return email


class FormulaireRejetDemande(forms.Form):
    motif = forms.CharField(
        label="Motif (visible par le commerçant)", max_length=255,
        initial="Transaction introuvable : vérifiez la référence et renvoyez la demande.",
    )
