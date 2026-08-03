"""
Logique de l'app rapports : aucune écriture, uniquement des agrégations
sur les autres apps (CLAUDE.md : « rapports ne définit aucun modèle »).
Une vente annulée n'a jamais eu lieu du point de vue des rapports.
"""
import calendar
from datetime import datetime, time

from django.db.models import Count, DecimalField, F, Sum
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone

from stock.models import Stock
from ventes.models import LigneVente, Paiement, Vente

DECIMAL = DecimalField(max_digits=14, decimal_places=2)


def plage_dates(request):
    date_debut = request.query_params.get("date_debut")
    date_fin = request.query_params.get("date_fin")
    if date_debut and date_fin:
        debut = datetime.fromisoformat(date_debut)
        fin = datetime.fromisoformat(date_fin)
    else:
        aujourdhui = timezone.localdate()
        periode = request.query_params.get("periode", "jour")
        if periode == "semaine":
            debut = aujourdhui - timezone.timedelta(days=aujourdhui.weekday())
            fin = debut + timezone.timedelta(days=6)
        elif periode == "mois":
            debut = aujourdhui.replace(day=1)
            fin = aujourdhui.replace(day=calendar.monthrange(aujourdhui.year, aujourdhui.month)[1])
        else:
            debut = fin = aujourdhui
        debut = datetime.combine(debut, time.min)
        fin = datetime.combine(fin, time.max)

    debut = timezone.make_aware(debut) if timezone.is_naive(debut) else debut
    fin = timezone.make_aware(fin) if timezone.is_naive(fin) else fin
    return debut, fin


def _ventes_periode(boutique, debut, fin):
    return Vente.objects.filter(
        boutique=boutique, date_creation__range=(debut, fin),
    ).exclude(statut=Vente.Statut.ANNULEE)


def synthese_ventes(boutique, debut, fin):
    ventes = _ventes_periode(boutique, debut, fin)
    agrege = ventes.aggregate(
        total_brut=Coalesce(Sum("total_brut"), 0, output_field=DECIMAL),
        total_remises=Coalesce(Sum("remise"), 0, output_field=DECIMAL),
        total_net=Coalesce(Sum("total_net"), 0, output_field=DECIMAL),
        nombre_ventes=Count("id"),
    )
    benefice = LigneVente.objects.filter(vente__in=ventes).aggregate(
        total=Coalesce(
            Sum(F("sous_total") - F("cout_unitaire") * F("quantite"), output_field=DECIMAL),
            0, output_field=DECIMAL,
        )
    )["total"]

    nombre_ventes = agrege["nombre_ventes"] or 0
    panier_moyen = round(agrege["total_net"] / nombre_ventes) if nombre_ventes else 0

    return {
        "total_brut": agrege["total_brut"],
        "total_remises": agrege["total_remises"],
        "total_net": agrege["total_net"],
        "nombre_ventes": nombre_ventes,
        "panier_moyen": panier_moyen,
        "benefice_total": benefice,
    }


def top_produits(boutique, debut, fin, limite=10, ordre="desc"):
    ventes = _ventes_periode(boutique, debut, fin)
    qs = (
        LigneVente.objects.filter(vente__in=ventes)
        .values("variante_id", "variante__produit__nom", "variante__reference")
        .annotate(
            quantite_vendue=Coalesce(Sum("quantite"), 0, output_field=DECIMAL),
            ca_genere=Coalesce(Sum("sous_total"), 0, output_field=DECIMAL),
        )
        .order_by("-quantite_vendue" if ordre != "asc" else "quantite_vendue")[:limite]
    )
    return [
        {
            "variante_id": ligne["variante_id"],
            "produit": ligne["variante__produit__nom"],
            "reference": ligne["variante__reference"],
            "quantite_vendue": ligne["quantite_vendue"],
            "ca_genere": ligne["ca_genere"],
        }
        for ligne in qs
    ]


def valeur_stock(boutique, depot=None):
    qs = Stock.objects.filter(depot__boutique=boutique)
    if depot is not None:
        qs = qs.filter(depot=depot)
    agrege = qs.aggregate(
        valeur_achat=Coalesce(
            Sum(F("quantite") * F("variante__prix_achat"), output_field=DECIMAL), 0, output_field=DECIMAL,
        ),
        valeur_vente_potentielle=Coalesce(
            Sum(F("quantite") * F("variante__prix_vente"), output_field=DECIMAL), 0, output_field=DECIMAL,
        ),
        nombre_variantes=Count("id"),
    )
    nombre_ruptures = qs.filter(quantite__lte=F("variante__seuil_alerte")).count()
    return {**agrege, "nombre_ruptures": nombre_ruptures}


def ventes_par_vendeur(boutique, debut, fin):
    ventes = _ventes_periode(boutique, debut, fin)
    qs = (
        ventes.values("utilisateur_id", "utilisateur__username")
        .annotate(
            nombre_ventes=Count("id"),
            total_net=Coalesce(Sum("total_net"), 0, output_field=DECIMAL),
        )
        .order_by("-total_net")
    )
    return [
        {
            "utilisateur_id": ligne["utilisateur_id"],
            "utilisateur": ligne["utilisateur__username"],
            "nombre_ventes": ligne["nombre_ventes"],
            "total_net": ligne["total_net"],
        }
        for ligne in qs
    ]


def ventes_par_categorie(boutique, debut, fin):
    ventes = _ventes_periode(boutique, debut, fin)
    qs = (
        LigneVente.objects.filter(vente__in=ventes)
        .values("variante__produit__categorie_id", "variante__produit__categorie__nom")
        .annotate(
            quantite_vendue=Coalesce(Sum("quantite"), 0, output_field=DECIMAL),
            ca_genere=Coalesce(Sum("sous_total"), 0, output_field=DECIMAL),
        )
        .order_by("-ca_genere")
    )
    return [
        {
            "categorie_id": ligne["variante__produit__categorie_id"],
            "categorie": ligne["variante__produit__categorie__nom"] or "Sans catégorie",
            "quantite_vendue": ligne["quantite_vendue"],
            "ca_genere": ligne["ca_genere"],
        }
        for ligne in qs
    ]


def ventes_par_jour(boutique, debut, fin):
    ventes = _ventes_periode(boutique, debut, fin)
    qs = (
        ventes.annotate(jour=TruncDate("date_creation"))
        .values("jour")
        .annotate(total_net=Coalesce(Sum("total_net"), 0, output_field=DECIMAL))
        .order_by("jour")
    )
    return [{"jour": ligne["jour"].isoformat(), "total_net": ligne["total_net"]} for ligne in qs]


def top_clients(boutique, debut, fin, limite=5):
    ventes = _ventes_periode(boutique, debut, fin).exclude(client__isnull=True)
    qs = (
        ventes.values("client_id", "client__nom")
        .annotate(
            nombre_ventes=Count("id"),
            total_net=Coalesce(Sum("total_net"), 0, output_field=DECIMAL),
        )
        .order_by("-total_net")[:limite]
    )
    return [
        {
            "client_id": ligne["client_id"],
            "client_nom": ligne["client__nom"],
            "nombre_ventes": ligne["nombre_ventes"],
            "total_net": ligne["total_net"],
        }
        for ligne in qs
    ]


def ventes_par_mode_paiement(boutique, debut, fin):
    ventes = _ventes_periode(boutique, debut, fin)
    qs = (
        Paiement.objects.filter(vente__in=ventes)
        .values("mode")
        .annotate(total=Coalesce(Sum("montant"), 0, output_field=DECIMAL))
        .order_by("-total")
    )
    return [{"mode": ligne["mode"], "total": ligne["total"]} for ligne in qs]
