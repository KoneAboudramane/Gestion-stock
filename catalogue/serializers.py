from rest_framework import serializers

from .models import (
    Attribut,
    Categorie,
    Produit,
    Unite,
    ValeurAttribut,
    Variante,
    VarianteValeur,
)
from .services import creer_produit


class CategorieSerializer(serializers.ModelSerializer):
    class Meta:
        model = Categorie
        fields = ["id", "nom", "categorie_parent"]
        read_only_fields = ["id"]


class UniteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Unite
        fields = ["id", "nom", "abreviation"]
        read_only_fields = ["id"]


class AttributSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attribut
        fields = ["id", "nom"]
        read_only_fields = ["id"]


class ValeurAttributSerializer(serializers.ModelSerializer):
    class Meta:
        model = ValeurAttribut
        fields = ["id", "attribut", "valeur"]
        read_only_fields = ["id"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            self.fields["attribut"].queryset = Attribut.objects.filter(
                boutique=request.user.boutique
            )


class VarianteSerializer(serializers.ModelSerializer):
    valeur_attribut_ids = serializers.PrimaryKeyRelatedField(
        source="valeurs", many=True, write_only=True, required=False,
        queryset=ValeurAttribut.objects.all(),
    )

    class Meta:
        model = Variante
        fields = [
            "id", "produit", "reference", "code_barres", "prix_achat",
            "prix_vente", "seuil_alerte", "photo", "actif", "valeur_attribut_ids",
        ]
        read_only_fields = ["id"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            self.fields["produit"].queryset = Produit.objects.filter(
                boutique=request.user.boutique
            )
            self.fields["valeur_attribut_ids"].queryset = ValeurAttribut.objects.filter(
                attribut__boutique=request.user.boutique
            )

    def validate(self, attrs):
        request = self.context.get("request")
        if request and ("prix_achat" in attrs or "prix_vente" in attrs):
            role = getattr(request.user, "role", None)
            if not (role and role.permissions.get("modifier_prix", False)):
                raise serializers.ValidationError(
                    "Votre rôle ne permet pas de modifier les prix."
                )
        return attrs

    def create(self, validated_data):
        valeurs_attribut = validated_data.pop("valeurs", None)
        variante = super().create(validated_data)
        if valeurs_attribut:
            self._remplacer_valeurs(variante, valeurs_attribut)
        return variante

    def update(self, instance, validated_data):
        valeurs_attribut = validated_data.pop("valeurs", None)
        variante = super().update(instance, validated_data)
        if valeurs_attribut is not None:
            self._remplacer_valeurs(variante, valeurs_attribut)
        return variante

    @staticmethod
    def _remplacer_valeurs(variante, valeurs_attribut):
        variante.valeurs.all().delete()
        VarianteValeur.objects.bulk_create(
            VarianteValeur(variante=variante, valeur_attribut=v) for v in valeurs_attribut
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        role = getattr(request.user, "role", None) if request else None
        if not (role and role.permissions.get("voir_benefices_achat", False)):
            data.pop("prix_achat", None)
        data["valeur_attribut_ids"] = [
            v.valeur_attribut_id for v in instance.valeurs.all()
        ]
        return data


class ProduitSerializer(serializers.ModelSerializer):
    variantes = VarianteSerializer(many=True, read_only=True)

    # Champs write-only pour peupler la variante par défaut à la création
    # (CLAUDE.md règle 5 : un produit simple a une seule variante par défaut).
    reference = serializers.CharField(max_length=100, required=False, allow_blank=True, write_only=True)
    code_barres = serializers.CharField(max_length=100, required=False, allow_blank=True, write_only=True)
    prix_achat = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, write_only=True)
    prix_vente = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, write_only=True)
    seuil_alerte = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, write_only=True)

    class Meta:
        model = Produit
        fields = [
            "id", "nom", "categorie", "unite", "description", "photo", "actif",
            "variantes", "reference", "code_barres", "prix_achat", "prix_vente",
            "seuil_alerte",
        ]
        read_only_fields = ["id"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            boutique = request.user.boutique
            self.fields["categorie"].queryset = Categorie.objects.filter(boutique=boutique)
            self.fields["unite"].queryset = Unite.objects.filter(boutique=boutique)

    def validate(self, attrs):
        request = self.context.get("request")
        if request and ("prix_achat" in attrs or "prix_vente" in attrs):
            role = getattr(request.user, "role", None)
            if not (role and role.permissions.get("modifier_prix", False)):
                raise serializers.ValidationError(
                    "Votre rôle ne permet pas de modifier les prix."
                )
        return attrs

    def create(self, validated_data):
        donnees_variante_defaut = {
            "reference": validated_data.pop("reference", ""),
            "code_barres": validated_data.pop("code_barres", ""),
            "prix_achat": validated_data.pop("prix_achat", 0),
            "prix_vente": validated_data.pop("prix_vente", 0),
            "seuil_alerte": validated_data.pop("seuil_alerte", 0),
        }
        boutique = self.context["request"].user.boutique
        return creer_produit(boutique, validated_data, donnees_variante_defaut)
