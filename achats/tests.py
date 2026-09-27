from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from catalogue.models import Produit, Variante
from comptes.models import Role, Utilisateur
from comptes.services import inscrire_boutique
from fournisseurs.models import DetteFournisseur, Fournisseur
from stock.models import Depot, MouvementStock, Stock

from .models import CommandeAchat, Reception


class CommandeAchatTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique A"}, {"username": "patronA", "password": "UnMotDePasseSolide123"}
        )
        self.fournisseur = Fournisseur.objects.create(boutique=self.boutique, nom="Grossiste CI")
        produit = Produit.objects.create(boutique=self.boutique, nom="Huile")
        self.variante = Variante.objects.create(produit=produit, prix_achat=5000, prix_vente=6500)
        produit2 = Produit.objects.create(boutique=self.boutique, nom="Sel")
        self.variante2 = Variante.objects.create(produit=produit2, prix_achat=300, prix_vente=450)
        self.client.force_authenticate(user=self.patron)

    def test_creation_commande_calcule_le_total(self):
        reponse = self.client.post(
            reverse("commandeachat-list"),
            {
                "fournisseur": str(self.fournisseur.id),
                "statut": "commandee",
                "lignes_saisie": [
                    {"variante": str(self.variante.id), "quantite": "10", "prix_achat": "5000"},
                    {"variante": str(self.variante2.id), "quantite": "20", "prix_achat": "300"},
                ],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        self.assertTrue(reponse.data["numero"].startswith("CMD-"))
        self.assertEqual(reponse.data["total"], "56000.00")

    def test_modification_commande_recalcule_total_puis_bloquee_apres_reception(self):
        commande = CommandeAchat.objects.create(
            boutique=self.boutique, fournisseur=self.fournisseur, statut="commandee", total=0,
        )
        reponse = self.client.patch(
            reverse("commandeachat-detail", args=[commande.id]),
            {"lignes_saisie": [{"variante": str(self.variante.id), "quantite": "2", "prix_achat": "5000"}]},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertEqual(reponse.data["total"], "10000.00")

        depot = Depot.objects.create(boutique=self.boutique, nom="Entrepot")
        self.client.post(
            reverse("reception-list"),
            {
                "commande": str(commande.id),
                "depot": str(depot.id),
                "lignes": [{"variante": str(self.variante.id), "quantite": "2"}],
            },
            format="json",
        )
        reponse = self.client.patch(
            reverse("commandeachat-detail", args=[commande.id]),
            {"lignes_saisie": [{"variante": str(self.variante.id), "quantite": "5", "prix_achat": "5000"}]},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

    def test_annulation_commande_sans_reception(self):
        commande = CommandeAchat.objects.create(
            boutique=self.boutique, fournisseur=self.fournisseur, statut="commandee", total=0,
        )
        reponse = self.client.patch(
            reverse("commandeachat-detail", args=[commande.id]), {"statut": "annulee"}, format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        commande.refresh_from_db()
        self.assertEqual(commande.statut, "annulee")

    def test_annulation_refusee_apres_reception_partielle(self):
        commande = CommandeAchat.objects.create(
            boutique=self.boutique, fournisseur=self.fournisseur, statut="commandee", total=50000,
        )
        from .models import LigneAchat
        LigneAchat.objects.create(
            commande=commande, variante=self.variante, quantite=10, prix_achat=5000, sous_total=50000,
        )
        depot = Depot.objects.create(boutique=self.boutique, nom="Entrepot")
        self.client.post(
            reverse("reception-list"),
            {
                "commande": str(commande.id),
                "depot": str(depot.id),
                "lignes": [{"variante": str(self.variante.id), "quantite": "3"}],
            },
            format="json",
        )
        reponse = self.client.patch(
            reverse("commandeachat-detail", args=[commande.id]), {"statut": "annulee"}, format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)


class ReceptionTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique B"}, {"username": "patronB", "password": "UnMotDePasseSolide123"}
        )
        self.fournisseur = Fournisseur.objects.create(boutique=self.boutique, nom="Grossiste")
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Entrepot")
        produit = Produit.objects.create(boutique=self.boutique, nom="Farine")
        self.variante = Variante.objects.create(produit=produit, prix_achat=4000, prix_vente=5000)
        self.commande = CommandeAchat.objects.create(
            boutique=self.boutique, fournisseur=self.fournisseur, statut="commandee", total=40000,
        )
        from .models import LigneAchat
        LigneAchat.objects.create(
            commande=self.commande, variante=self.variante, quantite=10, prix_achat=4000, sous_total=40000,
        )
        self.client.force_authenticate(user=self.patron)

    def test_reception_incremente_stock_et_cree_dette_partielle(self):
        reponse = self.client.post(
            reverse("reception-list"),
            {
                "commande": str(self.commande.id),
                "depot": str(self.depot.id),
                "montant_deja_paye": "15000",
                "lignes": [{"variante": str(self.variante.id), "quantite": "10"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

        self.commande.refresh_from_db()
        self.assertEqual(self.commande.statut, "recue")

        stock = Stock.objects.get(variante=self.variante, depot=self.depot)
        self.assertEqual(stock.quantite, 10)

        dette = DetteFournisseur.objects.get(commande=self.commande)
        self.assertEqual(dette.montant, 40000)
        self.assertEqual(dette.montant_paye, 15000)
        self.assertEqual(dette.solde, 25000)
        self.assertEqual(dette.statut, "en_cours")

    def test_reception_totalement_payee_ne_cree_pas_de_dette(self):
        reponse = self.client.post(
            reverse("reception-list"),
            {
                "commande": str(self.commande.id),
                "depot": str(self.depot.id),
                "montant_deja_paye": "40000",
                "lignes": [{"variante": str(self.variante.id), "quantite": "10"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        self.assertFalse(DetteFournisseur.objects.filter(commande=self.commande).exists())

    def test_double_reception_refusee(self):
        self.client.post(
            reverse("reception-list"),
            {
                "commande": str(self.commande.id),
                "depot": str(self.depot.id),
                "lignes": [{"variante": str(self.variante.id), "quantite": "10"}],
            },
            format="json",
        )
        reponse = self.client.post(
            reverse("reception-list"),
            {
                "commande": str(self.commande.id),
                "depot": str(self.depot.id),
                "lignes": [{"variante": str(self.variante.id), "quantite": "10"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reception_commande_brouillon_refusee(self):
        commande_brouillon = CommandeAchat.objects.create(
            boutique=self.boutique, fournisseur=self.fournisseur, statut="brouillon", total=0,
        )
        reponse = self.client.post(
            reverse("reception-list"),
            {
                "commande": str(commande_brouillon.id),
                "depot": str(self.depot.id),
                "lignes": [{"variante": str(self.variante.id), "quantite": "1"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reception_met_a_jour_prix_achat_et_vente_de_la_variante(self):
        reponse = self.client.post(
            reverse("reception-list"),
            {
                "commande": str(self.commande.id),
                "depot": str(self.depot.id),
                "lignes": [{"variante": str(self.variante.id), "quantite": "10", "prix_vente": "5500"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

        self.variante.refresh_from_db()
        self.assertEqual(self.variante.prix_achat, 4000)
        self.assertEqual(self.variante.prix_vente, 5500)

    def test_reception_pondere_le_prix_achat_cump_avec_le_stock_existant(self):
        # 10 unités déjà en stock à 3000, on en reçoit 10 à 4000 : CUMP = 3500.
        from stock.services import appliquer_mouvement
        self.variante.prix_achat = 3000
        self.variante.save(update_fields=["prix_achat"])
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 10)
        reponse = self.client.post(
            reverse("reception-list"),
            {
                "commande": str(self.commande.id),
                "depot": str(self.depot.id),
                "lignes": [{"variante": str(self.variante.id), "quantite": "10", "prix_vente": "5500"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        self.variante.refresh_from_db()
        self.assertEqual(self.variante.prix_achat, 3500)

    def test_reception_refuse_prix_vente_sous_le_prix_achat(self):
        reponse = self.client.post(
            reverse("reception-list"),
            {
                "commande": str(self.commande.id),
                "depot": str(self.depot.id),
                "lignes": [{"variante": str(self.variante.id), "quantite": "10", "prix_vente": "1000"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reception_partielle_garde_la_commande_commandee_puis_la_termine(self):
        reponse = self.client.post(
            reverse("reception-list"),
            {
                "commande": str(self.commande.id),
                "depot": str(self.depot.id),
                "lignes": [{"variante": str(self.variante.id), "quantite": "6"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

        self.commande.refresh_from_db()
        self.assertEqual(self.commande.statut, "commandee")

        stock = Stock.objects.get(variante=self.variante, depot=self.depot)
        self.assertEqual(stock.quantite, 6)

        ligne = self.commande.lignes.get()
        self.assertEqual(ligne.quantite_recue, 6)

        reponse = self.client.post(
            reverse("reception-list"),
            {
                "commande": str(self.commande.id),
                "depot": str(self.depot.id),
                "lignes": [{"variante": str(self.variante.id), "quantite": "4"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

        self.commande.refresh_from_db()
        self.assertEqual(self.commande.statut, "recue")
        stock.refresh_from_db()
        self.assertEqual(stock.quantite, 10)

        # Chaque réception garde la trace de ses propres articles livrés.
        quantites_par_reception = [
            [
                m.quantite
                for m in MouvementStock.objects.filter(
                    reference_type="achats.Reception", reference_id=reception.id
                )
            ]
            for reception in self.commande.receptions.order_by("date_creation")
        ]
        self.assertEqual(quantites_par_reception, [[6], [4]])

    def test_reception_partielle_quantite_superieure_au_restant_refusee(self):
        reponse = self.client.post(
            reverse("reception-list"),
            {
                "commande": str(self.commande.id),
                "depot": str(self.depot.id),
                "lignes": [{"variante": str(self.variante.id), "quantite": "6"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)

        reponse = self.client.post(
            reverse("reception-list"),
            {
                "commande": str(self.commande.id),
                "depot": str(self.depot.id),
                "lignes": [{"variante": str(self.variante.id), "quantite": "5"}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)


class PaiementDetteTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique C"}, {"username": "patronC", "password": "UnMotDePasseSolide123"}
        )
        self.fournisseur = Fournisseur.objects.create(boutique=self.boutique, nom="Grossiste")
        self.dette = DetteFournisseur.objects.create(
            fournisseur=self.fournisseur, montant=10000, montant_paye=0, solde=10000, statut="en_cours",
        )
        self.client.force_authenticate(user=self.patron)

    def test_paiement_partiel_puis_solde(self):
        reponse = self.client.post(
            reverse("dettefournisseur-payer", args=[self.dette.id]), {"montant": "4000"}, format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.dette.refresh_from_db()
        self.assertEqual(self.dette.solde, 6000)
        self.assertEqual(self.dette.statut, "en_cours")

        reponse = self.client.post(
            reverse("dettefournisseur-payer", args=[self.dette.id]), {"montant": "6000"}, format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        self.dette.refresh_from_db()
        self.assertEqual(self.dette.solde, 0)
        self.assertEqual(self.dette.statut, "solde")

    def test_trop_percu_refuse(self):
        reponse = self.client.post(
            reverse("dettefournisseur-payer", args=[self.dette.id]), {"montant": "99999"}, format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)


class PermissionsAchatsTests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique D"}, {"username": "patronD", "password": "UnMotDePasseSolide123"}
        )
        self.fournisseur = Fournisseur.objects.create(boutique=self.boutique, nom="Grossiste")
        self.caissier = Utilisateur(
            boutique=self.boutique,
            role=Role.objects.get(boutique=self.boutique, nom="Caissier"),
            username="caissierD",
        )
        self.caissier.set_password("UnMotDePasseSolide123")
        self.caissier.save()

    def test_caissier_lit_fournisseurs_mais_pas_les_commandes(self):
        self.client.force_authenticate(user=self.caissier)

        reponse_fournisseurs = self.client.get(reverse("fournisseur-list"))
        self.assertEqual(reponse_fournisseurs.status_code, status.HTTP_200_OK)

        reponse_commandes = self.client.get(reverse("commandeachat-list"))
        self.assertEqual(reponse_commandes.status_code, status.HTTP_403_FORBIDDEN)

        reponse_dettes = self.client.get(reverse("dettefournisseur-list"))
        self.assertEqual(reponse_dettes.status_code, status.HTTP_403_FORBIDDEN)


class AnnulationEtRetourTests(APITestCase):
    """Réception saisie par erreur (annulation) et retour de marchandise au fournisseur."""

    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique R"}, {"username": "patronR", "password": "UnMotDePasseSolide123"}
        )
        self.fournisseur = Fournisseur.objects.create(boutique=self.boutique, nom="Grossiste")
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Entrepot")
        produit = Produit.objects.create(boutique=self.boutique, nom="Huile")
        self.variante = Variante.objects.create(produit=produit, prix_achat=1000, prix_vente=1500)
        self.commande = CommandeAchat.objects.create(
            boutique=self.boutique, fournisseur=self.fournisseur, statut="commandee", total=10000,
        )
        from .models import LigneAchat
        LigneAchat.objects.create(
            commande=self.commande, variante=self.variante, quantite=10, prix_achat=1000, sous_total=10000,
        )
        self.client.force_authenticate(user=self.patron)

    def _recevoir(self, quantite="10", paye="0"):
        reponse = self.client.post(
            reverse("reception-list"),
            {
                "commande": str(self.commande.id), "depot": str(self.depot.id), "montant_deja_paye": paye,
                "lignes": [{"variante": str(self.variante.id), "quantite": quantite}],
            },
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_201_CREATED, reponse.data)
        return Reception.objects.get(id=reponse.data["id"])

    def _stock(self):
        return Stock.objects.get(variante=self.variante, depot=self.depot).quantite

    def test_annuler_une_reception(self):
        from comptabilite.models import EcritureComptable
        reception = self._recevoir()
        reponse = self.client.post(reverse("reception-annuler", args=[reception.id]))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertEqual(self._stock(), 0)
        self.commande.refresh_from_db()
        self.assertEqual(self.commande.statut, "commandee")
        self.assertEqual(self.commande.lignes.get().quantite_recue, 0)
        dette = DetteFournisseur.objects.get(reception=reception)
        self.assertEqual((dette.solde, dette.statut), (0, "solde"))
        self.assertTrue(
            EcritureComptable.objects.filter(
                reference_type="achats.Reception:annulation", reference_id=reception.id
            ).exists()
        )

    def test_annulation_refusee_si_marchandise_deja_vendue(self):
        from stock.services import appliquer_mouvement
        reception = self._recevoir()
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.SORTIE, 5)
        reponse = self.client.post(reverse("reception-annuler", args=[reception.id]))
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self._stock(), 5)

    def test_retour_partiel_reduit_la_dette_puis_cree_un_avoir(self):
        reception = self._recevoir(paye="7000")  # dette : 3 000
        reponse = self.client.post(
            reverse("reception-retourner", args=[reception.id]),
            {"lignes": [{"variante": str(self.variante.id), "quantite": "4"}], "motif": "Bidons percés"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.assertEqual((reponse.data["montant"], reponse.data["avoir"]), (4000, 1000))
        self.assertEqual(self._stock(), 6)
        dette = DetteFournisseur.objects.get(reception=reception)
        self.assertEqual((dette.solde, dette.statut), (0, "solde"))
        # On ne peut pas retourner plus que ce qui reste de la réception (6).
        trop = self.client.post(
            reverse("reception-retourner", args=[reception.id]),
            {"lignes": [{"variante": str(self.variante.id), "quantite": "7"}]},
            format="json",
        )
        self.assertEqual(trop.status_code, status.HTTP_400_BAD_REQUEST)


class SuiviEtapesCommandeTests(APITestCase):
    """Chaque étape d'une commande laisse une trace (achats.EvenementCommande)."""

    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique S"}, {"username": "patronS", "password": "UnMotDePasseSolide123"}
        )
        self.fournisseur = Fournisseur.objects.create(boutique=self.boutique, nom="Grossiste")
        produit = Produit.objects.create(boutique=self.boutique, nom="Huile")
        self.variante = Variante.objects.create(produit=produit, prix_achat=4000, prix_vente=5000)
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Entrepot")
        self.client.force_authenticate(user=self.patron)

    def test_creation_commande_reception_paiement_notent_chaque_etape(self):
        reponse = self.client.post(
            reverse("commandeachat-list"),
            {
                "fournisseur": str(self.fournisseur.id),
                "statut": "brouillon",
                "lignes_saisie": [{"variante": str(self.variante.id), "quantite": "10", "prix_achat": "4000"}],
            },
            format="json",
        )
        commande = CommandeAchat.objects.get(id=reponse.data["id"])
        self.client.patch(reverse("commandeachat-detail", args=[commande.id]), {"statut": "commandee"}, format="json")
        self.client.post(
            reverse("reception-list"),
            {
                "commande": str(commande.id),
                "depot": str(self.depot.id),
                "montant_deja_paye": "15000",
                "lignes": [{"variante": str(self.variante.id), "quantite": "10"}],
            },
            format="json",
        )
        dette = DetteFournisseur.objects.get(commande=commande)
        self.client.post(reverse("dettefournisseur-payer", args=[dette.id]), {"montant": "5000"}, format="json")

        etapes = list(commande.evenements.order_by("date_creation").values_list("type", "utilisateur", "montant"))
        self.assertEqual(
            [e[0] for e in etapes], ["creee", "commandee", "reception", "paiement", "paiement"]
        )
        self.assertTrue(all(e[1] == self.patron.id for e in etapes))
        self.assertEqual([e[2] for e in etapes[2:]], [40000, 15000, 5000])
