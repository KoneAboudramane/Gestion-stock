"""Téléchargement de l'appli Android : adresse fixe /telecharger/android/.

C'est cette adresse (et non le fichier) qui est dans le QR code de
Réglages > Informations boutique : un QR imprimé reste valable quand l'APK
change, et pourra plus tard renvoyer vers le Play Store sans le réimprimer.
Publique (pas de connexion) : la personne qui scanne n'a pas encore l'appli.
"""

from django.conf import settings
from django.http import FileResponse, HttpResponse
from django.views.decorators.http import require_GET

PAGE_INDISPONIBLE = """<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gestion Stock — appli Android</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 3em 1em; color: #1e293b">
<h1 style="font-size: 1.4em">📱 Appli Android bientôt disponible</h1>
<p>Le fichier d'installation n'est pas encore en ligne. Réessayez plus tard
ou demandez au responsable de la boutique.</p>
</body></html>"""


@require_GET
def telecharger_android(request):
    fichier = settings.TELECHARGEMENTS_DIR / settings.APK_ANDROID_NOM
    if not fichier.is_file():
        return HttpResponse(PAGE_INDISPONIBLE, status=404)
    reponse = FileResponse(
        fichier.open("rb"),
        as_attachment=True,
        filename=settings.APK_ANDROID_NOM,
        content_type="application/vnd.android.package-archive",
    )
    # Toujours la dernière version : pas de copie gardée par le navigateur ou un proxy.
    reponse["Cache-Control"] = "no-store"
    return reponse
