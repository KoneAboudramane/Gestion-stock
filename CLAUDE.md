# Projet gestion_stock — Référence des modèles (à respecter par Claude Code)

Application de gestion de stock et de vente pour commerçants (Afrique de l'Ouest).
Backend **Django** (serveur, comptes, sauvegarde en ligne, espace admin) — **MySQL** en production (hébergement mutualisé o2switch), **PostgreSQL** possible sur VPS. Le code Django reste agnostique de la base (voir `DB_ENGINE` dans `config/settings.py`).
Client **Electron + React + SQLite** (appli locale, hors-ligne), qui se synchronise via une API.

## Règles impératives (ne pas s'en écarter)

1. **Chaque modèle hérite de `core.models.ModeleBase`** (sauf `comptes.Utilisateur` qui hérite de `AbstractUser`).
   `ModeleBase` fournit : `id` (UUID, clé primaire), `date_creation`, `date_modification`, `synchronise`, `date_synchronisation`.
   → Ne jamais redéfinir `id` en AutoField : les UUID sont indispensables à la synchronisation locale/serveur.
2. **`AUTH_USER_MODEL = "comptes.Utilisateur"`** dans settings.py. Toujours référencer l'utilisateur par `settings.AUTH_USER_MODEL` ou la chaîne `"comptes.Utilisateur"`.
3. **Références entre apps = chaînes `"app.Modele"`** (ex. `"comptes.Boutique"`), jamais d'import direct entre apps (évite les imports circulaires).
4. **Multi-tenant** : presque tout est rattaché à une `Boutique`. Toute requête doit filtrer par la boutique de l'utilisateur.
5. **Stock au niveau `Variante` + `Depot`**, jamais au niveau `Produit`. Un produit simple a une seule variante par défaut.
6. **Montants et quantités** : `DecimalField(max_digits=12, decimal_places=2)`. Jamais de FloatField pour l'argent.
7. Les labels d'app sont le nom du dossier : `core, comptes, catalogue, stock, ventes, achats, clients, fournisseurs, configuration, synchronisation`.

## Les 10 apps et leurs 39 modèles

### core
- `ModeleBase` (abstrait) — hérité par tous. Champs : id (UUID), date_creation, date_modification, synchronise, date_synchronisation.

### comptes
- `Boutique` — entité centrale. nom, adresse, telephone, email, logo, devise (déf. "FCFA"), actif.
- `Role` — boutique (FK), nom, permissions (JSON).
- `Utilisateur(AbstractUser)` — boutique (FK, null), role (FK, null), telephone.

### catalogue
- `Categorie` — boutique (FK), nom, categorie_parent (FK self → sous_categories).
- `Unite` — boutique (FK), nom, abreviation.
- `Produit` — boutique (FK), nom, categorie (FK), unite (FK), description, photo, actif. **Pas de prix ni de stock ici.**
- `Attribut` — boutique (FK), nom (ex. Taille, Couleur).
- `ValeurAttribut` — attribut (FK → valeurs), valeur (ex. M, Rouge).
- `Variante` — produit (FK → variantes), reference (SKU), code_barres, **prix_achat**, **prix_vente**, seuil_alerte, photo, actif. **C'est l'article vendu et stocké.**
- `VarianteValeur` — variante (FK → valeurs), valeur_attribut (FK). unique_together(variante, valeur_attribut).

### stock  (tout est par Variante + Depot)
- `Depot` — boutique (FK), nom, adresse.
- `Stock` — variante (FK), depot (FK), quantite. unique_together(variante, depot).
- `MouvementStock` — variante (FK), depot (FK), type {entree|sortie|ajustement}, quantite, motif, reference_type, reference_id (UUID), utilisateur (FK).
- `TransfertStock` — variante (FK), depot_source (FK → transferts_sortants), depot_destination (FK → transferts_entrants), quantite, utilisateur (FK).
- `PerteStock` — variante (FK, PROTECT), depot (FK → pertes, PROTECT), quantite, motif {perime|abime|vol|don|consommation|autre}, detail (obligatoire si « autre »), valeur (figée au CUMP), utilisateur (FK), annulee, date_annulation. **Sortie sans vente** : crée un `MouvementStock` `sortie` (reference_type `stock.PerteStock`). À distinguer d'un ajustement (correction d'erreur).
- `OperationDestockage` — boutique (FK), nom, date_fin (null), utilisateur (FK). **Groupe nommé** de déstockages lancés ensemble (ex. « Liquidation fin d'année ») : création tout-ou-rien, arrêt en un clic, bilan commun.
- `Destockage` — variante (FK → destockages, PROTECT), prix_normal (figé au démarrage), prix_destockage, date_fin (null), statut {en_cours|termine}, motif_fin {date|epuise|manuel}, date_arret, utilisateur (FK), operation (FK OperationDestockage, null). **Prix réduit appliqué automatiquement en caisse** ; s'arrête à date_fin, quand le stock (tous dépôts) tombe à 0, ou à la main. Vente à perte permise.
- `ReleveDormants` — boutique (FK), date, jours_seuil (déf. 60), nombre_articles, valeur_immobilisee. **Photo quotidienne de l'argent qui dort**, prise par les clients à l'ouverture (ajout seul, pas d'unicité par date : plusieurs appareils → l'affichage garde le plus récent).
- `Inventaire` — boutique (FK), depot (FK), statut {en_cours|valide}, utilisateur (FK).
- `LigneInventaire` — inventaire (FK → lignes), variante (FK), qte_theorique, qte_physique, ecart.

### ventes  (une vente sort du stock d'un dépôt)
- `Vente` — boutique (FK), **depot (FK, PROTECT)**, client (FK clients.Client, null), utilisateur (FK), numero, total_brut, remise, total_net, statut {payee|credit|annulee}.
- `LigneVente` — vente (FK → lignes), variante (FK catalogue.Variante, PROTECT), quantite, prix_unitaire, remise, sous_total, prix_normal (null), destockage (FK stock.Destockage, null) — ces deux derniers seulement si vendue en déstockage (bilan : marge, manque à gagner).
- `Paiement` — vente (FK → paiements), mode {especes|mobile_money|carte|credit}, montant.

### achats  (une réception entre en stock d'un dépôt)
- `CommandeAchat` — boutique (FK), fournisseur (FK fournisseurs.Fournisseur, PROTECT), utilisateur (FK), numero, statut {brouillon|commandee|recue|annulee}, total.
- `LigneAchat` — commande (FK → lignes), variante (FK, PROTECT), quantite, prix_achat, sous_total.
- `Reception` — commande (FK → receptions), depot (FK stock.Depot, PROTECT), utilisateur (FK), valeur_recue, montant_paye, annulee, date_annulation. Réception partielle possible (LigneAchat.quantite_recue) ; annulable si la marchandise est encore en stock (contre-écriture).
- `RetourFournisseur` — commande (FK → retours), reception (FK → retours), depot (FK, PROTECT), motif, montant, avoir, utilisateur (FK). Réduit la dette de la réception ; l'excédent est un avoir à récupérer. Écriture 401/601.
- `LigneRetourFournisseur` — retour (FK → lignes), variante (FK, PROTECT), quantite, prix_achat, sous_total.
- `EvenementCommande` — commande (FK → evenements), type {creee|modifiee|commandee|reception|reception_annulee|retour|paiement|paiement_annule|annulee}, utilisateur (FK), detail, montant (null), reference_id (UUID, null). **Suivi des étapes** d'une commande, ajout seul ; les étapes des commandes antérieures sont reconstituées à l'affichage, jamais écrites.

### clients
- `Client` — boutique (FK), nom, telephone, adresse.
- `Credit` — client (FK → credits), vente (FK ventes.Vente, null), montant, montant_paye, solde, echeance, statut {en_cours|solde}. **Carnet de crédit.**
- `PaiementCredit` — credit (FK → paiements), montant, mode.
- `EcheanceCredit` — credit (FK → echeances), date_echeance, montant. **Échéancier** du crédit client, même principe que `EcheanceDette` (statut calculé ; alertes `credit_proche` J-3 et `credit_retard`).

### fournisseurs
- `Fournisseur` — boutique (FK), nom, telephone, adresse, contact.
- `DetteFournisseur` — fournisseur (FK → dettes), commande (FK achats.CommandeAchat, null), reception (FK achats.Reception, null), montant, montant_paye, solde, statut {en_cours|solde}.
- `PaiementDetteFournisseur` — dette (FK → paiements), montant, mode, annulee, date_annulation, annule_par (FK), motif_annulation. Un remboursement annulé reste visible ; son montant revient dans le solde (contre-écriture, retour en caisse si espèces).
- `EcheanceDette` — dette (FK → echeances), date_echeance, montant. **Échéancier** de remboursement : les paiements (libres) couvrent les tranches dans l'ordre des dates ; statut (payée / partielle / à venir / en retard) calculé, jamais stocké. Replanifier = retirer les tranches non couvertes, en ajouter pour le reste dû. Alertes `echeance_proche` (J-3) et `echeance_retard`.

### configuration
- `Parametre` — boutique (FK), cle, valeur. unique_together(boutique, cle). Réglages dynamiques (devise, TVA, format ticket). **PAS l'interface** (elle reste dans le code React).

### synchronisation
- `JournalSync` — boutique (FK), appareil, table (ex. "ventes.Vente"), enregistrement_id (UUID), action {cree|modifie|supprime}, statut {en_attente|synchronise|conflit}, donnees (JSON).

## Logique métier attendue (dans les vues/services, pas dans les modèles)

- **Vente validée** → créer un `MouvementStock` de type `sortie` par ligne (variante + depot de la vente) et décrémenter le `Stock` correspondant. Si statut `credit` → créer un `Credit` pour le client.
- **Réception d'achat** → créer un `MouvementStock` de type `entree` (variante + depot de la réception) et incrémenter le `Stock`. Créer/mettre à jour la `DetteFournisseur` si non payé.
- **TransfertStock** → une sortie sur depot_source + une entrée sur depot_destination.
- **Alerte de rupture** quand `Stock.quantite <= Variante.seuil_alerte`.
- `rapports` **ne définit aucun modèle** : il lit les autres apps (CA, bénéfice = prix_vente − prix_achat, top produits, valeur du stock).

## Comptabilité des pertes et du stock (décision)
- Les pertes (`PerteStock`) ne passent **aucune écriture** : le module comptable ne valorise pas encore le stock (achats en 601, pas de 31/6031). Une écriture par perte fausserait les comptes (double comptage à l'inventaire).
- À faire plus tard, après validation d'un comptable SYSCOHADA : une **écriture de variation de stock de fin d'exercice** (6031/31) calculée depuis l'inventaire, qui englobe les pertes.

## Périmètre
- **V1** : les 10 apps ci-dessus.
- **Phase 2** : `paiements` (Wave/Orange Money/MTN), `notifications` (rappels crédit/rupture, ticket WhatsApp).

## Prérequis techniques
- `pip install django Pillow djangorestframework`
- Pillow nécessaire pour les `ImageField` (logo, photos).
- Générer les migrations app par app : `python manage.py makemigrations comptes catalogue stock clients fournisseurs ventes achats configuration synchronisation`.
