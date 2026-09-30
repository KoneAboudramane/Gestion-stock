from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import DetteFournisseur, Fournisseur, MouvementCompteFournisseur, PaiementDetteFournisseur
from .serializers import (
    DetteFournisseurSerializer, FournisseurSerializer, MouvementCompteSerializer, OperationCompteSerializer,
    PaiementDetteSerializer,
)
from .services import (
    annuler_paiement_dette, payer_dette, rembourse_par_fournisseur, solde_compte_fournisseur,
    verser_avance_fournisseur,
)

PeutGererAchats = a_la_permission("gerer_produits_stock_achats")


class FournisseurViewSet(FiltreBoutiqueMixin, viewsets.ModelViewSet):
    serializer_class = FournisseurSerializer
    queryset = Fournisseur.objects.all()

    def get_permissions(self):
        if self.action in ("list", "retrieve", "compte"):
            return [EstMembreBoutique()]
        return [EstMembreBoutique(), PeutGererAchats()]

    def _compte(self, fournisseur):
        mouvements = MouvementCompteFournisseur.objects.filter(fournisseur=fournisseur, supprime=False).order_by(
            "date_creation"
        )
        return {
            "solde": solde_compte_fournisseur(fournisseur),
            "mouvements": MouvementCompteSerializer(mouvements, many=True).data,
        }

    @action(detail=True, methods=["get"])
    def compte(self, request, pk=None):
        return Response(self._compte(self.get_object()))

    def _operation(self, request, fonction):
        fournisseur = self.get_object()
        entree = OperationCompteSerializer(data=request.data, context={"request": request})
        entree.is_valid(raise_exception=True)
        d = entree.validated_data
        fonction(
            fournisseur, d["montant"], d["mode"], operateur=d.get("operateur", ""), depot=d.get("depot"),
            utilisateur=request.user, motif=d.get("motif", ""),
        )
        return Response(self._compte(fournisseur))

    @action(detail=True, methods=["post"], url_path="verser-avance")
    def verser_avance(self, request, pk=None):
        return self._operation(request, verser_avance_fournisseur)

    @action(detail=True, methods=["post"])
    def remboursement(self, request, pk=None):
        return self._operation(request, rembourse_par_fournisseur)


class DetteFournisseurViewSet(
    FiltreBoutiqueMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet,
):
    serializer_class = DetteFournisseurSerializer
    queryset = DetteFournisseur.objects.select_related("fournisseur", "commande").prefetch_related("paiements")
    chemin_boutique = "fournisseur__boutique"
    permission_classes = [EstMembreBoutique, PeutGererAchats]

    @action(detail=True, methods=["post"])
    def payer(self, request, pk=None):
        dette = self.get_object()
        entree = PaiementDetteSerializer(data=request.data, context={"request": request})
        entree.is_valid(raise_exception=True)
        payer_dette(
            dette, entree.validated_data["montant"], entree.validated_data.get("mode", ""),
            depot=entree.validated_data.get("depot"), utilisateur=request.user,
        )
        # Le cache prefetch_related("paiements") de get_object() est antérieur
        # au paiement : on relit l'objet pour renvoyer l'historique à jour.
        dette.refresh_from_db()
        dette._prefetched_objects_cache = {}
        return Response(self.get_serializer(dette).data)

    @action(detail=True, methods=["post"], url_path="annuler-paiement")
    def annuler_paiement(self, request, pk=None):
        dette = self.get_object()
        paiement = PaiementDetteFournisseur.objects.filter(dette=dette, id=request.data.get("paiement")).first()
        if paiement is None:
            raise NotFound("Remboursement introuvable pour cette dette.")
        annuler_paiement_dette(paiement, utilisateur=request.user, motif=request.data.get("motif", ""))
        dette.refresh_from_db()
        dette._prefetched_objects_cache = {}
        return Response(self.get_serializer(dette).data)
