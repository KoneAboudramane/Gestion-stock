from rest_framework import serializers

from catalogue.models import Variante

from .models import Depot, Inventaire, LigneInventaire, MouvementStock, Stock, TransfertStock
from .services import appliquer_mouvement, demarrer_inventaire, transferer_stock


class DepotSerializer(serializers.ModelSerializer):
    class Meta:
        model = Depot
        fields = ["id", "nom", "adresse"]
        read_only_fields = ["id"]


class _RestreintABoutiqueMixin:
    """Restreint les FK déclarées dans `champs_boutique` (dict champ -> chemin) à la boutique courante."""

    champs_boutique = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            boutique = request.user.boutique
            for champ, chemin in self.champs_boutique.items():
                self.fields[champ].queryset = self.fields[champ].queryset.model.objects.filter(
                    **{chemin: boutique}
                )


class StockSerializer(serializers.ModelSerializer):
    en_rupture = serializers.SerializerMethodField()
    # Champs d'affichage en lecture seule : évite au client-web une 2e requête
    # de jointure juste pour afficher un nom de produit/dépôt.
    produit_nom = serializers.CharField(source="variante.produit.nom", read_only=True)
    variante_reference = serializers.CharField(source="variante.reference", read_only=True)
    depot_nom = serializers.CharField(source="depot.nom", read_only=True)
    seuil_alerte = serializers.DecimalField(
        source="variante.seuil_alerte", max_digits=12, decimal_places=2, read_only=True
    )

    class Meta:
        model = Stock
        fields = [
            "id", "variante", "depot", "quantite", "en_rupture",
            "produit_nom", "variante_reference", "depot_nom", "seuil_alerte",
        ]
        read_only_fields = fields

    def get_en_rupture(self, instance):
        return instance.quantite <= instance.variante.seuil_alerte


class MouvementStockSerializer(_RestreintABoutiqueMixin, serializers.ModelSerializer):
    champs_boutique = {"variante": "produit__boutique", "depot": "boutique"}

    class Meta:
        model = MouvementStock
        fields = [
            "id", "variante", "depot", "type", "quantite", "motif",
            "reference_type", "reference_id", "utilisateur", "date_creation",
        ]
        read_only_fields = ["id", "reference_type", "reference_id", "utilisateur", "date_creation"]

    def validate(self, attrs):
        type_mouvement = attrs.get("type")
        quantite = attrs.get("quantite")
        if type_mouvement in (MouvementStock.Type.ENTREE, MouvementStock.Type.SORTIE) and quantite <= 0:
            raise serializers.ValidationError(
                "La quantité doit être strictement positive pour une entrée ou une sortie."
            )
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        return appliquer_mouvement(
            variante=validated_data["variante"],
            depot=validated_data["depot"],
            type_mouvement=validated_data["type"],
            quantite=validated_data["quantite"],
            motif=validated_data.get("motif", ""),
            utilisateur=request.user,
        )


class TransfertStockSerializer(_RestreintABoutiqueMixin, serializers.ModelSerializer):
    champs_boutique = {
        "variante": "produit__boutique",
        "depot_source": "boutique",
        "depot_destination": "boutique",
    }

    class Meta:
        model = TransfertStock
        fields = [
            "id", "variante", "depot_source", "depot_destination", "quantite",
            "utilisateur", "date_creation",
        ]
        read_only_fields = ["id", "utilisateur", "date_creation"]

    def validate(self, attrs):
        if attrs.get("depot_source") == attrs.get("depot_destination"):
            raise serializers.ValidationError("Le dépôt source et destination doivent être différents.")
        if attrs.get("quantite", 0) <= 0:
            raise serializers.ValidationError("La quantité doit être strictement positive.")
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        return transferer_stock(
            variante=validated_data["variante"],
            depot_source=validated_data["depot_source"],
            depot_destination=validated_data["depot_destination"],
            quantite=validated_data["quantite"],
            utilisateur=request.user,
        )


class LigneInventaireSerializer(serializers.ModelSerializer):
    class Meta:
        model = LigneInventaire
        fields = ["id", "inventaire", "variante", "qte_theorique", "qte_physique", "ecart"]
        read_only_fields = ["id", "inventaire", "variante", "qte_theorique", "ecart"]

    def update(self, instance, validated_data):
        if instance.inventaire.statut == Inventaire.Statut.VALIDE:
            raise serializers.ValidationError("Cet inventaire est déjà validé, il ne peut plus être modifié.")
        instance.qte_physique = validated_data.get("qte_physique", instance.qte_physique)
        instance.ecart = instance.qte_physique - instance.qte_theorique
        instance.save(update_fields=["qte_physique", "ecart", "date_modification"])
        return instance


class InventaireSerializer(_RestreintABoutiqueMixin, serializers.ModelSerializer):
    champs_boutique = {"depot": "boutique"}
    lignes = LigneInventaireSerializer(many=True, read_only=True)

    class Meta:
        model = Inventaire
        fields = ["id", "depot", "statut", "utilisateur", "date_creation", "lignes"]
        read_only_fields = ["id", "statut", "utilisateur", "date_creation", "lignes"]

    def create(self, validated_data):
        request = self.context["request"]
        return demarrer_inventaire(
            boutique=request.user.boutique,
            depot=validated_data["depot"],
            utilisateur=request.user,
        )
