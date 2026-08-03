from functools import lru_cache

from rest_framework import serializers


class EntreeChangementSerializer(serializers.Serializer):
    table = serializers.CharField()
    action = serializers.ChoiceField(choices=["cree", "modifie", "supprime"])
    enregistrement_id = serializers.UUIDField()
    donnees = serializers.DictField(required=False, default=dict)


@lru_cache(maxsize=None)
def serializer_lecture(model):
    """Serializer générique en lecture seule (fields='__all__') pour le pull."""
    meta = type("Meta", (), {"model": model, "fields": "__all__"})
    return type(f"{model.__name__}SyncLectureSerializer", (serializers.ModelSerializer,), {"Meta": meta})
