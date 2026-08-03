"""
Adaptateurs d'envoi de notification — interface commune + implémentations
simulées. Aucune clé d'API WhatsApp Business/SMS n'est disponible dans cet
environnement : les mocks simulent toujours un envoi réussi. Pour brancher un
vrai prestataire, remplacer uniquement le corps de `envoyer` dans la classe
correspondante.
"""
from abc import ABC, abstractmethod


class AdaptateurNotification(ABC):
    @abstractmethod
    def envoyer(self, destinataire, message):
        """Retourne {"statut": ..., "donnees_brutes": {...}}."""


class AdaptateurWhatsApp(AdaptateurNotification):
    def envoyer(self, destinataire, message):
        return {
            "statut": "envoyee",
            "donnees_brutes": {"simule": True, "canal": "whatsapp", "destinataire": destinataire},
        }


class AdaptateurSms(AdaptateurNotification):
    def envoyer(self, destinataire, message):
        return {
            "statut": "envoyee",
            "donnees_brutes": {"simule": True, "canal": "sms", "destinataire": destinataire},
        }


class AdaptateurInterne(AdaptateurNotification):
    """Pas de réseau : une notification "interne" est considérée envoyée dès sa création."""

    def envoyer(self, destinataire, message):
        return {"statut": "envoyee", "donnees_brutes": {"simule": True, "canal": "interne"}}


_ADAPTATEURS = {
    "whatsapp": AdaptateurWhatsApp,
    "sms": AdaptateurSms,
    "interne": AdaptateurInterne,
}


def obtenir_adaptateur(canal):
    classe = _ADAPTATEURS.get(canal)
    if classe is None:
        raise ValueError(f"Canal de notification inconnu : {canal}")
    return classe()
