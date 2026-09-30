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


class AnnulationRemboursementDetteTests(APITestCase):
    """Un remboursement de dette annulé revient dans le solde, en caisse et en comptabilité."""

    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique R"}, {"username": "patronR", "password": "UnMotDePasseSolide123"}
        )
        self.fournisseur = Fournisseur.objects.create(boutique=self.boutique, nom="Grossiste")
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        self.commande = CommandeAchat.objects.create(
            boutique=self.boutique, fournisseur=self.fournisseur, statut="recue", total=10000,
        )
        self.dette = DetteFournisseur.objects.create(
            fournisseur=self.fournisseur, commande=self.commande, montant=10000, montant_paye=0, solde=10000,
            statut="en_cours",
        )
        self.client.force_authenticate(user=self.patron)

    def test_annuler_un_remboursement_en_especes(self):
        from comptabilite.models import EcritureComptable
        from fournisseurs.models import PaiementDetteFournisseur
        from tresorerie.models import MouvementCaisse

        self.client.post(
            reverse("dettefournisseur-payer", args=[self.dette.id]),
            {"montant": "10000", "mode": "especes", "depot": str(self.depot.id)},
            format="json",
        )
        self.dette.refresh_from_db()
        self.assertEqual(self.dette.statut, "solde")
        paiement = PaiementDetteFournisseur.objects.get(dette=self.dette)

        reponse = self.client.post(
            reverse("dettefournisseur-annuler-paiement", args=[self.dette.id]),
            {"paiement": str(paiement.id), "motif": "Erreur de saisie"},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_200_OK, reponse.data)
        self.dette.refresh_from_db()
        paiement.refresh_from_db()
        self.assertEqual((self.dette.solde, self.dette.montant_paye, self.dette.statut), (10000, 0, "en_cours"))
        self.assertTrue(paiement.annulee)
        self.assertEqual(paiement.annule_par, self.patron)
        self.assertEqual(paiement.motif_annulation, "Erreur de saisie")
        self.assertTrue(
            MouvementCaisse.objects.filter(
                reference_type="fournisseurs.PaiementDetteFournisseur:annulation", type="entree", montant=10000
            ).exists()
        )
        self.assertTrue(
            EcritureComptable.objects.filter(reference_type="fournisseurs.PaiementDetteFournisseur:annulation").exists()
        )
        self.assertTrue(self.commande.evenements.filter(type="paiement_annule").exists())

        reponse = self.client.post(
            reverse("dettefournisseur-annuler-paiement", args=[self.dette.id]),
            {"paiement": str(paiement.id)},
            format="json",
        )
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)


class PaiementALaReceptionTests(APITestCase):
    """Payé à la livraison : sortie de caisse si espèces, bon compte en comptabilité, retour en caisse à l'annulation."""

    def setUp(self):
        from catalogue.models import Produit, Variante
        from comptes.services import inscrire_boutique
        from fournisseurs.models import Fournisseur
        from stock.models import Depot

        from .models import CommandeAchat, LigneAchat

        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique R"}, {"username": "patronR", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        self.variante = Variante.objects.create(
            produit=Produit.objects.create(boutique=self.boutique, nom="Clou"), prix_achat=100, prix_vente=200,
        )
        fournisseur = Fournisseur.objects.create(boutique=self.boutique, nom="Grossiste")
        self.commande = CommandeAchat.objects.create(
            boutique=self.boutique, fournisseur=fournisseur, utilisateur=self.patron, numero="CMD-T", statut="commandee",
        )
        self.ligne = LigneAchat.objects.create(commande=self.commande, variante=self.variante, quantite=10, prix_achat=100, sous_total=1000)

    def _recevoir(self, paye, mode):
        from .services import receptionner_commande

        return receptionner_commande(
            self.commande, self.depot, self.patron, montant_deja_paye=paye,
            lignes=[{"ligne": self.ligne, "quantite": 10, "prix_vente": None}], mode_paiement=mode,
        )

    def test_especes_sort_de_la_caisse_et_revient_a_l_annulation(self):
        from tresorerie.services import solde_caisse

        from .services import annuler_reception

        reception = self._recevoir(600, "especes")
        self.assertEqual(solde_caisse(self.depot), -600)
        annuler_reception(reception, self.patron)
        self.assertEqual(solde_caisse(self.depot), 0)

    def test_mobile_money_et_banque_ne_touchent_pas_la_caisse(self):
        from tresorerie.services import solde_caisse

        self._recevoir(400, "banque")
        self.assertEqual(solde_caisse(self.depot), 0)

    def test_comptabilite_partage_paye_et_du(self):
        from comptabilite.models import EcritureComptable

        reception = self._recevoir(600, "banque")
        ecriture = EcritureComptable.objects.get(reference_type="achats.Reception", reference_id=reception.id)
        credits = {l.compte.numero: l.credit for l in ecriture.lignes.all() if l.credit}
        self.assertEqual(credits.get("521"), 600)
        self.assertEqual(credits.get("401"), 400)


