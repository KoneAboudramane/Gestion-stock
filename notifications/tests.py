from django.test import TestCase

from catalogue.models import Produit, Variante
from clients.models import Client, Credit
from comptes.services import inscrire_boutique
from stock.models import Depot, MouvementStock, Stock
from stock.services import appliquer_mouvement
from ventes.models import Vente

from .models import Message, Notification
from .services import generer_alertes_rupture, generer_rappels_credit, generer_ticket_whatsapp


class GenererAlertesRuptureTests(TestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronA", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        produit = Produit.objects.create(boutique=self.boutique, nom="Riz")
        self.variante = Variante.objects.create(produit=produit, seuil_alerte=5)
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 2)

    def test_notification_rattachee_au_depot_du_stock(self):
        notifications = generer_alertes_rupture(self.boutique)
        self.assertEqual(len(notifications), 1)
        self.assertEqual(notifications[0].depot, self.depot)
        self.assertEqual(notifications[0].reference_type, "stock.Stock")

    def test_ne_recree_pas_de_notification_pour_le_meme_stock(self):
        generer_alertes_rupture(self.boutique)
        deuxieme = generer_alertes_rupture(self.boutique)
        self.assertEqual(len(deuxieme), 0)
        self.assertEqual(Notification.objects.count(), 1)


class GenererRappelsCreditTests(TestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronA", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        self.client_boutique = Client.objects.create(boutique=self.boutique, nom="Mme Test", telephone="0700000000")

    def test_rappel_reprend_le_depot_de_la_vente_liee(self):
        vente = Vente.objects.create(
            boutique=self.boutique, depot=self.depot, client=self.client_boutique,
            utilisateur=self.patron, numero="VTE-TEST-0001", total_net=10000, statut=Vente.Statut.CREDIT,
        )
        Credit.objects.create(client=self.client_boutique, vente=vente, montant=10000, solde=10000)

        messages = generer_rappels_credit(self.boutique)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].depot, self.depot)
        self.assertEqual(messages[0].canal, Message.Canal.WHATSAPP)

    def test_rappel_sans_depot_ni_telephone_reste_interne(self):
        client_sans_telephone = Client.objects.create(boutique=self.boutique, nom="M. Sans Tel")
        Credit.objects.create(client=client_sans_telephone, vente=None, montant=5000, solde=5000)

        messages = generer_rappels_credit(self.boutique)
        self.assertEqual(len(messages), 1)
        self.assertIsNone(messages[0].depot)
        self.assertEqual(messages[0].canal, Message.Canal.INTERNE)


class GenererTicketWhatsappTests(TestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronA", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")

    def test_ticket_rattache_au_depot_et_au_caissier_de_la_vente(self):
        vente = Vente.objects.create(
            boutique=self.boutique, depot=self.depot, utilisateur=self.patron,
            numero="VTE-TEST-0002", total_net=5000, statut=Vente.Statut.PAYEE,
        )

        message = generer_ticket_whatsapp(vente)
        self.assertEqual(message.depot, self.depot)
        self.assertEqual(message.utilisateur, self.patron)
        self.assertEqual(message.reference_type, "ventes.Vente")

    def test_ticket_sans_client_reste_interne(self):
        vente = Vente.objects.create(
            boutique=self.boutique, depot=self.depot, utilisateur=self.patron,
            numero="VTE-TEST-0003", total_net=5000, statut=Vente.Statut.PAYEE,
        )

        message = generer_ticket_whatsapp(vente)
        self.assertEqual(message.canal, Message.Canal.INTERNE)
