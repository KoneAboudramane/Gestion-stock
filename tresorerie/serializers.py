from rest_framework import serializers

from comptes.models import Utilisateur
from stock.models import Depot

from .models import ClotureCaisse, Depense, MouvementCaisse, Transfert
from .services import cloturer_caisse, effectuer_transfert, enregistrer_depense


class _RestreintAuDepotDeLaBoutiqueMixin:
    """Restreint le champ `depot` à la boutique de l'utilisateur connecté."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            self.fields["depot"].queryset = Depot.objects.filter(boutique=request.user.boutique)


class MouvementCaisseSerializer(serializers.ModelSerializer):
    class Meta:
        model = MouvementCaisse
        fields = [
            "id", "depot", "type", "categorie", "montant", "motif",
            "reference_type", "reference_id", "utilisateur", "date_creation",
        ]
        read_only_fields = fields


class DepenseSerializer(_RestreintAuDepotDeLaBoutiqueMixin, serializers.ModelSerializer):
    class Meta:
        model = Depense
        fields = ["id", "depot", "categorie", "montant", "description", "utilisateur", "date_creation"]
        read_only_fields = ["id", "utilisateur", "date_creation"]

    def create(self, validated_data):
        request = self.context["request"]
        return enregistrer_depense(
            depot=validated_data["depot"],
            categorie=validated_data["categorie"],
            montant=validated_data["montant"],
            description=validated_data.get("description", ""),
            utilisateur=request.user,
        )


class TransfertSerializer(_RestreintAuDepotDeLaBoutiqueMixin, serializers.ModelSerializer):
    class Meta:
        model = Transfert
        fields = ["id", "depot", "utilisateur_source", "operateur", "montant", "utilisateur", "date_creation"]
        read_only_fields = ["id", "utilisateur", "date_creation"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            self.fields["utilisateur_source"].queryset = Utilisateur.objects.filter(
                boutique=request.user.boutique
            )

    def create(self, validated_data):
        request = self.context["request"]
        return effectuer_transfert(
            depot=validated_data["depot"],
            utilisateur_source=validated_data["utilisateur_source"],
            operateur=validated_data["operateur"],
            montant=validated_data["montant"],
            utilisateur=request.user,
        )


class ClotureCaisseSerializer(_RestreintAuDepotDeLaBoutiqueMixin, serializers.ModelSerializer):
    class Meta:
        model = ClotureCaisse
        fields = ["id", "depot", "solde_theorique", "solde_compte", "ecart", "utilisateur", "date_creation"]
        read_only_fields = ["id", "solde_theorique", "ecart", "utilisateur", "date_creation"]

    def create(self, validated_data):
        request = self.context["request"]
        return cloturer_caisse(
            depot=validated_data["depot"],
            solde_compte=validated_data["solde_compte"],
            utilisateur=request.user,
        )


class RetraitEntreeSerializer(_RestreintAuDepotDeLaBoutiqueMixin, serializers.Serializer):
    depot = serializers.PrimaryKeyRelatedField(queryset=Depot.objects.all())
    montant = serializers.DecimalField(max_digits=12, decimal_places=2)
    motif = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class ApportEntreeSerializer(_RestreintAuDepotDeLaBoutiqueMixin, serializers.Serializer):
    depot = serializers.PrimaryKeyRelatedField(queryset=Depot.objects.all())
    montant = serializers.DecimalField(max_digits=12, decimal_places=2)
    motif = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class AjustementEntreeSerializer(_RestreintAuDepotDeLaBoutiqueMixin, serializers.Serializer):
    depot = serializers.PrimaryKeyRelatedField(queryset=Depot.objects.all())
    # Signé : positif pour corriger vers le haut, négatif vers le bas (voir ajuster_caisse).
    montant = serializers.DecimalField(max_digits=12, decimal_places=2)
    motif = serializers.CharField(max_length=255)
