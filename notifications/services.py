"""
Logique métier de l'app notifications :
- Notification (interne) : détection des ruptures de stock.
- Message (externe) : rappels de crédit, ticket WhatsApp d'une vente, et
  envoi (simulé) via adaptateurs.py.
Déclenchement manuel depuis le client — pas de tâche planifiée en V1/Phase 2.
"""
from django.db.models import F
from django.utils import timezone

from clients.models import Credit
from stock.models import Stock

from .adaptateurs import obtenir_adaptateur
from .models import Message, Notification

FENETRE_ANTI_DOUBLON_HEURES = 24


def _recente_existe(modele, boutique, type_notif, reference_id):
    seuil = timezone.now() - timezone.timedelta(hours=FENETRE_ANTI_DOUBLON_HEURES)
    return modele.objects.filter(
        boutique=boutique, type=type_notif, reference_id=reference_id, date_creation__gte=seuil,
    ).exists()


def generer_alertes_rupture(boutique):
    stocks_en_rupture = Stock.objects.filter(
        depot__boutique=boutique, quantite__lte=F("variante__seuil_alerte")
    )
    notifications_creees = []
    for stock in stocks_en_rupture:
        if _recente_existe(Notification, boutique, Notification.Type.ALERTE_RUPTURE, stock.id):
            continue
        message = (
            f"Rupture de stock : {stock.variante.produit.nom} ({stock.depot.nom}) — "
            f"{stock.quantite} restant(s)"
        )
        notifications_creees.append(
            Notification.objects.create(
                boutique=boutique,
                depot=stock.depot,
                type=Notification.Type.ALERTE_RUPTURE,
                message=message,
                reference_type="stock.Stock",
                reference_id=stock.id,
            )
        )
    return notifications_creees


def generer_rappels_credit(boutique):
    credits_en_cours = Credit.objects.filter(client__boutique=boutique, statut=Credit.Statut.EN_COURS)
    messages_crees = []
    for credit in credits_en_cours:
        if _recente_existe(Message, boutique, Message.Type.RAPPEL_CREDIT, credit.id):
            continue
        message = f"Rappel : {credit.client.nom} doit {credit.solde} FCFA"
        if credit.echeance:
            message += f" (échéance {credit.echeance})"
        messages_crees.append(
            Message.objects.create(
                boutique=boutique,
                # Un Credit n'a pas toujours de vente liée (crédit ouvert
                # manuellement) : pas de dépôt connu dans ce cas.
                depot=credit.vente.depot if credit.vente_id else None,
                type=Message.Type.RAPPEL_CREDIT,
                canal=Message.Canal.WHATSAPP if credit.client.telephone else Message.Canal.INTERNE,
                destinataire=credit.client.telephone,
                message=message,
                reference_type="clients.Credit",
                reference_id=credit.id,
            )
        )
    return messages_crees


def generer_ticket_whatsapp(vente):
    lignes_texte = "\n".join(
        f"- {ligne.variante.produit.nom} x{ligne.quantite} = {ligne.sous_total} FCFA"
        for ligne in vente.lignes.all()
    )
    message = f"Ticket {vente.numero}\n{lignes_texte}\nTotal : {vente.total_net} FCFA"
    destinataire = ""
    if vente.client_id and vente.client.telephone:
        destinataire = vente.client.telephone

    return Message.objects.create(
        boutique=vente.boutique,
        depot=vente.depot,
        utilisateur=vente.utilisateur,
        type=Message.Type.TICKET_WHATSAPP,
        canal=Message.Canal.WHATSAPP if destinataire else Message.Canal.INTERNE,
        destinataire=destinataire,
        message=message,
        reference_type="ventes.Vente",
        reference_id=vente.id,
    )


def envoyer_message(message):
    adaptateur = obtenir_adaptateur(message.canal)
    resultat = adaptateur.envoyer(message.destinataire, message.message)
    message.statut = resultat["statut"]
    message.date_envoi = timezone.now()
    message.save(update_fields=["statut", "date_envoi", "date_modification"])
    return message
