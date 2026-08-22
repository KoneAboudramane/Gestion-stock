from rest_framework import mixins, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from . import rapports
from .models import CompteComptable
from .serializers import CompteComptableSerializer
from .services import preparer_contexte

PeutConsulterComptabilite = a_la_permission("consulter_comptabilite")


class CompteComptableViewSet(FiltreBoutiqueMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = CompteComptableSerializer
    queryset = CompteComptable.objects.all()
    permission_classes = [EstMembreBoutique, PeutConsulterComptabilite]

    def get_queryset(self):
        # S'assure que le plan comptable existe avant de le lister (une
        # boutique jamais utilisée pour une écriture n'a encore rien).
        preparer_contexte(self.request.user.boutique)
        return super().get_queryset()


class _RapportComptableView(APIView):
    permission_classes = [EstMembreBoutique, PeutConsulterComptabilite]


class JournalView(_RapportComptableView):
    def get(self, request):
        debut, fin = rapports.plage_dates(request)
        journal_code = request.query_params.get("journal")
        lignes = rapports.journal(request.user.boutique, debut, fin, journal_code)
        return Response(lignes)


class GrandLivreView(_RapportComptableView):
    def get(self, request):
        compte = request.query_params.get("compte")
        if not compte:
            return Response({"detail": "Le paramètre compte est requis."}, status=status.HTTP_400_BAD_REQUEST)
        debut, fin = rapports.plage_dates(request)
        resultat = rapports.grand_livre(request.user.boutique, compte, debut, fin)
        if resultat is None:
            return Response({"detail": "Compte introuvable."}, status=status.HTTP_404_NOT_FOUND)
        return Response(resultat)


class BalanceGeneraleView(_RapportComptableView):
    def get(self, request):
        debut, fin = rapports.plage_dates(request)
        return Response(rapports.balance_generale(request.user.boutique, debut, fin))


class CompteDeResultatView(_RapportComptableView):
    def get(self, request):
        debut, fin = rapports.plage_dates(request)
        return Response(rapports.compte_de_resultat(request.user.boutique, debut, fin))


class BilanView(_RapportComptableView):
    def get(self, request):
        _, fin = rapports.plage_dates(request)
        return Response(rapports.bilan(request.user.boutique, fin))
