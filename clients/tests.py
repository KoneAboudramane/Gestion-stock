from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from catalogue.models import Produit, Variante
from comptes.models import Role, Utilisateur
from comptes.services import inscrire_boutique
from stock.models import Depot, MouvementStock
from stock.services import appliquer_mouvement
from ventes.services import creer_vente

from .models import Client, Credit


class ClientTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronA", "password": "UnMotDePasseSolide123"}
        )
        self.autre_boutique, self.autre_patron = inscrire_boutique(
            {"nom": "Boutique B"}, {"username": "patronB", "password": "UnMotDePasseSolide123"}
        )
        self.client.force_authenticate(user=self.patron)

    def test_creation_et_isolation_client(self):
        reponse = self.client.post(reverse("client-list"), {"nom": "Mme Diallo"}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

        Client.objects.create(boutique=self.autre_boutique, nom="M. Traoré")
        reponse_liste = self.client.get(reverse("client-list"))
        noms = {c["nom"] for c in reponse_liste.data}
        self.assertIn("Mme Diallo", noms)
        self.assertNotIn("M. Traoré", noms)


class CreditTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique C"}, {"username": "patronC", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        produit = Produit.objects.create(boutique=self.boutique, nom="Riz")
        self.variante = Variante.objects.create(produit=produit, prix_achat=8000, prix_vente=12000)
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 10)
        self.client_boutique = Client.objects.create(boutique=self.boutique, nom="Mme Koné")

        self.vente = creer_vente(
            boutique=self.boutique, depot=self.depot, utilisateur=self.patron,
            client=self.client_boutique, statut="credit",
            lignes_donnees=[{"variante": self.variante, "quantite": 1}],
            paiements_donnees=[{"mode": "credit", "montant": 12000}],
        )
        self.credit = Credit.objects.get(vente=self.vente)
        self.client.force_authenticate(user=self.patron)

    def test_credit_liste_et_echeance_modifiable(self):
        reponse = self.client.get(reverse("credit-list"))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        self.assertEqual(len(reponse.data), 1)
        self.assertEqual(reponse.data[0]["solde"], "12000.00")

        reponse_patch = self.client.patch(
            reverse("credit-detail", args=[self.credit.id]),
            {"echeance": "2026-08-30", "montant": "999999"},  # montant doit être ignoré (read_only)
            format="json",
        )
        self.assertEqual(reponse_patch.status_code, status.HTTP_200_OK, reponse_patch.data)
        self.credit.refresh_from_db()
        self.assertEqual(str(self.credit.echeance), "2026-08-30")
        self.assertEqual(self.credit.montant, 12000)  # inchangé

    def test_remboursement_partiel_puis_total(self):
        reponse = self.client.post(
            reverse("credit-rembourser", args=[self.credit.id]),
            {"montant": "5000", "mode": "especes"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertEqual(len(reponse.data["paiements"]), 1)
        self.assertEqual(reponse.data["paiements"][0]["montant"], "5000.00")
        self.credit.refresh_from_db()
        self.assertEqual(self.credit.solde, 7000)
        self.assertEqual(self.credit.statut, "en_cours")
        self.assertEqual(self.credit.paiements.count(), 1)

        reponse = self.client.post(
            reverse("credit-rembourser", args=[self.credit.id]),
            {"montant": "7000"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        self.credit.refresh_from_db()
        self.assertEqual(self.credit.solde, 0)
        self.assertEqual(self.credit.statut, "solde")

    def test_remboursement_superieur_au_solde_refuse(self):
        reponse = self.client.post(
            reverse("credit-rembourser", args=[self.credit.id]),
            {"montant": "99999"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)


class PermissionsClientsTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique D"}, {"username": "patronD", "password": "UnMotDePasseSolide123"}
        )
        # Les 3 rôles par défaut ont tous gerer_clients=True : on crée un rôle
        # restreint pour vérifier que la permission est bien exercée.
        self.role_restreint = Role.objects.create(
            boutique=self.boutique, nom="Sans clients", permissions={"gerer_clients": False},
        )
        self.utilisateur_restreint = Utilisateur(
            boutique=self.boutique, role=self.role_restreint, username="restreintD",
        )
        self.utilisateur_restreint.set_password("UnMotDePasseSolide123")
        self.utilisateur_restreint.save()

    def test_role_sans_gerer_clients_refuse(self):
        self.client.force_authenticate(user=self.utilisateur_restreint)
        reponse = self.client.get(reverse("client-list"))
        self.assertEqual(reponse.status_code, status.HTTP_403_FORBIDDEN)
