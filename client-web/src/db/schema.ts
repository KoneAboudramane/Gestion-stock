import type { DBSchema } from "idb";

/**
 * Schéma IndexedDB local, miroir de client-electron/electron/db/schema.ts
 * (mêmes tables, mêmes colonnes). Mêmes colonnes de suivi de synchro
 * (date_creation, date_modification, synchronise, supprime,
 * date_synchronisation) que côté SQLite/Django ModeleBase.
 * "stocks" n'existe pas comme store séparé : recalculé à la volée depuis
 * mouvements_stock, comme côté Electron. "boutique_logo" est local
 * uniquement (jamais synchronisé, cf. note ImageField côté Electron).
 * comptes.Utilisateur/Role sont hors périmètre (PK entière Django,
 * incompatible avec le mécanisme générique — appel API direct partout,
 * y compris sur le desktop, voir electron/services/comptes.ts).
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
  /** Fixée côté serveur par l'administrateur, redescend via la synchro habituelle. NULL = illimité. */
  date_expiration_abonnement: string | null;
  formule: string;
  /** Voir comptes.Boutique.synchro_autorisee côté backend — champ protégé, jamais poussé par un push client normal. */
  synchro_autorisee: 0 | 1;
}

export interface CategorieLocale extends SuiviSync {
  id: string;
  boutique_id: string;
  nom: string;
  categorie_parent_id: string | null;
}

