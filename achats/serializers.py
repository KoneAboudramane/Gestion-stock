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
        fields = ["id", "variante", "quantite", "prix_achat", "sous_total", "quantite_recue"]
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
            utilisateur=self.context["request"].user if "request" in self.context else None,
        )


class LigneReceptionSerializer(serializers.Serializer):
    """Quantité effectivement reçue (réception partielle possible) et prix de
    vente confirmé/ajusté à la réception, pour une variante de la commande."""

    variante = serializers.PrimaryKeyRelatedField(queryset=Variante.objects.all())
    quantite = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    prix_vente = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0"), required=False
    )


class ReceptionSerializer(serializers.ModelSerializer):
    montant_deja_paye = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, default=0, write_only=True
    )
    lignes = LigneReceptionSerializer(many=True, write_only=True)

    class Meta:
        model = Reception
        fields = [
            "id", "commande", "depot", "utilisateur", "date_creation",
            "valeur_recue", "montant_paye", "montant_deja_paye", "mode_paiement", "operateur_paiement",
            "lignes", "annulee", "date_annulation",
        ]
        read_only_fields = [
            "id", "utilisateur", "date_creation", "valeur_recue", "montant_paye", "annulee", "date_annulation",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated and request.user.boutique_id:
            boutique = request.user.boutique
            self.fields["commande"].queryset = CommandeAchat.objects.filter(boutique=boutique)
            self.fields["depot"].queryset = Depot.objects.filter(boutique=boutique)
            self.fields["lignes"].child.fields["variante"].queryset = Variante.objects.filter(
                produit__boutique=boutique
            )

    def create(self, validated_data):
        request = self.context["request"]
        commande = validated_data["commande"]
        lignes_par_variante = {ligne.variante_id: ligne for ligne in commande.lignes.all()}

        lignes_donnees = []
        for donnee in validated_data["lignes"]:
            ligne = lignes_par_variante.get(donnee["variante"].id)
            if ligne is None:
                raise serializers.ValidationError("Cette variante ne fait pas partie de la commande.")
            lignes_donnees.append(
                {"ligne": ligne, "quantite": donnee["quantite"], "prix_vente": donnee.get("prix_vente")}
            )

        return receptionner_commande(
            commande=commande,
            depot=validated_data["depot"],
            utilisateur=request.user,
            montant_deja_paye=validated_data.get("montant_deja_paye") or 0,
            lignes=lignes_donnees,
            mode_paiement=validated_data.get("mode_paiement") or "",
            operateur_paiement=validated_data.get("operateur_paiement") or "",
        )
