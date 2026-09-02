from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import EstMembreBoutique, SynchroAutorisee

from .serializers import EntreeChangementSerializer
from .services import traiter_pull, traiter_push


class PushView(APIView):
    permission_classes = [EstMembreBoutique, SynchroAutorisee]

    def post(self, request):
        appareil = request.data.get("appareil", "")
        changements = []
        for item in request.data.get("changements", []):
            serializer = EntreeChangementSerializer(data=item)
            serializer.is_valid(raise_exception=True)
            changements.append(serializer.validated_data)

        resultats = traiter_push(request.user.boutique, appareil, changements)
        return Response({"resultats": resultats})


class PullView(APIView):
    permission_classes = [EstMembreBoutique, SynchroAutorisee]

    def get(self, request):
        depuis_brut = request.query_params.get("depuis")
        depuis = parse_datetime(depuis_brut) if depuis_brut else None
        if depuis and timezone.is_naive(depuis):
            depuis = timezone.make_aware(depuis)

        resultat = traiter_pull(request.user.boutique, depuis)
        return Response(resultat)
