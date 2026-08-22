"""
Services de l'app comptabilite.

Cette app ne modifie jamais les autres apps : elle se contente de les
observer (via comptabilite/signals.py) pour produire des écritures en
partie double. Si la génération d'une écriture échoue (compte manquant,
donnée inattendue...), l'opération d'origine (une vente, un achat...) ne
doit JAMAIS être bloquée par une erreur comptable — voir signals.py, qui
encapsule chaque écouteur dans un try/except.
"""
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from .models import CompteComptable, EcritureComptable, ExerciceComptable, JournalComptable
from .plan_comptable import construire_entrees


class ErreurComptable(Exception):
    """Erreur métier de génération d'écriture (compte manquant, déséquilibre...)."""


def _peupler_plan_comptable(boutique):
    entrees = sorted(construire_entrees(), key=lambda e: len(e[0]))
    comptes_par_numero = {}
    for numero, libelle, classe in entrees:
        parent = comptes_par_numero.get(numero[:-1]) if len(numero) > 2 else None
        compte, _ = CompteComptable.objects.get_or_create(
            boutique=boutique, numero=numero,
            defaults={"libelle": libelle, "classe": classe, "compte_parent": parent},
        )
        comptes_par_numero[numero] = compte


@dataclass
class ContexteComptable:
    boutique: object
    exercice: ExerciceComptable
    journaux: dict
    _comptes: dict = field(default_factory=dict)

    def journal(self, code):
        return self.journaux[code]

    def compte(self, numero):
        """Résout un compte par numéro exact, en remontant vers le compte parent
        le plus proche si le numéro précis n'existe pas pour cette boutique
        (ex. compte 4431 désactivé mais 443 présent)."""
        if numero in self._comptes:
            return self._comptes[numero]
        recherche = numero
        compte = None
        while recherche:
            compte = CompteComptable.objects.filter(
                boutique=self.boutique, numero=recherche
            ).first()
            if compte:
                break
            recherche = recherche[:-1]
        if compte is None:
            raise ErreurComptable(f"Aucun compte trouvé pour {numero} (boutique {self.boutique}).")
        self._comptes[numero] = compte
        return compte


def preparer_contexte(boutique, date_ref=None):
    """Garantit que le plan comptable, l'exercice courant et les journaux
    standard existent pour cette boutique, et retourne un ContexteComptable
    prêt à générer des écritures."""
    date_ref = date_ref or timezone.now().date()

    if not CompteComptable.objects.filter(boutique=boutique).exists():
        _peupler_plan_comptable(boutique)

    exercice = ExerciceComptable.objects.filter(
        boutique=boutique, date_debut__lte=date_ref, date_fin__gte=date_ref
    ).first()
    if exercice is None:
        annee = date_ref.year
        exercice, _ = ExerciceComptable.objects.get_or_create(
            boutique=boutique, libelle=str(annee),
            defaults={"date_debut": date(annee, 1, 1), "date_fin": date(annee, 12, 31)},
        )

    journaux = {}
    for code, libelle in JournalComptable.Code.choices:
        journal, _ = JournalComptable.objects.get_or_create(
            boutique=boutique, code=code, defaults={"libelle": libelle}
        )
        journaux[code] = journal

    return ContexteComptable(boutique=boutique, exercice=exercice, journaux=journaux)


def taux_tva(boutique):
    """Taux de TVA (en %) configuré pour la boutique via configuration.Parametre
    (clé "taux_tva"). 0 si absent ou invalide — une boutique qui ne configure
    rien n'a simplement aucune ligne de TVA dans ses écritures."""
    from configuration.models import Parametre

    parametre = Parametre.objects.filter(boutique=boutique, cle="taux_tva").first()
    if not parametre or not parametre.valeur:
        return Decimal("0")
    try:
        return Decimal(parametre.valeur)
    except Exception:
        return Decimal("0")


def decomposer_ttc(montant_ttc, taux):
    """Décompose un montant TTC en (hors_taxe, tva), arrondis à l'unité.
    taux est un pourcentage (ex. 18 pour 18%)."""
    montant_ttc = Decimal(montant_ttc)
    if not taux:
        return montant_ttc, Decimal("0")
    ht = (montant_ttc / (1 + Decimal(taux) / 100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    tva = montant_ttc - ht
    return ht, tva


@transaction.atomic
def creer_ecriture(contexte, journal_code, date_ecriture, libelle, lignes,
                    reference_type="", reference_id=None, utilisateur=None):
    """
    Crée une écriture équilibrée. `lignes` est une liste de dicts
    {"compte": numero_ou_CompteComptable, "libelle": str, "debit": Decimal, "credit": Decimal}.
    Les lignes à montant nul sont ignorées. Lève ErreurComptable si le total
    des débits ne balance pas avec le total des crédits.
    """
    lignes_utiles = [l for l in lignes if l.get("debit") or l.get("credit")]
    if not lignes_utiles:
        raise ErreurComptable(f"Écriture sans lignes utiles ({libelle}).")

    total_debit = sum(Decimal(l.get("debit") or 0) for l in lignes_utiles)
    total_credit = sum(Decimal(l.get("credit") or 0) for l in lignes_utiles)
    if total_debit != total_credit:
        raise ErreurComptable(
            f"Écriture déséquilibrée ({libelle}) : débit {total_debit} != crédit {total_credit}."
        )

    journal = contexte.journal(journal_code)
    dernier = EcritureComptable.objects.filter(
        exercice=contexte.exercice, journal=journal
    ).aggregate(m=Max("numero"))["m"] or 0

    ecriture = EcritureComptable.objects.create(
        boutique=contexte.boutique, exercice=contexte.exercice, journal=journal,
        numero=dernier + 1, date_ecriture=date_ecriture, libelle=libelle,
        reference_type=reference_type, reference_id=reference_id,
        utilisateur=utilisateur,
    )
    for donnee in lignes_utiles:
        compte = donnee["compte"]
        if isinstance(compte, str):
            compte = contexte.compte(compte)
        ecriture.lignes.create(
            compte=compte, libelle=donnee.get("libelle", ""),
            debit=donnee.get("debit") or 0, credit=donnee.get("credit") or 0,
        )
    return ecriture
