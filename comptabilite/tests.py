from decimal import Decimal

from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from achats.models import CommandeAchat
from achats.services import creer_commande, receptionner_commande
from catalogue.models import Produit, Variante
from clients.models import Client
from clients.services import rembourser_credit
from comptes.services import inscrire_boutique
from configuration.models import Parametre
from fournisseurs.models import Fournisseur
from fournisseurs.services import payer_dette
from stock.models import Depot, MouvementStock
from stock.services import appliquer_mouvement
from tresorerie.models import Depense
from tresorerie.services import (
    ajuster_caisse,
    effectuer_retrait,
    effectuer_transfert,
    enregistrer_apport,
    enregistrer_depense,
)
from ventes.models import Vente
from ventes.services import annuler_vente, creer_vente

from .models import EcritureComptable, LigneEcriture


def _lignes(ecriture):
    return {l.compte.numero: (l.debit, l.credit) for l in ecriture.lignes.all()}


class ComptabiliteTestsBase(TestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique Compta"}, {"username": "patronCompta", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        produit = Produit.objects.create(boutique=self.boutique, nom="Article")
        self.variante = Variante.objects.create(produit=produit, prix_achat=1000, prix_vente=1500)
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 100)


class EcrituresEquilibreesTests(ComptabiliteTestsBase):
    """Toute écriture générée par un signal doit être équilibrée (débit == crédit)."""

    def test_toutes_les_ecritures_generees_sont_equilibrees(self):
        creer_vente(
            self.boutique, self.depot, self.patron, None, Vente.Statut.PAYEE,
            [{"variante": self.variante, "quantite": 2}],
            [{"mode": "especes", "montant": 3000}],
        )
        enregistrer_depense(self.depot, Depense.Categorie.TRANSPORT, 500, utilisateur=self.patron)
        enregistrer_apport(self.depot, 10000, utilisateur=self.patron)
        effectuer_retrait(self.depot, 2000, utilisateur=self.patron)
        ajuster_caisse(self.depot, 100, "Trop constaté", utilisateur=self.patron)
        ajuster_caisse(self.depot, -50, "Manquant constaté", utilisateur=self.patron)

        self.assertGreater(EcritureComptable.objects.count(), 0)
        for ecriture in EcritureComptable.objects.all():
            total_debit = sum((l.debit for l in ecriture.lignes.all()), Decimal("0"))
            total_credit = sum((l.credit for l in ecriture.lignes.all()), Decimal("0"))
            self.assertEqual(total_debit, total_credit, f"écriture {ecriture} déséquilibrée")


class VenteComptableTests(ComptabiliteTestsBase):
    def test_vente_especes_sans_tva(self):
        vente = creer_vente(
            self.boutique, self.depot, self.patron, None, Vente.Statut.PAYEE,
            [{"variante": self.variante, "quantite": 2}],
            [{"mode": "especes", "montant": 3000}],
        )
        ecriture = EcritureComptable.objects.get(
            reference_type="ventes.Paiement", reference_id=vente.paiements.first().id
        )
        lignes = _lignes(ecriture)
        self.assertEqual(lignes["571"], (3000, 0))
        self.assertEqual(lignes["701"], (0, 3000))
        self.assertNotIn("4431", lignes)

    def test_vente_avec_tva_decompose_ht_et_tva(self):
        Parametre.objects.create(boutique=self.boutique, cle="taux_tva", valeur="18")
        vente = creer_vente(
            self.boutique, self.depot, self.patron, None, Vente.Statut.PAYEE,
            [{"variante": self.variante, "quantite": 1, "prix_unitaire": 1180}],
            [{"mode": "especes", "montant": 1180}],
        )
        ecriture = EcritureComptable.objects.get(
            reference_type="ventes.Paiement", reference_id=vente.paiements.first().id
        )
        lignes = _lignes(ecriture)
        self.assertEqual(lignes["571"], (1180, 0))
        self.assertEqual(lignes["701"], (0, 1000))
        self.assertEqual(lignes["4431"], (0, 180))

    def test_vente_a_credit_puis_reglement(self):
        clientBoutique = Client.objects.create(boutique=self.boutique, nom="M. Traoré")
        vente = creer_vente(
            self.boutique, self.depot, self.patron, clientBoutique, Vente.Statut.CREDIT,
            [{"variante": self.variante, "quantite": 2}],
            [{"mode": "especes", "montant": 1000}, {"mode": "credit", "montant": 2000}],
        )
        paiement_credit = vente.paiements.get(mode="credit")
        ecriture_vente_credit = EcritureComptable.objects.get(
            reference_type="ventes.Paiement", reference_id=paiement_credit.id
        )
        lignes = _lignes(ecriture_vente_credit)
        self.assertEqual(lignes["411"], (2000, 0))
        self.assertEqual(lignes["701"], (0, 2000))

        credit = clientBoutique.credits.first()
        rembourser_credit(credit, 2000, mode="especes", depot=self.depot, utilisateur=self.patron)
        paiement_reglement = credit.paiements.get(mode="especes")
        ecriture_reglement = EcritureComptable.objects.get(
            reference_type="clients.PaiementCredit", reference_id=paiement_reglement.id
        )
        lignes_reglement = _lignes(ecriture_reglement)
        self.assertEqual(lignes_reglement["571"], (2000, 0))
        self.assertEqual(lignes_reglement["411"], (0, 2000))

    def test_annulation_vente_genere_une_contre_passation(self):
        vente = creer_vente(
            self.boutique, self.depot, self.patron, None, Vente.Statut.PAYEE,
            [{"variante": self.variante, "quantite": 1}],
            [{"mode": "especes", "montant": 1500}],
        )
        paiement = vente.paiements.first()
        annuler_vente(vente, self.patron)

        ecriture_annulation = EcritureComptable.objects.get(
            reference_type="ventes.Paiement:annulation", reference_id=paiement.id
        )
        lignes = _lignes(ecriture_annulation)
        self.assertEqual(lignes["701"], (1500, 0))
        self.assertEqual(lignes["571"], (0, 1500))


