from rest_framework import serializers

from .models import CompteComptable


class CompteComptableSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompteComptable
        fields = ["id", "numero", "libelle", "classe", "compte_parent", "actif"]
