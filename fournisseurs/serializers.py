from rest_framework import serializers

from .models import DetteFournisseur, Fournisseur


class FournisseurSerializer(serializers.ModelSerializer):
    class Meta:
        model = Fournisseur
        fields = ["id", "nom", "telephone", "adresse", "contact"]
        read_only_fields = ["id"]


class DetteFournisseurSerializer(serializers.ModelSerializer):
    class Meta:
        model = DetteFournisseur
        fields = ["id", "fournisseur", "commande", "montant", "montant_paye", "solde", "statut", "date_creation"]
        read_only_fields = fields


class PaiementDetteSerializer(serializers.Serializer):
    montant = serializers.DecimalField(max_digits=12, decimal_places=2)
