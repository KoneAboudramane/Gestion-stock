from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from catalogue.models import Produit, Variante
from comptes.models import Boutique, Role, Utilisateur
from comptes.services import inscrire_boutique
from configuration.models import Parametre
from configuration.services import CLE_FABRICATION_PROPRE

from .models import Depot, Destockage, MouvementStock, OperationDestockage, PerteStock, Stock
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


class EntreeManuelleFabricationTests(APITestCase):
    """Réglage "fabrication propre" : l'entrée manuelle n'est permise qu'aux
    boutiques qui fabriquent, sauf pour le tout premier stock d'une variante."""

    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique F"}, {"username": "patronF", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        produit = Produit.objects.create(boutique=self.boutique, nom="Savon")
        self.variante = Variante.objects.create(produit=produit, prix_achat=100, prix_vente=150)
        self.client.force_authenticate(user=self.patron)

    def _entree(self, quantite="10"):
        return self.client.post(
            reverse("mouvement-list"),
            {"variante": str(self.variante.id), "depot": str(self.depot.id), "type": "entree", "quantite": quantite},
            format="json",
        )

    def test_stock_initial_permis_puis_entree_suivante_refusee(self):
        self.assertEqual(self._entree().status_code, status.HTTP_201_CREATED)
        reponse = self._entree()
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST, reponse.data)
        self.assertEqual(Stock.objects.get(variante=self.variante, depot=self.depot).quantite, 10)

    def test_entree_permise_si_la_boutique_fabrique(self):
        Parametre.objects.create(boutique=self.boutique, cle=CLE_FABRICATION_PROPRE, valeur="1")
        self.assertEqual(self._entree().status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._entree().status_code, status.HTTP_201_CREATED)
        self.assertEqual(Stock.objects.get(variante=self.variante, depot=self.depot).quantite, 20)

    def test_ajustement_et_sortie_restent_permis(self):
        self._entree()
        for type_mouvement, quantite in (("sortie", "2"), ("ajustement", "-1")):
            reponse = self.client.post(
                reverse("mouvement-list"),
                {"variante": str(self.variante.id), "depot": str(self.depot.id), "type": type_mouvement, "quantite": quantite},
                format="json",
            )
            self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)


class PerteStockTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique P"}, {"username": "patronP", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        produit = Produit.objects.create(boutique=self.boutique, nom="Yaourt")
        self.variante = Variante.objects.create(produit=produit, prix_achat=250, prix_vente=400)
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 20)
        self.client.force_authenticate(user=self.patron)

    def _declarer(self, **donnees):
        corps = {"variante": str(self.variante.id), "depot": str(self.depot.id), "quantite": "4", "motif": "perime"}
        corps.update(donnees)
        return self.client.post(reverse("perte-list"), corps, format="json")

    def test_perte_sort_du_stock_valorisee_au_cump(self):
        reponse = self._declarer()
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        self.assertEqual(Stock.objects.get(variante=self.variante, depot=self.depot).quantite, 16)
        perte = PerteStock.objects.get()
        self.assertEqual(perte.valeur, 1000)
        mouvement = MouvementStock.objects.get(reference_type="stock.PerteStock", reference_id=perte.id)
        self.assertEqual(mouvement.type, MouvementStock.Type.SORTIE)
        self.assertEqual(mouvement.motif, "Perte : Périmé")

    def test_motif_autre_exige_une_detail(self):
        self.assertEqual(self._declarer(motif="autre").status_code, status.HTTP_400_BAD_REQUEST)
        reponse = self._declarer(motif="autre", detail="Mangé par les rats")
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

    def test_perte_superieure_au_stock_refusee(self):
        self.assertEqual(self._declarer(quantite="50").status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(PerteStock.objects.count(), 0)
        self.assertEqual(Stock.objects.get(variante=self.variante, depot=self.depot).quantite, 20)


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


class OperationDestockageTests(APITestCase):
    """Opération de déstockage : plusieurs articles d'un coup, tout ou rien, arrêt global."""

    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique O"}, {"username": "patronO", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        self.chemise = Variante.objects.create(
            produit=Produit.objects.create(boutique=self.boutique, nom="Chemise"), prix_achat=3000, prix_vente=5000,
        )
        self.pantalon = Variante.objects.create(
            produit=Produit.objects.create(boutique=self.boutique, nom="Pantalon"), prix_achat=4000, prix_vente=8000,
        )
        self.client.force_authenticate(user=self.patron)

    def _creer(self, lignes, nom="Liquidation fin d'année"):
        return self.client.post(
            reverse("operationdestockage-list"),
            {"nom": nom, "lignes": [{"variante": str(v.id), "prix_destockage": p} for v, p in lignes]},
            format="json",
        )

    def test_cree_un_destockage_par_article_rattache_a_l_operation(self):
        reponse = self._creer([(self.chemise, "3500"), (self.pantalon, "6000")])
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        operation = OperationDestockage.objects.get()
        self.assertEqual(operation.destockages.count(), 2)
        self.assertEqual(Destockage.objects.get(variante=self.pantalon).prix_destockage, 6000)

    def test_tout_ou_rien_si_un_article_est_refuse(self):
        reponse = self._creer([(self.chemise, "3500"), (self.pantalon, "9000")])  # 9000 > prix normal
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(OperationDestockage.objects.count(), 0)
        self.assertEqual(Destockage.objects.count(), 0)

    def test_arreter_l_operation_arrete_tous_ses_articles(self):
        self._creer([(self.chemise, "3500"), (self.pantalon, "6000")])
        operation = OperationDestockage.objects.get()
        reponse = self.client.post(reverse("operationdestockage-arreter", args=[operation.id]))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertEqual(
            set(Destockage.objects.values_list("motif_fin", flat=True)), {Destockage.MotifFin.MANUEL}
        )
        self.assertEqual(
            self.client.post(reverse("operationdestockage-arreter", args=[operation.id])).status_code,
            status.HTTP_400_BAD_REQUEST,
        )


