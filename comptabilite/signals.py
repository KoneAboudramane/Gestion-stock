"""
Génération automatique des écritures comptables à partir des autres apps.

Principe non négociable : une erreur ici ne doit JAMAIS faire échouer
l'opération d'origine (une vente, un achat, une dépense...). Chaque
écouteur est donc entouré d'un try/except qui journalise et avale
l'erreur — au pire, une écriture manque et peut être corrigée à la main
plus tard ; au pire des cas, jamais une vente ne doit être bloquée par un
souci comptable.
"""
import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import EcritureComptable
from .services import ErreurComptable, creer_ecriture, decomposer_ttc, preparer_contexte, taux_tva

logger = logging.getLogger(__name__)

OPERATEUR_VERS_COMPTE = {
    "wave": "551",
    "orange_money": "552",
    "mtn_money": "553",
    "moov_money": "554",
}

CATEGORIE_DEPENSE_VERS_COMPTE = {
    "transport": "61",
    "reparation": "624",
    "achat_marchandise": "601",
    "achat_divers": "605",
    "remboursement_client": "658",
    "autre": "658",
}


def _reference_deja_comptabilisee(reference_type, reference_id):
    return EcritureComptable.objects.filter(
        reference_type=reference_type, reference_id=reference_id
    ).exists()


def _compte_source_paiement(mode, operateur):
    if mode == "especes":
        return "571"
    if mode == "mobile_money":
        return OPERATEUR_VERS_COMPTE.get(operateur, "55")
    if mode == "credit":
        return "411"
    return "47"  # tiers/débiteurs divers, filet de sécurité si un mode inconnu apparaît


# --- Ventes ---

@receiver(post_save, sender="ventes.Paiement")
def sur_paiement_vente(sender, instance, created, **kwargs):
    if not created:
        return
    try:
        vente = instance.vente
        if _reference_deja_comptabilisee("ventes.Paiement", instance.id):
            return
        contexte = preparer_contexte(vente.boutique, vente.date_creation.date())
        ht, tva = decomposer_ttc(instance.montant, taux_tva(vente.boutique))
        compte_source = _compte_source_paiement(instance.mode, instance.operateur)
        creer_ecriture(
            contexte, "VE", vente.date_creation.date(),
            f"Vente {vente.numero or vente.id} ({instance.get_mode_display()})",
            [
                {"compte": compte_source, "debit": instance.montant},
                {"compte": "701", "credit": ht},
                {"compte": "4431", "credit": tva},
            ],
            reference_type="ventes.Paiement", reference_id=instance.id,
            utilisateur=vente.utilisateur,
        )
    except Exception:
        logger.exception("comptabilite: échec génération écriture pour ventes.Paiement %s", instance.id)


@receiver(post_save, sender="ventes.Vente")
def sur_annulation_vente(sender, instance, created, **kwargs):
    if created or instance.statut != "annulee":
        return
    try:
        for paiement in instance.paiements.all():
            if _reference_deja_comptabilisee("ventes.Paiement:annulation", paiement.id):
                continue
            contexte = preparer_contexte(instance.boutique, instance.date_modification.date())
            ht, tva = decomposer_ttc(paiement.montant, taux_tva(instance.boutique))
            compte_source = _compte_source_paiement(paiement.mode, paiement.operateur)
            creer_ecriture(
                contexte, "VE", instance.date_modification.date(),
                f"Annulation vente {instance.numero or instance.id} ({paiement.get_mode_display()})",
                [
                    {"compte": "701", "debit": ht},
                    {"compte": "4431", "debit": tva},
                    {"compte": compte_source, "credit": paiement.montant},
                ],
                reference_type="ventes.Paiement:annulation", reference_id=paiement.id,
                utilisateur=instance.utilisateur,
            )
    except Exception:
        logger.exception("comptabilite: échec génération écriture d'annulation pour ventes.Vente %s", instance.id)


# --- Achats ---

@receiver(post_save, sender="achats.Reception")
def sur_reception_achat(sender, instance, created, **kwargs):
    """Une écriture par réception (pas par commande) : une commande peut être
    livrée en plusieurs fois (réception partielle, voir
    achats/services.py::receptionner_commande), et chaque livraison porte sa
    propre valeur reçue — jamais forcément le total de la commande."""
    if not created:
        return
    try:
        if _reference_deja_comptabilisee("achats.Reception", instance.id):
            return
        valeur_recue = instance.valeur_recue
        if valeur_recue <= 0:
            return
        commande = instance.commande

        contexte = preparer_contexte(commande.boutique, instance.date_creation.date())
        # achats/services.py::receptionner_commande ne trace pas séparément un
        # paiement immédiat partiel à la réception (aucun MouvementCaisse créé
        # pour lui, même limite côté trésorerie) : la réception finance donc
        # tout le montant reçu via 401 dès qu'un solde subsiste après ce
        # paiement, sinon tout est considéré payé comptant (571).
        solde = valeur_recue - instance.montant_paye
        compte_contrepartie = "401" if solde > 0 else "571"
        lignes = [
            {"compte": "601", "debit": valeur_recue},
            {"compte": compte_contrepartie, "credit": valeur_recue},
        ]
        creer_ecriture(
            contexte, "AC", instance.date_creation.date(),
            f"Réception {commande.numero or commande.id}",
            lignes,
            reference_type="achats.Reception", reference_id=instance.id,
            utilisateur=instance.utilisateur,
        )
    except Exception:
        logger.exception("comptabilite: échec génération écriture pour achats.Reception %s", instance.id)


