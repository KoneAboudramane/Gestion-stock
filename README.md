# gestion_stock

Application de gestion de stock et de vente pour commerçants (Afrique de l'Ouest).
Backend **Django + PostgreSQL** · Client **Electron + React + SQLite** · Fonctionnement **hors-ligne** avec synchronisation.

## Contenu du dossier

| Élément | Rôle |
|---|---|
| `CLAUDE.md` | **À lire en premier.** Référence complète des 30 modèles, relations et règles. |
| `docs/Cahier_des_charges_gestion_stock.docx` | Cahier des charges complet (contexte, techno, fonctions, plan). |
| `DEMARRAGE.md` | Message prêt à coller dans Claude Code + commandes de l'étape 0. |
| `config/` | Projet Django (settings, urls, wsgi/asgi). |
| `manage.py` | Commandes Django. |
| `requirements.txt` | Dépendances Python. |
| 10 apps | `core, comptes, catalogue, stock, ventes, achats, clients, fournisseurs, configuration, synchronisation` (les `models.py` sont déjà écrits). |

## Démarrage rapide (étape 0)

```bash
python -m venv .venv
# Windows :
.venv\Scripts\activate
pip install -r requirements.txt

python manage.py makemigrations
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Puis ouvrir http://127.0.0.1:8000/admin/. Si `makemigrations` passe sans erreur, la structure des données est validée.

> La base est en **SQLite** par défaut pour démarrer sans rien installer. Le passage à **PostgreSQL** est expliqué dans `config/settings.py`.

## Ce qui est fait / à faire

- **Fait** : structure du projet, les 10 apps, les 30 modèles (vérifiés), la configuration.
- **À construire** (par étapes, voir le cahier des charges §11) : admin, API (serializers + vues), logique métier (ventes → stock, achats → stock, crédits), rapports, API de synchronisation, puis le client Electron + React.

## Règle d'or

Travailler **une étape à la fois** et **tester** avant de passer à la suivante. Respecter les conventions du `CLAUDE.md` (UUID, `AUTH_USER_MODEL`, références `"app.Modele"`, stock au niveau variante+dépôt).
