"""
Documents comptables en lecture seule : Journal, Grand livre, Balance
générale, Bilan, Compte de résultat. Tout se calcule à la volée à partir de
EcritureComptable/LigneEcriture (comme rapports/services.py pour les
ventes) — rien n'est stocké séparément.
"""
from datetime import datetime, time

from django.db.models import DecimalField, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from .models import CompteComptable, LigneEcriture


def plage_dates(request):
    date_debut = request.query_params.get("date_debut")
    date_fin = request.query_params.get("date_fin")
    if date_debut and date_fin:
        return datetime.fromisoformat(date_debut).date(), datetime.fromisoformat(date_fin).date()
    aujourdhui = timezone.localdate()
    return aujourdhui.replace(month=1, day=1), aujourdhui


def journal(boutique, debut, fin, journal_code=None):
    queryset = LigneEcriture.objects.filter(
        ecriture__boutique=boutique, ecriture__date_ecriture__gte=debut, ecriture__date_ecriture__lte=fin,
    ).select_related("ecriture", "ecriture__journal", "compte").order_by(
        "ecriture__date_ecriture", "ecriture__journal__code", "ecriture__numero", "id"
    )
    if journal_code:
        queryset = queryset.filter(ecriture__journal__code=journal_code)

    resultat = []
    for ligne in queryset:
        ecriture = ligne.ecriture
        resultat.append({
            "date": ecriture.date_ecriture,
            "journal": ecriture.journal.code,
            "numero_ecriture": ecriture.numero,
            "libelle_ecriture": ecriture.libelle,
            "compte": ligne.compte.numero,
            "libelle_compte": ligne.compte.libelle,
            "libelle_ligne": ligne.libelle,
            "debit": ligne.debit,
            "credit": ligne.credit,
        })
    return resultat


def grand_livre(boutique, compte_numero, debut, fin):
    compte = CompteComptable.objects.filter(boutique=boutique, numero=compte_numero).first()
    if compte is None:
        return None

    queryset = LigneEcriture.objects.filter(
        compte=compte, ecriture__boutique=boutique,
        ecriture__date_ecriture__gte=debut, ecriture__date_ecriture__lte=fin,
    ).select_related("ecriture", "ecriture__journal").order_by(
        "ecriture__date_ecriture", "ecriture__numero", "id"
    )

    solde = 0
    lignes = []
    for ligne in queryset:
        solde += ligne.debit - ligne.credit
        lignes.append({
            "date": ligne.ecriture.date_ecriture,
            "journal": ligne.ecriture.journal.code,
            "numero_ecriture": ligne.ecriture.numero,
            "libelle": ligne.libelle or ligne.ecriture.libelle,
            "debit": ligne.debit,
            "credit": ligne.credit,
            "solde_cumule": solde,
        })
    return {
        "compte": compte.numero,
        "libelle": compte.libelle,
        "lignes": lignes,
        "solde_final": solde,
    }


def _totaux_par_compte(boutique, debut, fin):
    zero = Coalesce(Sum("debit"), 0, output_field=DecimalField(max_digits=14, decimal_places=2))
    zero_c = Coalesce(Sum("credit"), 0, output_field=DecimalField(max_digits=14, decimal_places=2))
    return (
        LigneEcriture.objects.filter(
            compte__boutique=boutique, ecriture__date_ecriture__gte=debut, ecriture__date_ecriture__lte=fin,
        )
        .values("compte__numero", "compte__libelle", "compte__classe")
        .annotate(total_debit=zero, total_credit=zero_c)
        .order_by("compte__numero")
    )


def balance_generale(boutique, debut, fin):
    lignes = []
    total_debit_general = total_credit_general = 0
    for ligne in _totaux_par_compte(boutique, debut, fin):
        total_debit = ligne["total_debit"]
        total_credit = ligne["total_credit"]
        solde = total_debit - total_credit
        lignes.append({
            "compte": ligne["compte__numero"],
            "libelle": ligne["compte__libelle"],
            "classe": ligne["compte__classe"],
            "total_debit": total_debit,
            "total_credit": total_credit,
            "solde_debiteur": solde if solde > 0 else 0,
            "solde_crediteur": -solde if solde < 0 else 0,
        })
        total_debit_general += total_debit
        total_credit_general += total_credit
    return {
        "lignes": lignes,
        "total_debit": total_debit_general,
        "total_credit": total_credit_general,
    }


def compte_de_resultat(boutique, debut, fin):
    """Charges (classe 6) vs Produits (classe 7). Résultat = produits - charges."""
    charges = []
    produits = []
    total_charges = total_produits = 0
    for ligne in _totaux_par_compte(boutique, debut, fin):
        classe = ligne["compte__classe"]
        if classe == 6:
            montant = ligne["total_debit"] - ligne["total_credit"]
            if montant:
                charges.append({"compte": ligne["compte__numero"], "libelle": ligne["compte__libelle"], "montant": montant})
                total_charges += montant
        elif classe == 7:
            montant = ligne["total_credit"] - ligne["total_debit"]
            if montant:
                produits.append({"compte": ligne["compte__numero"], "libelle": ligne["compte__libelle"], "montant": montant})
                total_produits += montant
    return {
        "charges": charges,
        "produits": produits,
        "total_charges": total_charges,
        "total_produits": total_produits,
        "resultat_net": total_produits - total_charges,
    }


def bilan(boutique, date_fin):
    """
    Actif/Passif à une date donnée : le solde de chaque compte (classes 1 à 5)
    depuis l'origine jusqu'à date_fin détermine sa colonne (débiteur -> actif,
    créditeur -> passif), pas sa classe seule (ex. classe 4 contient des
    clients débiteurs ET des fournisseurs créditeurs). Le résultat net de
    l'exercice (classes 6/7) est ajouté au passif pour équilibrer, comme dans
    un bilan comptable classique avant affectation.
    """
    from datetime import date as _date

    origine = _date(1900, 1, 1)
    debut_exercice = date_fin.replace(month=1, day=1)
    actif = []
    passif = []
    total_actif = total_passif = 0
    for ligne in _totaux_par_compte(boutique, origine, date_fin):
        classe = ligne["compte__classe"]
        if classe not in (1, 2, 3, 4, 5):
            continue
        solde = ligne["total_debit"] - ligne["total_credit"]
        if solde > 0:
            actif.append({"compte": ligne["compte__numero"], "libelle": ligne["compte__libelle"], "montant": solde})
            total_actif += solde
        elif solde < 0:
            passif.append({"compte": ligne["compte__numero"], "libelle": ligne["compte__libelle"], "montant": -solde})
            total_passif += -solde

    resultat = compte_de_resultat(boutique, debut_exercice, date_fin)
    if resultat["resultat_net"]:
        passif.append({"compte": "12", "libelle": "Résultat net de l'exercice", "montant": resultat["resultat_net"]})
        total_passif += resultat["resultat_net"]

    return {
        "date": date_fin,
        "actif": actif,
        "passif": passif,
        "total_actif": total_actif,
        "total_passif": total_passif,
    }
