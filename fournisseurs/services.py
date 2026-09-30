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

from django.db.models import Sum

from .models import DetteFournisseur, MouvementCompteFournisseur, PaiementDetteFournisseur

MODES_ARGENT = ("especes", "mobile_money", "banque")

# Mêmes libellés que les clients (suivi des étapes d'une commande).
LIBELLES_MODE = {
    "especes": "Espèces",
    "orange_money": "Orange Money",
    "mtn_money": "MTN Money",
    "moov_money": "Moov Money",
    "wave": "Wave",
    "compte_fournisseur": "Compte fournisseur",
}


@transaction.atomic
def payer_dette(dette, montant, mode="", depot=None, utilisateur=None):
    if montant <= 0:
        raise ValidationError("Le montant payé doit être strictement positif.")
    if montant > dette.solde:
        raise ValidationError("Le montant payé ne peut pas dépasser le solde restant.")
    if mode == "compte_fournisseur" and montant > solde_compte_fournisseur(dette.fournisseur):
        raise ValidationError("Le compte du fournisseur ne suffit pas.")

    paiement = PaiementDetteFournisseur.objects.create(dette=dette, montant=montant, mode=mode)
    if mode == "compte_fournisseur":
        MouvementCompteFournisseur.objects.create(
            fournisseur=dette.fournisseur, type=MouvementCompteFournisseur.Type.UTILISATION, montant=montant,
            dette=dette, reception=dette.reception, utilisateur=utilisateur, motif="Règlement de dette",
        )

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

    if paiement.mode == "compte_fournisseur":
        MouvementCompteFournisseur.objects.create(
            fournisseur=dette.fournisseur, type=MouvementCompteFournisseur.Type.ANNULATION, montant=paiement.montant,
            dette=dette, utilisateur=utilisateur, motif="Remboursement annulé",
        )

    if dette.commande_id:
        apps.get_model("achats", "EvenementCommande").objects.create(
            commande_id=dette.commande_id, type="paiement_annule", utilisateur=utilisateur,
            detail="Remboursement annulé" + (f" · {paiement.motif_annulation}" if paiement.motif_annulation else ""),
            montant=paiement.montant, reference_id=paiement.id,
        )
    return paiement


# --- Compte fournisseur (avances et avoirs) ---

def solde_compte_fournisseur(fournisseur):
    """Ce que le fournisseur nous doit (avances, avoirs) et qu'on peut utiliser."""
    mouvements = MouvementCompteFournisseur.objects.filter(fournisseur=fournisseur, supprime=False)
    entrees = mouvements.filter(type__in=MouvementCompteFournisseur.ENTREES).aggregate(t=Sum("montant"))["t"] or 0
    sorties = mouvements.exclude(type__in=MouvementCompteFournisseur.ENTREES).aggregate(t=Sum("montant"))["t"] or 0
    return entrees - sorties


def _verifier_mode(mode, depot):
    if mode not in MODES_ARGENT:
        raise ValidationError("Mode de paiement inconnu.")
    if mode == "especes" and depot is None:
        raise ValidationError("Choisissez le dépôt dont la caisse donne ou reçoit l'argent.")


@transaction.atomic
def verser_avance_fournisseur(fournisseur, montant, mode, operateur="", depot=None, utilisateur=None, motif=""):
    """On paie le fournisseur d'avance ; espèces : sortie de la caisse du dépôt."""
    if montant <= 0:
        raise ValidationError("Le montant doit être strictement positif.")
    _verifier_mode(mode, depot)
    mouvement = MouvementCompteFournisseur.objects.create(
        fournisseur=fournisseur, type=MouvementCompteFournisseur.Type.AVANCE, montant=montant, mode=mode,
        operateur=operateur if mode == "mobile_money" else "", depot=depot, utilisateur=utilisateur,
        motif=(motif or "").strip()[:255],
    )
    if mode == "especes":
        enregistrer_mouvement(
            depot, MouvementCaisse.Type.SORTIE, MouvementCaisse.Categorie.AVANCE_FOURNISSEUR, montant,
            motif=f"Avance à {fournisseur.nom}", utilisateur=utilisateur,
            reference_type="fournisseurs.MouvementCompteFournisseur", reference_id=mouvement.id,
        )
    return mouvement


@transaction.atomic
def rembourse_par_fournisseur(fournisseur, montant, mode, operateur="", depot=None, utilisateur=None, motif=""):
    """Le fournisseur nous rend de l'argent (avance ou avoir non utilisés)."""
    if montant <= 0:
        raise ValidationError("Le montant doit être strictement positif.")
    if montant > solde_compte_fournisseur(fournisseur):
        raise ValidationError("Le fournisseur ne peut pas rendre plus que ce qu'il nous doit sur son compte.")
    _verifier_mode(mode, depot)
    mouvement = MouvementCompteFournisseur.objects.create(
        fournisseur=fournisseur, type=MouvementCompteFournisseur.Type.REMBOURSEMENT, montant=montant, mode=mode,
        operateur=operateur if mode == "mobile_money" else "", depot=depot, utilisateur=utilisateur,
        motif=(motif or "").strip()[:255],
    )
    if mode == "especes":
        enregistrer_mouvement(
            depot, MouvementCaisse.Type.ENTREE, MouvementCaisse.Categorie.REMBOURSEMENT_FOURNISSEUR, montant,
            motif=f"Remboursement de {fournisseur.nom}", utilisateur=utilisateur,
            reference_type="fournisseurs.MouvementCompteFournisseur", reference_id=mouvement.id,
        )
    return mouvement
