from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import TransactionMobileMoney
from .serializers import InitierTransactionSerializer, TransactionMobileMoneySerializer
from .services import initier_paiement_mobile_money

PeutVendre = a_la_permission("vendre")


class TransactionMobileMoneyViewSet(
    FiltreBoutiqueMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """Pas de create() standard : une transaction naît de l'action "initier"."""

    serializer_class = TransactionMobileMoneySerializer
    queryset = TransactionMobileMoney.objects.all()
    chemin_boutique = "paiement__vente__boutique"
    permission_classes = [EstMembreBoutique, PeutVendre]

    @action(detail=False, methods=["post"])
    def initier(self, request):
        entree = InitierTransactionSerializer(data=request.data, context={"request": request})
        entree.is_valid(raise_exception=True)
        transaction_creee = initier_paiement_mobile_money(**entree.validated_data)
        return Response(
            TransactionMobileMoneySerializer(transaction_creee).data,
            status=status.HTTP_201_CREATED,
        )
