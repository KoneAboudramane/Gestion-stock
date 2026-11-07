"""
Droits des administrateurs secondaires, cochés un par un par le superuser.

Le superuser (admin principal) a tout, plus ce qui lui est réservé : gérer les
administrateurs, les réglages de la plateforme (tarifs, numéros), le journal
et l'activation de la double vérification.
"""

DROITS = {
    "boutiques": "Voir les boutiques et modifier leurs accès (synchronisation, activation)",
    "inscriptions": "Traiter les demandes d'inscription",
    "creer_boutique": "Créer une boutique",
    "paiements": "Valider les paiements et tenir le registre des abonnements",
    "demandes_reseau": "Traiter les demandes de réseau",
    "signalements": "Traiter les signalements",
    "comptes": "Gérer les comptes et mots de passe des boutiques",
    "laissez_passer": "Générer des laissez-passer (Espace Admin d'un appareil sans internet)",
}

# Réservé au superuser, jamais attribuable à un autre administrateur.
RESERVE_SUPERUSER = {
    "admins": "Gérer les administrateurs et leur double vérification",
    "reglages_plateforme": "Modifier les réglages de la plateforme (tarifs, numéros)",
    "journal": "Consulter le journal des actions",
}


def droits_valides(droits):
    """Ne garde que les clés connues, sans doublon, dans l'ordre du catalogue."""
    demandes = set(droits or [])
    return [cle for cle in DROITS if cle in demandes]
