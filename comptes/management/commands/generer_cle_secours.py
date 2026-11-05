import json

from django.core.management.base import BaseCommand

from comptes.secours import cle_publique_jwk, generer_paire, valeur_variable_environnement


class Command(BaseCommand):
    help = (
        "Génère la paire de clés de la « clé de secours » des sauvegardes : la clé privée va dans "
        "SECOURS_CLE_PRIVEE (serveur seulement, jamais dans le dépôt), la clé publique dans l'appli "
        "(client-electron/electron/services/sauvegarde.ts, CLE_PUBLIQUE_SECOURS)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--bits", type=int, default=3072)

    def handle(self, *args, **options):
        self.stdout.write("Génération en cours (quelques secondes)…")
        paire = generer_paire(options["bits"])
        self.stdout.write("\nÀ mettre dans le .env du serveur (SECRET, ne jamais publier) :\n")
        self.stdout.write(f"SECOURS_CLE_PRIVEE={valeur_variable_environnement(paire)}\n")
        self.stdout.write("\nClé publique pour l'appli (CLE_PUBLIQUE_SECOURS) :\n")
        self.stdout.write(json.dumps(cle_publique_jwk(paire)) + "\n")
