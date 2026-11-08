"""Options payantes de la formule Essentiel (En ligne, Réseau, Mobile), comprises dans Pro."""

from datetime import timedelta
from decimal import Decimal

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from administration.models import JournalAdmin, ProfilAdmin
from administration.services import emettre_jetons

from .models import PaiementAbonnement, ReglagesPlateforme, Utilisateur
from .services import enregistrer_option, etat_options, grille_tarifs_options, inscrire_boutique

MDP = "UnMotDePasseSolide123"


class BaseOptions(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique Options"}, {"username": "patronOpt", "password": MDP, "email": "p@x.com"}
        )
        self.boutique.formule = "essentiel"
        self.boutique.date_expiration_abonnement = timezone.now() + timedelta(days=30)
        self.boutique.save()
        self.admin = Utilisateur.objects.create_user(username="adminOpt", password=MDP, is_staff=True, is_superuser=True)


class DroitOptionsTests(BaseOptions):
    def test_essentiel_sans_option_n_a_droit_a_rien(self):
        self.assertEqual(self.boutique.droits_options(), {"en_ligne": False, "reseau": False, "mobile": False})

    def test_pro_et_essai_pro_ont_toutes_les_options(self):
        self.boutique.essai_fin = timezone.now() + timedelta(days=7)
        self.boutique.essai_formule = "pro"
        self.assertTrue(all(self.boutique.droits_options().values()))
        self.boutique.essai_fin = None
        self.boutique.formule = "pro"
        self.assertTrue(all(self.boutique.droits_options().values()))
        self.assertEqual(etat_options(self.boutique)["reseau"]["source"], "pro")

    def test_exception_de_l_admin(self):
        self.boutique.reseau_autorise = True
        self.assertTrue(self.boutique.droit_option("reseau"))
        self.assertEqual(etat_options(self.boutique)["reseau"]["source"], "exception")

    def test_option_payee_jusqu_a_une_date_puis_fin(self):
        fin = timezone.now() + timedelta(days=10)
        enregistrer_option(self.boutique, "mobile", "paiement", fin=fin, montant=Decimal("2500"), mode="wave")
        self.assertTrue(self.boutique.droit_option("mobile"))
        self.assertFalse(self.boutique.droit_option("mobile", fin + timedelta(minutes=1)))
        ligne = PaiementAbonnement.objects.get(boutique=self.boutique, option="mobile")
        self.assertEqual(ligne.montant, Decimal("2500"))

    def test_option_liee_a_l_abonnement(self):
        enregistrer_option(self.boutique, "reseau", "offert", suit=True)
        self.assertTrue(self.boutique.droit_option("reseau"))
        self.assertEqual(etat_options(self.boutique)["reseau"]["source"], "suit")
        apres = self.boutique.date_expiration_abonnement + timedelta(minutes=1)
        self.assertFalse(self.boutique.droit_option("reseau", apres))

    def test_envoi_en_ligne_demande_l_interrupteur_et_le_droit(self):
        self.boutique.synchro_autorisee = True
        self.assertFalse(self.boutique.en_ligne_actif())
        self.boutique.option_en_ligne_offerte = True
        self.assertTrue(self.boutique.en_ligne_actif())
        self.boutique.synchro_autorisee = False
        self.assertFalse(self.boutique.en_ligne_actif())

    def test_synchro_refusee_sans_droit_a_l_option(self):
        self.boutique.synchro_autorisee = True
        self.boutique.save()
        self.client.force_authenticate(user=self.patron)
        self.assertEqual(self.client.get(reverse("sync-pull")).status_code, 403)
        enregistrer_option(self.boutique, "en_ligne", "offert", fin=timezone.now() + timedelta(days=30))
        self.assertEqual(self.client.get(reverse("sync-pull")).status_code, 200)

    def test_grille_des_options(self):
        reglages = ReglagesPlateforme.obtenir()
        reglages.prix_mensuel_option_reseau = Decimal("5000")
        reglages.remise_12_mois = Decimal("15")
        reglages.save()
        tarifs = grille_tarifs_options()
        douze = next(t for t in tarifs if t["option"] == "reseau" and t["duree_mois"] == 12)
        self.assertEqual(douze["prix"], Decimal("51000"))
        self.assertFalse(any(t["option"] == "mobile" for t in tarifs))


