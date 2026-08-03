from rest_framework import serializers

from ventes.models import Paiement

from .models import TransactionMobileMoney


class TransactionMobileMoneySerializer(serializers.ModelSerializer):
    class Meta:
        model = TransactionMobileMoney
        fields = [
            "id", "paiement", "fournisseur", "numero_telephone",
            "reference_externe", "statut", "montant", "donnees_brutes", "date_creation",
        ]
        read_only_fields = ["id", "reference_externe", "statut", "montant", "donnees_brutes", "date_creation"]


class InitierTransactionSerializer(serializers.Serializer):
    """Entrée de l'action "initier" : ne crée jamais le Paiement, il existe déjà."""

    paiement = serializers.PrimaryKeyRelatedField(queryset=Paiement.objects.all())
    fournisseur = serializers.ChoiceField(choices=TransactionMobileMoney.Fournisseur.choices)
    numero_telephone = serializers.CharField(max_length=30)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            self.fields["paiement"].queryset = Paiement.objects.filter(
                vente__boutique=request.user.boutique
            )
