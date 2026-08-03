from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from comptes.models import Role, Utilisateur
from comptes.services import inscrire_boutique

from .models import Attribut, Categorie, Produit, ValeurAttribut, Variante


class ProduitVarianteDefautTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronA", "password": "UnMotDePasseSolide123"}
        )
        self.client.force_authenticate(user=self.patron)

    def test_creation_produit_cree_une_variante_par_defaut(self):
        reponse = self.client.post(
            reverse("produit-list"),
            {
                "nom": "Savon Marseille",
                "prix_achat": "500.00",
                "prix_vente": "750.00",
                "seuil_alerte": "10.00",
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

        produit = Produit.objects.get(nom="Savon Marseille")
        self.assertEqual(produit.variantes.count(), 1)
        variante = produit.variantes.first()
        self.assertEqual(str(variante.prix_achat), "500.00")
        self.assertEqual(str(variante.prix_vente), "750.00")
        self.assertEqual(len(reponse.data["variantes"]), 1)

    def test_ajout_variante_avec_attributs(self):
        produit = Produit.objects.create(boutique=self.boutique, nom="T-shirt")
        Variante.objects.create(produit=produit, prix_vente=1000)
        attribut_couleur = Attribut.objects.create(boutique=self.boutique, nom="Couleur")
        valeur_rouge = ValeurAttribut.objects.create(attribut=attribut_couleur, valeur="Rouge")

        reponse = self.client.post(
            reverse("variante-list"),
            {
                "produit": str(produit.id),
                "prix_vente": "1200.00",
                "valeur_attribut_ids": [str(valeur_rouge.id)],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        self.assertEqual(produit.variantes.count(), 2)
        nouvelle_variante = Variante.objects.get(prix_vente=1200)
        self.assertEqual(list(nouvelle_variante.valeurs.all().values_list("valeur_attribut", flat=True)), [valeur_rouge.id])


class IsolationCatalogueTests(APITestCase):
    def setUp(self):
        self.boutique_a, self.patron_a = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronA3", "password": "UnMotDePasseSolide123"}
        )
        self.boutique_b, self.patron_b = inscrire_boutique(
            {"nom": "Boutique B"}, {"username": "patronB2", "password": "UnMotDePasseSolide123"}
        )
        self.attribut_b = Attribut.objects.create(boutique=self.boutique_b, nom="Taille")
        Produit.objects.create(boutique=self.boutique_a, nom="Produit A")
        Produit.objects.create(boutique=self.boutique_b, nom="Produit B")

    def test_produits_isoles_par_boutique(self):
        self.client.force_authenticate(user=self.patron_a)
        reponse = self.client.get(reverse("produit-list"))
        noms = {p["nom"] for p in reponse.data}
        self.assertIn("Produit A", noms)
        self.assertNotIn("Produit B", noms)

    def test_creation_valeur_attribut_sur_attribut_autre_boutique_refusee(self):
        self.client.force_authenticate(user=self.patron_a)
        reponse = self.client.post(
            reverse("valeurattribut-list"),
            {"attribut": str(self.attribut_b.id), "valeur": "M"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)


class PermissionsCatalogueTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique C"}, {"username": "patronC", "password": "UnMotDePasseSolide123"}
        )
        produit = Produit.objects.create(boutique=self.boutique, nom="Produit Test")
        self.variante = Variante.objects.create(produit=produit, prix_achat=100, prix_vente=200)

        self.caissier = Utilisateur(
            boutique=self.boutique,
            role=Role.objects.get(boutique=self.boutique, nom="Caissier"),
            username="caissierC",
        )
        self.caissier.set_password("UnMotDePasseSolide123")
        self.caissier.save()

    def test_caissier_ne_voit_pas_prix_achat_et_ne_peut_pas_ecrire(self):
        self.client.force_authenticate(user=self.caissier)

        reponse_liste = self.client.get(reverse("variante-list"))
        self.assertEqual(reponse_liste.status_code, status.HTTP_200_OK)
        self.assertNotIn("prix_achat", reponse_liste.data[0])
        self.assertIn("prix_vente", reponse_liste.data[0])

        reponse_creation = self.client.post(
            reverse("produit-list"), {"nom": "Interdit"}, format="json"
        )
        self.assertEqual(reponse_creation.status_code, status.HTTP_403_FORBIDDEN)

    def test_role_sans_modifier_prix_refuse_changement_de_prix(self):
        role_limite = Role.objects.create(
            boutique=self.boutique,
            nom="Gerant sans prix",
            permissions={"gerer_produits_stock_achats": True, "modifier_prix": False},
        )
        utilisateur = Utilisateur(boutique=self.boutique, role=role_limite, username="gerantLimite")
        utilisateur.set_password("UnMotDePasseSolide123")
        utilisateur.save()
        self.client.force_authenticate(user=utilisateur)

        reponse = self.client.patch(
            reverse("variante-detail", args=[self.variante.id]),
            {"prix_vente": "999.00"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
