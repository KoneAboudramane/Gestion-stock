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


class CatalogueParDefautTests(APITestCase):
    def test_inscription_cree_unites_et_attributs_courants_sans_doublon(self):
        from comptes.services import inscrire_boutique

        from .catalogue_par_defaut import ATTRIBUTS_PAR_DEFAUT, UNITES_PAR_DEFAUT, creer_catalogue_par_defaut
        from .models import Attribut, Unite, ValeurAttribut

        boutique, _ = inscrire_boutique({"nom": "Boutique U"}, {"username": "patronU", "password": "UnMotDePasseSolide123"})
        self.assertEqual(Unite.objects.filter(boutique=boutique).count(), len(UNITES_PAR_DEFAUT))
        self.assertEqual(Attribut.objects.filter(boutique=boutique).count(), len(ATTRIBUTS_PAR_DEFAUT))
        self.assertTrue(ValeurAttribut.objects.filter(attribut__boutique=boutique, valeur="XL").exists())
        creer_catalogue_par_defaut(boutique)  # une seconde fois : rien de plus
        self.assertEqual(Unite.objects.filter(boutique=boutique).count(), len(UNITES_PAR_DEFAUT))


class UniciteNomCodeBarresTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronUnicite", "password": "UnMotDePasseSolide123"}
        )
        self.client.force_authenticate(user=self.patron)
        self.lait = Produit.objects.create(boutique=self.boutique, nom="Lait Nido carton")
        Variante.objects.create(produit=self.lait, code_barres="6111")

    def test_refuse_un_nom_deja_pris_sans_tenir_compte_majuscules_accents_espaces(self):
        reponse = self.client.post(reverse("produit-list"), {"nom": "  lait  nido CARTON "}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("existe déjà", str(reponse.data["nom"]))

    def test_accepte_le_nom_d_un_article_supprime(self):
        self.lait.supprime = True
        self.lait.save(update_fields=["supprime"])
        reponse = self.client.post(reverse("produit-list"), {"nom": "Lait Nido carton"}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

    def test_le_meme_nom_reste_permis_dans_une_autre_boutique(self):
        boutique_b, _ = inscrire_boutique(
            {"nom": "Boutique B"}, {"username": "patronUniciteB", "password": "UnMotDePasseSolide123"}
        )
        Produit.objects.create(boutique=boutique_b, nom="Café")
        reponse = self.client.post(reverse("produit-list"), {"nom": "Café"}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

    def test_renommer_vers_un_nom_pris_est_refuse_garder_le_sien_est_permis(self):
        sucre = Produit.objects.create(boutique=self.boutique, nom="Sucre")
        url = reverse("produit-detail", args=[sucre.id])
        self.assertEqual(
            self.client.patch(url, {"nom": "LAIT NIDO CARTON"}, format="json").status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(self.client.patch(url, {"nom": "sucre"}, format="json").status_code, status.HTTP_200_OK)

    def test_refuse_un_code_barres_deja_utilise(self):
        reponse = self.client.post(reverse("produit-list"), {"nom": "Huile", "code_barres": " 6111 "}, format="json")
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Lait Nido carton", str(reponse.data["code_barres"]))

        sel = Produit.objects.create(boutique=self.boutique, nom="Sel")
        variante_sel = Variante.objects.create(produit=sel, code_barres="6222")
        url = reverse("variante-detail", args=[variante_sel.id])
        self.assertEqual(
            self.client.patch(url, {"code_barres": "6111"}, format="json").status_code, status.HTTP_400_BAD_REQUEST
        )
        self.assertEqual(self.client.patch(url, {"code_barres": "6222"}, format="json").status_code, status.HTTP_200_OK)

    def test_plusieurs_articles_sans_code_barres(self):
        for nom in ("Article A", "Article B"):
            reponse = self.client.post(reverse("produit-list"), {"nom": nom}, format="json")
            self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
