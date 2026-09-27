from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from catalogue.models import Variante

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin, a_la_permission

from .models import CommandeAchat, Reception
from .serializers import CommandeAchatSerializer, ReceptionSerializer
from .services import annuler_reception, retourner_au_fournisseur

PeutGererAchats = a_la_permission("gerer_produits_stock_achats")


class CommandeAchatViewSet(FiltreBoutiqueMixin, viewsets.ModelViewSet):
    """Back-office uniquement : le Caissier n'a pas accès aux achats."""

    serializer_class = CommandeAchatSerializer
    queryset = CommandeAchat.objects.all().prefetch_related("lignes")
    http_method_names = ["get", "post", "patch", "put", "head", "options"]
    permission_classes = [EstMembreBoutique, PeutGererAchats]

    def perform_create(self, serializer):
        # CommandeAchatSerializer.create() lit la boutique via le contexte.
        serializer.save()


class ReceptionViewSet(
    FiltreBoutiqueMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.CreateModelMixin, viewsets.GenericViewSet,
):
    """Une réception est immuable (déclenche le stock) : create seulement."""

    serializer_class = ReceptionSerializer
    queryset = Reception.objects.select_related("commande", "depot")
    chemin_boutique = "commande__boutique"
    permission_classes = [EstMembreBoutique, PeutGererAchats]

    @action(detail=True, methods=["post"])
    def annuler(self, request, pk=None):
        reception = annuler_reception(self.get_object(), utilisateur=request.user)
        return Response(ReceptionSerializer(reception, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def retourner(self, request, pk=None):
        """Retour fournisseur : {"lignes": [{"variante": id, "quantite": "2"}], "motif": "..."}."""
        reception = self.get_object()
        lignes = []
        for donnee in request.data.get("lignes") or []:
            variante = Variante.objects.filter(
                id=donnee.get("variante"), produit__boutique=request.user.boutique
            ).first()
            if variante is None:
                raise ValidationError("Article introuvable.")
            quantite = serializers.DecimalField(max_digits=12, decimal_places=2).to_internal_value(
                donnee.get("quantite")
            )
            lignes.append({"variante": variante, "quantite": quantite})
        retour = retourner_au_fournisseur(
            reception, lignes, motif=request.data.get("motif", ""), utilisateur=request.user
        )
        return Response({"id": str(retour.id), "montant": retour.montant, "avoir": retour.avoir})
