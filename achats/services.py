"""
Logique métier de l'app achats.
CLAUDE.md : une réception crée une entrée de stock par ligne de la commande
(Reception n'a pas de lignes propres) et une DetteFournisseur si non payé.
"""
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from core.services import generer_numero_sequentiel
from fournisseurs.models import DetteFournisseur
from stock.models import MouvementStock, Stock
from stock.services import appliquer_mouvement

from .models import (
    CommandeAchat,
    EvenementCommande,
    LigneAchat,
    LigneRetourFournisseur,
    Reception,
    RetourFournisseur,
)


def noter_etape(commande, type_etape, utilisateur=None, detail="", montant=None, reference_id=None):
    """Ajoute une étape au suivi de la commande (voir EvenementCommande)."""
    return EvenementCommande.objects.create(
        commande=commande, type=type_etape, utilisateur=utilisateur,
        detail=detail[:255], montant=montant, reference_id=reference_id,
    )


def _articles(quantite):
    quantite = int(quantite) if quantite == int(quantite) else quantite
    return f"{quantite} article{'s' if quantite > 1 else ''}"


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
    noter_etape(
        commande, EvenementCommande.Type.CREEE, utilisateur,
        "Directement commandée" if statut == CommandeAchat.Statut.COMMANDEE else "En brouillon", total,
    )
    return commande


@transaction.atomic
def modifier_commande(commande, fournisseur, statut, lignes_donnees=None, utilisateur=None):
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

    ancien_fournisseur, ancien_statut = commande.fournisseur, commande.statut
    if ancien_fournisseur != fournisseur:
        noter_etape(
            commande, EvenementCommande.Type.MODIFIEE, utilisateur,
            f"Fournisseur : {ancien_fournisseur} → {fournisseur}",
        )
    if lignes_donnees is not None:
        noter_etape(commande, EvenementCommande.Type.MODIFIEE, utilisateur, "Articles modifiés", commande.total)
    if statut != ancien_statut and statut == CommandeAchat.Statut.COMMANDEE:
        noter_etape(commande, EvenementCommande.Type.COMMANDEE, utilisateur, "", commande.total)
    if statut != ancien_statut and statut == CommandeAchat.Statut.ANNULEE:
        noter_etape(commande, EvenementCommande.Type.ANNULEE, utilisateur)

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
            fournisseur=commande.fournisseur, commande=commande, reception=reception,
            montant=valeur_recue, montant_paye=montant_deja_paye, solde=solde,
            statut=DetteFournisseur.Statut.EN_COURS,
        )

    complete = all(l.quantite_recue >= l.quantite for l in commande.lignes.all())
    noter_etape(
        commande, EvenementCommande.Type.RECEPTION, utilisateur,
        f"{_articles(sum(d['quantite'] for d in lignes))} reçus au dépôt {depot.nom}"
        + (" · commande complète" if complete else " · reçue en partie"),
        valeur_recue, reception.id,
    )
    if montant_deja_paye > 0:
        noter_etape(
            commande, EvenementCommande.Type.PAIEMENT, utilisateur, "Payé à la réception", montant_deja_paye, reception.id,
        )
    if complete:
        commande.statut = CommandeAchat.Statut.RECUE
        commande.save(update_fields=["statut", "date_modification"])

    return reception


# --- Annulation de réception et retour fournisseur ---

def _lignes_recues(reception):
    """Quantités livrées à cette réception, par variante (lues dans ses
    mouvements d'entrée ; une réception ancienne sans ce lien n'en a pas)."""
    quantites = {}
    for m in MouvementStock.objects.filter(
        reference_type="achats.Reception", reference_id=reception.id, type=MouvementStock.Type.ENTREE,
    ):
        quantites[m.variante_id] = quantites.get(m.variante_id, 0) + m.quantite
    return quantites


def _deja_retourne(reception):
    quantites = {}
    for l in LigneRetourFournisseur.objects.filter(retour__reception=reception):
        quantites[l.variante_id] = quantites.get(l.variante_id, 0) + l.quantite
    return quantites


def _dette_de_la_reception(reception):
    """Dette créée par cette réception (lien direct, ou pour une réception
    ancienne : la dette de la commande de même montant, sans lien)."""
    dette = DetteFournisseur.objects.filter(reception=reception).first()
    if dette:
        return dette
    return DetteFournisseur.objects.filter(
        commande=reception.commande, reception__isnull=True, montant=reception.valeur_recue,
    ).order_by("date_creation").first()


def _retirer_du_stock_et_du_cump(variante, depot, quantite, prix_achat, motif, utilisateur, reference_type, reference_id):
    """Sortie de marchandise renvoyée au fournisseur : le coût moyen est recalculé
    à l'envers (on retire ces unités à leur prix d'achat)."""
    stock_depot = Stock.objects.filter(variante=variante, depot=depot).first()
    if not stock_depot or stock_depot.quantite < quantite:
        raise ValidationError(f"{variante} : plus assez de stock dans ce dépôt (déjà vendu ?).")
    stock_total = Stock.objects.filter(variante=variante).aggregate(total=Sum("quantite"))["total"] or 0
    reste = stock_total - quantite
    if reste > 0:
        nouveau_cump = round((stock_total * variante.prix_achat - quantite * prix_achat) / reste)
        if nouveau_cump > 0:
            variante.prix_achat = nouveau_cump
            variante.save(update_fields=["prix_achat", "date_modification"])
    appliquer_mouvement(
        variante, depot, MouvementStock.Type.SORTIE, quantite, motif=motif, utilisateur=utilisateur,
        reference_type=reference_type, reference_id=reference_id,
    )


