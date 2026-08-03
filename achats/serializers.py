from decimal import Decimal

from rest_framework import serializers

from catalogue.models import Variante
from fournisseurs.models import Fournisseur
from stock.models import Depot

from .models import CommandeAchat, LigneAchat, Reception
from .services import creer_commande, modifier_commande, receptionner_commande


class LigneAchatEntreeSerializer(serializers.Serializer):
    """Ligne saisie par le client pour créer/modifier une commande d'achat."""

    variante = serializers.PrimaryKeyRelatedField(queryset=Variante.objects.all())
    quantite = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    prix_achat = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))


class LigneAchatSerializer(serializers.ModelSerializer):
    class Meta:
        model = LigneAchat
        fields = ["id", "variante", "quantite", "prix_achat", "sous_total"]
        read_only_fields = fields


class CommandeAchatSerializer(serializers.ModelSerializer):
    lignes = LigneAchatSerializer(many=True, read_only=True)
    lignes_saisie = LigneAchatEntreeSerializer(many=True, write_only=True)

    class Meta:
        model = CommandeAchat
        fields = [
            "id", "fournisseur", "utilisateur", "numero", "statut", "total",
            "date_creation", "lignes", "lignes_saisie",
        ]
        read_only_fields = ["id", "utilisateur", "numero", "total", "date_creation"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            boutique = request.user.boutique
            self.fields["fournisseur"].queryset = Fournisseur.objects.filter(boutique=boutique)
            self.fields["lignes_saisie"].child.fields["variante"].queryset = Variante.objects.filter(
                produit__boutique=boutique
            )

    def create(self, validated_data):
        request = self.context["request"]
        return creer_commande(
            boutique=request.user.boutique,
            fournisseur=validated_data["fournisseur"],
            utilisateur=request.user,
            statut=validated_data.get("statut", CommandeAchat.Statut.BROUILLON),
            lignes_donnees=validated_data["lignes_saisie"],
        )

    def update(self, instance, validated_data):
        return modifier_commande(
            instance,
            fournisseur=validated_data.get("fournisseur", instance.fournisseur),
            statut=validated_data.get("statut", instance.statut),
            lignes_donnees=validated_data.get("lignes_saisie"),
        )


class LignePrixVenteSerializer(serializers.Serializer):
    """Prix de vente confirmé/ajusté à la réception pour une variante de la commande."""

    variante = serializers.PrimaryKeyRelatedField(queryset=Variante.objects.all())
    prix_vente = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))


class ReceptionSerializer(serializers.ModelSerializer):
    montant_deja_paye = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, default=0, write_only=True
    )
    lignes_prix = LignePrixVenteSerializer(many=True, required=False, write_only=True)

    class Meta:
        model = Reception
        fields = ["id", "commande", "depot", "utilisateur", "date_creation", "montant_deja_paye", "lignes_prix"]
        read_only_fields = ["id", "utilisateur", "date_creation"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            boutique = request.user.boutique
            self.fields["commande"].queryset = CommandeAchat.objects.filter(boutique=boutique)
            self.fields["depot"].queryset = Depot.objects.filter(boutique=boutique)
            self.fields["lignes_prix"].child.fields["variante"].queryset = Variante.objects.filter(
                produit__boutique=boutique
            )

    def create(self, validated_data):
        request = self.context["request"]
        return receptionner_commande(
            commande=validated_data["commande"],
            depot=validated_data["depot"],
            utilisateur=request.user,
            montant_deja_paye=validated_data.get("montant_deja_paye") or 0,
            lignes_prix=validated_data.get("lignes_prix"),
        )
