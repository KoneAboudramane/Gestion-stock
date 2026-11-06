import tempfile
from pathlib import Path

from django.test import TestCase, override_settings


class TelechargementAndroidTests(TestCase):
    def test_page_indisponible_sans_fichier(self):
        with tempfile.TemporaryDirectory() as dossier, override_settings(TELECHARGEMENTS_DIR=Path(dossier)):
            reponse = self.client.get("/telecharger/android/")
        self.assertEqual(reponse.status_code, 404)
        self.assertIn("bientôt disponible", reponse.content.decode())

    def test_sert_l_apk_sans_connexion(self):
        with tempfile.TemporaryDirectory() as dossier, override_settings(TELECHARGEMENTS_DIR=Path(dossier)):
            (Path(dossier) / "gestion-stock.apk").write_bytes(b"APK")
            reponse = self.client.get("/telecharger/android/")
            contenu = b"".join(reponse.streaming_content)
            reponse.close()
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(contenu, b"APK")
        self.assertEqual(reponse["Content-Type"], "application/vnd.android.package-archive")
        self.assertIn("attachment", reponse["Content-Disposition"])
