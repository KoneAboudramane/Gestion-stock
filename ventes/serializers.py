from decimal import Decimal

from rest_framework import serializers

from catalogue.models import Variante
from clients.models import Client
from stock.models import Depot

from .models import LigneVente, Paiement, Vente
from .services import creer_vente


class LigneVenteEntreeSerializer(serializers.Serializer):
    """Ligne saisie par le client (écran de caisse) pour créer une vente."""

    variante = serializers.PrimaryKeyRelatedField(queryset=Variante.objects.all())
    quantite = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    prix_unitaire = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    remise = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, default=0)


class PaiementEntreeSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=Paiement.Mode.choices)
    operateur = serializers.ChoiceField(choices=Paiement.Operateur.choices, required=False, allow_blank=True, default="")
    montant = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))

    def validate(self, attrs):
        if attrs["mode"] == Paiement.Mode.MOBILE_MONEY and not attrs.get("operateur"):
            raise serializers.ValidationError("Un opérateur est requis pour un paiement Mobile Money.")
        if attrs["mode"] != Paiement.Mode.MOBILE_MONEY and attrs.get("operateur"):
            attrs["operateur"] = ""
        return attrs


class LigneVenteSerializer(serializers.ModelSerializer):
    class Meta:
        model = LigneVente
        fields = ["id", "variante", "quantite", "prix_unitaire", "cout_unitaire", "remise", "sous_total"]
        read_only_fields = fields

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        role = getattr(request.user, "role", None) if request else None
        if not (role and role.permissions.get("voir_benefices_achat", False)):
            data.pop("cout_unitaire", None)
        return data


class PaiementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Paiement
        fields = ["id", "mode", "operateur", "montant"]
        read_only_fields = fields


class VenteSerializer(serializers.ModelSerializer):
    lignes = LigneVenteSerializer(many=True, read_only=True)
    paiements = PaiementSerializer(many=True, read_only=True)
    lignes_saisie = LigneVenteEntreeSerializer(many=True, write_only=True)
    paiements_saisie = PaiementEntreeSerializer(many=True, write_only=True)

    class Meta:
        model = Vente
        fields = [
            "id", "depot", "client", "utilisateur", "numero", "total_brut",
            "remise", "total_net", "statut", "date_creation",
            "lignes", "paiements", "lignes_saisie", "paiements_saisie",
        ]
        read_only_fields = ["id", "utilisateur", "numero", "total_brut", "total_net", "date_creation"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            boutique = request.user.boutique
            self.fields["depot"].queryset = Depot.objects.filter(boutique=boutique)
            self.fields["client"].queryset = Client.objects.filter(boutique=boutique)
            self.fields["lignes_saisie"].child.fields["variante"].queryset = Variante.objects.filter(
                produit__boutique=boutique
            )

    def validate(self, attrs):
        request = self.context.get("request")
        statut = attrs.get("statut", Vente.Statut.PAYEE)
        if statut == Vente.Statut.CREDIT and not attrs.get("client"):
            raise serializers.ValidationError("Un client est requis pour une vente à crédit.")

        role = getattr(request.user, "role", None) if request else None
        peut_modifier_prix = bool(role and role.permissions.get("modifier_prix", False))
        for ligne in attrs.get("lignes_saisie", []):
            prix_unitaire = ligne.get("prix_unitaire")
            if prix_unitaire is not None and prix_unitaire != ligne["variante"].prix_vente and not peut_modifier_prix:
                raise serializers.ValidationError("Votre rôle ne permet pas de modifier les prix.")
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        return creer_vente(
            boutique=request.user.boutique,
            depot=validated_data["depot"],
            utilisateur=request.user,
            client=validated_data.get("client"),
            statut=validated_data.get("statut", Vente.Statut.PAYEE),
            lignes_donnees=validated_data["lignes_saisie"],
            paiements_donnees=validated_data["paiements_saisie"],
            remise_globale=validated_data.get("remise") or 0,
        )
