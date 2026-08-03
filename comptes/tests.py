from django.core import mail
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Boutique, DemandeInscription, Role, Utilisateur
from .services import (
    approuver_inscription,
    inscrire_boutique,
    point_depart_renouvellement,
    rejeter_inscription,
    renouveler_abonnement,
)


@override_settings(ADMIN_EMAIL="admin@exemple.com")
class InscriptionTests(APITestCase):
    def test_inscription_cree_une_demande_pas_de_compte(self):
        reponse = self.client.post(
            reverse("inscription"),
            {
                "boutique_nom": "Boutique Test",
                "username": "patron1",
                "password": "UnMotDePasseSolide123",
                "email": "patron1@exemple.com",
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_202_ACCEPTED, reponse.data)

        # Rien n'est créé tant que ce n'est pas approuvé.
        self.assertFalse(Boutique.objects.filter(nom="Boutique Test").exists())
        self.assertFalse(Utilisateur.objects.filter(username="patron1").exists())

        demande = DemandeInscription.objects.get(username="patron1")
        self.assertEqual(demande.boutique_nom, "Boutique Test")
        self.assertEqual(demande.statut, DemandeInscription.Statut.EN_ATTENTE)
        self.assertEqual(demande.formule, Boutique.Formule.ESSENTIEL)
        self.assertNotEqual(demande.mot_de_passe_hash, "UnMotDePasseSolide123")  # jamais en clair

        # L'administrateur est notifié.
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["admin@exemple.com"])

    def test_inscription_refuse_sans_email(self):
        reponse = self.client.post(
            reverse("inscription"),
            {"boutique_nom": "Boutique Test 2", "username": "patron2", "password": "UnMotDePasseSolide123"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", reponse.data)

    def test_inscription_refuse_email_deja_utilise(self):
        inscrire_boutique(
            {"nom": "Boutique Existante"},
            {"username": "dejapris", "password": "UnMotDePasseSolide123", "email": "pris@exemple.com"},
        )
        reponse = self.client.post(
            reverse("inscription"),
            {
                "boutique_nom": "Boutique Test 3",
                "username": "patron3",
                "password": "UnMotDePasseSolide123",
                "email": "pris@exemple.com",
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", reponse.data)

    def test_inscription_refuse_demande_deja_en_attente(self):
        self.client.post(
            reverse("inscription"),
            {
                "boutique_nom": "Boutique Test 4",
                "username": "patron4",
                "password": "UnMotDePasseSolide123",
                "email": "patron4@exemple.com",
            },
            format="json",
        )
        reponse = self.client.post(
            reverse("inscription"),
            {
                "boutique_nom": "Boutique Test 4 bis",
                "username": "patron4",
                "password": "UnMotDePasseSolide123",
                "email": "autre@exemple.com",
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", reponse.data)


@override_settings(ADMIN_EMAIL="admin@exemple.com")
class ApprobationInscriptionTests(APITestCase):
    def setUp(self):
        self.client.post(
            reverse("inscription"),
            {
                "boutique_nom": "Boutique Approuvee",
                "username": "patronApprouve",
                "password": "UnMotDePasseSolide123",
                "email": "approuve@exemple.com",
            },
            format="json",
        )
        self.demande = DemandeInscription.objects.get(username="patronApprouve")
        mail.outbox = []  # on ignore l'email de notification admin pour la suite

    def test_approuver_cree_boutique_roles_patron_et_prevoit_lexpiration(self):
        expiration = timezone.now() + timezone.timedelta(days=30)
        boutique, utilisateur = approuver_inscription(self.demande, expiration)

        self.assertEqual(Role.objects.filter(boutique=boutique).count(), 3)
        self.assertEqual(utilisateur.role.nom, "Patron")
        self.assertTrue(utilisateur.check_password("UnMotDePasseSolide123"))
        self.assertEqual(boutique.date_expiration_abonnement, expiration)

        self.demande.refresh_from_db()
        self.assertEqual(self.demande.statut, DemandeInscription.Statut.APPROUVEE)

        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["approuve@exemple.com"])

    def test_approuver_peut_changer_la_formule_demandee(self):
        expiration = timezone.now() + timezone.timedelta(days=30)
        boutique, _ = approuver_inscription(self.demande, expiration, formule=Boutique.Formule.PRO)
        self.assertEqual(boutique.formule, Boutique.Formule.PRO)

    def test_approuver_sans_formule_reprend_celle_de_la_demande(self):
        self.demande.formule = Boutique.Formule.PRO
        self.demande.save(update_fields=["formule"])
        expiration = timezone.now() + timezone.timedelta(days=30)
        boutique, _ = approuver_inscription(self.demande, expiration)
        self.assertEqual(boutique.formule, Boutique.Formule.PRO)

    def test_approuver_deux_fois_echoue(self):
        expiration = timezone.now() + timezone.timedelta(days=30)
        approuver_inscription(self.demande, expiration)
        with self.assertRaises(Exception):
            approuver_inscription(self.demande, expiration)

    def test_rejeter_ne_cree_rien(self):
        rejeter_inscription(self.demande)

        self.demande.refresh_from_db()
        self.assertEqual(self.demande.statut, DemandeInscription.Statut.REJETEE)
        self.assertFalse(Boutique.objects.filter(nom="Boutique Approuvee").exists())
        self.assertEqual(len(mail.outbox), 1)


class RenouvellementAbonnementTests(APITestCase):
    def setUp(self):
        self.boutique, _ = inscrire_boutique(
            {"nom": "Boutique Abonnee"},
            {"username": "patronAbonne", "password": "UnMotDePasseSolide123"},
        )

    def test_point_depart_repart_de_la_date_actuelle_si_abonnement_deja_expire(self):
        self.boutique.date_expiration_abonnement = timezone.now() - timezone.timedelta(days=5)
        self.boutique.save(update_fields=["date_expiration_abonnement"])

        depart = point_depart_renouvellement(self.boutique)

        self.assertAlmostEqual(depart, timezone.now(), delta=timezone.timedelta(seconds=5))

    def test_point_depart_repart_de_lexpiration_en_cours_si_pas_encore_expire(self):
        expiration_future = timezone.now() + timezone.timedelta(days=10)
        self.boutique.date_expiration_abonnement = expiration_future
        self.boutique.save(update_fields=["date_expiration_abonnement"])

        depart = point_depart_renouvellement(self.boutique)

        self.assertEqual(depart, expiration_future)

    def test_point_depart_repart_de_maintenant_si_jamais_configure(self):
        depart = point_depart_renouvellement(self.boutique)
        self.assertAlmostEqual(depart, timezone.now(), delta=timezone.timedelta(seconds=5))

    def test_renouveler_met_a_jour_la_date_et_optionnellement_la_formule(self):
        nouvelle_date = timezone.now() + timezone.timedelta(days=30)
        renouveler_abonnement(self.boutique, nouvelle_date, formule=Boutique.Formule.PRO)

        self.boutique.refresh_from_db()
        self.assertEqual(self.boutique.date_expiration_abonnement, nouvelle_date)
        self.assertEqual(self.boutique.formule, Boutique.Formule.PRO)

    def test_renouveler_sans_formule_garde_lancienne(self):
        self.boutique.formule = Boutique.Formule.PRO
        self.boutique.save(update_fields=["formule"])
        nouvelle_date = timezone.now() + timezone.timedelta(days=30)

        renouveler_abonnement(self.boutique, nouvelle_date)

        self.boutique.refresh_from_db()
        self.assertEqual(self.boutique.formule, Boutique.Formule.PRO)


class ConnexionTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A"},
            {"username": "patronA", "password": "UnMotDePasseSolide123"},
        )

    def test_connexion_retourne_token_avec_claims(self):
        reponse = self.client.post(
            reverse("connexion"),
            {"username": "patronA", "password": "UnMotDePasseSolide123"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertIn("access", reponse.data)

        # Décode le payload du token (2e segment) pour vérifier les claims ajoutés.
        import base64
        import json

        payload_b64 = reponse.data["access"].split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))

        self.assertEqual(payload["boutique_nom"], "Boutique A")
        self.assertEqual(payload["role"], "Patron")
        self.assertTrue(payload["permissions"]["gerer_utilisateurs_reglages"])


class IsolationEtPermissionsTests(APITestCase):
    def setUp(self):
        self.boutique_a, self.patron_a = inscrire_boutique(
            {"nom": "Boutique A"},
            {"username": "patronA2", "password": "UnMotDePasseSolide123"},
        )
        self.boutique_b, self.patron_b = inscrire_boutique(
            {"nom": "Boutique B"},
            {"username": "patronB", "password": "UnMotDePasseSolide123"},
        )
        self.caissier_a = Utilisateur(
            boutique=self.boutique_a,
            role=Role.objects.get(boutique=self.boutique_a, nom="Caissier"),
            username="caissierA",
        )
        self.caissier_a.set_password("UnMotDePasseSolide123")
        self.caissier_a.save()

    def test_isolation_utilisateurs_entre_boutiques(self):
        self.client.force_authenticate(user=self.patron_a)
        reponse = self.client.get(reverse("utilisateur-list"))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)

        usernames = {u["username"] for u in reponse.data}
        self.assertIn("patronA2", usernames)
        self.assertIn("caissierA", usernames)
        self.assertNotIn("patronB", usernames)

    def test_permission_caissier_ne_peut_pas_gerer_utilisateurs(self):
        self.client.force_authenticate(user=self.caissier_a)
        reponse = self.client.post(
            reverse("utilisateur-list"),
            {"username": "nouveau", "password": "UnMotDePasseSolide123"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_403_FORBIDDEN)

    def test_role_patron_ne_peut_pas_etre_retire(self):
        self.client.force_authenticate(user=self.patron_a)
        role_caissier = Role.objects.get(boutique=self.boutique_a, nom="Caissier")
        reponse = self.client.patch(
            reverse("utilisateur-detail", args=[self.patron_a.id]),
            {"role": str(role_caissier.id)},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

        self.patron_a.refresh_from_db()
        self.assertEqual(self.patron_a.role.nom, "Patron")

    def test_modifier_un_patron_sans_toucher_au_role_fonctionne(self):
        self.client.force_authenticate(user=self.patron_a)
        reponse = self.client.patch(
            reverse("utilisateur-detail", args=[self.patron_a.id]),
            {"telephone": "0700000000"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)

        self.patron_a.refresh_from_db()
        self.assertEqual(self.patron_a.telephone, "0700000000")
        self.assertEqual(self.patron_a.role.nom, "Patron")

    def test_permissions_du_role_patron_ne_peuvent_pas_etre_modifiees(self):
        self.client.force_authenticate(user=self.patron_a)
        role_patron = Role.objects.get(boutique=self.boutique_a, nom="Patron")
        nouvelles_permissions = {**role_patron.permissions, "vendre": False}
        reponse = self.client.patch(
            reverse("role-detail", args=[role_patron.id]),
            {"permissions": nouvelles_permissions},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

        role_patron.refresh_from_db()
        self.assertTrue(role_patron.permissions["vendre"])

    def test_supprimer_un_caissier_fonctionne(self):
        self.client.force_authenticate(user=self.patron_a)
        reponse = self.client.delete(reverse("utilisateur-detail", args=[self.caissier_a.id]))
        self.assertEqual(reponse.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Utilisateur.objects.filter(id=self.caissier_a.id).exists())

    def test_supprimer_le_patron_est_refuse(self):
        self.client.force_authenticate(user=self.patron_a)
        reponse = self.client.delete(reverse("utilisateur-detail", args=[self.patron_a.id]))
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Utilisateur.objects.filter(id=self.patron_a.id).exists())

    def test_modifier_les_permissions_dun_role_non_patron_fonctionne(self):
        self.client.force_authenticate(user=self.patron_a)
        role_caissier = Role.objects.get(boutique=self.boutique_a, nom="Caissier")
        nouvelles_permissions = {**role_caissier.permissions, "annuler_vente": True}
        reponse = self.client.patch(
            reverse("role-detail", args=[role_caissier.id]),
            {"permissions": nouvelles_permissions},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)

        role_caissier.refresh_from_db()
        self.assertTrue(role_caissier.permissions["annuler_vente"])


class MotDePasseOublieTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique Reset"},
            {"username": "patronReset", "password": "AncienMotDePasse123", "email": "patron@exemple.com"},
        )
        self.caissier = Utilisateur(
            boutique=self.boutique,
            role=Role.objects.get(boutique=self.boutique, nom="Caissier"),
            username="caissierReset",
            email="caissier@exemple.com",
        )
        self.caissier.set_password("AncienMotDePasse123")
        self.caissier.save()

    def test_demande_envoie_un_email_si_patron_existe(self):
        reponse = self.client.post(
            reverse("mot-de-passe-oublie"), {"email": "patron@exemple.com"}, format="json"
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["patron@exemple.com"])

    def test_demande_ne_revele_rien_si_email_inconnu(self):
        reponse = self.client.post(
            reverse("mot-de-passe-oublie"), {"email": "inconnu@exemple.com"}, format="json"
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertEqual(len(mail.outbox), 0)

    def test_demande_ignore_un_caissier_seul_le_patron_est_eligible(self):
        reponse = self.client.post(
            reverse("mot-de-passe-oublie"), {"email": "caissier@exemple.com"}, format="json"
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertEqual(len(mail.outbox), 0)

    def test_reinitialisation_avec_bon_code_change_le_mot_de_passe(self):
        self.patron.code_reinitialisation = "12345"
        self.patron.code_reinitialisation_expire_le = timezone.now() + timezone.timedelta(minutes=15)
        self.patron.save()

        reponse = self.client.post(
            reverse("reinitialiser-mot-de-passe"),
            {"email": "patron@exemple.com", "code": "12345", "nouveau_mot_de_passe": "NouveauMotDePasse456"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)

        self.patron.refresh_from_db()
        self.assertTrue(self.patron.check_password("NouveauMotDePasse456"))
        self.assertEqual(self.patron.code_reinitialisation, "")

    def test_reinitialisation_refuse_un_mauvais_code(self):
        self.patron.code_reinitialisation = "12345"
        self.patron.code_reinitialisation_expire_le = timezone.now() + timezone.timedelta(minutes=15)
        self.patron.save()

        reponse = self.client.post(
            reverse("reinitialiser-mot-de-passe"),
            {"email": "patron@exemple.com", "code": "00000", "nouveau_mot_de_passe": "NouveauMotDePasse456"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

        self.patron.refresh_from_db()
        self.assertTrue(self.patron.check_password("AncienMotDePasse123"))

    def test_reinitialisation_refuse_un_code_expire(self):
        self.patron.code_reinitialisation = "12345"
        self.patron.code_reinitialisation_expire_le = timezone.now() - timezone.timedelta(minutes=1)
        self.patron.save()

        reponse = self.client.post(
            reverse("reinitialiser-mot-de-passe"),
            {"email": "patron@exemple.com", "code": "12345", "nouveau_mot_de_passe": "NouveauMotDePasse456"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reinitialisation_refusee_pour_un_caissier(self):
        self.caissier.code_reinitialisation = "12345"
        self.caissier.code_reinitialisation_expire_le = timezone.now() + timezone.timedelta(minutes=15)
        self.caissier.save()

        reponse = self.client.post(
            reverse("reinitialiser-mot-de-passe"),
            {"email": "caissier@exemple.com", "code": "12345", "nouveau_mot_de_passe": "NouveauMotDePasse456"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
