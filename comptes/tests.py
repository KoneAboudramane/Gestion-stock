from django.core import mail
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from .codes_vendeur import calculer_code_vendeur
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
        self.assertEqual(payload["code_vendeur"], "PAT")


class VerifierSessionAdminTests(APITestCase):
    """
    Détection de révocation d'accès admin (voir comptes/views.py::
    VerifierSessionAdminView) : un compte désactivé après coup doit être
    refusé au prochain appel, même avec un jeton d'accès déjà émis.
    """

    def setUp(self):
        self.admin = Utilisateur.objects.create_user(
            username="adminStaff", password="UnMotDePasseSolide123", is_staff=True
        )
        self.non_staff = Utilisateur.objects.create_user(
            username="simpleUser", password="UnMotDePasseSolide123", is_staff=False
        )

    def test_admin_actif_est_autorise(self):
        token = str(AccessToken.for_user(self.admin))
        reponse = self.client.get(reverse("verifier-session-admin"), HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        self.assertTrue(reponse.data["autorise"])

    def test_utilisateur_non_staff_n_est_pas_autorise(self):
        token = str(AccessToken.for_user(self.non_staff))
        reponse = self.client.get(reverse("verifier-session-admin"), HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        self.assertFalse(reponse.data["autorise"])

    def test_compte_desactive_est_refuse(self):
        token = str(AccessToken.for_user(self.admin))
        self.admin.is_active = False
        self.admin.save(update_fields=["is_active"])
        reponse = self.client.get(reverse("verifier-session-admin"), HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(reponse.status_code, status.HTTP_401_UNAUTHORIZED)




class ListerPatronsTests(APITestCase):
    """Menu de "Réinitialiser mot de passe" (voir comptes/views.py::ListerPatronsView)."""

    def setUp(self):
        self.admin = Utilisateur.objects.create_user(
            username="adminStaff3", password="UnMotDePasseSolide123", is_staff=True
        )
        self.boutique_a, _ = inscrire_boutique(
            {"nom": "Boutique Z"}, {"username": "patronZ", "password": "UnMotDePasseSolide123"}
        )
        self.boutique_b, _ = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronA", "password": "UnMotDePasseSolide123"}
        )

    def test_liste_tous_les_patrons_tries_par_boutique(self):
        reponse = self.client.post(
            reverse("lister-patrons"),
            {"username": "adminStaff3", "password": "UnMotDePasseSolide123"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        usernames = [p["username"] for p in reponse.data]
        self.assertIn("patronZ", usernames)
        self.assertIn("patronA", usernames)
        # Trié par nom de boutique : "Boutique A" avant "Boutique Z".
        self.assertLess(usernames.index("patronA"), usernames.index("patronZ"))

    def test_refuse_un_non_admin(self):
        reponse = self.client.post(
            reverse("lister-patrons"),
            {"username": "patronA", "password": "UnMotDePasseSolide123"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_403_FORBIDDEN)


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

    def test_annuaire_lisible_par_un_caissier_sans_donnees_sensibles(self):
        self.client.force_authenticate(user=self.caissier_a)
        reponse = self.client.get(reverse("utilisateur-annuaire"))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        noms = {u["nom"] for u in reponse.data}
        self.assertEqual(noms, {"patronA2", "caissierA"})
        self.assertEqual(set(reponse.data[0].keys()), {"id", "nom"})
        # La liste complète (e-mails, rôles...) reste réservée à la gestion des utilisateurs.
        self.assertEqual(self.client.get(reverse("utilisateur-list")).status_code, status.HTTP_403_FORBIDDEN)

    def test_permission_caissier_ne_peut_pas_gerer_utilisateurs(self):
        self.client.force_authenticate(user=self.caissier_a)
        reponse = self.client.post(
            reverse("utilisateur-list"),
            {"username": "nouveau", "password": "UnMotDePasseSolide123"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_403_FORBIDDEN)

    def test_formule_essentiel_limite_a_deux_utilisateurs(self):
        # boutique_a a déjà le Patron + caissier_a = 2 comptes (formule essentiel par défaut).
        role_caissier = Role.objects.get(boutique=self.boutique_a, nom="Caissier")
        self.client.force_authenticate(user=self.patron_a)
        reponse = self.client.post(
            reverse("utilisateur-list"),
            {"username": "troisieme", "password": "UnMotDePasseSolide123", "role": str(role_caissier.id)},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST, reponse.data)

    def test_formule_pro_autorise_plus_de_deux_utilisateurs(self):
        self.boutique_a.formule = Boutique.Formule.PRO
        self.boutique_a.save(update_fields=["formule"])
        role_caissier = Role.objects.get(boutique=self.boutique_a, nom="Caissier")
        self.client.force_authenticate(user=self.patron_a)
        reponse = self.client.post(
            reverse("utilisateur-list"),
            {"username": "troisieme", "password": "UnMotDePasseSolide123", "role": str(role_caissier.id)},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

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

    # --- Rôles personnalisés ---

    def test_creer_un_role_personnalise(self):
        self.client.force_authenticate(user=self.patron_a)
        reponse = self.client.post(
            reverse("role-list"),
            {"nom": "  Magasinier ", "permissions": {"consulter_stock": True, "gerer_produits_stock_achats": True}},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        role = Role.objects.get(id=reponse.data["id"])
        self.assertEqual(role.nom, "Magasinier")
        self.assertEqual(role.boutique, self.boutique_a)
        self.assertTrue(role.permissions["gerer_produits_stock_achats"])

    def test_creer_un_role_refuse_au_caissier(self):
        self.client.force_authenticate(user=self.caissier_a)
        reponse = self.client.post(reverse("role-list"), {"nom": "Vendeur", "permissions": {}}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_403_FORBIDDEN)

    def test_nom_de_role_unique_dans_la_boutique_mais_pas_entre_boutiques(self):
        self.client.force_authenticate(user=self.patron_a)
        reponse = self.client.post(reverse("role-list"), {"nom": "caissier", "permissions": {}}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("existe déjà", str(reponse.data["nom"][0]))

        self.client.post(reverse("role-list"), {"nom": "Vendeur", "permissions": {}}, format="json")
        self.client.force_authenticate(user=self.patron_b)
        reponse = self.client.post(reverse("role-list"), {"nom": "Vendeur", "permissions": {}}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

    def test_nom_patron_reserve(self):
        self.client.force_authenticate(user=self.patron_a)
        reponse = self.client.post(reverse("role-list"), {"nom": "PATRON", "permissions": {}}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

        role_caissier = Role.objects.get(boutique=self.boutique_a, nom="Caissier")
        reponse = self.client.patch(reverse("role-detail", args=[role_caissier.id]), {"nom": "Patron"}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

    def test_renommer_un_role_mais_pas_le_patron(self):
        self.client.force_authenticate(user=self.patron_a)
        role_caissier = Role.objects.get(boutique=self.boutique_a, nom="Caissier")
        reponse = self.client.patch(reverse("role-detail", args=[role_caissier.id]), {"nom": "Vendeur"}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        role_caissier.refresh_from_db()
        self.assertEqual(role_caissier.nom, "Vendeur")

        role_patron = Role.objects.get(boutique=self.boutique_a, nom="Patron")
        reponse = self.client.patch(reverse("role-detail", args=[role_patron.id]), {"nom": "Chef"}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        role_patron.refresh_from_db()
        self.assertEqual(role_patron.nom, "Patron")

    def test_supprimer_un_role_sans_utilisateur(self):
        self.client.force_authenticate(user=self.patron_a)
        role_gerant = Role.objects.get(boutique=self.boutique_a, nom="Gérant")
        reponse = self.client.delete(reverse("role-detail", args=[role_gerant.id]))
        self.assertEqual(reponse.status_code, status.HTTP_204_NO_CONTENT)
        noms = {r["nom"] for r in self.client.get(reverse("role-list")).data}
        self.assertNotIn("Gérant", noms)
        # Le nom redevient libre.
        reponse = self.client.post(reverse("role-list"), {"nom": "Gérant", "permissions": {}}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

    def test_supprimer_un_role_attribue_est_refuse(self):
        self.client.force_authenticate(user=self.patron_a)
        role_caissier = Role.objects.get(boutique=self.boutique_a, nom="Caissier")
        reponse = self.client.delete(reverse("role-detail", args=[role_caissier.id]))
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("1 utilisateur a ce rôle", str(reponse.data["detail"]))
        role_caissier.refresh_from_db()
        self.assertFalse(role_caissier.supprime)

    def test_supprimer_le_role_patron_est_refuse(self):
        self.client.force_authenticate(user=self.patron_a)
        role_patron = Role.objects.get(boutique=self.boutique_a, nom="Patron")
        reponse = self.client.delete(reverse("role-detail", args=[role_patron.id]))
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

    def test_attribuer_un_role_dune_autre_boutique_est_refuse(self):
        self.client.force_authenticate(user=self.patron_a)
        role_b = Role.objects.get(boutique=self.boutique_b, nom="Gérant")
        reponse = self.client.patch(
            reverse("utilisateur-detail", args=[self.caissier_a.id]), {"role": str(role_b.id)}, format="json"
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)


class CodeVendeurTests(APITestCase):
    """Code vendeur : abréviation unique dans la boutique, glissée dans les numéros de documents."""

    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A", "formule": Boutique.Formule.PRO},
            {"username": "patronA", "password": "UnMotDePasseSolide123", "first_name": "Aboudramane", "last_name": "Koné"},
        )
        self.client.force_authenticate(user=self.patron)

    def creer(self, **champs):
        return self.client.post(
            reverse("utilisateur-list"), {"password": "UnMotDePasseSolide123", **champs}, format="json"
        )

    def test_calcul_initiales_accents_et_suffixe(self):
        self.assertEqual(calculer_code_vendeur("Aboudramane", "Koné", "x", set()), "AKO")
        self.assertEqual(calculer_code_vendeur("Élise", "Ouédraogo", "x", set()), "EOU")
        self.assertEqual(calculer_code_vendeur("", "", "caissier.1", set()), "CAI")
        self.assertEqual(calculer_code_vendeur("Abou", "Konaté", "x", {"AKO", "ako2"}), "AKO3")

    def test_patron_recoit_un_code_a_linscription(self):
        self.assertEqual(self.patron.code_vendeur, "AKO")

    def test_nouvel_utilisateur_recoit_un_code_unique(self):
        reponse = self.creer(username="abou", first_name="Abou", last_name="Konaté")
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        self.assertEqual(reponse.data["code_vendeur"], "AKO2")

    def test_meme_code_permis_dans_une_autre_boutique(self):
        _, autre = inscrire_boutique(
            {"nom": "Boutique B"},
            {"username": "patronB", "password": "UnMotDePasseSolide123", "first_name": "Ali", "last_name": "Kouyaté"},
        )
        self.assertEqual(autre.code_vendeur, "AKO")

    def test_code_modifiable_unique_et_au_bon_format(self):
        cree = self.creer(username="awa", first_name="Awa", last_name="Diallo").data
        url = reverse("utilisateur-detail", args=[cree["id"]])
        self.assertEqual(self.client.patch(url, {"code_vendeur": "ako"}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"code_vendeur": "A B"}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"code_vendeur": "TROPLONG"}, format="json").status_code, 400)
        reponse = self.client.patch(url, {"code_vendeur": "awa1"}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertEqual(reponse.data["code_vendeur"], "AWA1")
        # Vide : le code reste inchangé.
        reponse = self.client.patch(url, {"code_vendeur": ""}, format="json")
        self.assertEqual(reponse.data["code_vendeur"], "AWA1")

    def test_moi_renvoie_le_code(self):
        reponse = self.client.get(reverse("moi"))
        self.assertEqual(reponse.data["code_vendeur"], "AKO")


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


class SuppressionDonneesEnLigneTests(APITestCase):
    """Mode 100 % local (docs/plan_reseau_local.md, §5) : supprimer du serveur les
    données d'une boutique en gardant la boutique, son abonnement, ses comptes et ses réglages."""

    def setUp(self):
        from catalogue.models import Produit, Variante
        from clients.models import Client
        from configuration.models import Parametre
        from stock.models import Depot, MouvementStock, PerteStock
        from stock.services import appliquer_mouvement, declarer_perte, demarrer_destockage
        from synchronisation.models import JournalSync

        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique L"}, {"username": "patronL", "password": "UnMotDePasseSolide123"}
        )
        depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        variante = Variante.objects.create(
            produit=Produit.objects.create(boutique=self.boutique, nom="Sac"), prix_achat=100, prix_vente=200
        )
        appliquer_mouvement(variante, depot, MouvementStock.Type.ENTREE, 10)
        declarer_perte(variante, depot, 1, PerteStock.Motif.ABIME)
        demarrer_destockage(variante, 150)
        Client.objects.create(boutique=self.boutique, nom="Awa")
        Parametre.objects.create(boutique=self.boutique, cle="format_ticket", valeur="a4")
        JournalSync.objects.create(
            boutique=self.boutique, appareil="poste", table="clients.Client",
            enregistrement_id=variante.id, action="cree", statut="synchronise", donnees={"nom": "Awa"},
        )
        self.client.force_authenticate(user=self.patron)
        reponse = self.client.post(
            reverse("vente-list"),
            {
                "depot": str(depot.id),
                "statut": "payee",
                "lignes_saisie": [{"variante": str(variante.id), "quantite": "2"}],
                "paiements_saisie": [{"mode": "especes", "montant": "300"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, 201, reponse.data)

    def test_refuse_tant_que_la_synchronisation_est_activee(self):
        from .services import supprimer_donnees_en_ligne

        self.boutique.synchro_autorisee = True
        self.boutique.save()
        with self.assertRaises(ValueError):
            supprimer_donnees_en_ligne(self.boutique)

    def test_supprime_les_donnees_et_garde_boutique_comptes_reglages(self):
        from catalogue.models import Produit, Variante
        from clients.models import Client
        from comptabilite.models import EcritureComptable
        from configuration.models import Parametre
        from stock.models import Depot, MouvementStock, Stock
        from synchronisation.models import JournalSync
        from ventes.models import Vente
        from .models import Boutique, Utilisateur
        from .services import supprimer_donnees_en_ligne

        self.boutique.synchro_autorisee = False
        self.boutique.save()
        compteurs = supprimer_donnees_en_ligne(self.boutique)

        self.assertGreater(sum(compteurs.values()), 0)
        for modele in (Vente, Client, Depot, Produit):
            self.assertFalse(modele.objects.filter(boutique=self.boutique).exists(), modele.__name__)
        self.assertFalse(Variante.objects.filter(produit__boutique=self.boutique).exists())
        self.assertFalse(MouvementStock.objects.filter(depot__boutique=self.boutique).exists())
        self.assertFalse(Stock.objects.filter(depot__boutique=self.boutique).exists())
        self.assertFalse(EcritureComptable.objects.filter(boutique=self.boutique).exists())
        self.assertFalse(JournalSync.objects.filter(boutique=self.boutique).exists())
        # Conservés.
        self.assertTrue(Boutique.objects.filter(id=self.boutique.id).exists())
        self.assertTrue(Utilisateur.objects.filter(id=self.patron.id).exists())
        self.assertTrue(Parametre.objects.filter(boutique=self.boutique, cle="format_ticket").exists())


class CodeActivationTests(APITestCase):
    """Codes d'activation signés (docs/plan_reseau_local.md, lot 6)."""

    SECRET = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")

    def test_ed25519_conforme_au_vecteur_officiel_rfc8032(self):
        from .activation import cle_publique, signer, verifier

        publique = cle_publique(self.SECRET)
        self.assertEqual(publique.hex(), "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        signature = signer(self.SECRET, b"")
        self.assertEqual(
            signature.hex(),
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
        )
        self.assertTrue(verifier(publique, b"", signature))
        self.assertFalse(verifier(publique, b"autre", signature))

    def test_code_lisible_et_infalsifiable(self):
        import uuid
        from datetime import date

        from .activation import ErreurActivation, cle_publique, generer_code, lire_code

        boutique_id = uuid.uuid4()
        code = generer_code(boutique_id, date(2027, 3, 31), "pro", secret=self.SECRET)
        self.assertTrue(code.startswith("GS-"))
        self.assertEqual(lire_code(code, cle_publique(self.SECRET)), (boutique_id, date(2027, 3, 31), "pro"))
        # Deux codes pour la même période ne sont jamais identiques (numéro aléatoire).
        self.assertNotEqual(code, generer_code(boutique_id, date(2027, 3, 31), "pro", secret=self.SECRET))
        # Un caractère changé (au milieu : le dernier caractère base32 porte des bits de remplissage) : refusé.
        milieu = len(code) // 2 if code[len(code) // 2] != "-" else len(code) // 2 + 1
        modifie = code[:milieu] + ("A" if code[milieu] != "A" else "B") + code[milieu + 1 :]
        with self.assertRaises(Exception):
            lire_code(modifie, cle_publique(self.SECRET))
        # Sans clé configurée : message clair.
        with self.settings(), self.assertRaises(ErreurActivation):
            import os
            ancienne = os.environ.pop("ACTIVATION_CLE_PRIVEE", None)
            try:
                generer_code(boutique_id, date(2027, 3, 31), "pro")
            finally:
                if ancienne is not None:
                    os.environ["ACTIVATION_CLE_PRIVEE"] = ancienne

    @override_settings(STORAGES={"default": {"BACKEND": "django.core.files.storage.FileSystemStorage"}, "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}})
    def test_page_admin_affiche_le_code_de_la_periode_actuelle(self):
        import base64
        import os
        from datetime import timedelta

        from .activation import cle_publique, lire_code

        boutique, _ = inscrire_boutique(
            {"nom": "Boutique Code"}, {"username": "patronCode", "password": "UnMotDePasseSolide123"}
        )
        boutique.date_expiration_abonnement = timezone.now() + timedelta(days=30)
        boutique.formule = "pro"
        boutique.save()
        admin = Utilisateur.objects.create_superuser("admincode", "admin@exemple.com", "UnMotDePasseSolide123")
        self.client.force_login(admin)

        ancienne = os.environ.get("ACTIVATION_CLE_PRIVEE")
        os.environ["ACTIVATION_CLE_PRIVEE"] = base64.b64encode(self.SECRET).decode()
        try:
            reponse = self.client.get(reverse("admin:comptes_boutique_code_activation", args=[boutique.pk]))
        finally:
            if ancienne is None:
                os.environ.pop("ACTIVATION_CLE_PRIVEE", None)
            else:
                os.environ["ACTIVATION_CLE_PRIVEE"] = ancienne
        self.assertEqual(reponse.status_code, 200)
        code = reponse.context["code"]
        boutique_id, date_fin, formule = lire_code(code, cle_publique(self.SECRET))
        self.assertEqual((boutique_id, formule), (boutique.id, "pro"))
        self.assertEqual(date_fin, timezone.localdate(boutique.date_expiration_abonnement))


class DateDerniereSauvegardeTests(APITestCase):
    """Date de la dernière sauvegarde (docs/plan_reseau_local.md, lot 7) : la date seulement."""

    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique Sauvegarde"}, {"username": "patronSauvegarde", "password": "UnMotDePasseSolide123"}
        )
        self.client.force_authenticate(user=self.patron)

    def test_enregistree_ne_recule_jamais_et_pas_dans_le_futur(self):
        from datetime import timedelta

        url = reverse("boutique-sauvegarde")
        hier = timezone.now() - timedelta(days=1)
        self.assertEqual(self.client.post(url, {"date_derniere_sauvegarde": hier.isoformat()}, format="json").status_code, 200)
        self.boutique.refresh_from_db()
        self.assertEqual(self.boutique.date_derniere_sauvegarde, hier)

        # Plus ancienne : ignorée.
        self.client.post(url, {"date_derniere_sauvegarde": (hier - timedelta(days=5)).isoformat()}, format="json")
        self.boutique.refresh_from_db()
        self.assertEqual(self.boutique.date_derniere_sauvegarde, hier)

        # Dans le futur (horloge en avance) : ramenée à maintenant.
        self.client.post(url, {"date_derniere_sauvegarde": (timezone.now() + timedelta(days=30)).isoformat()}, format="json")
        self.boutique.refresh_from_db()
        self.assertLessEqual(self.boutique.date_derniere_sauvegarde, timezone.now())

    def test_la_synchronisation_ne_peut_pas_l_ecraser(self):
        from synchronisation.registre import resoudre

        self.assertIn("date_derniere_sauvegarde", resoudre("comptes.Boutique").champs_proteges)


class ReseauBoutiqueTests(APITestCase):
    """Réseau de la boutique : désactivé par défaut, activé par l'administrateur à la demande."""

    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique Réseau"}, {"username": "patronReseau", "password": "UnMotDePasseSolide123"}
        )
        self.client.force_authenticate(user=self.patron)

    def test_desactive_par_defaut_demande_unique_puis_acceptee_par_l_admin(self):
        from .models import DemandeReseau

        url = reverse("boutique-reseau")
        etat = self.client.get(url).json()
        self.assertFalse(etat["reseau_autorise"])
        self.assertIsNone(etat["demande_en_attente"])

        self.assertEqual(self.client.post(url, {"note": "2 caisses"}, format="json").status_code, 201)
        self.client.post(url, {}, format="json")  # une seule demande en attente à la fois
        self.assertEqual(self.boutique.demandes_reseau.count(), 1)
        self.assertIsNotNone(self.client.get(url).json()["demande_en_attente"])

        Utilisateur.objects.create_user(username="adminReseau", password="AdminSolide123", is_staff=True)
        reponse = self.client.post(
            reverse("appliquer-abonnement"),
            {"username": "adminReseau", "password": "AdminSolide123", "boutique_id": str(self.boutique.id), "reseau_autorise": True},
            format="json",
        )
        self.assertEqual(reponse.status_code, 200, reponse.content)
        self.assertTrue(reponse.json()["reseau_autorise"])
        self.boutique.refresh_from_db()
        self.assertTrue(self.boutique.reseau_autorise)
        self.assertEqual(self.boutique.demandes_reseau.get().statut, DemandeReseau.Statut.ACCEPTEE)
        self.assertTrue(self.client.get(reverse("moi")).json()["boutique"]["reseau_autorise"])

    def test_la_synchronisation_ne_peut_pas_l_activer(self):
        from synchronisation.registre import resoudre

        self.assertIn("reseau_autorise", resoudre("comptes.Boutique").champs_proteges)



class CleSecoursSauvegardeTests(APITestCase):
    """Clé de secours : RSA-OAEP en Python pur, croisé avec un chiffré produit par Node (appli)."""

    ENV_TEST = "eyJuIjogImRlMDM2OTg3Yzk5ZDE2NDVlMGE0OGUyNzk2NzQ1ZGE1YzhiNGQ3ZWFiMzgyYjU3N2EzYWM5NTM5ZjM0OTQwYjI1ODhhOTg3NDNhOTI2MWJhOGU2MzJkMWJiODYwMDcwMzRkNzY5NGViNGY5YzIxZDZjNjE1M2QyMDgzMTA2NDQyY2NkZjg2N2YyZDZhZmM5ZDI2N2FmZWE2YjZmMGFkM2IzYmFjMTk3NWZlMzQ4ODRlOWFlNWMzNTQ3ZWM5MzFlYmFkNDUyZThlNTZkZDliMzdkMWYzZDRmYWFlYjZiYjE0MzI3YmZlMTgyMTAyZjhmODE0ZjAxMjBkNmYyYTFlNDciLCAiZCI6ICIzOWUzMjllMGZkZjBiNzllMDBiNGU3NWJlYjFlZWM0YzBkYzkxOTgzNThjYWZjMDVmNWU3NGEwMTkyMmRjNzcwYjkyNTZhMWFlNDJhYzZkMDlkY2ZiZTMzM2MxZmNkYjQ0ZWJlNWM5NWZlNmJmNzY2YzhiZjQwZjBmOTNiOGNlODYxYTg1ZmQ0YTk5OTQ2ZTAxZmNjMjAyYjAzNGNiMTBkMzU2OWM3M2I2MGVmYTc4MDkzZmUyZDhkZDA1NTRiZTMxMjc3Y2NkYjBkOTQ0ZGZmZmMwNjcyMGQ4MjI3OGZiYWUzOGQ2NzY2YmIzNTM2MDM5NDRjZDdmYmY2MDQ5NDEifQ=="
    EXEMPLE_NODE = "v1T/Evuk/Z1N8Drspbi5nRrl7cZkLLlLqyb68kVN883eExwe5TOI3bdrteW9ukMafdVftuCIONwwyE24j4vT0fjt4LiUkOvysXTpYa4bk0QWO7fF0RVR3W9eluBi3cduHqt+gK0m8rEvEh0NG6JZuf1kfkO1iW9rpqxZ9/Pnqqw="

    def test_ouvre_un_chiffre_produit_par_l_appli(self):
        from .secours import ouvrir_cle_secours

        boutique_id, cle = ouvrir_cle_secours(self.EXEMPLE_NODE, self.ENV_TEST)
        self.assertEqual(boutique_id, "3f2504e04f8941d30a0c0305e82c3301")
        self.assertEqual(cle, bytes([7]) * 32)

    def test_refuse_une_autre_cle_ou_un_chiffre_abime(self):
        from .secours import ErreurSecours, generer_paire, ouvrir_cle_secours, valeur_variable_environnement

        autre = valeur_variable_environnement(generer_paire(1024))
        with self.assertRaises(ErreurSecours):
            ouvrir_cle_secours(self.EXEMPLE_NODE, autre)
        with self.assertRaises(ErreurSecours):
            ouvrir_cle_secours("pas-du-base64", self.ENV_TEST)

    def test_vue_reservee_aux_administrateurs(self):
        from unittest import mock

        url = reverse("secours-sauvegarde")
        Utilisateur.objects.create_user(username="simpleSecours", password="UnMotDePasseSolide123")
        Utilisateur.objects.create_user(username="adminSecours", password="UnMotDePasseSolide123", is_staff=True)
        with mock.patch.dict("os.environ", {"SECOURS_CLE_PRIVEE": self.ENV_TEST}):
            refuse = self.client.post(
                url, {"username": "simpleSecours", "password": "UnMotDePasseSolide123", "cle_chiffree": self.EXEMPLE_NODE}, format="json"
            )
            self.assertEqual(refuse.status_code, 403)
            reponse = self.client.post(
                url, {"username": "adminSecours", "password": "UnMotDePasseSolide123", "cle_chiffree": self.EXEMPLE_NODE}, format="json"
            )
        self.assertEqual(reponse.status_code, 200, reponse.content)
        import base64

        self.assertEqual(base64.b64decode(reponse.json()["cle"]), bytes([7]) * 32)


class AdminReseauBoutiqueTests(APITestCase):
    """Espace Admin → Réseau de la boutique : état, demandes, refus (identifiants admin)."""

    def test_etat_et_refus_reserves_aux_administrateurs(self):
        boutique, patron = inscrire_boutique(
            {"nom": "Boutique Réseau Admin"}, {"username": "patronReseauAdmin", "password": "UnMotDePasseSolide123"}
        )
        self.client.force_authenticate(user=patron)
        self.client.post(reverse("boutique-reseau"), {"note": "3 caisses"}, format="json")
        self.client.force_authenticate(user=None)
        Utilisateur.objects.create_user(username="adminReseauAdmin", password="AdminSolide123", is_staff=True)
        url = reverse("admin-reseau-boutique")
        corps = {"username": "adminReseauAdmin", "password": "AdminSolide123", "boutique_id": str(boutique.id)}

        self.assertEqual(self.client.post(url, {**corps, "password": "faux"}, format="json").status_code, 403)
        etat = self.client.post(url, corps, format="json").json()
        self.assertFalse(etat["reseau_autorise"])
        self.assertEqual([(d["note"], d["statut"]) for d in etat["demandes"]], [("3 caisses", "en_attente")])

        refuse = self.client.post(url, {**corps, "action": "refuser"}, format="json").json()
        self.assertEqual(refuse["demandes"][0]["statut"], "refusee")


class AdminAbonnementBoutiqueTests(APITestCase):
    """Espace Admin → Gérer abonnement : détail, paiements déclarés validés / rejetés, code d'activation."""

    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique Abonnement Admin"}, {"username": "patronAboAdmin", "password": "UnMotDePasseSolide123"}
        )
        Utilisateur.objects.create_user(username="adminAbo", password="AdminSolide123", is_staff=True)
        self.corps = {"username": "adminAbo", "password": "AdminSolide123", "boutique_id": str(self.boutique.id)}
        self.url = reverse("admin-abonnement-boutique")

    def _declarer(self, reference):
        self.client.force_authenticate(user=self.patron)
        reponse = self.client.post(
            reverse("boutique-abonnement-demandes"),
            {"formule": "essentiel", "duree_mois": 3, "montant": 15000, "mode": "wave", "reference": reference},
            format="json",
        )
        self.client.force_authenticate(user=None)
        self.assertEqual(reponse.status_code, 201, reponse.content)
        return reponse.json()["id"]

    def test_detail_reserve_aux_administrateurs(self):
        self.assertEqual(self.client.post(self.url, {**self.corps, "password": "faux"}, format="json").status_code, 403)
        detail = self.client.post(self.url, self.corps, format="json").json()
        self.assertEqual(detail["boutique"]["nom"], "Boutique Abonnement Admin")
        self.assertIn("historique", detail)
        self.assertIn("tarifs", detail)

    def test_valider_prolonge_et_rejeter_demande_un_motif(self):
        fin_avant = self.boutique.date_expiration_abonnement
        demande = self._declarer("WAVE-1")
        detail = self.client.post(self.url, self.corps, format="json").json()
        self.assertEqual(detail["paiements_en_attente"], 1)
        self.assertEqual(detail["demandes"][0]["id"], demande)

        valide = self.client.post(self.url, {**self.corps, "action": "valider", "demande_id": demande}, format="json").json()
        self.assertEqual(valide["paiements_en_attente"], 0)
        self.boutique.refresh_from_db()
        self.assertIsNotNone(self.boutique.date_expiration_abonnement)
        if fin_avant:
            self.assertGreater(self.boutique.date_expiration_abonnement, fin_avant)

        autre = self._declarer("WAVE-2")
        sans_motif = self.client.post(self.url, {**self.corps, "action": "rejeter", "demande_id": autre}, format="json")
        self.assertEqual(sans_motif.status_code, 400)
        rejete = self.client.post(
            self.url, {**self.corps, "action": "rejeter", "demande_id": autre, "motif": "Référence introuvable"}, format="json"
        ).json()
        self.assertEqual(rejete["demandes"][0]["statut"], "rejetee")


class ReinitialisationEspaceAdminTests(APITestCase):
    """Espace Admin → Réinitialiser mot de passe : tous les comptes, mot de passe provisoire, changement obligatoire."""

    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique Mots de passe"}, {"username": "patronMdp", "password": "UnMotDePasseSolide123"}
        )
        self.vendeur = Utilisateur.objects.create_user(
            username="vendeurMdp", password="AncienSolide123", boutique=self.boutique
        )
        Utilisateur.objects.create_user(username="adminMdp", password="AdminSolide123", is_staff=True)
        self.admin = {"username": "adminMdp", "password": "AdminSolide123"}

    def test_liste_tous_les_comptes_sauf_administrateurs(self):
        comptes = self.client.post(reverse("lister-comptes"), self.admin, format="json").json()
        noms = [c["username"] for c in comptes]
        self.assertIn("patronMdp", noms)
        self.assertIn("vendeurMdp", noms)
        self.assertNotIn("adminMdp", noms)
        self.assertEqual(self.client.post(reverse("lister-comptes"), {**self.admin, "password": "x"}, format="json").status_code, 403)

    def test_provisoire_puis_changement_obligatoire_sans_l_ancien(self):
        reponse = self.client.post(
            reverse("reinitialiser-mot-de-passe-admin"),
            {**self.admin, "username_cible": "vendeurMdp", "nouveau_mot_de_passe": "Provisoire-4827", "doit_changer": True},
            format="json",
        )
        self.assertEqual(reponse.status_code, 200, reponse.content)
        connexion = self.client.post(reverse("connexion"), {"username": "vendeurMdp", "password": "Provisoire-4827"}, format="json")
        self.assertTrue(AccessToken(connexion.json()["access"])["doit_changer_mot_de_passe"])

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {connexion.json()['access']}")
        self.assertEqual(
            self.client.post(reverse("changer-mot-de-passe"), {"nouveau_mot_de_passe": "123"}, format="json").status_code, 400
        )
        self.assertEqual(
            self.client.post(reverse("changer-mot-de-passe"), {"nouveau_mot_de_passe": "MonPropreSecret-2026"}, format="json").status_code,
            200,
        )
        self.vendeur.refresh_from_db()
        self.assertFalse(self.vendeur.doit_changer_mot_de_passe)
        self.assertTrue(self.vendeur.check_password("MonPropreSecret-2026"))
        # Ensuite, l'ancien est redemandé.
        self.assertEqual(
            self.client.post(reverse("changer-mot-de-passe"), {"nouveau_mot_de_passe": "EncoreUnAutre-2027"}, format="json").status_code,
            400,
        )

    def test_jamais_un_compte_administrateur(self):
        reponse = self.client.post(
            reverse("reinitialiser-mot-de-passe-admin"),
            {**self.admin, "username_cible": "adminMdp", "nouveau_mot_de_passe": "Provisoire-4827"},
            format="json",
        )
        self.assertEqual(reponse.status_code, 404)


class CreationBoutiqueAssistantTests(APITestCase):
    """Espace Admin → Créer une boutique : options dès la création, identifiant disponible."""

    def setUp(self):
        Utilisateur.objects.create_user(username="adminCreation", password="AdminSolide123", is_staff=True)
        self.admin = {"username": "adminCreation", "password": "AdminSolide123"}

    def _creer(self, **options):
        import uuid

        corps = {
            **self.admin,
            "boutique_id": str(uuid.uuid4()),
            "boutique_nom": "Boutique Assistant",
            "boutique_telephone": "0700000000",
            "patron_username": options.pop("patron_username", "patronAssistant"),
            "patron_password": "Kalumo-Bitesa-4827",
            "patron_email": "patron@example.com",
            "patron_first_name": "Awa",
            **options,
        }
        return self.client.post(reverse("enregistrer-boutique-locale"), corps, format="json")

    def test_options_choisies_appliquees(self):
        from datetime import timedelta

        fin = timezone.now() + timedelta(days=90)
        reponse = self._creer(
            formule="pro", date_fin=fin.isoformat(), nature="paiement", montant=15000, mode="wave", reference="W-1",
            synchro_autorisee=True, reseau_autorise=True, patron_doit_changer=True,
        )
        self.assertEqual(reponse.status_code, 200, reponse.content)
        boutique = Boutique.objects.get(id=reponse.json()["boutique_id"])
        self.assertEqual(boutique.formule, "pro")
        self.assertTrue(boutique.synchro_autorisee and boutique.reseau_autorise)
        self.assertEqual(boutique.date_expiration_abonnement, fin)
        self.assertEqual(boutique.paiements_abonnement.get().montant, 15000)
        patron = Utilisateur.objects.get(username="patronAssistant")
        self.assertTrue(patron.doit_changer_mot_de_passe)
        self.assertEqual(patron.first_name, "Awa")

    def test_essai_d_une_duree_choisie_et_appli_mobile(self):
        from datetime import timedelta

        fin = timezone.now() + timedelta(days=7)
        reponse = self._creer(formule="pro", date_fin=fin.isoformat(), nature="essai", appli_mobile_autorisee=True)
        self.assertEqual(reponse.status_code, 200, reponse.content)
        boutique = Boutique.objects.get(id=reponse.json()["boutique_id"])
        self.assertEqual(boutique.formule, "pro")
        self.assertEqual(boutique.date_expiration_abonnement, fin)
        self.assertTrue(boutique.appli_mobile_autorisee)
        self.assertEqual(boutique.paiements_abonnement.get().nature, "essai")

    def test_par_defaut_essai_gratuit_100_pourcent_local(self):
        reponse = self._creer(patron_username="patronEssai")
        boutique = Boutique.objects.get(id=reponse.json()["boutique_id"])
        self.assertFalse(boutique.synchro_autorisee or boutique.reseau_autorise)
        self.assertEqual(boutique.paiements_abonnement.get().nature, "essai")

    def test_identifiant_disponible(self):
        self._creer(patron_username="pris")
        url = reverse("identifiant-disponible")
        self.assertFalse(self.client.post(url, {**self.admin, "identifiant": "PRIS"}, format="json").json()["disponible"])
        self.assertTrue(self.client.post(url, {**self.admin, "identifiant": "libre"}, format="json").json()["disponible"])
        self.assertEqual(self.client.post(url, {**self.admin, "password": "x", "identifiant": "libre"}, format="json").status_code, 403)
