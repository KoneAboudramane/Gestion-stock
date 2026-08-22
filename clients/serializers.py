from rest_framework import serializers

from stock.models import Depot

from .models import Client, Credit, PaiementCredit


class ClientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Client
        fields = ["id", "nom", "telephone", "adresse", "est_permanent"]
        read_only_fields = ["id"]


class PaiementCreditSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaiementCredit
        fields = ["id", "montant", "mode", "date_creation"]
        read_only_fields = fields


class CreditSerializer(serializers.ModelSerializer):
    paiements = PaiementCreditSerializer(many=True, read_only=True)

    class Meta:
        model = Credit
        fields = [
            "id", "client", "vente", "montant", "montant_paye", "solde",
            "echeance", "statut", "date_creation", "paiements",
        ]
        read_only_fields = ["id", "client", "vente", "montant", "montant_paye", "solde", "statut", "date_creation"]


class PaiementCreditEntreeSerializer(serializers.Serializer):
    montant = serializers.DecimalField(max_digits=12, decimal_places=2)
    mode = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    depot = serializers.PrimaryKeyRelatedField(queryset=Depot.objects.all(), required=False, allow_null=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            self.fields["depot"].queryset = Depot.objects.filter(boutique=request.user.boutique)
