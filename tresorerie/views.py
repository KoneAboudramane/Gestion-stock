from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from comptes.models import Utilisateur
from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission
from stock.models import Depot

from .models import ClotureCaisse, Depense, MouvementCaisse, Transfert
from .serializers import (
    AjustementEntreeSerializer,
    ApportEntreeSerializer,
    ClotureCaisseSerializer,
    DepenseSerializer,
    MouvementCaisseSerializer,
    RetraitEntreeSerializer,
    TransfertSerializer,
)
from .services import ajuster_caisse, effectuer_retrait, enregistrer_apport, solde_caisse, solde_mobile_money_disponible

PeutConsulterTresorerie = a_la_permission("consulter_tresorerie")
PeutEnregistrerDepense = a_la_permission("enregistrer_depense")
PeutGererTresorerie = a_la_permission("gerer_tresorerie")


class DepenseViewSet(
    FiltreBoutiqueMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.CreateModelMixin, viewsets.GenericViewSet,
):
    serializer_class = DepenseSerializer
    queryset = Depense.objects.select_related("depot", "utilisateur")
    chemin_boutique = "depot__boutique"

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [EstMembreBoutique(), PeutConsulterTresorerie()]
        return [EstMembreBoutique(), PeutEnregistrerDepense()]

    def get_queryset(self):
        queryset = super().get_queryset()
        depot_id = self.request.query_params.get("depot")
        if depot_id:
            queryset = queryset.filter(depot_id=depot_id)
        return queryset


class TransfertViewSet(
    FiltreBoutiqueMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.CreateModelMixin, viewsets.GenericViewSet,
):
    serializer_class = TransfertSerializer
    queryset = Transfert.objects.select_related("depot", "utilisateur_source", "utilisateur")
    chemin_boutique = "depot__boutique"

    def get_permissions(self):
        if self.action in ("list", "retrieve", "disponible"):
            return [EstMembreBoutique(), PeutConsulterTresorerie()]
        return [EstMembreBoutique(), PeutEnregistrerDepense()]

    @action(detail=False, methods=["get"])
    def disponible(self, request):
        """Solde mobile money d'un vendeur pas encore reversé en caisse (avant transfert)."""
        operateur = request.query_params.get("operateur")
        if not operateur:
            return Response({"detail": "Le paramètre operateur est requis."}, status=status.HTTP_400_BAD_REQUEST)
        utilisateur_id = request.query_params.get("utilisateur") or request.user.id
        utilisateur_source = get_object_or_404(
            Utilisateur, id=utilisateur_id, boutique=request.user.boutique
        )
        disponible = solde_mobile_money_disponible(request.user.boutique, utilisateur_source, operateur)
        return Response({"disponible": disponible})


class MouvementCaisseViewSet(
    FiltreBoutiqueMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet,
):
    """Pur ledger en lecture : toute création passe par une action dédiée (Depense, Transfert...)."""

    serializer_class = MouvementCaisseSerializer
    queryset = MouvementCaisse.objects.select_related("depot", "utilisateur")
    chemin_boutique = "depot__boutique"
    permission_classes = [EstMembreBoutique, PeutConsulterTresorerie]

    def get_queryset(self):
        queryset = super().get_queryset()
        depot_id = self.request.query_params.get("depot")
        if depot_id:
            queryset = queryset.filter(depot_id=depot_id)
        return queryset

    @action(detail=False)
    def solde(self, request):
        depot_id = request.query_params.get("depot")
        if not depot_id:
            return Response({"detail": "Le paramètre depot est requis."}, status=status.HTTP_400_BAD_REQUEST)
        depot = get_object_or_404(Depot, id=depot_id, boutique=request.user.boutique)
        return Response({"solde": solde_caisse(depot)})


class ClotureCaisseViewSet(
    FiltreBoutiqueMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.CreateModelMixin, viewsets.GenericViewSet,
):
    serializer_class = ClotureCaisseSerializer
    queryset = ClotureCaisse.objects.select_related("depot", "utilisateur")
    chemin_boutique = "depot__boutique"

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [EstMembreBoutique(), PeutConsulterTresorerie()]
        return [EstMembreBoutique(), PeutGererTresorerie()]

    def get_queryset(self):
        queryset = super().get_queryset()
        depot_id = self.request.query_params.get("depot")
        if depot_id:
            queryset = queryset.filter(depot_id=depot_id)
        return queryset


class RetraitView(APIView):
    """Sortie de caisse hors dépense (banque, coffre...), réservée Patron/Gérant."""

    permission_classes = [EstMembreBoutique, PeutGererTresorerie]

    def post(self, request):
        entree = RetraitEntreeSerializer(data=request.data, context={"request": request})
        entree.is_valid(raise_exception=True)
        mouvement = effectuer_retrait(
            entree.validated_data["depot"], entree.validated_data["montant"],
            motif=entree.validated_data.get("motif", ""), utilisateur=request.user,
        )
        return Response(MouvementCaisseSerializer(mouvement).data, status=status.HTTP_201_CREATED)


class ApportView(APIView):
    """Argent personnel injecté en caisse par le Patron/Gérant."""

    permission_classes = [EstMembreBoutique, PeutGererTresorerie]

    def post(self, request):
        entree = ApportEntreeSerializer(data=request.data, context={"request": request})
        entree.is_valid(raise_exception=True)
        mouvement = enregistrer_apport(
            entree.validated_data["depot"], entree.validated_data["montant"],
            motif=entree.validated_data.get("motif", ""), utilisateur=request.user,
        )
        return Response(MouvementCaisseSerializer(mouvement).data, status=status.HTTP_201_CREATED)


class AjustementView(APIView):
    """Correction manuelle d'une erreur de saisie, réservée Patron/Gérant."""

    permission_classes = [EstMembreBoutique, PeutGererTresorerie]

    def post(self, request):
        entree = AjustementEntreeSerializer(data=request.data, context={"request": request})
        entree.is_valid(raise_exception=True)
        mouvement = ajuster_caisse(
            entree.validated_data["depot"], entree.validated_data["montant"],
            entree.validated_data["motif"], utilisateur=request.user,
        )
        return Response(MouvementCaisseSerializer(mouvement).data, status=status.HTTP_201_CREATED)