class AchatFournisseurComptableTests(ComptabiliteTestsBase):
    def test_reception_avec_dette_puis_paiement(self):
        """achats/services.py ne trace pas séparément un paiement immédiat
        partiel à la réception (aucun MouvementCaisse créé pour lui) : la
        réception finance donc tout le montant via 401, et seuls les
        paiements passant par payer_dette() (donc réellement tracés) ont
        leur propre écriture de trésorerie."""
        fournisseur = Fournisseur.objects.create(boutique=self.boutique, nom="Grossiste A")
        commande = creer_commande(
            self.boutique, fournisseur, self.patron, CommandeAchat.Statut.COMMANDEE,
            [{"variante": self.variante, "quantite": 10, "prix_achat": 1000}],
        )
        receptionner_commande(commande, self.depot, self.patron, montant_deja_paye=4000)

        ecriture = EcritureComptable.objects.get(
            reference_type="achats.CommandeAchat", reference_id=commande.id
        )
        lignes = _lignes(ecriture)
        self.assertEqual(lignes["601"], (10000, 0))
        self.assertEqual(lignes["401"], (0, 10000))
        self.assertNotIn("571", lignes)

        dette = fournisseur.dettes.first()
        payer_dette(dette, 6000, mode="especes", depot=self.depot, utilisateur=self.patron)
        paiement = dette.paiements.get(mode="especes")
        ecriture_paiement = EcritureComptable.objects.get(
            reference_type="fournisseurs.PaiementDetteFournisseur", reference_id=paiement.id
        )
        lignes_paiement = _lignes(ecriture_paiement)
        self.assertEqual(lignes_paiement["401"], (6000, 0))
        self.assertEqual(lignes_paiement["571"], (0, 6000))

    def test_reception_payee_integralement_sans_dette(self):
        fournisseur = Fournisseur.objects.create(boutique=self.boutique, nom="Grossiste B")
        commande = creer_commande(
            self.boutique, fournisseur, self.patron, CommandeAchat.Statut.COMMANDEE,
            [{"variante": self.variante, "quantite": 5, "prix_achat": 1000}],
        )
        receptionner_commande(commande, self.depot, self.patron, montant_deja_paye=5000)

        ecriture = EcritureComptable.objects.get(
            reference_type="achats.CommandeAchat", reference_id=commande.id
        )
        lignes = _lignes(ecriture)
        self.assertEqual(lignes["601"], (5000, 0))
        self.assertEqual(lignes["571"], (0, 5000))
        self.assertNotIn("401", lignes)
        self.assertFalse(fournisseur.dettes.exists())