class OptionsBureauTests(BaseOptions):
    """Espace Admin du bureau (AppliquerAbonnementView)."""

    def corps(self, **champs):
        return {"username": "adminOpt", "password": MDP, "boutique_id": str(self.boutique.pk), **champs}

    def test_enregistrer_puis_rejouer_sans_doublon_puis_retirer(self):
        fin = (timezone.now() + timedelta(days=90)).isoformat()
        corps = self.corps(option_cle="reseau", option_fin=fin, option_nature="paiement", option_montant="15000", option_mode="wave")
        r = self.client.post(reverse("appliquer-abonnement"), corps, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["droits_options"]["reseau"])
        self.client.post(reverse("appliquer-abonnement"), corps, format="json")
        self.assertEqual(PaiementAbonnement.objects.filter(option="reseau").count(), 1)
        self.assertTrue(JournalAdmin.objects.filter(action="option_enregistree", boutique=self.boutique).exists())
        r = self.client.post(reverse("appliquer-abonnement"), self.corps(option_cle="reseau", option_retirer=True), format="json")
        self.assertFalse(r.data["droits_options"]["reseau"])

    def test_allumer_l_envoi_en_ligne_sans_l_option_est_refuse(self):
        r = self.client.post(reverse("appliquer-abonnement"), self.corps(synchro_autorisee=True), format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.post(
            reverse("appliquer-abonnement"), self.corps(synchro_autorisee=True, option_en_ligne_offerte=True), format="json"
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["en_ligne_actif"])

    def test_detail_montre_les_options(self):
        r = self.client.post(reverse("admin-abonnement-boutique"), self.corps(), format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIn("options", r.data)
        self.assertIn("tarifs_options", r.data)


class OptionsSiteTests(BaseOptions):
    """Site d'administration (fiche boutique)."""

    def connecter(self, utilisateur=None):
        jetons = emettre_jetons(utilisateur or self.admin, verifie_2fa=False)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {jetons['access']}")

    def test_enregistrer_une_option_de_3_mois_puis_liee_puis_retirer(self):
        self.connecter()
        url = reverse("admin-option-boutique", args=[self.boutique.pk])
        r = self.client.post(url, {"cle": "mobile", "nature": "paiement", "duree_mois": 3, "montant": "7500", "mode": "especes"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["options"]["mobile"]["droit"])
        self.assertEqual(r.data["options"]["mobile"]["source"], "payee")
        r = self.client.post(url, {"cle": "mobile", "nature": "offert", "suit_abonnement": True}, format="json")
        self.assertEqual(r.data["options"]["mobile"]["source"], "suit")
        r = self.client.post(url, {"cle": "mobile", "action": "retirer"}, format="json")
        self.assertFalse(r.data["options"]["mobile"]["droit"])
        self.assertEqual(JournalAdmin.objects.filter(action="option_enregistree").count(), 2)

    def test_option_sans_le_droit_paiements(self):
        limite = Utilisateur.objects.create_user(username="limiteOpt", password=MDP, is_staff=True)
        ProfilAdmin.objects.create(utilisateur=limite, droits=["boutiques"])
        self.connecter(limite)
        url = reverse("admin-option-boutique", args=[self.boutique.pk])
        self.assertEqual(self.client.post(url, {"cle": "mobile", "nature": "offert", "duree_mois": 1}, format="json").status_code, 403)

    def test_allumer_l_envoi_en_ligne_depuis_la_fiche(self):
        self.connecter()
        url = reverse("admin-fiche-boutique", args=[self.boutique.pk])
        self.assertEqual(self.client.patch(url, {"synchro_autorisee": True}, format="json").status_code, 400)
        r = self.client.patch(url, {"synchro_autorisee": True, "option_en_ligne_offerte": True}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["en_ligne_actif"])
        self.assertEqual(r.data["options"]["en_ligne"]["source"], "exception")


class CodeEtDeclarationTests(BaseOptions):
    SECRET = bytes(range(32))

    def test_le_code_d_activation_emporte_les_options_valables_jusqu_a_sa_date(self):
        import uuid
        from datetime import date

        from .activation import cle_publique, generer_code, lire_code, lire_options
        from .services import options_pour_code

        boutique_id = uuid.uuid4()
        code = generer_code(boutique_id, date(2027, 3, 31), "essentiel", secret=self.SECRET, options=["reseau", "mobile"])
        # Une appli qui ne connaît pas les options lit toujours « essentiel ».
        self.assertEqual(lire_code(code, cle_publique(self.SECRET)), (boutique_id, date(2027, 3, 31), "essentiel"))
        self.assertEqual(lire_options(code, cle_publique(self.SECRET)), ["reseau", "mobile"])
        code_pro = generer_code(boutique_id, date(2027, 3, 31), "pro", secret=self.SECRET, options=["reseau"])
        self.assertEqual(lire_code(code_pro, cle_publique(self.SECRET))[2], "pro")
        self.assertEqual(lire_options(code_pro, cle_publique(self.SECRET)), [])
        # Options retenues pour un code : celles valables jusqu'à sa date.
        fin_code = timezone.localdate(self.boutique.date_expiration_abonnement)
        enregistrer_option(self.boutique, "reseau", "offert", suit=True)
        enregistrer_option(self.boutique, "mobile", "offert", fin=timezone.now() + timedelta(days=3))
        self.boutique.option_en_ligne_offerte = True
        self.assertEqual(options_pour_code(self.boutique, fin_code), ["en_ligne", "reseau"])

    def test_paiement_declare_pour_une_option_puis_valide(self):
        from .services import valider_demande_renouvellement

        self.client.force_authenticate(user=self.patron)
        r = self.client.post(
            reverse("boutique-abonnement-demandes"),
            {"formule": "essentiel", "option": "reseau", "duree_mois": 3, "montant": "15000", "mode": "wave", "reference": "OPT-1"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        from .models import DemandeRenouvellement

        demande = DemandeRenouvellement.objects.get(reference="OPT-1")
        self.assertEqual(demande.option, "reseau")
        fin_abonnement = self.boutique.date_expiration_abonnement
        valider_demande_renouvellement(demande, par=self.admin)
        self.boutique.refresh_from_db()
        self.assertTrue(self.boutique.droit_option("reseau"))
        self.assertEqual(self.boutique.date_expiration_abonnement, fin_abonnement)  # l'abonnement n'a pas bougé
        self.assertEqual(PaiementAbonnement.objects.get(reference="OPT-1").option, "reseau")
