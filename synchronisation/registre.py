"""
Registre déclaratif des tables synchronisables, dans l'ordre imposé par le
cahier des charges §9.2 (parent avant enfant).

`stock.Stock` est volontairement absent : recalculé à partir des
`MouvementStock`, jamais synchronisé directement (§9.3). `catalogue.VarianteValeur`
a sa propre entrée (le moteur générique n'itère que les champs concrets du
modèle réel : `valeur_attribut_ids` de l'API interactive est un concept du
serializer, pas un champ de `Variante`, donc ne peut pas être synchronisé de
façon imbriquée). `comptes.Utilisateur`/`Role`/`JournalSync` restent hors
registre (flux dédiés / usage interne).
"""
from dataclasses import dataclass

from django.apps import apps


@dataclass(frozen=True)
class EntreeRegistre:
    app_label: str
    nom_modele: str
    chemin_boutique: str
    ajout_seul: bool = False

    @property
    def table(self):
        return f"{self.app_label}.{self.nom_modele}"

    def modele(self):
        return apps.get_model(self.app_label, self.nom_modele)


REGISTRE = [
    EntreeRegistre("comptes", "Boutique", "__self__"),
    EntreeRegistre("catalogue", "Categorie", "boutique"),
    EntreeRegistre("catalogue", "Unite", "boutique"),
    EntreeRegistre("catalogue", "Produit", "boutique"),
    EntreeRegistre("catalogue", "Attribut", "boutique"),
    EntreeRegistre("catalogue", "ValeurAttribut", "attribut__boutique"),
    EntreeRegistre("catalogue", "Variante", "produit__boutique"),
    EntreeRegistre("catalogue", "VarianteValeur", "variante__produit__boutique"),
    EntreeRegistre("stock", "Depot", "boutique"),
    EntreeRegistre("clients", "Client", "boutique"),
    EntreeRegistre("fournisseurs", "Fournisseur", "boutique"),
    EntreeRegistre("ventes", "Vente", "boutique"),
    EntreeRegistre("achats", "CommandeAchat", "boutique"),
    EntreeRegistre("ventes", "LigneVente", "vente__boutique"),
    EntreeRegistre("ventes", "Paiement", "vente__boutique"),
    EntreeRegistre("achats", "LigneAchat", "commande__boutique"),
    EntreeRegistre("achats", "Reception", "commande__boutique"),
    EntreeRegistre("stock", "MouvementStock", "depot__boutique", ajout_seul=True),
    EntreeRegistre("stock", "TransfertStock", "depot_source__boutique", ajout_seul=True),
    EntreeRegistre("stock", "Inventaire", "boutique"),
    EntreeRegistre("stock", "LigneInventaire", "inventaire__boutique"),
    EntreeRegistre("clients", "Credit", "client__boutique"),
    EntreeRegistre("clients", "PaiementCredit", "credit__client__boutique"),
    EntreeRegistre("fournisseurs", "DetteFournisseur", "fournisseur__boutique"),
    EntreeRegistre("paiements", "TransactionMobileMoney", "paiement__vente__boutique"),
    EntreeRegistre("notifications", "Notification", "boutique"),
    EntreeRegistre("notifications", "Message", "boutique"),
    EntreeRegistre("configuration", "Parametre", "boutique"),
]

_PAR_TABLE = {entree.table: entree for entree in REGISTRE}


def resoudre(table):
    return _PAR_TABLE.get(table)


def pour_pull():
    return REGISTRE
