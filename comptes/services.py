"""
Logique métier de l'app comptes : inscription d'un commerçant (boutique + rôles
par défaut + premier utilisateur). Reprend la matrice de permissions du cahier
des charges (§7 "Rôles et permissions").
"""
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.mail import send_mail
from django.db import models, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Boutique, DemandeInscription, Role, Utilisateur

# Durée de validité du code de réinitialisation envoyé par email : court
# volontairement (code à 5 chiffres, donc peu d'essais nécessaires pour le
# deviner par force brute) plutôt que les 3 jours par défaut d'un jeton long.
DUREE_VALIDITE_CODE_REINITIALISATION = timedelta(minutes=15)

ROLES_PAR_DEFAUT = {
    "Patron": {
        "vendre": True,
        "consulter_stock": True,
        "gerer_clients": True,
        "gerer_produits_stock_achats": True,
        "voir_benefices_achat": True,
        "modifier_prix": True,
        "annuler_vente": True,
        "voir_rapports_complets": True,
        "gerer_utilisateurs_reglages": True,
        "consulter_tresorerie": True,
        "enregistrer_depense": True,
        "gerer_tresorerie": True,
        "consulter_comptabilite": True,
    },
    "Gérant": {
        "vendre": True,
        "consulter_stock": True,
        "gerer_clients": True,
        "gerer_produits_stock_achats": True,
        "voir_benefices_achat": True,
        "modifier_prix": True,
        "annuler_vente": True,
        "voir_rapports_complets": True,
        "gerer_utilisateurs_reglages": False,
        "consulter_tresorerie": True,
        "enregistrer_depense": True,
        "gerer_tresorerie": True,
        "consulter_comptabilite": True,
    },
    "Caissier": {
        "vendre": True,
        "consulter_stock": True,
        "gerer_clients": True,
        "gerer_produits_stock_achats": False,
        "voir_benefices_achat": False,
        "modifier_prix": False,
        # "Sur autorisation" dans le cahier des charges : pas de mécanisme
        # d'autorisation ponctuelle dans les modèles V1 -> refusé par défaut.
        "annuler_vente": False,
        "voir_rapports_complets": False,
        "gerer_utilisateurs_reglages": False,
        "consulter_tresorerie": True,
        "enregistrer_depense": True,
        # Retrait/Apport/Ajustement de caisse : réservés Patron/Gérant (décision
        # utilisateur, voir mémoire projet "caisse_tresorerie_depenses").
        "gerer_tresorerie": False,
        # Comptabilité (journal, bilan...) : réservée Patron/Gérant.
        "consulter_comptabilite": False,
    },
}


@transaction.atomic
def inscrire_boutique(donnees_boutique, donnees_utilisateur, mot_de_passe_deja_hache=False):
    """
    Crée une nouvelle boutique, ses 3 rôles par défaut, et son premier
    utilisateur (Patron).

    `mot_de_passe_deja_hache` : utilisé par `approuver_inscription`, qui ne
    dispose que du hash stocké dans la demande (jamais le mot de passe en
    clair) — le champ `password` d'un Utilisateur Django est déjà un hash,
    pas besoin de repasser par `set_password()` dans ce cas.
    """
    boutique = Boutique.objects.create(**donnees_boutique)

    roles = {
        nom: Role.objects.create(boutique=boutique, nom=nom, permissions=permissions)
        for nom, permissions in ROLES_PAR_DEFAUT.items()
    }

    mot_de_passe = donnees_utilisateur.pop("password")
    utilisateur = Utilisateur(
        boutique=boutique,
        role=roles["Patron"],
        is_staff=False,
        is_superuser=False,
        **donnees_utilisateur,
    )
    if mot_de_passe_deja_hache:
        utilisateur.password = mot_de_passe
    else:
        utilisateur.set_password(mot_de_passe)
    utilisateur.save()

    return boutique, utilisateur


def demande_en_attente_existe(username=None, email=None):
    """Utilisé par InscriptionSerializer pour éviter les doublons de demandes."""
    filtre = models.Q()
    if username:
        filtre |= models.Q(username=username)
    if email:
        filtre |= models.Q(email__iexact=email)
    if not filtre:
        return False
    return DemandeInscription.objects.filter(statut=DemandeInscription.Statut.EN_ATTENTE).filter(filtre).exists()


