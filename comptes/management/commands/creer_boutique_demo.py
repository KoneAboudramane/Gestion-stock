from django.core.management.base import BaseCommand

from comptes.models import Boutique, Utilisateur
from comptes.services import attribuer_code_vendeur

BOUTIQUE_ID = "b1446d9a-1d5d-48e1-b4ca-6ba158ba9c01"
BOUTIQUE_NOM = "Quincaillerie Konate"
USERNAME = "demo"
PASSWORD = "Demo2026Kone!"


class Command(BaseCommand):
    help = "Crée (si absente) la boutique de démo et son compte, pour tester la synchro avec les données locales existantes."

    def handle(self, *args, **options):
        boutique, cree = Boutique.objects.get_or_create(
            id=BOUTIQUE_ID, defaults={"nom": BOUTIQUE_NOM}
        )
        if cree:
            self.stdout.write(self.style.SUCCESS(f"Boutique créée : {boutique.id}"))
        else:
            self.stdout.write(f"Boutique déjà existante : {boutique.id}")

        if Utilisateur.objects.filter(username=USERNAME).exists():
            self.stdout.write(f"Utilisateur '{USERNAME}' déjà existant, rien à faire.")
        else:
            utilisateur = Utilisateur(username=USERNAME, boutique=boutique)
            utilisateur.set_password(PASSWORD)
            attribuer_code_vendeur(utilisateur)
            utilisateur.save()
            self.stdout.write(self.style.SUCCESS(f"Utilisateur '{USERNAME}' créé."))

        self.stdout.write(self.style.SUCCESS("OK"))
