from datetime import timedelta
from decimal import Decimal

from django.test import override_settings
from django.urls import reverse
from django.utils import timezone

from comptes.models import DemandeRenouvellement, DemandeReseau, PaiementAbonnement, SignalementAbonnement, Utilisateur

from .models import JournalAdmin, ProfilAdmin
from .tests_boutiques import MDP, BaseAdmin


@override_settings(ADMIN_EMAIL="")
class PaiementsTests(BaseAdmin):
    def declarer(self, reference="TX123"):
        return DemandeRenouvellement.objects.create(
            boutique=self.boutique, formule="essentiel", duree_mois=3, montant=Decimal("15000"), mode="wave", reference=reference
        )

    def test_valider_un_paiement_declare_prolonge_depuis_la_fin_en_cours(self):
        fin_avant = self.boutique.date_expiration_abonnement
        d = self.declarer()
        self.connecter()
        self.assertEqual(len(self.client.get(reverse("admin-paiements-declares")).data), 1)
        r = self.client.post(reverse("admin-traiter-paiement", args=[d.id]), {"action": "valider"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["statut"], "validee")
        self.boutique.refresh_from_db()
        self.assertGreater(self.boutique.date_expiration_abonnement, fin_avant + timedelta(days=85))
        self.assertTrue(JournalAdmin.objects.filter(action="paiement_valide", boutique=self.boutique).exists())
        # Une seule fois.
        r2 = self.client.post(reverse("admin-traiter-paiement", args=[d.id]), {"action": "valider"}, format="json")
        self.assertEqual(r2.status_code, 400)

    def test_rejet_exige_un_motif(self):
        d = self.declarer()
        self.connecter()
        url = reverse("admin-traiter-paiement", args=[d.id])
        self.assertEqual(self.client.post(url, {"action": "rejeter"}, format="json").status_code, 400)
        r = self.client.post(url, {"action": "rejeter", "motif": "Transaction introuvable"}, format="json")
        self.assertEqual(r.data["statut"], "rejetee")
        self.assertEqual(r.data["motif_rejet"], "Transaction introuvable")

    def test_enregistrer_un_paiement_en_especes_puis_registre(self):
        self.connecter()
        r = self.client.post(
            reverse("admin-enregistrer-periode"),
            {"boutique_id": str(self.boutique.id), "nature": "paiement", "formule": "pro", "duree_mois": 1,
             "montant": "8000", "mode": "especes", "reference": "RECU-01"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["formule"], "pro")
        registre = self.client.get(reverse("admin-registre"), {"nature": "paiement"}).data
        self.assertEqual(registre["total_encaisse"], Decimal("8000"))
        self.assertEqual(registre["par_mode"][0]["mode_libelle"], "Espèces")
        # Même référence : refusée.
        r2 = self.client.post(
            reverse("admin-enregistrer-periode"),
            {"boutique_id": str(self.boutique.id), "nature": "paiement", "formule": "pro", "duree_mois": 1,
             "montant": "8000", "mode": "especes", "reference": "recu-01"},
            format="json",
        )
        self.assertEqual(r2.status_code, 400)
        self.assertIn("reference", r2.data)

    def test_paiement_sans_montant_refuse_et_offert_sans_montant_accepte(self):
        self.connecter()
        base = {"boutique_id": str(self.boutique.id), "formule": "essentiel", "duree_mois": 1}
        self.assertEqual(
            self.client.post(reverse("admin-enregistrer-periode"), {**base, "nature": "paiement"}, format="json").status_code, 400
        )
        r = self.client.post(reverse("admin-enregistrer-periode"), {**base, "nature": "offert", "montant": "5000"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(PaiementAbonnement.objects.filter(nature="offert").get().montant, 0)

    def test_ajustement_avec_date_de_fin(self):
        self.connecter()
        fin = (timezone.localdate() + timedelta(days=40)).isoformat()
        r = self.client.post(
            reverse("admin-enregistrer-periode"),
            {"boutique_id": str(self.boutique.id), "nature": "ajustement", "formule": "essentiel", "date_fin": fin},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.boutique.refresh_from_db()
        self.assertEqual(timezone.localdate(self.boutique.date_expiration_abonnement).isoformat(), fin)

    def test_sans_le_droit_paiements(self):
        limite = Utilisateur.objects.create_user(username="limite", password=MDP, is_staff=True)
        ProfilAdmin.objects.create(utilisateur=limite, droits=["comptes"])
        self.connecter(limite)
        self.assertEqual(self.client.get(reverse("admin-registre")).status_code, 403)
        self.assertEqual(self.client.get(reverse("admin-paiements-declares")).status_code, 403)


@override_settings(ADMIN_EMAIL="")
class ReseauSignalementsComptesTests(BaseAdmin):
    def test_accepter_une_demande_active_le_reseau(self):
        d = DemandeReseau.objects.create(boutique=self.boutique, demandeur=self.patron)
        self.connecter()
        r = self.client.post(reverse("admin-traiter-demande-reseau", args=[d.id]), {"action": "accepter"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["statut"], "acceptee")
        self.boutique.refresh_from_db()
        self.assertTrue(self.boutique.reseau_autorise)

    def test_refuser_une_demande(self):
        d = DemandeReseau.objects.create(boutique=self.boutique)
        self.connecter()
        r = self.client.post(reverse("admin-traiter-demande-reseau", args=[d.id]), {"action": "refuser"}, format="json")
        self.assertEqual(r.data["statut"], "refusee")
        self.boutique.refresh_from_db()
        self.assertFalse(self.boutique.reseau_autorise)

    def test_signalement_marque_traite(self):
        import uuid

        s = SignalementAbonnement.objects.create(
            boutique=self.boutique, type="vente_hors_abonnement", table="ventes.Vente", enregistrement_id=uuid.uuid4()
        )
        self.connecter()
        self.assertEqual(len(self.client.get(reverse("admin-signalements")).data), 1)
        self.client.post(reverse("admin-traiter-signalement", args=[s.id]), {"traite": True}, format="json")
        self.assertEqual(self.client.get(reverse("admin-signalements")).data, [])
        self.assertEqual(len(self.client.get(reverse("admin-signalements"), {"traites": "1"}).data), 1)

    def test_comptes_sans_les_administrateurs_et_reinitialisation(self):
        self.connecter()
        comptes = self.client.get(reverse("admin-comptes")).data
        self.assertEqual([c["username"] for c in comptes], ["kone"])
        url = reverse("admin-reinitialiser-mot-de-passe", args=[self.patron.pk])
        self.assertEqual(self.client.post(url, {"nouveau_mot_de_passe": "123"}, format="json").status_code, 400)
        r = self.client.post(url, {"nouveau_mot_de_passe": "Provisoire-482", "doit_changer": True}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.patron.refresh_from_db()
        self.assertTrue(self.patron.check_password("Provisoire-482"))
        self.assertTrue(self.patron.doit_changer_mot_de_passe)
        # Un administrateur ne se réinitialise pas par ici.
        url_admin = reverse("admin-reinitialiser-mot-de-passe", args=[self.admin.pk])
        self.assertEqual(self.client.post(url_admin, {"nouveau_mot_de_passe": "Provisoire-482"}, format="json").status_code, 404)