@transaction.atomic
def annuler_reception(reception, utilisateur=None):
    """Réception saisie par erreur : la marchandise ressort, la commande attend
    de nouveau ces quantités, la dette de la réception est soldée à zéro.
    Refusée si la marchandise n'est plus en stock ou si la dette a déjà reçu
    un règlement après la réception. Renvoie le montant payé sur place à
    récupérer auprès du fournisseur."""
    if reception.annulee:
        raise ValidationError("Cette réception est déjà annulée.")
    quantites = _lignes_recues(reception)
    if not quantites:
        raise ValidationError("Réception trop ancienne : ses articles ne sont pas tracés, annulation impossible.")
    if LigneRetourFournisseur.objects.filter(retour__reception=reception).exists():
        raise ValidationError("Des articles de cette réception ont déjà été retournés au fournisseur.")
    dette = _dette_de_la_reception(reception)
    if dette and dette.montant_paye > reception.montant_paye:
        raise ValidationError("Un règlement a déjà été fait sur la dette de cette réception : annulation impossible.")

    commande = reception.commande
    lignes = {l.variante_id: l for l in commande.lignes.select_related("variante")}
    for variante_id, quantite in quantites.items():
        ligne = lignes[variante_id]
        _retirer_du_stock_et_du_cump(
            ligne.variante, reception.depot, quantite, ligne.prix_achat,
            f"Annulation réception {commande.numero}", utilisateur, "achats.Reception", reception.id,
        )
        ligne.quantite_recue = max(0, ligne.quantite_recue - quantite)
        ligne.save(update_fields=["quantite_recue", "date_modification"])

    if dette:
        dette.montant = dette.montant_paye
        dette.solde = 0
        dette.statut = DetteFournisseur.Statut.SOLDE
        dette.save(update_fields=["montant", "solde", "statut", "date_modification"])
    if commande.statut == CommandeAchat.Statut.RECUE:
        commande.statut = CommandeAchat.Statut.COMMANDEE
        commande.save(update_fields=["statut", "date_modification"])

    reception.annulee = True
    reception.date_annulation = timezone.now()
    reception.save(update_fields=["annulee", "date_annulation", "date_modification"])
    noter_etape(
        commande, EvenementCommande.Type.RECEPTION_ANNULEE, utilisateur,
        f"{_articles(sum(quantites.values()))} ressortis du dépôt {reception.depot.nom}",
        reception.valeur_recue, reception.id,
    )
    return reception


@transaction.atomic
def retourner_au_fournisseur(reception, lignes, motif="", utilisateur=None):
    """Renvoie une partie des articles d'une réception. `lignes` :
    [{"variante": Variante, "quantite": Decimal}]. La dette de la réception
    baisse du montant retourné (au prix d'achat de la commande) ; ce qui
    dépasse son solde devient un avoir à récupérer auprès du fournisseur."""
    if reception.annulee:
        raise ValidationError("Cette réception est annulée.")
    lignes = [l for l in lignes if l["quantite"] > 0]
    if not lignes:
        raise ValidationError("Indiquez au moins une quantité à retourner.")
    recues = _lignes_recues(reception)
    retournees = _deja_retourne(reception)
    commande = reception.commande
    lignes_commande = {l.variante_id: l for l in commande.lignes.select_related("variante")}

    retour = RetourFournisseur.objects.create(
        commande=commande, reception=reception, depot=reception.depot,
        motif=(motif or "").strip(), utilisateur=utilisateur,
    )
    montant = 0
    for donnee in lignes:
        variante = donnee["variante"]
        quantite = donnee["quantite"]
        ligne = lignes_commande.get(variante.id)
        disponible = recues.get(variante.id, 0) - retournees.get(variante.id, 0)
        if not ligne or quantite > disponible:
            raise ValidationError(f"{variante} : on ne peut pas retourner plus que ce qui a été reçu.")
        _retirer_du_stock_et_du_cump(
            variante, reception.depot, quantite, ligne.prix_achat,
            f"Retour fournisseur {commande.numero}", utilisateur, "achats.RetourFournisseur", retour.id,
        )
        sous_total = round(quantite * ligne.prix_achat)
        LigneRetourFournisseur.objects.create(
            retour=retour, variante=variante, quantite=quantite, prix_achat=ligne.prix_achat, sous_total=sous_total,
        )
        montant += sous_total

    dette = _dette_de_la_reception(reception)
    deduit = min(montant, dette.solde) if dette else 0
    if dette and deduit > 0:
        dette.montant -= deduit
        dette.solde -= deduit
        if dette.solde <= 0:
            dette.statut = DetteFournisseur.Statut.SOLDE
        dette.save(update_fields=["montant", "solde", "statut", "date_modification"])
    retour.montant = montant
    retour.avoir = montant - deduit
    retour.save(update_fields=["montant", "avoir", "date_modification"])
    noter_etape(
        commande, EvenementCommande.Type.RETOUR, utilisateur,
        f"{_articles(sum(l['quantite'] for l in lignes))} renvoyés" + (f" · {retour.motif}" if retour.motif else ""),
        montant, retour.id,
    )
    return retour
