from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from catalogue.models import Categorie, Produit, Variante
from clients.models import Client
from comptes.services import inscrire_boutique
from stock.models import Depot, MouvementStock, Stock

from .models import JournalSync


class PushCreationTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronA", "password": "UnMotDePasseSolide123"}
        )
        self.client.force_authenticate(user=self.patron)

    def test_push_creation_simple(self):
        import uuid
        nouvel_id = str(uuid.uuid4())
        reponse = self.client.post(
            reverse("sync-push"),
            {
                "appareil": "poste-caisse-1",
                "changements": [
                    {
                        "table": "catalogue.Categorie",
                        "action": "cree",
                        "enregistrement_id": nouvel_id,
                        "donnees": {"nom": "Boissons"},
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertEqual(reponse.data["resultats"][0]["statut"], "synchronise")

        categorie = Categorie.objects.get(id=nouvel_id)
        self.assertEqual(categorie.nom, "Boissons")
        self.assertEqual(categorie.boutique, self.boutique)
        self.assertTrue(categorie.synchronise)

        journal = JournalSync.objects.get(enregistrement_id=nouvel_id)
        self.assertEqual(journal.statut, "synchronise")


class PushOrdreTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique B"}, {"username": "patronB", "password": "UnMotDePasseSolide123"}
        )
        self.client.force_authenticate(user=self.patron)

    def test_variante_avant_son_produit_dans_le_payload_fonctionne_quand_meme(self):
        import uuid
        produit_id = str(uuid.uuid4())
        variante_id = str(uuid.uuid4())
        reponse = self.client.post(
            reverse("sync-push"),
            {
                "appareil": "poste-1",
                "changements": [
                    {
                        "table": "catalogue.Variante",
                        "action": "cree",
                        "enregistrement_id": variante_id,
                        "donnees": {"produit": produit_id, "prix_vente": "1000", "prix_achat": "700"},
                    },
                    {
                        "table": "catalogue.Produit",
                        "action": "cree",
                        "enregistrement_id": produit_id,
                        "donnees": {"nom": "Eau minérale"},
                    },
                ],
            },
            format="json",
        )
        resultats = {r["table"]: r["statut"] for r in reponse.data["resultats"]}
        self.assertEqual(resultats["catalogue.Produit"], "synchronise")
        self.assertEqual(resultats["catalogue.Variante"], "synchronise")
        self.assertTrue(Variante.objects.filter(id=variante_id, produit_id=produit_id).exists())


class PushConflitTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique C"}, {"username": "patronC", "password": "UnMotDePasseSolide123"}
        )
        self.categorie = Categorie.objects.create(boutique=self.boutique, nom="Ancien nom")
        self.client.force_authenticate(user=self.patron)

    def test_modification_avec_date_plus_ancienne_est_en_conflit(self):
        date_ancienne = (timezone.now() - timezone.timedelta(days=10)).isoformat()
        reponse = self.client.post(
            reverse("sync-push"),
            {
                "changements": [{
                    "table": "catalogue.Categorie",
                    "action": "modifie",
                    "enregistrement_id": str(self.categorie.id),
                    "donnees": {"nom": "Nom en retard", "date_modification": date_ancienne},
                }],
            },
            format="json",
        )
        self.assertEqual(reponse.data["resultats"][0]["statut"], "conflit")
        self.categorie.refresh_from_db()
        self.assertEqual(self.categorie.nom, "Ancien nom")


class PushStockTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique D"}, {"username": "patronD", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        produit = Produit.objects.create(boutique=self.boutique, nom="Riz")
        self.variante = Variante.objects.create(produit=produit, prix_vente=1000)
        self.client.force_authenticate(user=self.patron)

    def test_mouvements_recalculent_le_stock(self):
        import uuid
        reponse = self.client.post(
            reverse("sync-push"),
            {
                "changements": [
                    {
                        "table": "stock.MouvementStock", "action": "cree",
                        "enregistrement_id": str(uuid.uuid4()),
                        "donnees": {
                            "variante": str(self.variante.id), "depot": str(self.depot.id),
                            "type": "entree", "quantite": "20",
                        },
                    },
                    {
                        "table": "stock.MouvementStock", "action": "cree",
                        "enregistrement_id": str(uuid.uuid4()),
                        "donnees": {
                            "variante": str(self.variante.id), "depot": str(self.depot.id),
                            "type": "sortie", "quantite": "6",
                        },
                    },
                ],
            },
            format="json",
        )
        self.assertTrue(all(r["statut"] == "synchronise" for r in reponse.data["resultats"]))
        stock = Stock.objects.get(variante=self.variante, depot=self.depot)
        self.assertEqual(stock.quantite, 14)

    def test_modification_de_mouvement_refusee(self):
        mouvement = MouvementStock.objects.create(
            variante=self.variante, depot=self.depot, type="entree", quantite=5,
        )
        reponse = self.client.post(
            reverse("sync-push"),
            {"changements": [{
                "table": "stock.MouvementStock", "action": "modifie",
                "enregistrement_id": str(mouvement.id), "donnees": {"quantite": "999"},
            }]},
            format="json",
        )
        self.assertEqual(reponse.data["resultats"][0]["statut"], "erreur")


class PushSuppressionTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique E"}, {"username": "patronE", "password": "UnMotDePasseSolide123"}
        )
        self.client_boutique = Client.objects.create(boutique=self.boutique, nom="M. Kader")
        self.client.force_authenticate(user=self.patron)

    def test_suppression_est_un_soft_delete_et_se_propage_au_pull(self):
        reponse = self.client.delete(reverse("client-detail", args=[self.client_boutique.id]))
        self.assertEqual(reponse.status_code, status.HTTP_204_NO_CONTENT)

        self.client_boutique.refresh_from_db()
        self.assertTrue(self.client_boutique.supprime)

        reponse_liste = self.client.get(reverse("client-list"))
        self.assertEqual(len(reponse_liste.data), 0)

        reponse_pull = self.client.get(reverse("sync-pull"), {"depuis": "1970-01-01T00:00:00Z"})
        table_clients = next(t for t in reponse_pull.data["tables"] if t["table"] == "clients.Client")
        self.assertEqual(len(table_clients["enregistrements"]), 1)
        self.assertTrue(table_clients["enregistrements"][0]["supprime"])


class PushIsolationTests(APITestCase):
    def setUp(self):
        self.boutique_a, self.patron_a = inscrire_boutique(
            {"nom": "Boutique F"}, {"username": "patronF", "password": "UnMotDePasseSolide123"}
        )
        self.boutique_b, self.patron_b = inscrire_boutique(
            {"nom": "Boutique G"}, {"username": "patronG", "password": "UnMotDePasseSolide123"}
        )
        self.categorie_b = Categorie.objects.create(boutique=self.boutique_b, nom="Categorie B")
        self.client.force_authenticate(user=self.patron_a)

    def test_modification_enregistrement_existant_autre_boutique_refusee(self):
        # Un utilisateur de la boutique A ne doit pas pouvoir modifier (en
        # devinant son UUID) un enregistrement appartenant à la boutique B.
        reponse = self.client.post(
            reverse("sync-push"),
            {"changements": [{
                "table": "catalogue.Categorie", "action": "modifie",
                "enregistrement_id": str(self.categorie_b.id),
                "donnees": {"nom": "Vole par A"},
            }]},
            format="json",
        )
        self.assertEqual(reponse.data["resultats"][0]["statut"], "erreur")
        self.categorie_b.refresh_from_db()
        self.assertEqual(self.categorie_b.nom, "Categorie B")

    def test_produit_rattache_a_categorie_autre_boutique_refuse(self):
        import uuid
        reponse = self.client.post(
            reverse("sync-push"),
            {"changements": [{
                "table": "catalogue.Produit", "action": "cree",
                "enregistrement_id": str(uuid.uuid4()),
                "donnees": {"nom": "Intrus", "categorie": str(self.categorie_b.id)},
            }]},
            format="json",
        )
        self.assertEqual(reponse.data["resultats"][0]["statut"], "erreur")


class PullTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique H"}, {"username": "patronH", "password": "UnMotDePasseSolide123"}
        )
        self.client.force_authenticate(user=self.patron)

    def test_pull_depuis_absent_renvoie_tout_puis_incremental(self):
        Categorie.objects.create(boutique=self.boutique, nom="Cat 1")

        reponse = self.client.get(reverse("sync-pull"))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        table_cat = next(t for t in reponse.data["tables"] if t["table"] == "catalogue.Categorie")
        self.assertEqual(len(table_cat["enregistrements"]), 1)
        curseur = reponse.data["maintenant"]

        Categorie.objects.create(boutique=self.boutique, nom="Cat 2")
        reponse2 = self.client.get(reverse("sync-pull"), {"depuis": curseur})
        table_cat2 = next(t for t in reponse2.data["tables"] if t["table"] == "catalogue.Categorie")
        self.assertEqual(len(table_cat2["enregistrements"]), 1)
        self.assertEqual(table_cat2["enregistrements"][0]["nom"], "Cat 2")

    def test_ordre_des_tables_respecte_le_registre(self):
        reponse = self.client.get(reverse("sync-pull"))
        noms_tables = [t["table"] for t in reponse.data["tables"]]
        self.assertEqual(noms_tables.index("comptes.Boutique"), 0)
        self.assertLess(noms_tables.index("catalogue.Produit"), noms_tables.index("catalogue.Variante"))
        self.assertLess(noms_tables.index("catalogue.Variante"), noms_tables.index("ventes.Vente"))
        self.assertLess(noms_tables.index("ventes.Vente"), noms_tables.index("ventes.LigneVente"))