class CompteFournisseurTests(APITestCase):
    """Avances et avoirs : versement, paiement d'une réception, retour, remboursement."""

    def setUp(self):
        from catalogue.models import Produit, Variante
        from comptes.services import inscrire_boutique
        from fournisseurs.models import Fournisseur
        from stock.models import Depot

        from .models import CommandeAchat, LigneAchat

        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique F"}, {"username": "patronF", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        self.variante = Variante.objects.create(
            produit=Produit.objects.create(boutique=self.boutique, nom="Clou"), prix_achat=100, prix_vente=200,
        )
        self.fournisseur = Fournisseur.objects.create(boutique=self.boutique, nom="Grossiste")
        self.commande = CommandeAchat.objects.create(
            boutique=self.boutique, fournisseur=self.fournisseur, utilisateur=self.patron, numero="CMD-F",
            statut="commandee",
        )
        self.ligne = LigneAchat.objects.create(
            commande=self.commande, variante=self.variante, quantite=10, prix_achat=100, sous_total=1000,
        )
        self.client.force_authenticate(user=self.patron)

    def test_avance_puis_reception_payee_par_le_compte(self):
        from django.urls import reverse

        from comptabilite.models import EcritureComptable
        from fournisseurs.services import solde_compte_fournisseur
        from tresorerie.services import solde_caisse

        from .services import annuler_reception, receptionner_commande

        reponse = self.client.post(
            reverse("fournisseur-verser-avance", args=[self.fournisseur.id]),
            {"montant": "700", "mode": "especes", "depot": str(self.depot.id)}, format="json",
        )
        self.assertEqual(reponse.status_code, 200, reponse.data)
        self.assertEqual(solde_caisse(self.depot), -700)
        reception = receptionner_commande(
            self.commande, self.depot, self.patron, montant_deja_paye=700,
            lignes=[{"ligne": self.ligne, "quantite": 10, "prix_vente": None}], mode_paiement="compte_fournisseur",
        )
        self.assertEqual(solde_compte_fournisseur(self.fournisseur), 0)
        self.assertEqual(solde_caisse(self.depot), -700)  # rien ne ressort une 2e fois
        ecriture = EcritureComptable.objects.get(reference_type="achats.Reception", reference_id=reception.id)
        credits = {l.compte.numero: l.credit for l in ecriture.lignes.all() if l.credit}
        self.assertEqual(credits.get("409"), 700)
        self.assertEqual(credits.get("401"), 300)
        annuler_reception(reception, self.patron)
        self.assertEqual(solde_compte_fournisseur(self.fournisseur), 700)

    def test_retour_au_dela_de_la_dette_devient_un_avoir(self):
        from django.urls import reverse

        from fournisseurs.services import solde_compte_fournisseur

        from .services import receptionner_commande, retourner_au_fournisseur

        reception = receptionner_commande(
            self.commande, self.depot, self.patron, montant_deja_paye=800,
            lignes=[{"ligne": self.ligne, "quantite": 10, "prix_vente": None}], mode_paiement="banque",
        )
        retour = retourner_au_fournisseur(reception, [{"variante": self.variante, "quantite": 5}])
        self.assertEqual(retour.avoir, 300)
        self.assertEqual(solde_compte_fournisseur(self.fournisseur), 300)
        reponse = self.client.post(
            reverse("fournisseur-remboursement", args=[self.fournisseur.id]),
            {"montant": "300", "mode": "especes", "depot": str(self.depot.id)}, format="json",
        )
        self.assertEqual(reponse.status_code, 200, reponse.data)
        self.assertEqual(reponse.data["solde"], 0)
