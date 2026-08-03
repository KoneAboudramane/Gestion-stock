from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from catalogue.models import Produit, Variante
from clients.models import Client, Credit
from comptes.models import Role, Utilisateur
from comptes.services import inscrire_boutique
from stock.models import MouvementStock, Stock
from stock.services import appliquer_mouvement

from .models import Vente


class VenteSimpleTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronA", "password": "UnMotDePasseSolide123"}
        )
        self.depot = self._creer_depot()
        produit = Produit.objects.create(boutique=self.boutique, nom="Savon")
        self.variante = Variante.objects.create(produit=produit, prix_achat=200, prix_vente=350)
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 30)
        self.client.force_authenticate(user=self.patron)

    def _creer_depot(self):
        from stock.models import Depot
        return Depot.objects.create(boutique=self.boutique, nom="Magasin")

    def test_vente_payee_decremente_stock_et_fige_le_cout(self):
        reponse = self.client.post(
            reverse("vente-list"),
            {
                "depot": str(self.depot.id),
                "statut": "payee",
                "lignes_saisie": [{"variante": str(self.variante.id), "quantite": "3"}],
                "paiements_saisie": [{"mode": "especes", "montant": "1050"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        self.assertTrue(reponse.data["numero"].startswith("VTE-"))
        self.assertEqual(reponse.data["total_net"], "1050.00")

        vente = Vente.objects.get(numero=reponse.data["numero"])
        ligne = vente.lignes.first()
        self.assertEqual(ligne.cout_unitaire, 200)

        stock = Stock.objects.get(variante=self.variante, depot=self.depot)
        self.assertEqual(stock.quantite, 27)

    def test_vente_refusee_si_stock_insuffisant(self):
        reponse = self.client.post(
            reverse("vente-list"),
            {
                "depot": str(self.depot.id),
                "statut": "payee",
                "lignes_saisie": [{"variante": str(self.variante.id), "quantite": "999"}],
                "paiements_saisie": [{"mode": "especes", "montant": "349650"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Vente.objects.count(), 0)
        stock = Stock.objects.get(variante=self.variante, depot=self.depot)
        self.assertEqual(stock.quantite, 30)

    def test_vente_refusee_si_paiements_ne_correspondent_pas(self):
        reponse = self.client.post(
            reverse("vente-list"),
            {
                "depot": str(self.depot.id),
                "statut": "payee",
                "lignes_saisie": [{"variante": str(self.variante.id), "quantite": "1"}],
                "paiements_saisie": [{"mode": "especes", "montant": "100"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

    def test_annulation_restaure_le_stock(self):
        reponse = self.client.post(
            reverse("vente-list"),
            {
                "depot": str(self.depot.id),
                "statut": "payee",
                "lignes_saisie": [{"variante": str(self.variante.id), "quantite": "5"}],
                "paiements_saisie": [{"mode": "especes", "montant": "1750"}],
            },
            format="json",
        )
        vente_id = reponse.data["id"]
        stock = Stock.objects.get(variante=self.variante, depot=self.depot)
        self.assertEqual(stock.quantite, 25)

        reponse_annulation = self.client.post(reverse("vente-annuler", args=[vente_id]))
        self.assertEqual(reponse_annulation.status_code, status.HTTP_200_OK, reponse_annulation.data)

        stock.refresh_from_db()
        self.assertEqual(stock.quantite, 30)


class VenteCreditTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique B"}, {"username": "patronB", "password": "UnMotDePasseSolide123"}
        )
        from stock.models import Depot
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        produit = Produit.objects.create(boutique=self.boutique, nom="Riz")
        self.variante = Variante.objects.create(produit=produit, prix_achat=8000, prix_vente=12000)
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 10)
        self.clientBoutique = Client.objects.create(boutique=self.boutique, nom="Mme Koné")
        self.client.force_authenticate(user=self.patron)

    def test_vente_a_credit_partiel_cree_une_creance(self):
        reponse = self.client.post(
            reverse("vente-list"),
            {
                "depot": str(self.depot.id),
                "client": str(self.clientBoutique.id),
                "statut": "credit",
                "lignes_saisie": [{"variante": str(self.variante.id), "quantite": "1"}],
                "paiements_saisie": [
                    {"mode": "especes", "montant": "5000"},
                    {"mode": "credit", "montant": "7000"},
                ],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

        credit = Credit.objects.get(client=self.clientBoutique)
        self.assertEqual(credit.montant, 7000)
        self.assertEqual(credit.solde, 7000)

        vente = Vente.objects.get(id=reponse.data["id"])
        reponse_annulation = self.client.post(reverse("vente-annuler", args=[vente.id]))
        self.assertEqual(reponse_annulation.status_code, status.HTTP_200_OK)
        credit.refresh_from_db()
        self.assertEqual(credit.solde, 0)


class PermissionsVenteTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique C"}, {"username": "patronC", "password": "UnMotDePasseSolide123"}
        )
        from stock.models import Depot
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        produit = Produit.objects.create(boutique=self.boutique, nom="Sucre")
        self.variante = Variante.objects.create(produit=produit, prix_achat=300, prix_vente=500)
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 20)

        self.caissier = Utilisateur(
            boutique=self.boutique,
            role=Role.objects.get(boutique=self.boutique, nom="Caissier"),
            username="caissierC",
        )
        self.caissier.set_password("UnMotDePasseSolide123")
        self.caissier.save()

    def test_caissier_peut_vendre_mais_pas_annuler_et_ne_voit_pas_le_cout(self):
        self.client.force_authenticate(user=self.caissier)
        reponse = self.client.post(
            reverse("vente-list"),
            {
                "depot": str(self.depot.id),
                "statut": "payee",
                "lignes_saisie": [{"variante": str(self.variante.id), "quantite": "2"}],
                "paiements_saisie": [{"mode": "especes", "montant": "1000"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        self.assertNotIn("cout_unitaire", reponse.data["lignes"][0])

        reponse_annulation = self.client.post(reverse("vente-annuler", args=[reponse.data["id"]]))
        self.assertEqual(reponse_annulation.status_code, status.HTTP_403_FORBIDDEN)