export interface UniteLocale extends SuiviSync {
  id: string;
  boutique_id: string;
  nom: string;
  abreviation: string;
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

export interface AttributLocal extends SuiviSync {
  id: string;
  boutique_id: string;
  nom: string;
}

export interface ValeurAttributLocal extends SuiviSync {
  id: string;
  attribut_id: string;
  valeur: string;
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

export interface VarianteValeurLocale extends SuiviSync {
  id: string;
  variante_id: string;
  valeur_attribut_id: string;
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

export interface FournisseurLocal extends SuiviSync {
  id: string;
  boutique_id: string;
  nom: string;
  telephone: string;
  adresse: string;
  contact: string;
}

/** Local uniquement, jamais synchronisé (cf. note ImageField). */
export interface BoutiqueLogoLocale {
  boutique_id: string;
  logo: string;
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

export interface CommandeAchatLocale extends SuiviSync {
  id: string;
  boutique_id: string;
  fournisseur_id: string;
  utilisateur_id: string | null;
  numero: string;
  statut: "brouillon" | "commandee" | "recue" | "annulee";
  total: number;
}

export interface LigneAchatLocale extends SuiviSync {
  id: string;
  commande_id: string;
  variante_id: string;
  quantite: number;
  prix_achat: number;
  sous_total: number;
}

export interface ReceptionLocale extends SuiviSync {
  id: string;
  commande_id: string;
  depot_id: string;
  utilisateur_id: string | null;
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

export interface TransfertStockLocal extends SuiviSync {
  id: string;
  variante_id: string;
  depot_source_id: string;
  depot_destination_id: string;
  quantite: number;
  utilisateur_id: string | null;
}

export interface InventaireLocal extends SuiviSync {
  id: string;
  boutique_id: string;
  depot_id: string;
  statut: "en_cours" | "valide";
  utilisateur_id: string | null;
  date_validation: string | null;
}

export interface LigneInventaireLocale extends SuiviSync {
  id: string;
  inventaire_id: string;
  variante_id: string;
  qte_theorique: number;
  qte_physique: number;
  ecart: number;
  prix_achat_fige: number;
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

export interface PaiementCreditLocal extends SuiviSync {
  id: string;
  credit_id: string;
  montant: number;
  mode: string;
}

export interface DetteFournisseurLocale extends SuiviSync {
  id: string;
  fournisseur_id: string;
  commande_id: string | null;
  montant: number;
  montant_paye: number;
  solde: number;
  statut: "en_cours" | "solde";
}

export interface PaiementDetteFournisseurLocale extends SuiviSync {
  id: string;
  dette_id: string;
  montant: number;
  mode: string;
}

// --- Trésorerie (suivi de caisse, séparé de l'écran de vente "Caisse") ---
// Le solde d'un dépôt n'est jamais stocké : agrégat à la volée sur
// mouvements_caisse (voir services/tresorerie.ts::soldeCaisse), même
// principe que "stocks" côté stock mais sans store dérivé à tenir à jour.

export interface DepenseLocale extends SuiviSync {
  id: string;
  depot_id: string;
  categorie: string;
  montant: number;
  description: string;
  utilisateur_id: string | null;
}

export interface TransfertCaisseLocal extends SuiviSync {
  id: string;
  depot_id: string;
  utilisateur_source_id: string | null;
  operateur: string;
  montant: number;
  utilisateur_id: string | null;
}

export interface ClotureCaisseLocale extends SuiviSync {
  id: string;
  depot_id: string;
  solde_theorique: number;
  solde_compte: number;
  ecart: number;
  utilisateur_id: string | null;
}

/** reference_id : UUID libre (pas une FK, comme mouvements_stock.reference_id). */
export interface MouvementCaisseLocal extends SuiviSync {
  id: string;
  depot_id: string;
  type: "entree" | "sortie" | "ajustement";
  categorie: string;
  montant: number;
  motif: string;
  reference_type: string;
  reference_id: string | null;
  utilisateur_id: string | null;
}

export interface ParametreLocal extends SuiviSync {
  id: string;
  boutique_id: string;
  cle: string;
  valeur: string;
}

export interface TransactionMobileMoneyLocale extends SuiviSync {
  id: string;
  paiement_id: string;
  fournisseur: "wave" | "orange_money" | "mtn";
  numero_telephone: string;
  reference_externe: string;
  statut: "en_attente" | "reussie" | "echouee";
  montant: number;
  donnees_brutes: string;
}

/** Alerte interne (ex. rupture de stock) — pas de canal/destinataire, juste un message à lire. */
export interface NotificationLocale extends SuiviSync {
  id: string;
  boutique_id: string;
  depot_id: string | null;
  type: string;
  message: string;
  reference_type: string;
  reference_id: string | null;
  lu: 0 | 1;
}

/** Communication sortante (WhatsApp/SMS) — contrairement à Notification, a un vrai destinataire/canal/statut d'envoi. */
export interface MessageLocal extends SuiviSync {
  id: string;
  boutique_id: string;
  depot_id: string | null;
  utilisateur_id: string | null;
  type: string;
  canal: "sms" | "whatsapp" | "interne";
  destinataire: string;
  message: string;
  reference_type: string;
  reference_id: string | null;
  statut: "en_attente" | "envoyee" | "echouee";
  date_envoi: string | null;
}

/**
 * Store local (non synchronisé) : quantité en stock, recalculée depuis
 * mouvements_stock. id = UUID aléatoire (généré une fois, réutilisé aux mises
 * à jour) — jamais une clé composite variante/dépôt, cf. db/helpers.ts::recalculerStock.
 */
export interface StockLocal {
  id: string;
  variante_id: string;
  depot_id: string;
  quantite: number;
}

export interface GestionStockDB extends DBSchema {
  boutiques: { key: string; value: BoutiqueLocale; indexes: { synchronise: number } };
  categories: { key: string; value: CategorieLocale; indexes: { boutique_id: string; synchronise: number } };
  unites: { key: string; value: UniteLocale; indexes: { boutique_id: string; synchronise: number } };
  produits: {
    key: string;
    value: ProduitLocal;
    indexes: { boutique_id: string; synchronise: number };
  };
  attributs: { key: string; value: AttributLocal; indexes: { boutique_id: string; synchronise: number } };
  valeurs_attribut: {
    key: string;
    value: ValeurAttributLocal;
    indexes: { attribut_id: string; synchronise: number };
  };
  variantes: {
    key: string;
    value: VarianteLocale;
    indexes: { produit_id: string; synchronise: number };
  };
  variante_valeurs: {
    key: string;
    value: VarianteValeurLocale;
    indexes: { variante_id: string; synchronise: number };
  };
  depots: { key: string; value: DepotLocal; indexes: { boutique_id: string; synchronise: number } };
  clients: { key: string; value: ClientLocal; indexes: { boutique_id: string; synchronise: number } };
  fournisseurs: { key: string; value: FournisseurLocal; indexes: { boutique_id: string; synchronise: number } };
  boutique_logo: { key: string; value: BoutiqueLogoLocale };
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
  commandes_achat: {
    key: string;
    value: CommandeAchatLocale;
    indexes: { boutique_id: string; synchronise: number };
  };
  lignes_achat: {
    key: string;
    value: LigneAchatLocale;
    indexes: { commande_id: string; synchronise: number };
  };
  receptions: {
    key: string;
    value: ReceptionLocale;
    indexes: { commande_id: string; synchronise: number };
  };
  credits: {
    key: string;
    value: CreditLocal;
    indexes: { client_id: string; synchronise: number };
  };
  paiements_credit: {
    key: string;
    value: PaiementCreditLocal;
    indexes: { credit_id: string; synchronise: number };
  };
  dettes_fournisseur: {
    key: string;
    value: DetteFournisseurLocale;
    indexes: { fournisseur_id: string; synchronise: number };
  };
  paiements_dette_fournisseur: {
    key: string;
    value: PaiementDetteFournisseurLocale;
    indexes: { dette_id: string; synchronise: number };
  };
  depenses: { key: string; value: DepenseLocale; indexes: { depot_id: string; synchronise: number } };
  transferts_caisse: {
    key: string;
    value: TransfertCaisseLocal;
    indexes: { depot_id: string; synchronise: number };
  };
  clotures_caisse: {
    key: string;
    value: ClotureCaisseLocale;
    indexes: { depot_id: string; synchronise: number };
  };
  mouvements_caisse: {
    key: string;
    value: MouvementCaisseLocal;
    indexes: { depot_id: string; synchronise: number };
  };
  mouvements_stock: {
    key: string;
    value: MouvementStockLocal;
    indexes: { variante_depot: [string, string]; synchronise: number };
  };
  transferts_stock: {
    key: string;
    value: TransfertStockLocal;
    indexes: { variante_id: string; synchronise: number };
  };
  inventaires: {
    key: string;
    value: InventaireLocal;
    indexes: { boutique_id: string; synchronise: number };
  };
  lignes_inventaire: {
    key: string;
    value: LigneInventaireLocale;
    indexes: { inventaire_id: string; synchronise: number };
  };
  parametres: {
    key: string;
    value: ParametreLocal;
    indexes: { boutique_id: string; synchronise: number };
  };
  transactions_mobile_money: {
    key: string;
    value: TransactionMobileMoneyLocale;
    indexes: { paiement_id: string; synchronise: number };
  };
  notifications: {
    key: string;
    value: NotificationLocale;
    indexes: { boutique_id: string; synchronise: number };
  };
  messages: {
    key: string;
    value: MessageLocal;
    indexes: { boutique_id: string; synchronise: number };
  };
  stocks: { key: string; value: StockLocal; indexes: { variante_depot: [string, string] } };
}

export const NOM_BASE = "gestion-stock";
export const VERSION_BASE = 3;
