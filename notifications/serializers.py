from rest_framework import serializers

from .models import Message, Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "type", "depot", "message", "reference_type", "reference_id", "date_creation"]
        read_only_fields = fields


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = [
            "id", "type", "depot", "utilisateur", "canal", "destinataire", "message",
            "reference_type", "reference_id", "statut", "date_envoi", "date_creation",
        ]
        read_only_fields = fields