class SuppressionBoutiqueAvecPertesEtDestockagesTests(APITestCase):
    """La suppression définitive d'une boutique (admin) ne doit pas buter sur
    les FK PROTECT de PerteStock / Destockage."""

    def test_suppression_definitive(self):
        from comptes.models import Boutique
        from comptes.services import supprimer_boutique_definitivement
        from .services import declarer_perte, demarrer_destockage

        boutique, _ = inscrire_boutique(
            {"nom": "Boutique S"}, {"username": "patronS", "password": "UnMotDePasseSolide123"}
        )
        depot = Depot.objects.create(boutique=boutique, nom="Magasin")
        variante = Variante.objects.create(
            produit=Produit.objects.create(boutique=boutique, nom="Sac"), prix_achat=100, prix_vente=200,
        )
        appliquer_mouvement(variante, depot, MouvementStock.Type.ENTREE, 10)
        declarer_perte(variante, depot, 1, PerteStock.Motif.ABIME)
        demarrer_destockage(variante, 150)

        supprimer_boutique_definitivement(boutique)
        self.assertFalse(Boutique.objects.filter(id=boutique.id).exists())
        self.assertEqual(PerteStock.objects.count(), 0)
        self.assertEqual(Destockage.objects.count(), 0)


class AnnulationPerteEtModificationDestockageTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique AM"}, {"username": "patronAM", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        self.variante = Variante.objects.create(
            produit=Produit.objects.create(boutique=self.boutique, nom="Lait"), prix_achat=300, prix_vente=500,
        )
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 10)
        self.client.force_authenticate(user=self.patron)

    def test_annuler_une_perte_remet_le_stock(self):
        from .services import declarer_perte
        perte = declarer_perte(self.variante, self.depot, 3, PerteStock.Motif.PERIME)
        reponse = self.client.post(reverse("perte-annuler", args=[perte.id]))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        perte.refresh_from_db()
        self.assertTrue(perte.annulee)
        self.assertEqual(Stock.objects.get(variante=self.variante, depot=self.depot).quantite, 10)
        self.assertEqual(
            self.client.post(reverse("perte-annuler", args=[perte.id])).status_code, status.HTTP_400_BAD_REQUEST
        )

    def test_modifier_prix_et_date_d_un_destockage_en_cours(self):
        from .services import demarrer_destockage
        destockage = demarrer_destockage(self.variante, 400)
        reponse = self.client.post(
            reverse("destockage-modifier", args=[destockage.id]),
            {"prix_destockage": "350", "date_fin": "2999-01-01"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        destockage.refresh_from_db()
        self.assertEqual(destockage.prix_destockage, 350)
        self.assertEqual(str(destockage.date_fin), "2999-01-01")
        refus = self.client.post(
            reverse("destockage-modifier", args=[destockage.id]), {"prix_destockage": "600"}, format="json",
        )
        self.assertEqual(refus.status_code, status.HTTP_400_BAD_REQUEST)


class InventaireComptageAZeroEtAjoutTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique I"}, {"username": "patronI", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        self.variante = Variante.objects.create(
            produit=Produit.objects.create(boutique=self.boutique, nom="Bol"), prix_achat=100, prix_vente=200,
        )
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 8)
        self.client.force_authenticate(user=self.patron)

    def test_comptage_a_zero_puis_ajout_d_un_article(self):
        reponse = self.client.post(
            reverse("inventaire-list"), {"depot": str(self.depot.id), "a_zero": True}, format="json"
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        ligne = reponse.data["lignes"][0]
        self.assertEqual((float(ligne["qte_physique"]), float(ligne["ecart"])), (0.0, -8.0))

        nouvelle = Variante.objects.create(
            produit=Produit.objects.create(boutique=self.boutique, nom="Tasse"), prix_achat=50, prix_vente=90,
        )
        ajout = self.client.post(
            reverse("inventaire-ajouter-ligne", args=[reponse.data["id"]]),
            {"variante": str(nouvelle.id), "qte_physique": "3"},
            format="json",
        )
        self.assertEqual(ajout.status_code, status.HTTP_200_OK, ajout.data)
        self.assertEqual(float(ajout.data["ecart"]), 3.0)


class DetaillageTests(APITestCase):
    """Détailler un carton en paquets, regrouper, annuler : le coût suit."""

    def setUp(self):
        from .services import detailler_ou_regrouper  # noqa: F401

        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique D"}, {"username": "patronD", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        self.paquet = Variante.objects.create(
            produit=Produit.objects.create(boutique=self.boutique, nom="Biscuit paquet"), prix_achat=0, prix_vente=600,
        )
        self.carton = Variante.objects.create(
            produit=Produit.objects.create(boutique=self.boutique, nom="Biscuit carton"),
            prix_achat=9600, prix_vente=12000, variante_detail=self.paquet, quantite_detail=24,
        )
        appliquer_mouvement(self.carton, self.depot, MouvementStock.Type.ENTREE, 5)
        self.client.force_authenticate(user=self.patron)

    def _stock(self, variante):
        return Stock.objects.get(variante=variante, depot=self.depot).quantite

    def _operer(self, type_operation, nombre="2"):
        return self.client.post(
            reverse("detaillage-list"),
            {"type": type_operation, "depot": str(self.depot.id), "variante": str(self.carton.id), "nombre": nombre},
            format="json",
        )

    def test_detailler_sort_les_cartons_et_entre_les_paquets_au_bon_cout(self):
        reponse = self._operer("detailler")
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        self.assertEqual(self._stock(self.carton), 3)
        self.assertEqual(self._stock(self.paquet), 48)
        self.paquet.refresh_from_db()
        self.assertEqual(self.paquet.prix_achat, 400)
        self.assertEqual(MouvementStock.objects.filter(reference_type="stock.Detaillage").count(), 2)

    def test_regrouper_reconstitue_un_carton(self):
        from .models import Detaillage
        from .services import detailler_ou_regrouper

        detailler_ou_regrouper(self.carton, self.depot, 1, Detaillage.Type.DETAILLER)
        reponse = self._operer("regrouper", "1")
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        self.assertEqual(self._stock(self.carton), 5)
        self.assertEqual(self._stock(self.paquet), 0)
        self.carton.refresh_from_db()
        self.assertEqual(self.carton.prix_achat, 9600)

    def test_regrouper_refuse_sans_assez_de_paquets(self):
        self.assertEqual(self._operer("regrouper", "1").status_code, status.HTTP_400_BAD_REQUEST)

    def test_refuse_un_nombre_non_entier_ou_plus_que_le_stock(self):
        self.assertEqual(self._operer("detailler", "1.5").status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self._operer("detailler", "6").status_code, status.HTTP_400_BAD_REQUEST)

    def test_refuse_si_prix_de_vente_du_detail_sous_le_cout(self):
        self.paquet.prix_vente = 300
        self.paquet.save()
        self.assertEqual(self._operer("detailler").status_code, status.HTTP_400_BAD_REQUEST)

    def test_annuler_tant_que_les_paquets_sont_en_stock(self):
        from .models import Detaillage

        operation = Detaillage.objects.get(id=self._operer("detailler").data["id"])
        reponse = self.client.post(reverse("detaillage-annuler", args=[operation.id]))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertEqual(self._stock(self.carton), 5)
        self.assertEqual(self._stock(self.paquet), 0)
        self.carton.refresh_from_db()
        self.assertEqual(self.carton.prix_achat, 9600)

    def test_annulation_refusee_si_paquets_vendus(self):
        from .models import Detaillage

        operation = Detaillage.objects.get(id=self._operer("detailler").data["id"])
        appliquer_mouvement(self.paquet, self.depot, MouvementStock.Type.SORTIE, 1)
        reponse = self.client.post(reverse("detaillage-annuler", args=[operation.id]))
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)


class AlerteRuptureDetailTests(APITestCase):
    def test_alerte_propose_de_detailler_quand_il_reste_des_cartons(self):
        from notifications.services import generer_alertes_rupture

        boutique, _ = inscrire_boutique({"nom": "Boutique A"}, {"username": "patronA", "password": "UnMotDePasseSolide123"})
        depot = Depot.objects.create(boutique=boutique, nom="Magasin")
        paquet = Variante.objects.create(
            produit=Produit.objects.create(boutique=boutique, nom="Paquet"), prix_vente=600, seuil_alerte=5,
        )
        carton = Variante.objects.create(
            produit=Produit.objects.create(boutique=boutique, nom="Carton"), prix_vente=12000,
            variante_detail=paquet, quantite_detail=24,
        )
        appliquer_mouvement(carton, depot, MouvementStock.Type.ENTREE, 3)
        appliquer_mouvement(paquet, depot, MouvementStock.Type.ENTREE, 2)
        messages = [n.message for n in generer_alertes_rupture(boutique)]
        self.assertTrue(any("déballez-en un" in m and "Carton" in m for m in messages), messages)