@receiver(post_save, sender="fournisseurs.PaiementDetteFournisseur")
def sur_paiement_dette_fournisseur(sender, instance, created, **kwargs):
    if not created:
        return
    try:
        boutique = instance.dette.fournisseur.boutique
        if _reference_deja_comptabilisee("fournisseurs.PaiementDetteFournisseur", instance.id):
            return
        contexte = preparer_contexte(boutique)
        compte_source = "571" if instance.mode == "especes" else "55"
        creer_ecriture(
            contexte, "AC", instance.date_creation.date(),
            f"Paiement dette {instance.dette.fournisseur.nom}",
            [
                {"compte": "401", "debit": instance.montant},
                {"compte": compte_source, "credit": instance.montant},
            ],
            reference_type="fournisseurs.PaiementDetteFournisseur", reference_id=instance.id,
        )
    except Exception:
        logger.exception(
            "comptabilite: échec génération écriture pour fournisseurs.PaiementDetteFournisseur %s", instance.id
        )


# --- Clients ---

@receiver(post_save, sender="clients.PaiementCredit")
def sur_paiement_credit(sender, instance, created, **kwargs):
    if not created:
        return
    try:
        boutique = instance.credit.client.boutique
        if _reference_deja_comptabilisee("clients.PaiementCredit", instance.id):
            return
        contexte = preparer_contexte(boutique)
        compte_source = "571" if instance.mode == "especes" else "55"
        creer_ecriture(
            contexte, "VE", instance.date_creation.date(),
            f"Règlement crédit {instance.credit.client.nom}",
            [
                {"compte": compte_source, "debit": instance.montant},
                {"compte": "411", "credit": instance.montant},
            ],
            reference_type="clients.PaiementCredit", reference_id=instance.id,
        )
    except Exception:
        logger.exception("comptabilite: échec génération écriture pour clients.PaiementCredit %s", instance.id)


# --- Trésorerie ---

@receiver(post_save, sender="tresorerie.Depense")
def sur_depense(sender, instance, created, **kwargs):
    if not created:
        return
    try:
        boutique = instance.depot.boutique
        if _reference_deja_comptabilisee("tresorerie.Depense", instance.id):
            return
        contexte = preparer_contexte(boutique, instance.date_creation.date())
        compte_charge = CATEGORIE_DEPENSE_VERS_COMPTE.get(instance.categorie, "658")
        creer_ecriture(
            contexte, "CA", instance.date_creation.date(),
            instance.get_categorie_display(),
            [
                {"compte": compte_charge, "debit": instance.montant},
                {"compte": "571", "credit": instance.montant},
            ],
            reference_type="tresorerie.Depense", reference_id=instance.id,
            utilisateur=instance.utilisateur,
        )
    except Exception:
        logger.exception("comptabilite: échec génération écriture pour tresorerie.Depense %s", instance.id)


@receiver(post_save, sender="tresorerie.Transfert")
def sur_transfert_mobile_money(sender, instance, created, **kwargs):
    if not created:
        return
    try:
        boutique = instance.depot.boutique
        if _reference_deja_comptabilisee("tresorerie.Transfert", instance.id):
            return
        contexte = preparer_contexte(boutique, instance.date_creation.date())
        compte_mobile_money = OPERATEUR_VERS_COMPTE.get(instance.operateur, "55")
        creer_ecriture(
            contexte, "CA", instance.date_creation.date(),
            f"Transfert {instance.get_operateur_display()}",
            [
                {"compte": "571", "debit": instance.montant},
                {"compte": compte_mobile_money, "credit": instance.montant},
            ],
            reference_type="tresorerie.Transfert", reference_id=instance.id,
            utilisateur=instance.utilisateur,
        )
    except Exception:
        logger.exception("comptabilite: échec génération écriture pour tresorerie.Transfert %s", instance.id)


@receiver(post_save, sender="tresorerie.MouvementCaisse")
def sur_mouvement_caisse_divers(sender, instance, created, **kwargs):
    """Ne couvre que les catégories sans modèle source dédié (apport, retrait,
    ajustement) : vente_especes, remboursement_credit, paiement_dette_fournisseur,
    depense et transfert_mobile_money sont déjà comptabilisés via leur propre
    signal (voir plus haut), les traiter ici doublerait les écritures."""
    if not created or instance.categorie not in ("apport", "retrait", "ajustement"):
        return
    try:
        boutique = instance.depot.boutique
        if _reference_deja_comptabilisee("tresorerie.MouvementCaisse", instance.id):
            return
        contexte = preparer_contexte(boutique, instance.date_creation.date())
        libelle = instance.motif or instance.get_categorie_display()

        if instance.categorie == "apport":
            lignes = [{"compte": "571", "debit": instance.montant}, {"compte": "46", "credit": instance.montant}]
        elif instance.categorie == "retrait":
            lignes = [{"compte": "46", "debit": instance.montant}, {"compte": "571", "credit": instance.montant}]
        else:  # ajustement : montant signé, positif = excédent constaté, négatif = manquant
            montant = instance.montant
            if montant >= 0:
                lignes = [{"compte": "571", "debit": montant}, {"compte": "758", "credit": montant}]
            else:
                lignes = [{"compte": "658", "debit": -montant}, {"compte": "571", "credit": -montant}]

        creer_ecriture(
            contexte, "CA", instance.date_creation.date(), libelle, lignes,
            reference_type="tresorerie.MouvementCaisse", reference_id=instance.id,
            utilisateur=instance.utilisateur,
        )
    except Exception:
        logger.exception("comptabilite: échec génération écriture pour tresorerie.MouvementCaisse %s", instance.id)