def demander_inscription(donnees_boutique, donnees_utilisateur, formule=Boutique.Formule.ESSENTIEL):
    """
    Enregistre une demande d'ouverture de boutique — ne crée ni Boutique ni
    Utilisateur : ça n'arrive qu'à la validation par l'administrateur (voir
    `approuver_inscription`). Prévient l'administrateur par email.
    """
    demande = DemandeInscription.objects.create(
        boutique_nom=donnees_boutique["nom"],
        boutique_adresse=donnees_boutique.get("adresse", ""),
        boutique_telephone=donnees_boutique.get("telephone", ""),
        boutique_email=donnees_boutique.get("email", ""),
        boutique_devise=donnees_boutique.get("devise") or "FCFA",
        username=donnees_utilisateur["username"],
        email=donnees_utilisateur["email"],
        telephone=donnees_utilisateur.get("telephone", ""),
        first_name=donnees_utilisateur.get("first_name", ""),
        last_name=donnees_utilisateur.get("last_name", ""),
        mot_de_passe_hash=make_password(donnees_utilisateur["password"]),
        formule=formule,
    )

    if settings.ADMIN_EMAIL:
        send_mail(
            subject=f"Nouvelle demande d'inscription — {demande.boutique_nom}",
            message=(
                f"Boutique : {demande.boutique_nom}\n"
                f"Contact : {demande.username} ({demande.email}, {demande.telephone or 'pas de téléphone'})\n"
                f"Formule demandée : {demande.get_formule_display()}\n\n"
                "À valider dans l'espace admin : /admin/comptes/demandeinscription/"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[settings.ADMIN_EMAIL],
        )

    return demande


@transaction.atomic
def approuver_inscription(demande, date_expiration_abonnement, formule=None):
    """
    Crée la vraie boutique/rôles/Patron à partir d'une demande, et fixe la
    période d'abonnement de départ. `formule` : reprend celle demandée par le
    client si non précisée (l'admin peut la changer à l'approbation, ex. si
    un accord différent a été négocié).
    """
    if demande.statut != DemandeInscription.Statut.EN_ATTENTE:
        raise ValidationError("Cette demande a déjà été traitée.")

    boutique, utilisateur = inscrire_boutique(
        {
            "nom": demande.boutique_nom,
            "adresse": demande.boutique_adresse,
            "telephone": demande.boutique_telephone,
            "email": demande.boutique_email,
            "devise": demande.boutique_devise,
        },
        {
            "username": demande.username,
            "password": demande.mot_de_passe_hash,
            "email": demande.email,
            "telephone": demande.telephone,
            "first_name": demande.first_name,
            "last_name": demande.last_name,
        },
        mot_de_passe_deja_hache=True,
    )
    boutique.date_expiration_abonnement = date_expiration_abonnement
    boutique.formule = formule or demande.formule
    boutique.save(update_fields=["date_expiration_abonnement", "formule"])

    demande.statut = DemandeInscription.Statut.APPROUVEE
    demande.save(update_fields=["statut"])

    send_mail(
        subject="Votre compte Gestion Stock est prêt",
        message=(
            f"Bonjour {demande.username},\n\n"
            f"Votre boutique « {demande.boutique_nom} » a été validée.\n"
            "Connectez-vous dans l'application avec le nom d'utilisateur et le mot de passe que vous aviez choisis."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[demande.email],
    )

    return boutique, utilisateur


def point_depart_renouvellement(boutique):
    """
    D'où repart un renouvellement : si l'abonnement en cours n'est pas encore
    expiré, le client ne doit pas perdre les jours déjà payés — sinon on
    repart simplement d'aujourd'hui.
    """
    maintenant = timezone.now()
    expiration_actuelle = boutique.date_expiration_abonnement
    if expiration_actuelle and expiration_actuelle > maintenant:
        return expiration_actuelle
    return maintenant


def renouveler_abonnement(boutique, date_expiration_abonnement, formule=None):
    """Prolonge/modifie l'abonnement d'une boutique déjà active (voir comptes/admin.py)."""
    boutique.date_expiration_abonnement = date_expiration_abonnement
    if formule:
        boutique.formule = formule
    boutique.save(update_fields=["date_expiration_abonnement", "formule", "date_modification"])
    return boutique


def rejeter_inscription(demande):
    if demande.statut != DemandeInscription.Statut.EN_ATTENTE:
        raise ValidationError("Cette demande a déjà été traitée.")

    demande.statut = DemandeInscription.Statut.REJETEE
    demande.save(update_fields=["statut"])

    send_mail(
        subject="Votre demande d'inscription — Gestion Stock",
        message=(
            f"Bonjour {demande.username},\n\n"
            f"Votre demande pour « {demande.boutique_nom} » n'a pas été retenue. "
            "Contactez-nous si vous pensez qu'il s'agit d'une erreur."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[demande.email],
    )


def _patron_par_email(email):
    return Utilisateur.objects.filter(email__iexact=email, role__nom="Patron", is_active=True).first()


def demander_reinitialisation_mot_de_passe(email):
    """
    Envoie un code de réinitialisation par email au compte Patron correspondant.
    Ne révèle jamais si l'email correspond à un compte (réponse générique côté vue) :
    silencieux si aucun Patron actif ne porte cet email.
    """
    utilisateur = _patron_par_email(email)
    if not utilisateur:
        return

    code = "".join(secrets.choice("0123456789") for _ in range(5))
    utilisateur.code_reinitialisation = code
    utilisateur.code_reinitialisation_expire_le = timezone.now() + DUREE_VALIDITE_CODE_REINITIALISATION
    utilisateur.save(update_fields=["code_reinitialisation", "code_reinitialisation_expire_le"])

    send_mail(
        subject="Réinitialisation de votre mot de passe — Gestion Stock",
        message=(
            f"Bonjour {utilisateur.username},\n\n"
            f"Voici votre code de réinitialisation : {code}\n\n"
            "Ce code est valable 15 minutes. Saisissez-le dans l'application avec votre nouveau mot de passe.\n\n"
            "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[utilisateur.email],
    )


def reinitialiser_mot_de_passe(email, code, nouveau_mot_de_passe):
    utilisateur = _patron_par_email(email)
    code_valide = (
        utilisateur
        and utilisateur.code_reinitialisation
        and secrets.compare_digest(utilisateur.code_reinitialisation, code)
        and utilisateur.code_reinitialisation_expire_le
        and utilisateur.code_reinitialisation_expire_le > timezone.now()
    )
    if not code_valide:
        raise ValidationError("Code invalide ou expiré.")

    utilisateur.set_password(nouveau_mot_de_passe)
    utilisateur.code_reinitialisation = ""
    utilisateur.code_reinitialisation_expire_le = None
    utilisateur.save(update_fields=["password", "code_reinitialisation", "code_reinitialisation_expire_le"])
