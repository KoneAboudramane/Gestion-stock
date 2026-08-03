from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.permissions import EstMembreBoutique, FiltreBoutiqueMixin

from .models import Message, Notification
from .serializers import MessageSerializer, NotificationSerializer
from .services import envoyer_message, generer_alertes_rupture, generer_rappels_credit


class NotificationViewSet(
    FiltreBoutiqueMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """Pas de create() standard : une notification naît d'une détection de rupture."""

    serializer_class = NotificationSerializer
    queryset = Notification.objects.all()
    permission_classes = [EstMembreBoutique]

    @action(detail=False, methods=["post"], url_path="generer-alertes-rupture")
    def generer_alertes_rupture_action(self, request):
        notifications = generer_alertes_rupture(request.user.boutique)
        return Response(
            NotificationSerializer(notifications, many=True).data, status=status.HTTP_201_CREATED
        )


class MessageViewSet(
    FiltreBoutiqueMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """Pas de create() standard : un message naît d'une génération ou d'un ticket de vente."""

    serializer_class = MessageSerializer
    queryset = Message.objects.all()
    permission_classes = [EstMembreBoutique]

    @action(detail=False, methods=["post"], url_path="generer-rappels-credit")
    def generer_rappels_credit_action(self, request):
        messages = generer_rappels_credit(request.user.boutique)
        return Response(MessageSerializer(messages, many=True).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def envoyer(self, request, pk=None):
        message = self.get_object()
        envoyer_message(message)
        return Response(MessageSerializer(message).data)
