from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import EstMembreBoutique, a_la_permission
from stock.models import Depot

from . import services
from .export import exporter_tableau

PeutVoirRapports = a_la_permission("voir_rapports_complets")


class _RapportView(APIView):
    permission_classes = [EstMembreBoutique, PeutVoirRapports]

    def repondre(self, request, titre, colonnes, lignes):
        # NB : le paramètre s'appelle "export" et non "format" — DRF réserve
        # "format" pour sa propre négociation de contenu (sinon Http404 interne
        # dès que la valeur ne correspond à aucun renderer enregistré).
        format_demande = request.query_params.get("export")
        if format_demande:
            reponse_export = exporter_tableau(format_demande, titre, colonnes, lignes)
            if reponse_export is not None:
                return reponse_export
        return Response(lignes)


class SyntheseVentesView(_RapportView):
    def get(self, request):
        debut, fin = services.plage_dates(request)
        donnees = services.synthese_ventes(request.user.boutique, debut, fin)
        colonnes = [
            ("total_brut", "Total brut"), ("total_remises", "Remises"),
            ("total_net", "Total net"), ("nombre_ventes", "Nombre de ventes"),
            ("panier_moyen", "Panier moyen"), ("benefice_total", "Bénéfice"),
        ]
        return self.repondre(request, "Synthese des ventes", colonnes, [donnees])


class TopProduitsView(_RapportView):
    def get(self, request):
        debut, fin = services.plage_dates(request)
        limite = int(request.query_params.get("limite", 10))
        ordre = request.query_params.get("ordre", "desc")
        lignes = services.top_produits(request.user.boutique, debut, fin, limite, ordre)
        colonnes = [
            ("produit", "Produit"), ("reference", "Référence"),
            ("quantite_vendue", "Quantité vendue"), ("ca_genere", "CA généré"),
        ]
        return self.repondre(request, "Top produits", colonnes, lignes)


class ValeurStockView(_RapportView):
    def get(self, request):
        depot = None
        depot_id = request.query_params.get("depot")
        if depot_id:
            depot = Depot.objects.filter(boutique=request.user.boutique, pk=depot_id).first()
        donnees = services.valeur_stock(request.user.boutique, depot)
        colonnes = [
            ("valeur_achat", "Valeur au coût"), ("valeur_vente_potentielle", "Valeur au prix de vente"),
            ("nombre_variantes", "Nombre de lignes de stock"), ("nombre_ruptures", "Variantes en rupture"),
        ]
        return self.repondre(request, "Valeur du stock", colonnes, [donnees])


class VentesParVendeurView(_RapportView):
    def get(self, request):
        debut, fin = services.plage_dates(request)
        lignes = services.ventes_par_vendeur(request.user.boutique, debut, fin)
        colonnes = [("utilisateur", "Vendeur"), ("nombre_ventes", "Nombre de ventes"), ("total_net", "Total net")]
        return self.repondre(request, "Ventes par vendeur", colonnes, lignes)


class VentesParCategorieView(_RapportView):
    def get(self, request):
        debut, fin = services.plage_dates(request)
        lignes = services.ventes_par_categorie(request.user.boutique, debut, fin)
        colonnes = [
            ("categorie", "Catégorie"), ("quantite_vendue", "Quantité vendue"), ("ca_genere", "CA généré"),
        ]
        return self.repondre(request, "Ventes par categorie", colonnes, lignes)


class VentesParModePaiementView(_RapportView):
    def get(self, request):
        debut, fin = services.plage_dates(request)
        lignes = services.ventes_par_mode_paiement(request.user.boutique, debut, fin)
        colonnes = [("mode", "Mode de paiement"), ("total", "Total")]
        return self.repondre(request, "Ventes par mode de paiement", colonnes, lignes)


class VentesParJourView(_RapportView):
    def get(self, request):
        debut, fin = services.plage_dates(request)
        lignes = services.ventes_par_jour(request.user.boutique, debut, fin)
        colonnes = [("jour", "Jour"), ("total_net", "Total net")]
        return self.repondre(request, "Ventes par jour", colonnes, lignes)


class TopClientsView(_RapportView):
    def get(self, request):
        debut, fin = services.plage_dates(request)
        limite = int(request.query_params.get("limite", 5))
        lignes = services.top_clients(request.user.boutique, debut, fin, limite)
        colonnes = [
            ("client_nom", "Client"), ("nombre_ventes", "Nombre de ventes"), ("total_net", "Total net"),
        ]
        return self.repondre(request, "Top clients", colonnes, lignes)
