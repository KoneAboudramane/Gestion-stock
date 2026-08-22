"""
Logique métier de l'app fournisseurs.
Comme clients.rembourser_credit, chaque remboursement laisse une trace
(PaiementDetteFournisseur), pas seulement une mutation du solde.
"""
from django.db import transaction
from rest_framework.exceptions import ValidationError

from tresorerie.models import MouvementCaisse
from tresorerie.services import enregistrer_mouvement

from .models import DetteFournisseur, PaiementDetteFournisseur


@transaction.atomic
def payer_dette(dette, montant, mode="", depot=None, utilisateur=None):
    if montant <= 0:
        raise ValidationError("Le montant payé doit être strictement positif.")
    if montant > dette.solde:
        raise ValidationError("Le montant payé ne peut pas dépasser le solde restant.")

    paiement = PaiementDetteFournisseur.objects.create(dette=dette, montant=montant, mode=mode)

    dette.montant_paye = dette.montant_paye + montant
    dette.solde = dette.solde - montant
    if dette.solde == 0:
        dette.statut = DetteFournisseur.Statut.SOLDE
    dette.save(update_fields=["montant_paye", "solde", "statut", "date_modification"])

    if mode == "especes" and depot is not None:
        enregistrer_mouvement(
            depot, MouvementCaisse.Type.SORTIE, MouvementCaisse.Categorie.PAIEMENT_DETTE_FOURNISSEUR,
            montant, motif=f"Paiement dette {dette.fournisseur}", utilisateur=utilisateur,
            reference_type="fournisseurs.PaiementDetteFournisseur", reference_id=paiement.id,
        )
    return dette
