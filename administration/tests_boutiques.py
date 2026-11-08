from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from comptes.models import Boutique, DemandeInscription, Utilisateur
from comptes.services import inscrire_boutique

from .models import JournalAdmin, ProfilAdmin
from .services import emettre_jetons

MDP = "UnMotDePasseSolide123"


class BaseAdmin(APITestCase):
    def setUp(self):
        self.admin = Utilisateur.objects.create_user(username="admin", password=MDP, is_staff=True)
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Quincaillerie Koné", "telephone": "0700000000"},
            {"username": "kone", "password": MDP, "email": "kone@x.com"},
        )
        self.boutique.date_expiration_abonnement = timezone.now() + timedelta(days=3)
        self.boutique.save()

    def connecter(self, utilisateur=None):
        jetons = emettre_jetons(utilisateur or self.admin, verifie_2fa=False)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {jetons['access']}")


@override_settings(ADMIN_EMAIL="")
class BoutiquesTests(BaseAdmin):
    def test_tableau_de_bord(self):
        self.connecter()
        r = self.client.get(reverse("admin-tableau-de-bord"))
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["boutiques"]["total"], 1)
        self.assertEqual(r.data["abonnements"]["bientot"], 1)
        self.assertEqual(r.data["a_surveiller"][0]["nom"], "Quincaillerie Koné")

    def test_tableau_de_bord_ne_montre_que_ce_que_l_admin_peut_traiter(self):
        limite = Utilisateur.objects.create_user(username="limite", password=MDP, is_staff=True)
        ProfilAdmin.objects.create(utilisateur=limite, droits=["inscriptions"])
        self.connecter(limite)
        r = self.client.get(reverse("admin-tableau-de-bord"))
        self.assertEqual(list(r.data["a_traiter"]), ["inscriptions"])
        self.assertEqual(r.data["a_surveiller"], [])

    def test_liste_recherche_et_filtre(self):
        self.connecter()
        r = self.client.get(reverse("admin-boutiques"), {"recherche": "kone"})
        self.assertEqual(len(r.data), 1)
        self.assertEqual(r.data[0]["patron"]["username"], "kone")
        self.assertEqual(r.data[0]["nb_utilisateurs"], 1)
        self.assertEqual(len(self.client.get(reverse("admin-boutiques"), {"etat": "bloque"}).data), 0)
        self.assertEqual(len(self.client.get(reverse("admin-boutiques"), {"etat": "bientot"}).data), 1)

    def test_fiche_sans_donnees_metier(self):
        self.connecter()
        r = self.client.get(reverse("admin-fiche-boutique", args=[self.boutique.id]))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["utilisateurs"][0]["role"], "Patron")
        for interdit in ("ventes", "stock", "clients", "chiffre_affaires"):
            self.assertNotIn(interdit, r.data)

    def test_activer_la_synchro_est_journalise(self):
        self.connecter()
        url = reverse("admin-fiche-boutique", args=[self.boutique.id])
        r = self.client.patch(url, {"synchro_autorisee": True}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["synchro_autorisee"])
        self.assertTrue(JournalAdmin.objects.filter(action="synchro_activee", boutique=self.boutique).exists())
        # « actif » n'est pas modifiable (sans effet réel dans l'appli).
        self.client.patch(url, {"actif": False}, format="json")
        self.boutique.refresh_from_db()
        self.assertTrue(self.boutique.actif)

    def test_activer_l_appli_mobile_est_journalise(self):
        self.connecter()
        url = reverse("admin-fiche-boutique", args=[self.boutique.id])
        self.assertFalse(self.client.get(url).data["appli_mobile_autorisee"])
        r = self.client.patch(url, {"appli_mobile_autorisee": True}, format="json")
        self.assertTrue(r.data["appli_mobile_autorisee"])
        self.boutique.refresh_from_db()
        self.assertTrue(self.boutique.appli_mobile_autorisee)
        self.assertTrue(JournalAdmin.objects.filter(action="appli_mobile_activee", boutique=self.boutique).exists())

    def test_fiche_essai_et_reseau(self):
        from comptes.models import DemandeReseau

        DemandeReseau.objects.create(boutique=self.boutique, demandeur=self.patron, note="2 caisses")
        self.connecter()
        url = reverse("admin-fiche-boutique", args=[self.boutique.id])
        fiche = self.client.get(url).data
        self.assertTrue(fiche["peut"]["paiements"] and fiche["peut"]["demandes_reseau"])
        self.assertEqual(len(fiche["demandes_reseau"]), 1)
        self.assertIn("tarifs", fiche)
        # Essai Pro de 15 jours, à part de l'abonnement payé.
        fin = timezone.now() + timedelta(days=15)
        r = self.client.patch(url, {"essai_fin": fin.isoformat(), "essai_formule": "pro"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["essai_en_cours"])
        self.assertEqual(r.data["formule_effective"], "pro")
        self.assertTrue(JournalAdmin.objects.filter(action="essai_accorde", boutique=self.boutique).exists())
        self.assertEqual(self.client.patch(url, {"essai_fin": fin.isoformat()}, format="json").status_code, 400)
        r = self.client.patch(url, {"essai_fin": None}, format="json")
        self.assertFalse(r.data["essai_en_cours"])
        # Réseau : activer accepte la demande en attente.
        r = self.client.patch(url, {"reseau_autorise": True}, format="json")
        self.assertTrue(r.data["reseau_autorise"])
        self.assertEqual(r.data["demandes_reseau"][0]["statut"], "acceptee")
        self.assertTrue(JournalAdmin.objects.filter(action="reseau_active", boutique=self.boutique).exists())

    def test_fiche_essai_refuse_sans_le_droit_paiements(self):
        limite = Utilisateur.objects.create_user(username="limite2", password=MDP, is_staff=True)
        ProfilAdmin.objects.create(utilisateur=limite, droits=["boutiques"])
        self.connecter(limite)
        url = reverse("admin-fiche-boutique", args=[self.boutique.id])
        fiche = self.client.get(url).data
        self.assertFalse(fiche["peut"]["paiements"])
        self.assertNotIn("tarifs", fiche)
        fin = (timezone.now() + timedelta(days=7)).isoformat()
        self.assertEqual(self.client.patch(url, {"essai_fin": fin, "essai_formule": "pro"}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(url, {"reseau_autorise": True}, format="json").status_code, 403)

    def test_sans_le_droit_boutiques(self):
        limite = Utilisateur.objects.create_user(username="limite", password=MDP, is_staff=True)
        ProfilAdmin.objects.create(utilisateur=limite, droits=["paiements"])
        self.connecter(limite)
        self.assertEqual(self.client.get(reverse("admin-boutiques")).status_code, 403)
        self.assertEqual(
            self.client.patch(
                reverse("admin-fiche-boutique", args=[self.boutique.id]), {"synchro_autorisee": True}, format="json"
            ).status_code,
            403,
        )


@override_settings(ADMIN_EMAIL="")
class InscriptionsEtCreationTests(BaseAdmin):
    def demande(self, username="nouveau"):
        return DemandeInscription.objects.create(
            boutique_nom="Boutique Awa", username=username, email=f"{username}@x.com", mot_de_passe_hash=make_password(MDP)
        )

    def test_approuver_cree_la_boutique_avec_essai(self):
        d = self.demande()
        self.connecter()
        r = self.client.post(reverse("admin-traiter-inscription", args=[d.id]), {"action": "approuver"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["statut"], "approuvee")
        boutique = Boutique.objects.get(nom="Boutique Awa")
        self.assertGreater(boutique.date_expiration_abonnement, timezone.now() + timedelta(days=14))
        self.assertTrue(Utilisateur.objects.get(username="nouveau").check_password(MDP))
        self.assertTrue(JournalAdmin.objects.filter(action="inscription_approuvee", boutique=boutique).exists())
        # Déjà traitée : refus.
        r2 = self.client.post(reverse("admin-traiter-inscription", args=[d.id]), {"action": "rejeter"}, format="json")
        self.assertEqual(r2.status_code, 400)

    def test_identifiant_deja_pris(self):
        d = self.demande(username="kone")
        self.connecter()
        r = self.client.post(reverse("admin-traiter-inscription", args=[d.id]), {"action": "approuver"}, format="json")
        self.assertEqual(r.status_code, 409)

    def test_rejeter(self):
        d = self.demande()
        self.connecter()
        r = self.client.post(reverse("admin-traiter-inscription", args=[d.id]), {"action": "rejeter"}, format="json")
        self.assertEqual(r.data["statut"], "rejetee")
        self.assertEqual(self.client.get(reverse("admin-inscriptions")).data["demandes"], [])

    def test_creer_une_boutique(self):
        self.connecter()
        self.assertTrue(self.client.get(reverse("admin-identifiant-disponible"), {"identifiant": "awa"}).data["disponible"])
        self.assertFalse(self.client.get(reverse("admin-identifiant-disponible"), {"identifiant": "KONE"}).data["disponible"])
        r = self.client.post(
            reverse("admin-creer-boutique"),
            {"boutique_nom": "Chez Awa", "username": "awa", "password": MDP, "email": "awa@x.com", "formule": "pro"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["formule"], "pro")
        awa = Utilisateur.objects.get(username="awa")
        self.assertTrue(awa.doit_changer_mot_de_passe)
        self.assertEqual(awa.role.nom, "Patron")
        self.assertIsNotNone(Boutique.objects.get(nom="Chez Awa").date_expiration_abonnement)

    def test_creer_avec_essai_choisi_reseau_et_appli(self):
        self.connecter()
        r = self.client.post(
            reverse("admin-creer-boutique"),
            {
                "boutique_nom": "Chez Fanta", "username": "fanta", "password": MDP, "email": "fanta@x.com",
                "formule": "pro", "essai_jours": 7, "reseau_autorise": True, "appli_mobile_autorisee": True,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        b = Boutique.objects.get(nom="Chez Fanta")
        self.assertTrue(b.reseau_autorise and b.appli_mobile_autorisee)
        self.assertEqual(b.formule, "pro")
        self.assertEqual((timezone.localdate(b.date_expiration_abonnement) - timezone.localdate()).days, 7)
        self.assertEqual(b.paiements_abonnement.get().nature, "essai")

    def test_creer_refuse_mot_de_passe_faible_et_doublon(self):
        self.connecter()
        r = self.client.post(
            reverse("admin-creer-boutique"),
            {"boutique_nom": "X", "username": "kone", "password": "123", "email": "kone@x.com"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("username", r.data)
        self.assertIn("email", r.data)


class ThemeAdminTests(BaseAdmin):
    def test_theme_attache_au_compte_sans_toucher_aux_droits(self):
        from .services import droits_de

        droits_avant = droits_de(self.admin)
        self.connecter()
        self.assertEqual(self.client.get(reverse("admin-moi")).data["theme"], "clair")
        self.assertEqual(self.client.post(reverse("admin-theme"), {"theme": "violet"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(reverse("admin-theme"), {"theme": "nuit"}, format="json").data["theme"], "nuit")
        self.assertEqual(self.client.get(reverse("admin-moi")).data["theme"], "nuit")
        # Un admin sans profil garde tous ses droits : le thème n'a pas créé de ProfilAdmin.
        self.assertFalse(ProfilAdmin.objects.filter(utilisateur=self.admin).exists())
        self.assertEqual(droits_de(self.admin), droits_avant)
