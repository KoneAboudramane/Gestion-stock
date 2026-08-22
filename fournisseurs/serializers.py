from rest_framework import serializers

from stock.models import Depot

from .models import DetteFournisseur, Fournisseur, PaiementDetteFournisseur


class FournisseurSerializer(serializers.ModelSerializer):
    class Meta:
        model = Fournisseur
        fields = ["id", "nom", "telephone", "adresse", "contact"]
        read_only_fields = ["id"]


class PaiementDetteFournisseurSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaiementDetteFournisseur
        fields = ["id", "montant", "mode", "date_creation"]
        read_only_fields = fields


class DetteFournisseurSerializer(serializers.ModelSerializer):
    paiements = PaiementDetteFournisseurSerializer(many=True, read_only=True)

    class Meta:
        model = DetteFournisseur
        fields = [
            "id", "fournisseur", "commande", "montant", "montant_paye", "solde",
            "statut", "date_creation", "paiements",
        ]
        read_only_fields = [
            "id", "fournisseur", "commande", "montant", "montant_paye", "solde",
            "statut", "date_creation", "paiements",
        ]


class PaiementDetteSerializer(serializers.Serializer):
    montant = serializers.DecimalField(max_digits=12, decimal_places=2)
    mode = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    depot = serializers.PrimaryKeyRelatedField(queryset=Depot.objects.all(), required=False, allow_null=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            self.fields["depot"].queryset = Depot.objects.filter(boutique=request.user.boutique)
