# Démarrer avec Claude Code

Ouvre Claude Code **à la racine de ce dossier** (`gestion_stock`), celui qui contient `CLAUDE.md`.
Claude Code lira automatiquement `CLAUDE.md`. Avance **une étape à la fois**.

---

## Message à coller dans Claude Code pour l'étape 0

> Lis d'abord `CLAUDE.md` et `docs/Cahier_des_charges_gestion_stock.docx` pour comprendre le projet.
> Nous démarrons l'**étape 0 (mise en place)**. Les 10 apps et leurs `models.py` existent déjà — ne modifie pas la structure des modèles décrite dans `CLAUDE.md`.
> Fais ceci :
> 1. Vérifie que le projet se lance : `python manage.py makemigrations` puis `python manage.py migrate`.
> 2. Corrige uniquement les éventuelles erreurs de configuration (sans changer la logique des modèles).
> 3. Crée un `admin.py` dans chaque app pour enregistrer tous les modèles dans l'espace d'administration Django.
> 4. Crée un super-utilisateur et confirme que l'admin affiche bien toutes les tables.
> Explique-moi chaque commande, et arrête-toi à la fin de l'étape 0 pour que je teste avant de continuer.

---

## Étapes suivantes (une à la fois)

- **Étape 1 — Comptes** : authentification, boutique, rôles, JWT, isolation par boutique.
- **Étape 2 — Catalogue** : produits, catégories, unités, attributs, variantes (+ variante par défaut).
- **Étape 3 — Stock** : dépôts, stock, mouvements, transferts, inventaire, alertes.
- **Étape 4 — Ventes & caisse** : vente → sortie de stock auto ; vente à crédit → crédit client.
- **Étape 5 — Achats** : commandes, réception → entrée de stock, dettes fournisseurs.
- **Étape 6 — Clients & crédit** : fiches, crédits, remboursements.
- **Étape 7 — Rapports** : CA, bénéfices, top produits, valeur du stock, exports.
- **Étape 8 — API de synchronisation** : push/pull, journal, conflits.
- **Étape 9 — Client Electron + React** : interface et base SQLite locale.
- **Étape 10 — Branchement synchro** : hors-ligne + échange des deltas.
- **Étape 11 — Phase 2** : mobile money, notifications.

Détails complets dans le cahier des charges (`docs/`).

## À rappeler à Claude Code si besoin

- Identifiants **UUID** partout (jamais d'AutoField) — indispensable à la synchro.
- `AUTH_USER_MODEL = "comptes.Utilisateur"`.
- Références entre apps par chaîne `"app.Modele"` (pas d'import direct).
- Le **stock se recalcule à partir des mouvements** (jamais écrasé).
- Toujours filtrer les données par la **boutique** de l'utilisateur.
