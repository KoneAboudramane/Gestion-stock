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
        # Il reste du gros (cartons) dans ce dépôt : détailler plutôt que commander.
        stock_gros = (
            Stock.objects.filter(
                depot=stock.depot, variante__variante_detail=stock.variante,
                variante__supprime=False, quantite__gt=0,
            ).select_related("variante__produit").order_by("-quantite").first()
        )
        if stock_gros:
            message += (
                f" — il reste {stock_gros.quantite:g} « {stock_gros.variante.produit.nom} » : "
                "déballez-en un plutôt que de commander."
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


def _montant(valeur):
    return f"{round(valeur or 0):,}".replace(",", " ")


def texte_rappel_credit(credit):
    """Rappel adressé au client (envoyable tel quel par WhatsApp), dans la devise de la boutique."""
    boutique = credit.client.boutique
    texte = (
        f"Bonjour {credit.client.nom}, petit rappel de {boutique.nom} : "
        f"il reste {_montant(credit.solde)} {boutique.devise or 'FCFA'} à régler"
    )
    if credit.echeance:
        texte += f" (échéance le {credit.echeance:%d/%m/%Y})"
    return texte + ". Merci !"


def generer_rappels_credit(boutique):
    credits_en_cours = Credit.objects.filter(client__boutique=boutique, statut=Credit.Statut.EN_COURS)
    messages_crees = []
    for credit in credits_en_cours:
        message = texte_rappel_credit(credit)
        # Un seul rappel en attente par crédit : mis à jour (montant dû actuel),
        # doublons retirés, au lieu d'en empiler un par jour.
        en_attente = list(
            Message.objects.filter(
                boutique=boutique, type=Message.Type.RAPPEL_CREDIT, reference_id=credit.id,
                statut=Message.Statut.EN_ATTENTE, supprime=False,
            ).order_by("-date_creation")
        )
        if en_attente:
            for doublon in en_attente[1:]:
                doublon.supprime = True
                doublon.save(update_fields=["supprime", "date_modification"])
            if en_attente[0].message != message:
                en_attente[0].message = message
                en_attente[0].destinataire = credit.client.telephone
                en_attente[0].canal = Message.Canal.WHATSAPP if credit.client.telephone else Message.Canal.INTERNE
                en_attente[0].save(update_fields=["message", "destinataire", "canal", "date_modification"])
            continue
        if _recente_existe(Message, boutique, Message.Type.RAPPEL_CREDIT, credit.id):
            continue
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
    # Rappels encore en attente pour un crédit soldé ou supprimé : devenus sans objet.
    ids_en_cours = {credit.id for credit in credits_en_cours}
    obsoletes = Message.objects.filter(
        boutique=boutique, type=Message.Type.RAPPEL_CREDIT, statut=Message.Statut.EN_ATTENTE, supprime=False,
    ).exclude(reference_id__in=ids_en_cours)
    for message in obsoletes:
        message.supprime = True
        message.save(update_fields=["supprime", "date_modification"])
    return messages_crees


def generer_ticket_whatsapp(vente):
    devise = vente.boutique.devise or "FCFA"
    lignes_texte = "\n".join(
        f"- {ligne.variante.produit.nom} x{ligne.quantite} = {_montant(ligne.sous_total)} {devise}"
        for ligne in vente.lignes.all()
    )
    message = f"Ticket {vente.numero}\n{lignes_texte}\nTotal : {_montant(vente.total_net)} {devise}"
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
