"""
App notifications (Phase 2) : deux concepts distincts.
- Notification : alerte interne du système vers un utilisateur de l'appli
  (ex. rupture de stock sur son dépôt) — pas d'envoi, juste à lire.
- Message : communication sortante vers un client via un canal externe
  (WhatsApp/SMS) — rappel de crédit, ticket de vente. Squelette avec
  adaptateurs simulés (adaptateurs.py) en attendant les clés d'API réelles.
"""
from django.conf import settings
from django.db import models

from core.models import ModeleBase


class Notification(ModeleBase):
    """Alerte système interne (ex. rupture de stock). Pas de canal/destinataire/envoi."""

    class Type(models.TextChoices):
        ALERTE_RUPTURE = "alerte_rupture", "Alerte de rupture"

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="notifications"
    )
    # Dépôt concerné : permet à un caissier de ne voir que les notifications
    # de son propre dépôt, et au Patron/Gérant de filtrer par dépôt.
    depot = models.ForeignKey(
        "stock.Depot", on_delete=models.SET_NULL, null=True, blank=True, related_name="notifications"
    )
    type = models.CharField(max_length=20, choices=Type.choices, default=Type.ALERTE_RUPTURE)
    message = models.TextField()
    # Pointe vers le Stock concerné — sert au lien direct depuis le détail
    # de la notification (même pattern générique que stock.MouvementStock).
    reference_type = models.CharField(max_length=50, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)

    def __str__(self):
        return self.message


class Message(ModeleBase):
    """Communication sortante vers un client (WhatsApp/SMS) : rappel de crédit, ticket de vente."""

    class Type(models.TextChoices):
        RAPPEL_CREDIT = "rappel_credit", "Rappel de crédit"
        TICKET_WHATSAPP = "ticket_whatsapp", "Ticket WhatsApp"

    class Canal(models.TextChoices):
        SMS = "sms", "SMS"
        WHATSAPP = "whatsapp", "WhatsApp"
        INTERNE = "interne", "Interne (pas de téléphone connu, à traiter manuellement)"

    class Statut(models.TextChoices):
        EN_ATTENTE = "en_attente", "En attente"
        ENVOYEE = "envoyee", "Envoyée"
        ECHOUEE = "echouee", "Échouée"

    boutique = models.ForeignKey(
        "comptes.Boutique", on_delete=models.CASCADE, related_name="messages"
    )
    # Dépôt/caissier concernés (quand connus) : permettent au Patron/Gérant de
    # filtrer par dépôt ou par caissier. Nuls si non applicable (ex.
    # rappel_credit sans vente liée).
    depot = models.ForeignKey(
        "stock.Depot", on_delete=models.SET_NULL, null=True, blank=True, related_name="messages"
    )
    utilisateur = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="messages"
    )
    type = models.CharField(max_length=20, choices=Type.choices)
    canal = models.CharField(max_length=15, choices=Canal.choices, default=Canal.INTERNE)
    destinataire = models.CharField(max_length=150, blank=True)
    message = models.TextField()
    # Pointe vers un Credit ou une Vente selon `type` — sert au détail affiché
    # (montant/solde du crédit, ou lignes/total de la vente).
    reference_type = models.CharField(max_length=50, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)
    statut = models.CharField(max_length=15, choices=Statut.choices, default=Statut.EN_ATTENTE)
    date_envoi = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.get_type_display()} → {self.destinataire or '—'} ({self.statut})"
