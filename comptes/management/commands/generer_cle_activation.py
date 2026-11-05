"""Crée la paire de clés des codes d'activation (docs/plan_reseau_local.md, lot 6).

La clé PRIVÉE va dans la variable d'environnement ACTIVATION_CLE_PRIVEE du serveur
(fichier .env, jamais dans le dépôt) ; la clé PUBLIQUE est embarquée dans l'appli
(client-electron/electron/services/activation.ts, CLE_PUBLIQUE_ACTIVATION).
Changer de paire invalide tous les codes déjà donnés.
"""
import base64
import secrets

from django.core.management.base import BaseCommand

from comptes.activation import cle_publique


class Command(BaseCommand):
    help = "Crée une paire de clés Ed25519 pour les codes d'activation de l'abonnement."

    def handle(self, *args, **options):
        graine = secrets.token_bytes(32)
        self.stdout.write("Clé privée (serveur, .env) :")
        self.stdout.write(f"ACTIVATION_CLE_PRIVEE={base64.b64encode(graine).decode()}")
        self.stdout.write("Clé publique (appli, CLE_PUBLIQUE_ACTIVATION) :")
        self.stdout.write(base64.b64encode(cle_publique(graine)).decode())
