"""Registre des abonnements, suivi admin et signalements de la synchro (plan abonnement, lot 2)."""

import uuid
from datetime import timedelta
from decimal import Decimal

from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from stock.models import Depot

from .models import Boutique, PaiementAbonnement, ReglagesPlateforme, Role, SignalementAbonnement, Utilisateur
from .services import enregistrer_periode_abonnement, inscrire_boutique


# Les écrans d'admin rendus ici chargent leurs CSS : sans « collectstatic », le
# stockage à manifeste de la production échouerait.
STOCKAGES_TEST = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


@override_settings(STORAGES=STOCKAGES_TEST)
class RegistreAbonnementTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronA", "password": "UnMotDePasseSolide123"}
        )
        self.admin = Utilisateur.objects.create_user(
            username="adminStaff", password="UnMotDePasseSolide123", is_staff=True, is_superuser=True
        )

    def test_un_paiement_repart_de_la_fin_en_cours_et_met_a_jour_la_boutique(self):
        fin_actuelle = timezone.now() + timedelta(days=10)
        self.boutique.date_expiration_abonnement = fin_actuelle
        self.boutique.save()
        nouvelle_fin = fin_actuelle + timedelta(days=30)
        periode = enregistrer_periode_abonnement(
            self.boutique, nouvelle_fin, "pro", nature="paiement", montant=Decimal("15000"), mode="wave", reference="W1"
        )
        self.assertEqual(periode.date_debut, fin_actuelle)
        self.boutique.refresh_from_db()
        self.assertEqual(self.boutique.date_expiration_abonnement, nouvelle_fin)
        self.assertEqual(self.boutique.formule, "pro")

    def test_un_ajustement_part_d_aujourd_hui(self):
        self.boutique.date_expiration_abonnement = timezone.now() + timedelta(days=10)
        self.boutique.save()
        avant = timezone.now()
        periode = enregistrer_periode_abonnement(self.boutique, None, "essentiel", nature="ajustement")
        self.assertGreaterEqual(periode.date_debut, avant)
        self.boutique.refresh_from_db()
        self.assertIsNone(self.boutique.date_expiration_abonnement)

    def test_renouvellement_admin_inscrit_le_paiement(self):
        self.client.force_login(self.admin)
        fin = (timezone.now() + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M")
        reponse = self.client.post(
            reverse("admin:comptes_boutique_renouveler", args=[self.boutique.pk]),
            {
                "date_expiration_abonnement": fin, "formule": "essentiel", "nature": "paiement",
                "montant": "5000", "mode": "orange_money", "reference": "OM-123", "note": "",
            },
        )
        self.assertEqual(reponse.status_code, 302)
        paiement = PaiementAbonnement.objects.get(boutique=self.boutique)
        self.assertEqual(paiement.montant, Decimal("5000"))
        self.assertEqual(paiement.reference, "OM-123")
        self.assertEqual(paiement.enregistre_par, self.admin)

    def test_renouvellement_admin_exige_le_montant_d_un_paiement(self):
        self.client.force_login(self.admin)
        fin = (timezone.now() + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M")
        reponse = self.client.post(
            reverse("admin:comptes_boutique_renouveler", args=[self.boutique.pk]),
            {"date_expiration_abonnement": fin, "formule": "essentiel", "nature": "paiement", "montant": ""},
        )
        self.assertEqual(reponse.status_code, 200)
        self.assertFalse(PaiementAbonnement.objects.exists())

    def test_espace_admin_de_l_appli_inscrit_la_periode_sans_doublon_au_rejeu(self):
        fin = (timezone.now() + timedelta(days=30)).isoformat()
        corps = {
            "username": "adminStaff", "password": "UnMotDePasseSolide123", "boutique_id": str(self.boutique.pk),
            "formule": "essentiel", "date_expiration_abonnement": fin, "montant": "5000", "mode": "wave",
        }
        self.assertEqual(self.client.post(reverse("appliquer-abonnement"), corps, format="json").status_code, 200)
        # Rejeu d'une modification en attente sans paiement : rien de nouveau au registre.
        corps.pop("montant")
        self.client.post(reverse("appliquer-abonnement"), corps, format="json")
        self.assertEqual(PaiementAbonnement.objects.filter(boutique=self.boutique).count(), 1)
        self.assertEqual(PaiementAbonnement.objects.get().nature, "paiement")

    def test_le_commercant_voit_son_historique_et_ou_payer(self):
        enregistrer_periode_abonnement(self.boutique, timezone.now() + timedelta(days=30), "essentiel", nature="essai")
        reglages = ReglagesPlateforme.obtenir()
        reglages.numero_wave = "0700000000"
        reglages.whatsapp = "2250700000000"
        reglages.save()
        self.client.force_authenticate(user=self.patron)
        reponse = self.client.get(reverse("boutique-abonnement"))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertEqual(reponse.data["historique"][0]["nature_libelle"], "Essai gratuit")
        self.assertEqual(reponse.data["renouvellement"]["numeros"], [{"operateur": "Wave", "numero": "0700000000"}])

    def test_historique_reserve_au_responsable(self):
        caissier = Utilisateur(
            boutique=self.boutique, role=Role.objects.get(boutique=self.boutique, nom="Caissier"), username="caissierA"
        )
        caissier.set_password("UnMotDePasseSolide123")
        caissier.save()
        self.client.force_authenticate(user=caissier)
        self.assertEqual(self.client.get(reverse("boutique-abonnement")).status_code, status.HTTP_403_FORBIDDEN)


class SignalementSynchroTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique S"}, {"username": "patronS", "password": "UnMotDePasseSolide123"}
        )
        self.boutique.synchro_autorisee = True
        self.boutique.date_expiration_abonnement = timezone.now() - timedelta(days=10)
        self.boutique.save()
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        self.client.force_authenticate(user=self.patron)

    def pousser(self, table, donnees):
        enregistrement_id = str(uuid.uuid4())
        reponse = self.client.post(
            reverse("sync-push"),
            {"appareil": "poste-1", "changements": [
                {"table": table, "action": "cree", "enregistrement_id": enregistrement_id, "donnees": donnees}
            ]},
            format="json",
        )
        self.assertEqual(reponse.status_code, 200, reponse.data)
        return reponse.data, enregistrement_id

    def vente(self, date_creation):
        return {
            "depot": str(self.depot.pk), "numero": "VTE-TEST-0001", "statut": "payee",
            "date_creation": date_creation.isoformat(), "date_modification": timezone.now().isoformat(),
        }

    def test_vente_apres_le_delai_de_grace_acceptee_mais_signalee(self):
        resultats, vente_id = self.pousser("ventes.Vente", self.vente(timezone.now()))
        self.assertEqual(resultats["resultats"][0]["statut"], "synchronise")
        signalement = SignalementAbonnement.objects.get(boutique=self.boutique)
        self.assertEqual(signalement.type, "vente_hors_abonnement")
        self.assertEqual(str(signalement.enregistrement_id), vente_id)

    def test_vente_faite_pendant_l_abonnement_mais_recue_plus_tard_non_signalee(self):
        self.pousser("ventes.Vente", self.vente(timezone.now() - timedelta(days=11)))
        self.assertFalse(SignalementAbonnement.objects.exists())

    def test_second_depot_en_formule_essentiel_signale(self):
        donnees = {"nom": "Entrepôt", "date_modification": timezone.now().isoformat()}
        resultats, _ = self.pousser("stock.Depot", donnees)
        self.assertEqual(resultats["resultats"][0]["statut"], "synchronise")
        self.assertEqual(SignalementAbonnement.objects.get().type, "depot_hors_formule")

    def test_pas_de_signalement_en_formule_pro(self):
        self.boutique.formule = Boutique.Formule.PRO
        self.boutique.save()
        self.pousser("stock.Depot", {"nom": "Entrepôt", "date_modification": timezone.now().isoformat()})
        self.assertFalse(SignalementAbonnement.objects.exists())


@override_settings(STORAGES=STOCKAGES_TEST, ADMIN_EMAIL="admin@exemple.com")
class DemandeRenouvellementTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique D"}, {"username": "patronD", "password": "UnMotDePasseSolide123"}
        )
        self.fin = timezone.now() + timedelta(days=5)
        self.boutique.date_expiration_abonnement = self.fin
        self.boutique.save()
        self.client.force_authenticate(user=self.patron)

    def declarer(self, reference="MP241003.1234", **champs):
        return self.client.post(
            reverse("boutique-abonnement-demandes"),
            {"formule": "essentiel", "duree_mois": 3, "montant": "15000", "mode": "wave", "reference": reference, **champs},
            format="json",
        )

    def test_ajouter_mois_gere_les_fins_de_mois(self):
        from datetime import datetime
        from .services import ajouter_mois

        self.assertEqual(ajouter_mois(datetime(2027, 1, 31), 1), datetime(2027, 2, 28))
        self.assertEqual(ajouter_mois(datetime(2026, 11, 15), 3), datetime(2027, 2, 15))
        self.assertEqual(ajouter_mois(datetime(2026, 10, 3), 12), datetime(2027, 10, 3))

    def test_declaration_puis_validation_prolonge_depuis_la_fin_en_cours(self):
        from django.core import mail
        from .models import DemandeRenouvellement
        from .services import ajouter_mois, valider_demande_renouvellement

        reponse = self.declarer()
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("MP241003.1234", mail.outbox[0].body)

        demande = DemandeRenouvellement.objects.get()
        valider_demande_renouvellement(demande)
        self.boutique.refresh_from_db()
        self.assertEqual(self.boutique.date_expiration_abonnement, ajouter_mois(self.fin, 3))
        demande.refresh_from_db()
        self.assertEqual(demande.statut, "validee")
        self.assertEqual(demande.paiement.montant, Decimal("15000"))
        with self.assertRaises(Exception):
            valider_demande_renouvellement(demande)

    def test_une_meme_reference_ne_paie_qu_une_fois(self):
        from .models import DemandeRenouvellement
        from .services import rejeter_demande_renouvellement

        self.assertEqual(self.declarer().status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.declarer().status_code, status.HTTP_400_BAD_REQUEST)
        # Rejetée (ex. faute de frappe) : la référence peut être redéclarée.
        rejeter_demande_renouvellement(DemandeRenouvellement.objects.get(), "Introuvable")
        self.assertEqual(self.declarer().status_code, status.HTTP_201_CREATED)

    def test_le_commercant_voit_ses_demandes_et_le_motif_de_rejet(self):
        from .models import DemandeRenouvellement
        from .services import rejeter_demande_renouvellement

        self.declarer()
        rejeter_demande_renouvellement(DemandeRenouvellement.objects.get(), "Montant incomplet")
        demandes = self.client.get(reverse("boutique-abonnement")).data["demandes"]
        self.assertEqual(demandes[0]["statut_libelle"], "Rejetée")
        self.assertEqual(demandes[0]["motif_rejet"], "Montant incomplet")

    def test_declaration_reservee_au_responsable(self):
        caissier = Utilisateur(
            boutique=self.boutique, role=Role.objects.get(boutique=self.boutique, nom="Caissier"), username="caissierD"
        )
        caissier.set_password("UnMotDePasseSolide123")
        caissier.save()
        self.client.force_authenticate(user=caissier)
        self.assertEqual(self.declarer().status_code, status.HTTP_403_FORBIDDEN)

    def test_validation_depuis_l_admin(self):
        from .models import DemandeRenouvellement

        self.declarer()
        demande = DemandeRenouvellement.objects.get()
        admin = Utilisateur.objects.create_user(
            username="adminD", password="UnMotDePasseSolide123", is_staff=True, is_superuser=True
        )
        self.client.force_login(admin)
        url = reverse("admin:comptes_demanderenouvellement_valider", args=[demande.pk])
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.client.post(url).status_code, 302)
        demande.refresh_from_db()
        self.assertEqual(demande.statut, "validee")
        self.assertEqual(demande.traitee_par, admin)
        self.assertEqual(self.client.get(reverse("admin:comptes_demanderenouvellement_changelist")).status_code, 200)


