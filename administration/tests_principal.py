from django.urls import reverse

from comptes.models import ReglagesPlateforme, Utilisateur

from .models import JournalAdmin, ProfilAdmin
from .services import emettre_jetons
from .tests_boutiques import MDP, BaseAdmin


class PrincipalTests(BaseAdmin):
    def setUp(self):
        super().setUp()
        self.chef = Utilisateur.objects.create_superuser(username="chef", password=MDP, email="chef@x.com")

    def test_reserve_au_superuser(self):
        self.connecter()  # admin ordinaire (sans profil : tous les droits non réservés)
        for nom in ("admin-administrateurs", "admin-reglages", "admin-journal"):
            self.assertEqual(self.client.get(reverse(nom)).status_code, 403, nom)

    def test_creer_un_admin_avec_droits_et_double_verification(self):
        self.connecter(self.chef)
        r = self.client.post(
            reverse("admin-administrateurs"),
            {"username": "awa", "password": "Provisoire-123", "droits": ["paiements", "admins", "inconnu"],
             "double_verification_exigee": True},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["droits"], ["paiements"])  # les droits réservés ou inconnus sont ignorés
        awa = Utilisateur.objects.get(username="awa")
        self.assertTrue(awa.is_staff)
        self.assertTrue(awa.doit_changer_mot_de_passe)
        self.assertTrue(ProfilAdmin.objects.get(utilisateur=awa).double_verification_exigee)
        self.assertTrue(JournalAdmin.objects.filter(action="admin_cree", detail="awa").exists())

    def test_modifier_droits_desactiver_et_reinitialiser_2fa(self):
        self.connecter(self.chef)
        url = reverse("admin-administrateur", args=[self.admin.pk])
        r = self.client.patch(url, {"droits": ["comptes"]}, format="json")
        self.assertEqual(r.data["droits"], ["comptes"])
        self.assertFalse(r.data["droits_herites"])
        ProfilAdmin.objects.filter(utilisateur=self.admin).update(totp_actif=True, totp_secret="ABC")
        r = self.client.patch(url, {"reinitialiser_double_verification": True}, format="json")
        self.assertFalse(r.data["double_verification_active"])
        r = self.client.patch(url, {"actif": False}, format="json")
        self.assertFalse(r.data["actif"])
        self.admin.refresh_from_db()
        self.assertFalse(self.admin.is_active)

    def test_garde_fous(self):
        self.connecter(self.chef)
        soi = reverse("admin-administrateur", args=[self.chef.pk])
        self.assertEqual(self.client.patch(soi, {"actif": False}, format="json").status_code, 400)
        # Il peut activer la double vérification pour lui-même.
        r = self.client.patch(soi, {"double_verification_exigee": True}, format="json")
        self.assertEqual(r.status_code, 200)
        autre_chef = Utilisateur.objects.create_superuser(username="chef2", password=MDP, email="c2@x.com")
        jetons = emettre_jetons(self.chef, verifie_2fa=True)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {jetons['access']}")
        r = self.client.patch(reverse("admin-administrateur", args=[autre_chef.pk]), {"actif": False}, format="json")
        self.assertEqual(r.status_code, 403)
        # Un compte de boutique n'est pas un administrateur.
        r = self.client.patch(reverse("admin-administrateur", args=[self.patron.pk]), {"actif": False}, format="json")
        self.assertEqual(r.status_code, 404)

    def test_mot_de_passe_provisoire_puis_change(self):
        self.connecter(self.chef)
        self.client.patch(
            reverse("admin-administrateur", args=[self.admin.pk]), {"nouveau_mot_de_passe": "Provisoire-456"}, format="json"
        )
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.doit_changer_mot_de_passe)
        self.connecter(self.admin)
        self.assertTrue(self.client.get(reverse("admin-moi")).data["doit_changer_mot_de_passe"])
        url = reverse("admin-mon-mot-de-passe")
        faux = self.client.post(url, {"ancien_mot_de_passe": "x", "nouveau_mot_de_passe": "Nouveau-789-solide"}, format="json")
        self.assertEqual(faux.status_code, 400)
        r = self.client.post(
            url, {"ancien_mot_de_passe": "Provisoire-456", "nouveau_mot_de_passe": "Nouveau-789-solide"}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.admin.refresh_from_db()
        self.assertFalse(self.admin.doit_changer_mot_de_passe)

    def test_reglages_et_journal(self):
        self.connecter(self.chef)
        r = self.client.patch(
            reverse("admin-reglages"), {"prix_mensuel_essentiel": "5000", "remise_12_mois": "20", "whatsapp": "+225 07 00 00 00 00"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["whatsapp"], "2250700000000")
        douze = next(t for t in r.data["grille_tarifs"] if t["formule"] == "essentiel" and t["duree_mois"] == 12)
        self.assertEqual(int(douze["prix"]), 48000)
        self.assertEqual(ReglagesPlateforme.obtenir().prix_mensuel_essentiel, 5000)
        self.assertEqual(self.client.patch(reverse("admin-reglages"), {"remise_3_mois": "150"}, format="json").status_code, 400)

        journal = self.client.get(reverse("admin-journal"), {"action": "reglages_modifies"}).data
        self.assertEqual(len(journal["lignes"]), 1)
        self.assertIn("prix_mensuel_essentiel", journal["lignes"][0]["donnees"])
        self.assertIn("chef", journal["admins"])
