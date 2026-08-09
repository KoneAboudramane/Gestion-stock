import type { DBSchema } from "idb";

/**
 * Schéma IndexedDB local, sous-ensemble de client-electron/electron/db/schema.ts
 * limité à ce dont la Caisse a besoin (Phase 1 du PWA — voir le plan). Mêmes
 * colonnes de suivi de synchro (date_creation, date_modification, synchronise,
 * supprime, date_synchronisation) que côté SQLite/Django ModeleBase.
 * "stocks" n'existe pas comme store séparé : recalculé à la volée depuis
 * mouvements_stock, comme côté Electron.
 */

export interface SuiviSync {
  date_creation: string;
  date_modification: string;
  synchronise: 0 | 1;
  supprime: 0 | 1;
  date_synchronisation: string | null;
}

export interface BoutiqueLocale extends SuiviSync {
  id: string;
  nom: string;
  adresse: string;
  telephone: string;
  email: string;
  devise: string;
  actif: 0 | 1;
}

export interface ProduitLocal extends SuiviSync {
  id: string;
  boutique_id: string;
  nom: string;
  categorie_id: string | null;
  unite_id: string | null;
  description: string;
  actif: 0 | 1;
}

export interface VarianteLocale extends SuiviSync {
  id: string;
  produit_id: string;
  reference: string;
  code_barres: string;
  prix_achat: number;
  prix_vente: number;
  seuil_alerte: number;
  actif: 0 | 1;
}

export interface DepotLocal extends SuiviSync {
  id: string;
  boutique_id: string;
  nom: string;
  adresse: string;
}

export interface ClientLocal extends SuiviSync {
  id: string;
  boutique_id: string;
  nom: string;
  telephone: string;
  adresse: string;
  est_permanent: 0 | 1;
}

export interface VenteLocale extends SuiviSync {
  id: string;
  boutique_id: string;
  depot_id: string;
  client_id: string | null;
  utilisateur_id: string | null;
  numero: string;
  total_brut: number;
  remise: number;
  total_net: number;
  statut: "payee" | "credit" | "annulee";
}

export interface LigneVenteLocale extends SuiviSync {
  id: string;
  vente_id: string;
  variante_id: string;
  quantite: number;
  prix_unitaire: number;
  cout_unitaire: number;
  remise: number;
  sous_total: number;
}

export interface PaiementLocal extends SuiviSync {
  id: string;
  vente_id: string;
  mode: string;
  operateur: string;
  montant: number;
}

export interface CreditLocal extends SuiviSync {
  id: string;
  client_id: string;
  vente_id: string | null;
  montant: number;
  montant_paye: number;
  solde: number;
  echeance: string | null;
  statut: "en_cours" | "solde";
}

export interface MouvementStockLocal extends SuiviSync {
  id: string;
  variante_id: string;
  depot_id: string;
  type: "entree" | "sortie" | "ajustement";
  quantite: number;
  motif: string;
  reference_type: string;
  reference_id: string | null;
  utilisateur_id: string | null;
}

/** Store local (non synchronisé) : quantité en stock, recalculée depuis mouvements_stock. */
export interface StockLocal {
  id: string; // `${variante_id}::${depot_id}`
  variante_id: string;
  depot_id: string;
  quantite: number;
}

export interface GestionStockDB extends DBSchema {
  boutiques: { key: string; value: BoutiqueLocale; indexes: { synchronise: number } };
  produits: {
    key: string;
    value: ProduitLocal;
    indexes: { boutique_id: string; synchronise: number };
  };
  variantes: {
    key: string;
    value: VarianteLocale;
    indexes: { produit_id: string; synchronise: number };
  };
  depots: { key: string; value: DepotLocal; indexes: { boutique_id: string; synchronise: number } };
  clients: { key: string; value: ClientLocal; indexes: { boutique_id: string; synchronise: number } };
  ventes: { key: string; value: VenteLocale; indexes: { boutique_id: string; synchronise: number } };
  lignes_vente: {
    key: string;
    value: LigneVenteLocale;
    indexes: { vente_id: string; synchronise: number };
  };
  paiements: {
    key: string;
    value: PaiementLocal;
    indexes: { vente_id: string; synchronise: number };
  };
  credits: {
    key: string;
    value: CreditLocal;
    indexes: { client_id: string; synchronise: number };
  };
  mouvements_stock: {
    key: string;
    value: MouvementStockLocal;
    indexes: { variante_depot: [string, string]; synchronise: number };
  };
  stocks: { key: string; value: StockLocal; indexes: { variante_depot: [string, string] } };
}

export const NOM_BASE = "gestion-stock";
export const VERSION_BASE = 1;
