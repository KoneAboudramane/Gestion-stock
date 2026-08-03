"""
Logique métier de l'app paiements : initier une transaction mobile money pour
un ventes.Paiement existant. Ne crée jamais le Paiement lui-même (déjà créé
par ventes/services.py::creer_vente) — se contente de tracer la tentative
auprès du prestataire simulé.
"""
from django.db import transaction

from .adaptateurs import obtenir_adaptateur
from .models import TransactionMobileMoney


@transaction.atomic
def initier_paiement_mobile_money(paiement, fournisseur, numero_telephone):
    adaptateur = obtenir_adaptateur(fournisseur)
    resultat = adaptateur.initier(numero_telephone, paiement.montant)

    return TransactionMobileMoney.objects.create(
        paiement=paiement,
        fournisseur=fournisseur,
        numero_telephone=numero_telephone,
        montant=paiement.montant,
        statut=resultat["statut"],
        reference_externe=resultat["reference_externe"],
        donnees_brutes=resultat["donnees_brutes"],
    )
