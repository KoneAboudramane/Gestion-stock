from django.core.management.base import BaseCommand, CommandError

from comptabilite.models import CompteComptable
from comptabilite.plan_comptable import construire_entrees
from comptes.models import Boutique


class Command(BaseCommand):
    help = (
        "Crée le plan comptable SYSCOHADA standard pour une boutique. "
        "Les comptes déjà présents (même numéro) sont laissés intacts."
    )

    def add_arguments(self, parser):
        parser.add_argument("boutique_id", type=str)

    def handle(self, *args, **options):
        boutique_id = options["boutique_id"]
        try:
            boutique = Boutique.objects.get(pk=boutique_id)
        except Boutique.DoesNotExist as exc:
            raise CommandError(f"Boutique introuvable : {boutique_id}") from exc

        existants = set(
            CompteComptable.objects.filter(boutique=boutique).values_list("numero", flat=True)
        )
        entrees = construire_entrees()
        # Trie par longueur de numéro pour rattacher les comptes parents
        # avant leurs sous-comptes.
        entrees.sort(key=lambda e: len(e[0]))

        comptes_par_numero = {}
        crees = 0
        for numero, libelle, classe in entrees:
            if numero in existants:
                comptes_par_numero[numero] = CompteComptable.objects.get(
                    boutique=boutique, numero=numero
                )
                continue
            parent = None
            if len(numero) > 2:
                parent = comptes_par_numero.get(numero[:-1])
            compte = CompteComptable.objects.create(
                boutique=boutique,
                numero=numero,
                libelle=libelle,
                classe=classe,
                compte_parent=parent,
            )
            comptes_par_numero[numero] = compte
            crees += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"{crees} compte(s) créé(s) pour {boutique.nom} "
                f"({len(entrees) - crees} déjà présents)."
            )
        )
