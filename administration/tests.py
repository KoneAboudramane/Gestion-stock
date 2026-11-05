import time
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from comptes.models import Utilisateur

from . import totp
from .models import JournalAdmin, ProfilAdmin
from .services import droits_de

MDP = "UnMotDePasseSolide123"


def code_actuel(secret, decalage=0):
    return totp._code_pour_pas(secret, totp.pas_actuel() + decalage)


class TotpTests(TestCase):
    def test_vecteur_rfc6238(self):
        # RFC 6238, annexe B (SHA-1, secret "12345678901234567890"), tronqué à 6 chiffres.
        import base64

        secret = base64.b32encode(b"12345678901234567890").decode()
        self.assertEqual(totp.verifier_code(secret, "287082", maintenant=59), 1)
        self.assertEqual(totp.verifier_code(secret, "081804", maintenant=1111111109), 37037036)

    def test_code_deja_utilise_refuse(self):
        secret = totp.generer_secret()
        pas = totp.verifier_code(secret, code_actuel(secret))
        self.assertIsNotNone(pas)
        self.assertIsNone(totp.verifier_code(secret, code_actuel(secret), dernier_pas=pas))

    def test_decalage_horloge_tolere_une_periode(self):
        secret = totp.generer_secret()
        self.assertIsNotNone(totp.verifier_code(secret, code_actuel(secret, -1)))
        self.assertIsNone(totp.verifier_code(secret, code_actuel(secret, -3)))


class ConnexionAdminTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = Utilisateur.objects.create_user(username="admin2", password=MDP, is_staff=True)
        self.commercant = Utilisateur.objects.create_user(username="patron", password=MDP)

    def connexion(self, username="admin2", password=MDP):
        return self.client.post(reverse("admin-connexion"), {"username": username, "password": password}, format="json")

    def test_sans_double_verification_jetons_directs(self):
        reponse = self.connexion()
        self.assertEqual(reponse.status_code, 200, reponse.data)
        self.assertEqual(reponse.data["etape"], "terminee")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {reponse.data['access']}")
        moi = self.client.get(reverse("admin-moi"))
        self.assertEqual(moi.status_code, 200, moi.data)
        self.assertFalse(moi.data["superuser"])
        self.assertTrue(JournalAdmin.objects.filter(admin=self.admin, action="connexion").exists())

    def test_compte_non_admin_ou_mauvais_mdp_meme_refus(self):
        r1 = self.connexion("patron")
        r2 = self.connexion(password="faux")
        self.assertEqual(r1.status_code, 401)
        self.assertEqual(r1.data, r2.data)

    def test_jeton_commercant_refuse_meme_pour_un_staff(self):
        jeton = RefreshToken.for_user(self.admin).access_token
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {jeton}")
        self.assertEqual(self.client.get(reverse("admin-moi")).status_code, 403)

    def test_premiere_connexion_avec_double_verification_configure_l_appli(self):
        ProfilAdmin.objects.create(utilisateur=self.admin, double_verification_exigee=True)
        etape = self.connexion()
        self.assertEqual(etape.data["etape"], "configuration")
        self.assertTrue(etape.data["uri"].startswith("otpauth://totp/"))
        self.assertNotIn("access", etape.data)

        faux = self.client.post(
            reverse("admin-connexion-code"), {"jeton_etape": etape.data["jeton_etape"], "code": "000000"}, format="json"
        )
        self.assertEqual(faux.status_code, 401)

        bon = self.client.post(
            reverse("admin-connexion-code"),
            {"jeton_etape": etape.data["jeton_etape"], "code": code_actuel(etape.data["secret"])},
            format="json",
        )
        self.assertEqual(bon.status_code, 200, bon.data)
        self.assertTrue(ProfilAdmin.objects.get(utilisateur=self.admin).totp_actif)

        # Connexion suivante : on demande juste le code, le secret n'est plus montré.
        suivante = self.connexion()
        self.assertEqual(suivante.data["etape"], "code")
        self.assertNotIn("secret", suivante.data)

    def test_trop_de_codes_faux_bloque(self):
        ProfilAdmin.objects.create(utilisateur=self.admin, double_verification_exigee=True)
        etape = self.connexion()
        for _ in range(5):
            self.client.post(
                reverse("admin-connexion-code"), {"jeton_etape": etape.data["jeton_etape"], "code": "000000"}, format="json"
            )
        bloque = self.client.post(
            reverse("admin-connexion-code"),
            {"jeton_etape": etape.data["jeton_etape"], "code": code_actuel(etape.data["secret"])},
            format="json",
        )
        self.assertEqual(bloque.status_code, 401)
        self.assertIn("15 minutes", bloque.data["detail"])

    def test_double_verification_activee_apres_connexion_coupe_la_session(self):
        jetons = self.connexion().data
        ProfilAdmin.objects.create(utilisateur=self.admin, double_verification_exigee=True)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {jetons['access']}")
        self.assertEqual(self.client.get(reverse("admin-moi")).status_code, 401)

    def test_session_bornee_meme_apres_rafraichissement(self):
        jetons = self.connexion().data
        rafraichi = self.client.post(reverse("admin-rafraichir"), {"refresh": jetons["refresh"]}, format="json")
        self.assertEqual(rafraichi.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {rafraichi.data['access']}")
        self.assertEqual(self.client.get(reverse("admin-moi")).status_code, 200)
        with mock.patch("administration.permissions.time.time", return_value=time.time() + 13 * 3600):
            self.assertEqual(self.client.get(reverse("admin-moi")).status_code, 401)

    def test_admin_retire_du_staff_perd_l_acces(self):
        jetons = self.connexion().data
        self.admin.is_staff = False
        self.admin.save()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {jetons['access']}")
        self.assertEqual(self.client.get(reverse("admin-moi")).status_code, 403)


class DroitsTests(APITestCase):
    def setUp(self):
        self.superuser = Utilisateur.objects.create_superuser(username="chef", password=MDP, email="c@x.com")
        self.ancien = Utilisateur.objects.create_user(username="ancien", password=MDP, is_staff=True)
        self.limite = Utilisateur.objects.create_user(username="limite", password=MDP, is_staff=True)
        ProfilAdmin.objects.create(utilisateur=self.limite, droits=["paiements", "inconnu"])

    def test_droits_effectifs(self):
        self.assertIn("admins", droits_de(self.superuser))
        self.assertIn("comptes", droits_de(self.ancien))  # sans profil : tout, comme avant
        self.assertNotIn("admins", droits_de(self.ancien))
        self.assertEqual(droits_de(self.limite), ["paiements"])

    def test_droits_appliques_a_l_espace_admin_du_bureau(self):
        refuse = self.client.post(reverse("lister-comptes"), {"username": "limite", "password": MDP}, format="json")
        self.assertEqual(refuse.status_code, 403)
        autorise = self.client.post(reverse("lister-comptes"), {"username": "ancien", "password": MDP}, format="json")
        self.assertEqual(autorise.status_code, 200)

    def test_admin_django_reserve_au_superuser(self):
        from django.contrib import admin
        from django.test import RequestFactory

        requete = RequestFactory().get("/admin/")
        requete.user = self.ancien
        self.assertFalse(admin.site.has_permission(requete))
        requete.user = self.superuser
        self.assertTrue(admin.site.has_permission(requete))
        # Un admin non superuser est renvoyé vers la page de connexion de l'admin Django.
        self.client.login(username="ancien", password=MDP)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
