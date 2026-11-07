"""Laissez-passer admin (docs/plan_laissez_passer_admin.md, lot A)."""
import base64
import os
from datetime import date, timedelta

from django.urls import reverse

from comptes.activation import cle_publique

from .laissez_passer import ErreurLaissezPasser, empreinte_mot_de_passe, fabriquer_code, lire_code
from .models import JournalAdmin, LaissezPasser, ProfilAdmin
from .tests_boutiques import MDP, BaseAdmin

# Clé de test officielle de la RFC 8032 (comme les tests des codes d'activation).
SECRET = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")


class CodeTests(BaseAdmin):
    def test_code_signe_relu_avec_empreinte_du_mot_de_passe(self):
        code, numero = fabriquer_code("awa", "Secret-123", date(2027, 1, 31), secret=SECRET)
        self.assertTrue(code.startswith("LP-"))
        lu = lire_code(code, cle_publique(SECRET))
        self.assertEqual(lu["numero"], numero)
        self.assertEqual(lu["identifiant"], "awa")
        self.assertEqual(lu["date_fin"], date(2027, 1, 31))
        self.assertEqual(lu["empreinte"], empreinte_mot_de_passe("Secret-123", lu["sel"]))
        self.assertNotEqual(lu["empreinte"], empreinte_mot_de_passe("Secret-124", lu["sel"]))

    def test_illimite_et_code_modifie_refuse(self):
        code, _ = fabriquer_code("awa", "Secret-123", None, secret=SECRET)
        self.assertIsNone(lire_code(code, cle_publique(SECRET))["date_fin"])
        # Un caractère au milieu (le dernier peut ne porter que des bits de remplissage du base32).
        milieu = len(code) // 2 if code[len(code) // 2] != "-" else len(code) // 2 + 1
        abime = code[:milieu] + ("A" if code[milieu] != "A" else "B") + code[milieu + 1 :]
        with self.assertRaises(ErreurLaissezPasser):
            lire_code(abime, cle_publique(SECRET))
        autre = bytes(32)
        with self.assertRaises(ErreurLaissezPasser):
            lire_code(code, cle_publique(autre))


class ApiTests(BaseAdmin):
    def setUp(self):
        super().setUp()
        self._ancienne = os.environ.get("ACTIVATION_CLE_PRIVEE")
        os.environ["ACTIVATION_CLE_PRIVEE"] = base64.b64encode(SECRET).decode()

    def tearDown(self):
        if self._ancienne is None:
            os.environ.pop("ACTIVATION_CLE_PRIVEE", None)
        else:
            os.environ["ACTIVATION_CLE_PRIVEE"] = self._ancienne
        super().tearDown()

    def generer(self, duree=15, mot_de_passe=MDP):
        return self.client.post(reverse("admin-laissez-passer"), {"duree_jours": duree, "mot_de_passe": mot_de_passe}, format="json")

    def test_generer_exige_le_mot_de_passe_et_une_duree_proposee(self):
        self.connecter()
        self.assertEqual(self.generer(mot_de_passe="faux").status_code, 400)
        self.assertEqual(self.generer(duree=12).status_code, 400)
        r = self.generer(duree=None)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data["illimite"])
        self.assertEqual(r.data["etat"], "actif")
        lu = lire_code(r.data["code"], cle_publique(SECRET))
        self.assertEqual(lu["identifiant"], "admin")
        self.assertTrue(JournalAdmin.objects.filter(action="laissez_passer_genere").exists())
        r = self.generer(duree=7)
        self.assertEqual(lire_code(r.data["code"], cle_publique(SECRET))["date_fin"], date.today() + timedelta(days=7))

    def test_droit_requis(self):
        ProfilAdmin.objects.create(utilisateur=self.admin, droits=["paiements"])
        self.connecter()
        self.assertEqual(self.generer().status_code, 403)
        ProfilAdmin.objects.filter(utilisateur=self.admin).update(droits=["paiements", "laissez_passer"])
        self.assertEqual(self.generer().status_code, 201)

    def test_appareil_revenu_sur_internet_revocation_et_mot_de_passe_change(self):
        self.connecter()
        r = self.generer()
        numero = r.data["numero"]
        url = reverse("admin-laissez-passer-utilisation")
        self.client.credentials()  # l'appareil n'a pas de session
        rep = self.client.post(
            url, {"numero": numero, "identifiant": "admin", "utilisations": [{"date": "2026-11-07", "appareil": "Tab A11"}]}, format="json"
        )
        self.assertEqual(rep.data, {"valide": True, "etat": "actif", "etat_libelle": "Actif"})
        self.assertEqual(LaissezPasser.objects.get(numero=numero).utilisations, 1)
        self.assertTrue(JournalAdmin.objects.filter(action="laissez_passer_utilise").exists())
        # Mauvais identifiant : rien n'est révélé.
        self.assertEqual(self.client.post(url, {"numero": numero, "identifiant": "autre"}, format="json").data["valide"], False)
        # Mot de passe changé : le laissez-passer ne vaut plus.
        self.admin.set_password("NouveauMotDePasse-456")
        self.admin.save()
        self.assertEqual(self.client.post(url, {"numero": numero, "identifiant": "admin"}, format="json").data["etat"], "mot_de_passe_change")

    def test_revoquer(self):
        self.connecter()
        lp_id = self.generer().data["id"]
        r = self.client.post(reverse("admin-laissez-passer-revoquer", args=[lp_id]))
        self.assertEqual(r.data["etat"], "revoque")
        liste = self.client.get(reverse("admin-laissez-passer")).data["laissez_passer"]
        self.assertEqual(liste[0]["etat_libelle"], "Révoqué")


class AppliTests(ApiTests):
    """Espace Admin de l'appli, avec internet : identifiants dans la requête (sans session du site)."""

    def test_generer_depuis_l_appli(self):
        url = reverse("admin-laissez-passer-appli")
        self.assertEqual(self.client.post(url, {"username": "admin", "password": "faux", "duree_jours": 7}, format="json").status_code, 403)
        self.assertEqual(self.client.post(url, {"username": "kone", "password": MDP, "duree_jours": 7}, format="json").status_code, 403)
        r = self.client.post(url, {"username": "admin", "password": MDP, "duree_jours": "illimite"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data["illimite"])
        self.assertEqual(lire_code(r.data["code"], cle_publique(SECRET))["identifiant"], "admin")
        self.assertTrue(JournalAdmin.objects.filter(action="laissez_passer_genere", origine="bureau").exists())
        ProfilAdmin.objects.create(utilisateur=self.admin, droits=["paiements"])
        r = self.client.post(url, {"username": "admin", "password": MDP, "duree_jours": 7}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertIn("droit", r.data["detail"])
