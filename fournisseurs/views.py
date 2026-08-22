from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import DetteFournisseur, Fournisseur
from .serializers import DetteFournisseurSerializer, FournisseurSerializer, PaiementDetteSerializer
from .services import payer_dette

PeutGererAchats = a_la_permission("gerer_produits_stock_achats")


class FournisseurViewSet(FiltreBoutiqueMixin, viewsets.ModelViewSet):
    serializer_class = FournisseurSerializer
    queryset = Fournisseur.objects.all()

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [EstMembreBoutique()]
        return [EstMembreBoutique(), PeutGererAchats()]


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
