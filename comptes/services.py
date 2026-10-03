"""
Logique métier de l'app comptes : inscription d'un commerçant (boutique + rôles
par défaut + premier utilisateur). Reprend la matrice de permissions du cahier
des charges (§7 "Rôles et permissions").
"""
import calendar
import secrets
from datetime import timedelta

from django.apps import apps
from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.mail import send_mail
from django.db import models, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .codes_vendeur import calculer_code_vendeur
from .models import (
    Boutique,
    DemandeInscription,
    DemandeRenouvellement,
    PaiementAbonnement,
    Role,
    Utilisateur,
)

# Durée de validité du code de réinitialisation envoyé par email : court
# volontairement (code à 5 chiffres, donc peu d'essais nécessaires pour le
# deviner par force brute) plutôt que les 3 jours par défaut d'un jeton long.
DUREE_VALIDITE_CODE_REINITIALISATION = timedelta(minutes=15)

# Même valeur que les clients (services/abonnement.ts::DELAI_GRACE_JOURS) : après la fin
# de l'abonnement, la vente reste permise ce nombre de jours, puis elle est bloquée.
DELAI_GRACE_ABONNEMENT = timedelta(days=3)

# Essai gratuit à l'ouverture d'une boutique, quelle que soit la formule (décision du 2026-10-03).
DUREE_ESSAI = timedelta(days=15)

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

    # Unités et attributs courants (carton, kilo, taille…), modifiables ensuite.
    from catalogue.catalogue_par_defaut import creer_catalogue_par_defaut

    creer_catalogue_par_defaut(boutique)

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
    attribuer_code_vendeur(utilisateur)
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
    enregistrer_periode_abonnement(
        boutique,
        date_expiration_abonnement,
        formule or demande.formule,
        nature=PaiementAbonnement.Nature.ESSAI,
        note="Période d'essai à l'ouverture du compte",
    )

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


@transaction.atomic
def enregistrer_periode_abonnement(
    boutique, date_fin, formule, nature, montant=0, mode="", reference="", note="", par=None
):
    """
    Ajoute une ligne au registre des abonnements (comptes.PaiementAbonnement)
    et en reporte la date de fin et la formule sur la boutique. Un paiement,
    un essai ou un geste offert démarre là où l'abonnement en cours s'arrête
    (point_depart_renouvellement) ; un ajustement corrige la date à partir
    d'aujourd'hui. `date_fin` None : sans limite.
    """
    debut = timezone.now() if nature == PaiementAbonnement.Nature.AJUSTEMENT else point_depart_renouvellement(boutique)
    periode = PaiementAbonnement.objects.create(
        boutique=boutique,
        nature=nature,
        formule=formule,
        date_debut=debut,
        date_fin=date_fin,
        montant=montant or 0,
        mode=mode or "",
        reference=reference or "",
        note=note or "",
        enregistre_par=par if par is not None and par.pk else None,
    )
    renouveler_abonnement(boutique, date_fin, formule=formule)
    return periode


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


@transaction.atomic
def supprimer_boutique_definitivement(boutique):
    """
    Supprime une boutique et tout son contenu (voir comptes/admin.py, bouton
    "Supprimer définitivement").

    Depot/Variante/Fournisseur/ExerciceComptable/JournalComptable/CompteComptable
    sont volontairement en on_delete=PROTECT (ventes.models, achats.models,
    comptabilite.models) pour empêcher de supprimer par erreur un objet encore
    référencé par une vente/un achat/une écriture. Mais Django ne fait pas
    d'exception pour un objet protégé qui serait lui-même supprimé dans la même
    cascade : `boutique.delete()` seul lève ProtectedError dès qu'une boutique a
    au moins une vente, un achat ou une écriture. On supprime donc d'abord,
    explicitement, les enregistrements qui portent ces FK protégées (leurs
    lignes suivent en CASCADE) ; le reste part normalement en CASCADE avec la
    boutique.
    """
    apps.get_model("ventes", "Vente").objects.filter(boutique=boutique).delete()
    apps.get_model("achats", "CommandeAchat").objects.filter(boutique=boutique).delete()
    apps.get_model("comptabilite", "EcritureComptable").objects.filter(boutique=boutique).delete()
    # Pertes et déstockages protègent aussi Variante/Depot (PROTECT).
    apps.get_model("stock", "PerteStock").objects.filter(depot__boutique=boutique).delete()
    apps.get_model("stock", "Detaillage").objects.filter(depot__boutique=boutique).delete()
    apps.get_model("stock", "Destockage").objects.filter(variante__produit__boutique=boutique).delete()
    boutique.delete()


def attribuer_code_vendeur(utilisateur):
    """Donne au compte son code vendeur s'il n'en a pas encore (voir comptes/codes_vendeur.py)."""
    if utilisateur.code_vendeur or not utilisateur.boutique_id:
        return
    codes_pris = (
        Utilisateur.objects.filter(boutique_id=utilisateur.boutique_id)
        .exclude(pk=utilisateur.pk)
        .values_list("code_vendeur", flat=True)
    )
    utilisateur.code_vendeur = calculer_code_vendeur(
        utilisateur.first_name, utilisateur.last_name, utilisateur.username, codes_pris
    )