@override_settings(STORAGES=STOCKAGES_TEST)
class EssaiTarifsEtFormuleTests(APITestCase):
    def setUp(self):
        self.admin = Utilisateur.objects.create_user(
            username="adminE", password="UnMotDePasseSolide123", is_staff=True, is_superuser=True
        )

    def verifier_essai(self, boutique):
        boutique.refresh_from_db()
        jours = (boutique.date_expiration_abonnement - timezone.now()).days
        self.assertIn(jours, (14, 15))
        self.assertEqual(PaiementAbonnement.objects.get(boutique=boutique).nature, "essai")

    def test_essai_de_15_jours_pour_une_boutique_creee_depuis_l_appli(self):
        boutique_id = uuid.uuid4()
        reponse = self.client.post(reverse("enregistrer-boutique-locale"), {
            "username": "adminE", "password": "UnMotDePasseSolide123", "boutique_id": str(boutique_id),
            "boutique_nom": "Boutique Appli", "patron_username": "patronAppli",
            "patron_password": "UnMotDePasseSolide123", "patron_email": "patron@exemple.com",
        }, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.verifier_essai(Boutique.objects.get(id=boutique_id))

    def test_essai_de_15_jours_pour_une_boutique_creee_dans_l_admin(self):
        self.client.force_login(self.admin)
        reponse = self.client.post(reverse("admin:comptes_boutique_creer"), {
            "boutique_nom": "Boutique Admin", "boutique_adresse": "", "boutique_telephone": "", "boutique_devise": "FCFA",
            "username": "patronAdmin", "password": "UnMotDePasseSolide123", "email": "p@exemple.com", "telephone": "",
        })
        self.assertEqual(reponse.status_code, 302)
        self.verifier_essai(Boutique.objects.get(nom="Boutique Admin"))

    def test_grille_des_tarifs_avec_remises(self):
        from .services import grille_tarifs

        self.assertEqual(grille_tarifs(), [])
        reglages = ReglagesPlateforme.obtenir()
        reglages.prix_mensuel_essentiel = Decimal("5000")
        reglages.remise_3_mois = Decimal("10")
        reglages.remise_12_mois = Decimal("20")
        reglages.save()
        prix = {(t["formule"], t["duree_mois"]): t["prix"] for t in grille_tarifs()}
        self.assertEqual(prix[("essentiel", 1)], Decimal("5000"))
        self.assertEqual(prix[("essentiel", 3)], Decimal("13500"))
        self.assertEqual(prix[("essentiel", 6)], Decimal("30000"))
        self.assertEqual(prix[("essentiel", 12)], Decimal("48000"))
        self.assertNotIn(("pro", 1), prix)

    def test_essentiel_refuse_de_reactiver_un_compte_au_dela_de_2(self):
        boutique, patron = inscrire_boutique(
            {"nom": "Boutique F", "formule": Boutique.Formule.PRO},
            {"username": "patronF", "password": "UnMotDePasseSolide123"},
        )
        role = Role.objects.get(boutique=boutique, nom="Caissier")
        comptes = []
        for nom in ("c1", "c2"):
            u = Utilisateur(boutique=boutique, role=role, username=f"{nom}F")
            u.set_password("UnMotDePasseSolide123")
            u.save()
            comptes.append(u)
        # Passage à Essentiel : 3 comptes actifs ; le Patron en met un en pause, puis ne peut pas le réactiver.
        boutique.formule = Boutique.Formule.ESSENTIEL
        boutique.save()
        self.client.force_authenticate(user=patron)
        url = reverse("utilisateur-detail", args=[comptes[1].id])
        self.assertEqual(self.client.patch(url, {"is_active": False}, format="json").status_code, 200)
        reponse = self.client.patch(url, {"is_active": True}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("2 comptes actifs", str(reponse.data))
