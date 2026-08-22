"""
Logique métier de l'app achats.
CLAUDE.md : une réception crée une entrée de stock par ligne de la commande
(Reception n'a pas de lignes propres) et une DetteFournisseur si non payé.
"""
from django.db import transaction
from rest_framework.exceptions import ValidationError

from core.services import generer_numero_sequentiel
from fournisseurs.models import DetteFournisseur
from stock.models import MouvementStock
from stock.services import appliquer_mouvement

from .models import CommandeAchat, LigneAchat, Reception


def _calculer_lignes_et_total(lignes_donnees):
    lignes_calculees = []
    total = 0
    for donnee in lignes_donnees:
        sous_total = round(donnee["quantite"] * donnee["prix_achat"])
        total += sous_total
        lignes_calculees.append({**donnee, "sous_total": sous_total})
    return lignes_calculees, total


@transaction.atomic
def creer_commande(boutique, fournisseur, utilisateur, statut, lignes_donnees):
    lignes_calculees, total = _calculer_lignes_et_total(lignes_donnees)
    numero = generer_numero_sequentiel(boutique, CommandeAchat, "CMD")

    commande = CommandeAchat.objects.create(
        boutique=boutique, fournisseur=fournisseur, utilisateur=utilisateur,
        numero=numero, statut=statut, total=total,
    )
    for donnee in lignes_calculees:
        LigneAchat.objects.create(commande=commande, **donnee)
    return commande


@transaction.atomic
def modifier_commande(commande, fournisseur, statut, lignes_donnees=None):
    if commande.statut in (CommandeAchat.Statut.RECUE, CommandeAchat.Statut.ANNULEE):
        raise ValidationError("Cette commande ne peut plus être modifiée.")

    if lignes_donnees is not None:
        lignes_calculees, total = _calculer_lignes_et_total(lignes_donnees)
        commande.total = total

    commande.fournisseur = fournisseur
    commande.statut = statut
    commande.save(update_fields=["fournisseur", "statut", "total", "date_modification"])

    if lignes_donnees is not None:
        commande.lignes.all().delete()
        for donnee in lignes_calculees:
            LigneAchat.objects.create(commande=commande, **donnee)
    return commande


@transaction.atomic
def receptionner_commande(commande, depot, utilisateur, montant_deja_paye=0, lignes_prix=None):
    if commande.statut != CommandeAchat.Statut.COMMANDEE:
        raise ValidationError(
            "Seule une commande au statut 'commandée' peut être réceptionnée."
        )
    if montant_deja_paye > commande.total:
        raise ValidationError("Le montant déjà payé ne peut pas dépasser le total de la commande.")

    prix_vente_par_variante = {
        donnee["variante"].id: donnee["prix_vente"] for donnee in (lignes_prix or [])
    }

    for ligne in commande.lignes.all():
        variante = ligne.variante
        motif = f"Réception {commande.numero}"
        nouveau_prix_vente = prix_vente_par_variante.get(variante.id)
        if nouveau_prix_vente is not None:
            if nouveau_prix_vente < ligne.prix_achat:
                raise ValidationError("Le prix de vente ne peut pas être inférieur au prix d'achat.")
            ancien_prix_achat, ancien_prix_vente = variante.prix_achat, variante.prix_vente
            variante.prix_achat = ligne.prix_achat
            variante.prix_vente = nouveau_prix_vente
            variante.save(update_fields=["prix_achat", "prix_vente", "date_modification"])
            motif += (
                f" (Prix achat : {ancien_prix_achat} → {ligne.prix_achat} FCFA, "
                f"Prix vente : {ancien_prix_vente} → {nouveau_prix_vente} FCFA)"
            )

        appliquer_mouvement(
            variante, depot, MouvementStock.Type.ENTREE, ligne.quantite,
            motif=motif, utilisateur=utilisateur,
            reference_type="achats.CommandeAchat", reference_id=commande.id,
        )

    reception = Reception.objects.create(commande=commande, depot=depot, utilisateur=utilisateur)

    solde = commande.total - montant_deja_paye
    if solde > 0:
        DetteFournisseur.objects.create(
            fournisseur=commande.fournisseur, commande=commande,
            montant=commande.total, montant_paye=montant_deja_paye, solde=solde,
            statut=DetteFournisseur.Statut.EN_COURS,
        )

    commande.statut = CommandeAchat.Statut.RECUE
    commande.save(update_fields=["statut", "date_modification"])
    return reception
