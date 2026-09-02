from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from catalogue.models import Produit, Variante
from comptes.models import Boutique, Role, Utilisateur
from comptes.services import inscrire_boutique

from .models import Depot, MouvementStock, Stock
from .services import appliquer_mouvement, demarrer_inventaire, transferer_stock, valider_inventaire


class FormuleDepotsTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique Formule"}, {"username": "patronFormule", "password": "UnMotDePasseSolide123"}
        )
        Depot.objects.create(boutique=self.boutique, nom="Magasin principal")
        self.client.force_authenticate(user=self.patron)

    def test_formule_essentiel_limite_a_un_depot(self):
        reponse = self.client.post(reverse("depot-list"), {"nom": "Deuxième dépôt"}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST, reponse.data)

    def test_formule_pro_autorise_plusieurs_depots(self):
        self.boutique.formule = Boutique.Formule.PRO
        self.boutique.save(update_fields=["formule"])
        reponse = self.client.post(reverse("depot-list"), {"nom": "Deuxième dépôt"}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)


class MouvementsTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronA", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin principal")
        produit = Produit.objects.create(boutique=self.boutique, nom="Riz")
        self.variante = Variante.objects.create(produit=produit, prix_achat=100, prix_vente=150, seuil_alerte=5)
        self.client.force_authenticate(user=self.patron)

    def test_entree_puis_sortie_mettent_a_jour_le_stock(self):
        reponse = self.client.post(
            reverse("mouvement-list"),
            {"variante": str(self.variante.id), "depot": str(self.depot.id), "type": "entree", "quantite": "20"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        stock = Stock.objects.get(variante=self.variante, depot=self.depot)
        self.assertEqual(stock.quantite, 20)

        reponse = self.client.post(
            reverse("mouvement-list"),
            {"variante": str(self.variante.id), "depot": str(self.depot.id), "type": "sortie", "quantite": "8"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        stock.refresh_from_db()
        self.assertEqual(stock.quantite, 12)

    def test_sortie_superieure_au_stock_refusee(self):
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 5)
        reponse = self.client.post(
            reverse("mouvement-list"),
            {"variante": str(self.variante.id), "depot": str(self.depot.id), "type": "sortie", "quantite": "10"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        stock = Stock.objects.get(variante=self.variante, depot=self.depot)
        self.assertEqual(stock.quantite, 5)

    def test_ruptures(self):
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 3)  # <= seuil 5 -> rupture
        produit2 = Produit.objects.create(boutique=self.boutique, nom="Sucre")
        variante2 = Variante.objects.create(produit=produit2, prix_vente=100, seuil_alerte=5)
        appliquer_mouvement(variante2, self.depot, MouvementStock.Type.ENTREE, 50)  # > seuil -> pas de rupture

        reponse = self.client.get(reverse("stock-ruptures"))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        variantes_en_rupture = {str(ligne["variante"]) for ligne in reponse.data}
        self.assertIn(str(self.variante.id), variantes_en_rupture)
        self.assertNotIn(str(variante2.id), variantes_en_rupture)


class TransfertTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique B"}, {"username": "patronB", "password": "UnMotDePasseSolide123"}
        )
        self.depot_source = Depot.objects.create(boutique=self.boutique, nom="Entrepot")
        self.depot_dest = Depot.objects.create(boutique=self.boutique, nom="Boutique")
        produit = Produit.objects.create(boutique=self.boutique, nom="Huile")
        self.variante = Variante.objects.create(produit=produit, prix_vente=100)
        appliquer_mouvement(self.variante, self.depot_source, MouvementStock.Type.ENTREE, 30)
        self.client.force_authenticate(user=self.patron)

    def test_transfert_decremente_source_et_incremente_destination(self):
        reponse = self.client.post(
            reverse("transfert-list"),
            {
                "variante": str(self.variante.id),
                "depot_source": str(self.depot_source.id),
                "depot_destination": str(self.depot_dest.id),
                "quantite": "10",
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

        stock_source = Stock.objects.get(variante=self.variante, depot=self.depot_source)
        stock_dest = Stock.objects.get(variante=self.variante, depot=self.depot_dest)
        self.assertEqual(stock_source.quantite, 20)
        self.assertEqual(stock_dest.quantite, 10)
        self.assertEqual(MouvementStock.objects.filter(reference_type="stock.TransfertStock").count(), 2)


class InventaireTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique C"}, {"username": "patronC", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        produit = Produit.objects.create(boutique=self.boutique, nom="Savon")
        self.variante = Variante.objects.create(produit=produit, prix_vente=100)
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 50)
        self.client.force_authenticate(user=self.patron)

    def test_workflow_inventaire_complet(self):
        inventaire = demarrer_inventaire(self.boutique, self.depot, utilisateur=self.patron)
        ligne = inventaire.lignes.get(variante=self.variante)
        self.assertEqual(ligne.qte_theorique, 50)

        reponse = self.client.patch(
            reverse("ligneinventaire-detail", args=[ligne.id]),
            {"qte_physique": "47"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        ligne.refresh_from_db()
        self.assertEqual(ligne.ecart, -3)

        reponse = self.client.post(reverse("inventaire-valider", args=[inventaire.id]))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)

        stock = Stock.objects.get(variante=self.variante, depot=self.depot)
        self.assertEqual(stock.quantite, 47)

        # Une fois validé, plus aucune modification de ligne n'est permise.
        reponse = self.client.patch(
            reverse("ligneinventaire-detail", args=[ligne.id]),
            {"qte_physique": "10"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)


class PermissionsStockTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique D"}, {"username": "patronD", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        produit = Produit.objects.create(boutique=self.boutique, nom="Farine")
        self.variante = Variante.objects.create(produit=produit, prix_vente=100)
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 20)

        self.caissier = Utilisateur(
            boutique=self.boutique,
            role=Role.objects.get(boutique=self.boutique, nom="Caissier"),
            username="caissierD",
        )
        self.caissier.set_password("UnMotDePasseSolide123")
        self.caissier.save()

    def test_caissier_consulte_mais_ne_peut_pas_creer_mouvement(self):
        self.client.force_authenticate(user=self.caissier)

        reponse_liste = self.client.get(reverse("stock-list"))
        self.assertEqual(reponse_liste.status_code, status.HTTP_200_OK)

        reponse_creation = self.client.post(
            reverse("mouvement-list"),
            {"variante": str(self.variante.id), "depot": str(self.depot.id), "type": "entree", "quantite": "5"},
            format="json",
        )
        self.assertEqual(reponse_creation.status_code, status.HTTP_403_FORBIDDEN)
