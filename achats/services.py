"""
Logique métier de l'app achats.
CLAUDE.md : une réception crée une entrée de stock par ligne de la commande
(Reception n'a pas de lignes propres) et une DetteFournisseur si non payé.
"""
from django.db import transaction
from django.db.models import Sum
from rest_framework.exceptions import ValidationError

from core.services import generer_numero_sequentiel
from fournisseurs.models import DetteFournisseur
from stock.models import MouvementStock, Stock
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
    deja_receptionnee = commande.lignes.filter(quantite_recue__gt=0).exists()
    if statut == CommandeAchat.Statut.ANNULEE and deja_receptionnee:
        raise ValidationError(
            "Cette commande a déjà été partiellement réceptionnée, elle ne peut plus être annulée."
        )
    if lignes_donnees is not None and deja_receptionnee:
        raise ValidationError(
            "Cette commande a déjà été partiellement réceptionnée, ses lignes ne peuvent plus être modifiées."
        )

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
def receptionner_commande(commande, depot, utilisateur, montant_deja_paye=0, lignes=None):
    """Réceptionne tout ou partie d'une commande. `lignes` est une liste de
    {"ligne": LigneAchat, "quantite": Decimal, "prix_vente": Decimal|None} —
    seules les quantités indiquées sont reçues (réception partielle possible
    sur plusieurs livraisons). La commande ne repasse au statut "recue" que
    lorsque toutes les lignes ont atteint leur quantité commandée.
    """
    if commande.statut != CommandeAchat.Statut.COMMANDEE:
        raise ValidationError(
            "Seule une commande au statut 'commandée' peut être réceptionnée."
        )

    lignes = [donnee for donnee in (lignes or []) if donnee["quantite"] > 0]
    if not lignes:
        raise ValidationError("Indiquez au moins une quantité à réceptionner.")

    valeur_recue = 0
    for donnee in lignes:
        ligne = donnee["ligne"]
        restant = ligne.quantite - ligne.quantite_recue
        if donnee["quantite"] > restant:
            raise ValidationError(
                f"Quantité reçue supérieure à la quantité restante pour {ligne.variante}."
            )
        valeur_recue += donnee["quantite"] * ligne.prix_achat

    if montant_deja_paye > valeur_recue:
        raise ValidationError("Le montant déjà payé ne peut pas dépasser la valeur reçue.")

    # Créée avant les mouvements pour qu'ils puissent la référencer : c'est ce
    # lien qui permet de retrouver les articles livrés à chaque réception.
    reception = Reception.objects.create(
        commande=commande, depot=depot, utilisateur=utilisateur,
        valeur_recue=valeur_recue, montant_paye=montant_deja_paye,
    )

    for donnee in lignes:
        ligne = donnee["ligne"]
        variante = ligne.variante
        quantite = donnee["quantite"]
        motif = f"Réception {commande.numero}"
        nouveau_prix_vente = donnee.get("prix_vente")
        if nouveau_prix_vente is not None:
            # CUMP (coût unitaire moyen pondéré), comme les clients (voir
            # client-electron/electron/services/achats.ts::receptionnerCommande) :
            # le prix d'achat existant est pondéré par le stock encore présent,
            # pas écrasé par le dernier prix reçu — sinon la valeur du stock et le
            # bénéfice des ventes seraient faussés dès que le prix d'achat varie.
            stock_actuel = (
                Stock.objects.filter(variante=variante).aggregate(total=Sum("quantite"))["total"] or 0
            )
            ancien_prix_achat, ancien_prix_vente = variante.prix_achat, variante.prix_vente
            nouveau_prix_achat = (
                round((stock_actuel * ancien_prix_achat + quantite * ligne.prix_achat) / (stock_actuel + quantite))
                if stock_actuel > 0
                else ligne.prix_achat
            )
            if nouveau_prix_vente < nouveau_prix_achat:
                raise ValidationError("Le prix de vente ne peut pas être inférieur au prix d'achat (CUMP).")
            variante.prix_achat = nouveau_prix_achat
            variante.prix_vente = nouveau_prix_vente
            variante.save(update_fields=["prix_achat", "prix_vente", "date_modification"])
            motif += (
                f" (Prix achat : {ancien_prix_achat} → {nouveau_prix_achat} FCFA [CUMP], "
                f"Prix vente : {ancien_prix_vente} → {nouveau_prix_vente} FCFA)"
            )

        appliquer_mouvement(
            variante, depot, MouvementStock.Type.ENTREE, quantite,
            motif=motif, utilisateur=utilisateur,
            reference_type="achats.Reception", reference_id=reception.id,
        )
        ligne.quantite_recue += quantite
        ligne.save(update_fields=["quantite_recue", "date_modification"])

    solde = valeur_recue - montant_deja_paye
    if solde > 0:
        DetteFournisseur.objects.create(
            fournisseur=commande.fournisseur, commande=commande,
            montant=valeur_recue, montant_paye=montant_deja_paye, solde=solde,
            statut=DetteFournisseur.Statut.EN_COURS,
        )

    if all(l.quantite_recue >= l.quantite for l in commande.lignes.all()):
        commande.statut = CommandeAchat.Statut.RECUE
        commande.save(update_fields=["statut", "date_modification"])

    return reception
