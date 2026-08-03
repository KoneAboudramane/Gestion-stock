"""
Adaptateurs mobile money — interface commune + implémentations simulées.
Aucune clé d'API Wave/Orange Money/MTN n'est disponible dans cet environnement :
chaque adaptateur simule une réponse "réussie" avec une référence factice.
Pour brancher le vrai prestataire, remplacer uniquement le corps de `initier`
dans la classe correspondante (le reste de l'app — modèle, service, vue —
n'a pas à changer).
"""
from abc import ABC, abstractmethod
from uuid import uuid4


class AdaptateurMobileMoney(ABC):
    @abstractmethod
    def initier(self, numero_telephone, montant):
        """Retourne {"statut": ..., "reference_externe": ..., "donnees_brutes": {...}}."""


class _AdaptateurSimule(AdaptateurMobileMoney):
    """Base commune aux 3 mocks : toujours "réussie", référence MOCK-xxxxxxxxxx."""

    prefixe_reference = "MOCK"

    def initier(self, numero_telephone, montant):
        reference = f"{self.prefixe_reference}-{uuid4().hex[:10].upper()}"
        return {
            "statut": "reussie",
            "reference_externe": reference,
            "donnees_brutes": {
                "simule": True,
                "numero_telephone": numero_telephone,
                "montant": str(montant),
                "reference": reference,
            },
        }


class AdaptateurWave(_AdaptateurSimule):
    prefixe_reference = "MOCK-WAVE"


class AdaptateurOrangeMoney(_AdaptateurSimule):
    prefixe_reference = "MOCK-OM"


class AdaptateurMTN(_AdaptateurSimule):
    prefixe_reference = "MOCK-MTN"


_ADAPTATEURS = {
    "wave": AdaptateurWave,
    "orange_money": AdaptateurOrangeMoney,
    "mtn": AdaptateurMTN,
}


def obtenir_adaptateur(fournisseur):
    classe = _ADAPTATEURS.get(fournisseur)
    if classe is None:
        raise ValueError(f"Fournisseur mobile money inconnu : {fournisseur}")
    return classe()
