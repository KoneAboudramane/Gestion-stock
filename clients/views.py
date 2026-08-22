from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import Client, Credit
from .serializers import ClientSerializer, CreditSerializer, PaiementCreditEntreeSerializer
from .services import rembourser_credit

PeutGererClients = a_la_permission("gerer_clients")


class ClientViewSet(FiltreBoutiqueMixin, viewsets.ModelViewSet):
    serializer_class = ClientSerializer
    queryset = Client.objects.all()
    permission_classes = [EstMembreBoutique, PeutGererClients]


class CreditViewSet(
    FiltreBoutiqueMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin, viewsets.GenericViewSet,
):
    """Un Credit naît d'une vente à crédit (Étape 4) : pas de create ici."""

    serializer_class = CreditSerializer
    queryset = Credit.objects.prefetch_related("paiements")
    chemin_boutique = "client__boutique"
    permission_classes = [EstMembreBoutique, PeutGererClients]

    def get_queryset(self):
        queryset = super().get_queryset()
        client_id = self.request.query_params.get("client")
        if client_id:
            queryset = queryset.filter(client_id=client_id)
        return queryset

    @action(detail=True, methods=["post"])
    def rembourser(self, request, pk=None):
        credit = self.get_object()
        entree = PaiementCreditEntreeSerializer(data=request.data, context={"request": request})
        entree.is_valid(raise_exception=True)
        rembourser_credit(
            credit, entree.validated_data["montant"], entree.validated_data.get("mode", ""),
            depot=entree.validated_data.get("depot"), utilisateur=request.user,
        )
        # Le cache prefetch_related("paiements") de get_object() est antérieur
        # au règlement : on relit l'objet pour renvoyer l'historique à jour.
        credit.refresh_from_db()
        credit._prefetched_objects_cache = {}
        return Response(self.get_serializer(credit).data)