class TresorerieComptableTests(ComptabiliteTestsBase):
    def test_depense_genere_charge(self):
        depense = enregistrer_depense(
            self.depot, Depense.Categorie.TRANSPORT, 500, utilisateur=self.patron
        )
        ecriture = EcritureComptable.objects.get(
            reference_type="tresorerie.Depense", reference_id=depense.id
        )
        lignes = _lignes(ecriture)
        self.assertEqual(lignes["61"], (500, 0))
        self.assertEqual(lignes["571"], (0, 500))

    def test_apport_et_retrait(self):
        apport = enregistrer_apport(self.depot, 10000, utilisateur=self.patron)
        ecriture_apport = EcritureComptable.objects.get(
            reference_type="tresorerie.MouvementCaisse", reference_id=apport.id
        )
        self.assertEqual(_lignes(ecriture_apport)["571"], (10000, 0))
        self.assertEqual(_lignes(ecriture_apport)["46"], (0, 10000))

        retrait = effectuer_retrait(self.depot, 2000, utilisateur=self.patron)
        ecriture_retrait = EcritureComptable.objects.get(
            reference_type="tresorerie.MouvementCaisse", reference_id=retrait.id
        )
        self.assertEqual(_lignes(ecriture_retrait)["46"], (2000, 0))
        self.assertEqual(_lignes(ecriture_retrait)["571"], (0, 2000))

    def test_ajustement_positif_et_negatif(self):
        excedent = ajuster_caisse(self.depot, 100, "Trop constaté", utilisateur=self.patron)
        ecriture_excedent = EcritureComptable.objects.get(
            reference_type="tresorerie.MouvementCaisse", reference_id=excedent.id
        )
        self.assertEqual(_lignes(ecriture_excedent)["571"], (100, 0))
        self.assertEqual(_lignes(ecriture_excedent)["758"], (0, 100))

        manquant = ajuster_caisse(self.depot, -50, "Manquant constaté", utilisateur=self.patron)
        ecriture_manquant = EcritureComptable.objects.get(
            reference_type="tresorerie.MouvementCaisse", reference_id=manquant.id
        )
        self.assertEqual(_lignes(ecriture_manquant)["658"], (50, 0))
        self.assertEqual(_lignes(ecriture_manquant)["571"], (0, 50))

    def test_transfert_mobile_money(self):
        vente = creer_vente(
            self.boutique, self.depot, self.patron, None, Vente.Statut.PAYEE,
            [{"variante": self.variante, "quantite": 1}],
            [{"mode": "mobile_money", "operateur": "orange_money", "montant": 1500}],
        )
        transfert = effectuer_transfert(
            self.depot, self.patron, "orange_money", 1500, utilisateur=self.patron
        )
        ecriture = EcritureComptable.objects.get(
            reference_type="tresorerie.Transfert", reference_id=transfert.id
        )
        lignes = _lignes(ecriture)
        self.assertEqual(lignes["571"], (1500, 0))
        self.assertEqual(lignes["552"], (0, 1500))

        ecriture_vente = EcritureComptable.objects.get(
            reference_type="ventes.Paiement", reference_id=vente.paiements.first().id
        )
        self.assertEqual(_lignes(ecriture_vente)["552"], (1500, 0))


class ComptabiliteAPITests(APITestCase):
    def setUp(self):
        self.boutique, self.patron = inscrire_boutique(
            {"nom": "Boutique Compta API"}, {"username": "patronComptaAPI", "password": "UnMotDePasseSolide123"}
        )
        self.depot = Depot.objects.create(boutique=self.boutique, nom="Magasin")
        produit = Produit.objects.create(boutique=self.boutique, nom="Article")
        self.variante = Variante.objects.create(produit=produit, prix_achat=1000, prix_vente=1500)
        appliquer_mouvement(self.variante, self.depot, MouvementStock.Type.ENTREE, 100)
        creer_vente(
            self.boutique, self.depot, self.patron, None, Vente.Statut.PAYEE,
            [{"variante": self.variante, "quantite": 2}],
            [{"mode": "especes", "montant": 3000}],
        )
        self.client.force_authenticate(user=self.patron)

    def test_liste_comptes(self):
        reponse = self.client.get(reverse("comptecomptable-list"))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        self.assertGreater(len(reponse.data), 0)

    def test_journal(self):
        reponse = self.client.get(reverse("comptabilite-journal"))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        comptes = {ligne["compte"] for ligne in reponse.data}
        self.assertIn("571", comptes)
        self.assertIn("701", comptes)

    def test_grand_livre(self):
        reponse = self.client.get(reverse("comptabilite-grand-livre"), {"compte": "571"})
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        self.assertEqual(reponse.data["solde_final"], 3000)

    def test_grand_livre_sans_compte_renvoie_400(self):
        reponse = self.client.get(reverse("comptabilite-grand-livre"))
        self.assertEqual(reponse.status_code, status.HTTP_400_BAD_REQUEST)

    def test_balance_generale_equilibree(self):
        reponse = self.client.get(reverse("comptabilite-balance"))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        self.assertEqual(reponse.data["total_debit"], reponse.data["total_credit"])

    def test_compte_de_resultat(self):
        reponse = self.client.get(reverse("comptabilite-resultat"))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        self.assertEqual(reponse.data["resultat_net"], 3000)

    def test_bilan(self):
        reponse = self.client.get(reverse("comptabilite-bilan"))
        self.assertEqual(reponse.status_code, status.HTTP_200_OK)
        self.assertEqual(reponse.data["total_actif"], reponse.data["total_passif"])

    def test_caissier_sans_permission_est_refuse(self):
        from comptes.models import Role, Utilisateur

        caissier = Utilisateur(
            boutique=self.boutique,
            role=Role.objects.get(boutique=self.boutique, nom="Caissier"),
            username="caissierComptaAPI",
        )
        caissier.set_password("UnMotDePasseSolide123")
        caissier.save()
        self.client.force_authenticate(user=caissier)

        reponse = self.client.get(reverse("comptabilite-journal"))
        self.assertEqual(reponse.status_code, status.HTTP_403_FORBIDDEN)