# --- Demandes de renouvellement (paiement déclaré par le commerçant, validé par l'admin) ---


def ajouter_mois(date, mois):
    """Même jour `mois` mois plus tard (31 janvier + 1 mois = 28/29 février)."""
    total = date.month - 1 + mois
    annee, mois_cible = date.year + total // 12, total % 12 + 1
    jour = min(date.day, calendar.monthrange(annee, mois_cible)[1])
    return date.replace(year=annee, month=mois_cible, day=jour)


def demander_renouvellement(boutique, demandeur, formule, duree_mois, montant, mode, reference, note=""):
    reference = reference.strip()
    if DemandeRenouvellement.objects.filter(reference__iexact=reference).exclude(
        statut=DemandeRenouvellement.Statut.REJETEE
    ).exists() or PaiementAbonnement.objects.filter(reference__iexact=reference).exists():
        # Une même transaction ne paie qu'une fois.
        raise ValidationError({"reference": "Cette référence de transaction a déjà été déclarée."})
    demande = DemandeRenouvellement.objects.create(
        boutique=boutique,
        demandeur=demandeur,
        formule=formule,
        duree_mois=duree_mois,
        montant=montant,
        mode=mode,
        reference=reference,
        note=note,
    )
    if settings.ADMIN_EMAIL:
        send_mail(
            subject=f"Paiement d'abonnement à vérifier — {boutique.nom}",
            message=(
                f"Boutique : {boutique.nom}\n"
                f"Formule : {demande.get_formule_display()}, {demande.get_duree_mois_display()}\n"
                f"Montant : {montant} par {demande.get_mode_display()}\n"
                f"Référence : {reference}\n\n"
                "À valider dans l'espace admin : /admin/comptes/demanderenouvellement/"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[settings.ADMIN_EMAIL],
            fail_silently=True,
        )
    return demande


@transaction.atomic
def valider_demande_renouvellement(demande, par=None):
    """Inscrit la période payée au registre : elle démarre à la fin de l'abonnement en cours."""
    if demande.statut != DemandeRenouvellement.Statut.EN_ATTENTE:
        raise ValidationError("Cette demande a déjà été traitée.")
    boutique = demande.boutique
    fin = ajouter_mois(point_depart_renouvellement(boutique), demande.duree_mois)
    demande.paiement = enregistrer_periode_abonnement(
        boutique,
        fin,
        demande.formule,
        nature=PaiementAbonnement.Nature.PAIEMENT,
        montant=demande.montant,
        mode=demande.mode,
        reference=demande.reference,
        note=f"Déclaré dans l'appli ({demande.get_duree_mois_display()})",
        par=par,
    )
    demande.statut = DemandeRenouvellement.Statut.VALIDEE
    demande.traitee_par = par if par is not None and par.pk else None
    demande.date_traitement = timezone.now()
    demande.save()
    return demande


def rejeter_demande_renouvellement(demande, motif, par=None):
    if demande.statut != DemandeRenouvellement.Statut.EN_ATTENTE:
        raise ValidationError("Cette demande a déjà été traitée.")
    demande.statut = DemandeRenouvellement.Statut.REJETEE
    demande.motif_rejet = motif
    demande.traitee_par = par if par is not None and par.pk else None
    demande.date_traitement = timezone.now()
    demande.save()
    return demande


def demarrer_essai(boutique, par=None):
    """Essai gratuit de DUREE_ESSAI, inscrit au registre, pour une boutique qui vient d'être créée."""
    return enregistrer_periode_abonnement(
        boutique,
        timezone.now() + DUREE_ESSAI,
        boutique.formule,
        nature=PaiementAbonnement.Nature.ESSAI,
        note="Essai gratuit à l'ouverture du compte",
        par=par,
    )


def grille_tarifs():
    """Prix de chaque formule pour 1, 3, 6 et 12 mois (comptes.ReglagesPlateforme), arrondis à l'unité."""
    from decimal import ROUND_HALF_UP, Decimal

    from .models import ReglagesPlateforme

    reglages = ReglagesPlateforme.obtenir()
    remises = {1: Decimal(0), 3: reglages.remise_3_mois, 6: reglages.remise_6_mois, 12: reglages.remise_12_mois}
    tarifs = []
    for formule, mensuel in ((Boutique.Formule.ESSENTIEL, reglages.prix_mensuel_essentiel), (Boutique.Formule.PRO, reglages.prix_mensuel_pro)):
        if not mensuel:
            continue
        for mois, remise in remises.items():
            prix = (mensuel * mois * (100 - remise) / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
            tarifs.append({
                "formule": formule.value,
                "formule_libelle": formule.label,
                "duree_mois": mois,
                "prix": prix,
                "remise": remise,
            })
    return tarifs
