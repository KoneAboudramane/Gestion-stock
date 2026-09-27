"""
Logique métier de l'app fournisseurs.
Comme clients.rembourser_credit, chaque remboursement laisse une trace
(PaiementDetteFournisseur), pas seulement une mutation du solde.
"""
from django.apps import apps
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from tresorerie.models import MouvementCaisse
from tresorerie.services import enregistrer_mouvement

from .models import DetteFournisseur, PaiementDetteFournisseur

# Mêmes libellés que les clients (suivi des étapes d'une commande).
LIBELLES_MODE = {
    "especes": "Espèces",
    "orange_money": "Orange Money",
    "mtn_money": "MTN Money",
    "moov_money": "Moov Money",
    "wave": "Wave",
}


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

    if dette.commande_id:
        # Suivi des étapes de la commande (achats.EvenementCommande) — lu par
        # chaîne pour ne pas importer l'app achats (règle CLAUDE.md n°3).
        apps.get_model("achats", "EvenementCommande").objects.create(
            commande_id=dette.commande_id, type="paiement", utilisateur=utilisateur,
            detail="Règlement de dette" + (f" · {LIBELLES_MODE.get(mode, mode)}" if mode else ""), montant=montant,
            reference_id=paiement.id,
        )

    if mode == "especes" and depot is not None:
        enregistrer_mouvement(
            depot, MouvementCaisse.Type.SORTIE, MouvementCaisse.Categorie.PAIEMENT_DETTE_FOURNISSEUR,
            montant, motif=f"Paiement dette {dette.fournisseur}", utilisateur=utilisateur,
            reference_type="fournisseurs.PaiementDetteFournisseur", reference_id=paiement.id,
        )
    return dette


@transaction.atomic
def annuler_paiement_dette(paiement, utilisateur=None, motif=""):
    """Remboursement saisi par erreur : il reste visible, marqué annulé ; son
    montant revient dans le solde de la dette (qui redevient en cours). S'il
    était en espèces, l'argent revient dans la caisse du même dépôt. La
    contre-écriture comptable est passée par comptabilite/signals.py."""
    if paiement.annulee:
        raise ValidationError("Ce remboursement est déjà annulé.")
    dette = paiement.dette
    dette.montant_paye = dette.montant_paye - paiement.montant
    dette.solde = dette.solde + paiement.montant
    dette.statut = DetteFournisseur.Statut.EN_COURS
    dette.save(update_fields=["montant_paye", "solde", "statut", "date_modification"])

    paiement.annulee = True
    paiement.date_annulation = timezone.now()
    paiement.annule_par = utilisateur
    paiement.motif_annulation = (motif or "").strip()[:255]
    paiement.save(update_fields=["annulee", "date_annulation", "annule_par", "motif_annulation", "date_modification"])

    sortie = MouvementCaisse.objects.filter(
        reference_type="fournisseurs.PaiementDetteFournisseur", reference_id=paiement.id,
        type=MouvementCaisse.Type.SORTIE,
    ).first()
    if sortie:
        enregistrer_mouvement(
            sortie.depot, MouvementCaisse.Type.ENTREE, MouvementCaisse.Categorie.PAIEMENT_DETTE_FOURNISSEUR,
            paiement.montant, motif=f"Annulation paiement dette {dette.fournisseur}", utilisateur=utilisateur,
            reference_type="fournisseurs.PaiementDetteFournisseur:annulation", reference_id=paiement.id,
        )

    if dette.commande_id:
        apps.get_model("achats", "EvenementCommande").objects.create(
            commande_id=dette.commande_id, type="paiement_annule", utilisateur=utilisateur,
            detail="Remboursement annulé" + (f" · {paiement.motif_annulation}" if paiement.motif_annulation else ""),
            montant=paiement.montant, reference_id=paiement.id,
        )
    return paiement
