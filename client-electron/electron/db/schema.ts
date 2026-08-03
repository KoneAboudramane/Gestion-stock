// Schéma SQLite local. Couvre les 23 tables synchronisables du serveur
// (registre.ts) + `stocks` (jamais synchronisé, recalculé localement à partir
// de `mouvements_stock` — même règle que côté Django).
// Colonnes de suivi de synchro (mêmes que ModeleBase côté Django) sur toutes
// les tables synchronisables : date_creation, date_modification, synchronise
// (0/1 : reste à pousser), supprime (0/1 : soft delete), date_synchronisation.
// Les champs ImageField (photo, logo) ne sont pas synchronisés dans ce passage
// (transfert de fichiers hors périmètre) : absents du schéma local, ignorés
// silencieusement s'ils arrivent dans un pull (voir services/sync.ts).
const SUIVI_SYNC = `
  date_creation TEXT,
  date_modification TEXT,
  synchronise INTEGER DEFAULT 0,
  supprime INTEGER DEFAULT 0,
  date_synchronisation TEXT
`;

export const SCHEMA_SQL = `
-- date_expiration_abonnement : NULL = illimité/pas encore configuré, jamais
-- bloquant faute de donnée (voir electron/services/abonnement.ts).
CREATE TABLE IF NOT EXISTS boutiques (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  adresse TEXT DEFAULT '',
  telephone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  devise TEXT DEFAULT 'FCFA',
  actif INTEGER DEFAULT 1,
  date_expiration_abonnement TEXT,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  categorie_parent_id TEXT,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS unites (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  abreviation TEXT DEFAULT '',
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS produits (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  categorie_id TEXT,
  unite_id TEXT,
  description TEXT DEFAULT '',
  actif INTEGER DEFAULT 1,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS attributs (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS valeurs_attribut (
  id TEXT PRIMARY KEY,
  attribut_id TEXT NOT NULL,
  valeur TEXT NOT NULL,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS variantes (
  id TEXT PRIMARY KEY,
  produit_id TEXT NOT NULL,
  reference TEXT DEFAULT '',
  code_barres TEXT DEFAULT '',
  prix_achat REAL DEFAULT 0,
  prix_vente REAL DEFAULT 0,
  seuil_alerte REAL DEFAULT 0,
  actif INTEGER DEFAULT 1,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS variante_valeurs (
  id TEXT PRIMARY KEY,
  variante_id TEXT NOT NULL,
  valeur_attribut_id TEXT NOT NULL,
  ${SUIVI_SYNC},
  UNIQUE (variante_id, valeur_attribut_id)
);

CREATE TABLE IF NOT EXISTS depots (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  adresse TEXT DEFAULT '',
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  telephone TEXT DEFAULT '',
  adresse TEXT DEFAULT '',
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS fournisseurs (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  telephone TEXT DEFAULT '',
  adresse TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  ${SUIVI_SYNC}
);

-- stocks : JAMAIS synchronisé directement, recalculé depuis mouvements_stock.
CREATE TABLE IF NOT EXISTS stocks (
  id TEXT PRIMARY KEY,
  variante_id TEXT NOT NULL,
  depot_id TEXT NOT NULL,
  quantite REAL DEFAULT 0,
  UNIQUE (variante_id, depot_id)
);

-- boutique_logo : local uniquement, hors registre de sync (cf. note ImageField
-- ci-dessus). Le logo choisi ne quitte jamais cet appareil.
CREATE TABLE IF NOT EXISTS boutique_logo (
  boutique_id TEXT PRIMARY KEY,
  logo TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ventes (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  depot_id TEXT NOT NULL,
  client_id TEXT,
  utilisateur_id TEXT,
  numero TEXT DEFAULT '',
  total_brut REAL DEFAULT 0,
  remise REAL DEFAULT 0,
  total_net REAL DEFAULT 0,
  statut TEXT DEFAULT 'payee',
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS lignes_vente (
  id TEXT PRIMARY KEY,
  vente_id TEXT NOT NULL,
  variante_id TEXT NOT NULL,
  quantite REAL NOT NULL,
  prix_unitaire REAL NOT NULL,
  cout_unitaire REAL DEFAULT 0,
  remise REAL DEFAULT 0,
  sous_total REAL DEFAULT 0,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS paiements (
  id TEXT PRIMARY KEY,
  vente_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  montant REAL NOT NULL,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS commandes_achat (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  fournisseur_id TEXT NOT NULL,
  utilisateur_id TEXT,
  numero TEXT DEFAULT '',
  statut TEXT DEFAULT 'brouillon',
  total REAL DEFAULT 0,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS lignes_achat (
  id TEXT PRIMARY KEY,
  commande_id TEXT NOT NULL,
  variante_id TEXT NOT NULL,
  quantite REAL NOT NULL,
  prix_achat REAL NOT NULL,
  sous_total REAL DEFAULT 0,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS receptions (
  id TEXT PRIMARY KEY,
  commande_id TEXT NOT NULL,
  depot_id TEXT NOT NULL,
  utilisateur_id TEXT,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS mouvements_stock (
  id TEXT PRIMARY KEY,
  variante_id TEXT NOT NULL,
  depot_id TEXT NOT NULL,
  type TEXT NOT NULL,
  quantite REAL NOT NULL,
  motif TEXT DEFAULT '',
  reference_type TEXT DEFAULT '',
  reference_id TEXT,
  utilisateur_id TEXT,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS transferts_stock (
  id TEXT PRIMARY KEY,
  variante_id TEXT NOT NULL,
  depot_source_id TEXT NOT NULL,
  depot_destination_id TEXT NOT NULL,
  quantite REAL NOT NULL,
  utilisateur_id TEXT,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS inventaires (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  depot_id TEXT NOT NULL,
  statut TEXT DEFAULT 'en_cours',
  utilisateur_id TEXT,
  date_validation TEXT,
  ${SUIVI_SYNC}
);

-- prix_achat_fige : CUMP de la variante figé au moment de la validation de cette
-- ligne (voir services/stock.ts::validerInventaire). Ne doit jamais être recalculé
-- après coup : chaque inventaire reste une photo fidèle à sa date, même si le CUMP
-- de la variante continue d'évoluer ensuite au fil des réceptions.
CREATE TABLE IF NOT EXISTS lignes_inventaire (
  id TEXT PRIMARY KEY,
  inventaire_id TEXT NOT NULL,
  variante_id TEXT NOT NULL,
  qte_theorique REAL DEFAULT 0,
  qte_physique REAL DEFAULT 0,
  ecart REAL DEFAULT 0,
  prix_achat_fige REAL DEFAULT 0,
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS credits (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  vente_id TEXT,
  montant REAL NOT NULL,
  montant_paye REAL DEFAULT 0,
  solde REAL DEFAULT 0,
  echeance TEXT,
  statut TEXT DEFAULT 'en_cours',
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS paiements_credit (
  id TEXT PRIMARY KEY,
  credit_id TEXT NOT NULL,
  montant REAL NOT NULL,
  mode TEXT DEFAULT '',
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS dettes_fournisseur (
  id TEXT PRIMARY KEY,
  fournisseur_id TEXT NOT NULL,
  commande_id TEXT,
  montant REAL NOT NULL,
  montant_paye REAL DEFAULT 0,
  solde REAL DEFAULT 0,
  statut TEXT DEFAULT 'en_cours',
  ${SUIVI_SYNC}
);

CREATE TABLE IF NOT EXISTS parametres (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  cle TEXT NOT NULL,
  valeur TEXT DEFAULT '',
  ${SUIVI_SYNC}
);

-- Phase 2 (squelette, adaptateurs simulés) --

CREATE TABLE IF NOT EXISTS transactions_mobile_money (
  id TEXT PRIMARY KEY,
  paiement_id TEXT NOT NULL,
  fournisseur TEXT NOT NULL,
  numero_telephone TEXT DEFAULT '',
  reference_externe TEXT DEFAULT '',
  statut TEXT DEFAULT 'en_attente',
  montant REAL DEFAULT 0,
  donnees_brutes TEXT DEFAULT '{}',
  ${SUIVI_SYNC}
);

-- Notification : alerte interne du système (ex. rupture de stock) — pas de
-- canal/destinataire/envoi, juste un message à lire, rattaché à un dépôt.
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  depot_id TEXT,
  type TEXT NOT NULL DEFAULT 'alerte_rupture',
  message TEXT DEFAULT '',
  reference_type TEXT DEFAULT '',
  reference_id TEXT,
  lu INTEGER NOT NULL DEFAULT 0,
  ${SUIVI_SYNC}
);

-- Message : communication sortante vers un client (WhatsApp/SMS) — rappel de
-- crédit, ticket de vente. Contrairement à Notification, a un vrai
-- destinataire/canal/statut d'envoi.
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL,
  depot_id TEXT,
  utilisateur_id TEXT,
  type TEXT NOT NULL,
  canal TEXT DEFAULT 'interne',
  destinataire TEXT DEFAULT '',
  message TEXT DEFAULT '',
  reference_type TEXT DEFAULT '',
  reference_id TEXT,
  statut TEXT DEFAULT 'en_attente',
  date_envoi TEXT,
  ${SUIVI_SYNC}
);
`;
