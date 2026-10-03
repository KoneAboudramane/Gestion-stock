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
  /** Vente au détail : article de détail et combien il en contient (voir stock.Detaillage). */
  variante_detail_id?: string | null;
  quantite_detail?: number | null;
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
  /** Livraison d'une commande client (absent pour une vente directe). */
  commande_client_id?: string | null;
}

/** Commande d'un client avant livraison (ventes.CommandeClient). */
export interface CommandeClientLocale extends SuiviSync {
  id: string;
  boutique_id: string;
  client_id: string;
  depot_id: string;
  utilisateur_id: string | null;
  numero: string;
  statut: "en_attente" | "prete" | "partielle" | "livree" | "annulee";
  date_livraison_prevue: string | null;
  note: string;
  total: number;
  avance: number;
  date_annulation: string | null;
}

export interface LigneCommandeClientLocale extends SuiviSync {
  id: string;
  commande_id: string;
  variante_id: string;
  quantite: number;
  quantite_livree: number;
  prix_unitaire: number;
  sous_total: number;
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
  /** Vendue pendant un déstockage : prix normal du moment + lien (voir stock.Destockage). */
  prix_normal?: number | null;
  destockage_id?: string | null;
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
  quantite_recue: number;
}

export interface ReceptionLocale extends SuiviSync {
  id: string;
  commande_id: string;
  depot_id: string;
  utilisateur_id: string | null;
  valeur_recue: number;
  montant_paye: number;
  /** Comment le montant payé à la livraison a été réglé : especes, mobile_money, banque (vide avant ce suivi). */
  mode_paiement?: string;
  operateur_paiement?: string;
  annulee?: boolean | number;
  date_annulation?: string | null;
}

/** Étape du suivi d'une commande (achats.EvenementCommande), ajout seul. */
export interface EvenementCommandeLocal extends SuiviSync {
  id: string;
  commande_id: string;
  type: string;
  utilisateur_id: string | null;
  detail: string;
  montant: number | null;
  reference_id: string | null;
}

/** Marchandise d'une réception renvoyée au fournisseur (achats.RetourFournisseur). */
export interface RetourFournisseurLocale extends SuiviSync {
  id: string;
  commande_id: string;
  reception_id: string;
  depot_id: string;
  motif: string;
  montant: number;
  avoir: number;
  utilisateur_id: string | null;
}

export interface LigneRetourFournisseurLocale extends SuiviSync {
  id: string;
  retour_id: string;
  variante_id: string;
  quantite: number;
  prix_achat: number;
  sous_total: number;
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

/** Article vendu à prix réduit en caisse (stock.Destockage). date_fin : "AAAA-MM-JJ" ou null. */
export interface DestockageLocal extends SuiviSync {
  id: string;
  variante_id: string;
  prix_normal: number;
  prix_destockage: number;
  date_fin: string | null;
  statut: "en_cours" | "termine";
  motif_fin: "" | "date" | "epuise" | "manuel";
  date_arret: string | null;
  utilisateur_id: string | null;
  operation_id?: string | null;
}

/** Groupe nommé de déstockages lancés ensemble (stock.OperationDestockage). */
export interface OperationDestockageLocale extends SuiviSync {
  id: string;
  boutique_id: string;
  nom: string;
  date_fin: string | null;
  utilisateur_id: string | null;
}

/** Photo quotidienne des produits dormants (stock.ReleveDormants). date : "AAAA-MM-JJ". */
export interface ReleveDormantsLocal extends SuiviSync {
  id: string;
  boutique_id: string;
  date: string;
  jours_seuil: number;
  nombre_articles: number;
  valeur_immobilisee: number;
}

/** Sortie de stock sans vente (stock.PerteStock) : valeur figée au CUMP du moment. */
export interface PerteStockLocal extends SuiviSync {
  id: string;
  variante_id: string;
  depot_id: string;
  quantite: number;
  motif: string;
  detail: string;
  valeur: number;
  utilisateur_id: string | null;
  annulee?: boolean | number;
  date_annulation?: string | null;
}

export interface DetaillageLocal extends SuiviSync {
  id: string;
  depot_id: string;
  type: "detailler" | "regrouper";
  variante_source_id: string;
  variante_cible_id: string;
  quantite_source: number;
  quantite_cible: number;
  cout_unitaire_cible: number;
  utilisateur_id: string | null;
  annulee?: boolean | number;
  date_annulation?: string | null;
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
  utilisateur_id: string | null;
}

/** Porte-monnaie du client (voir services/comptesTiers.ts). */
export interface MouvementCompteClientLocal extends SuiviSync {
  id: string;
  client_id: string;
  type: string;
  montant: number;
  mode: string;
  operateur: string;
  depot_id: string | null;
  vente_id: string | null;
  credit_id: string | null;
  utilisateur_id: string | null;
  motif: string;
}

/** Avances versées et avoirs de retour d'un fournisseur. */
export interface MouvementCompteFournisseurLocal extends SuiviSync {
  id: string;
  fournisseur_id: string;
  type: string;
  montant: number;
  mode: string;
  operateur: string;
  depot_id: string | null;
  reception_id: string | null;
  retour_id: string | null;
  dette_id: string | null;
  utilisateur_id: string | null;
  motif: string;
}

export interface DetteFournisseurLocale extends SuiviSync {
  id: string;
  fournisseur_id: string;
  commande_id: string | null;
  reception_id?: string | null;
  montant: number;
  montant_paye: number;
  solde: number;
  statut: "en_cours" | "solde";
}

/** Tranche prévue d'un échéancier de crédit client (clients.EcheanceCredit). */
export interface EcheanceCreditLocale extends SuiviSync {
  id: string;
  credit_id: string;
  date_echeance: string;
  montant: number;
}

/** Tranche prévue d'un échéancier de remboursement (fournisseurs.EcheanceDette). */
export interface EcheanceDetteLocale extends SuiviSync {
  id: string;
  dette_id: string;
  date_echeance: string;
  montant: number;
}

export interface PaiementDetteFournisseurLocale extends SuiviSync {
  id: string;
  dette_id: string;
  montant: number;
  mode: string;
  annulee?: boolean | number;
  date_annulation?: string | null;
  annule_par_id?: string | null;
  motif_annulation?: string;
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
  mouvements_compte_client: {
    key: string;
    value: MouvementCompteClientLocal;
    indexes: { client_id: string; synchronise: number };
  };
  commandes_client: {
    key: string;
    value: CommandeClientLocale;
    indexes: { boutique_id: string; synchronise: number };
  };
  lignes_commande_client: {
    key: string;
    value: LigneCommandeClientLocale;
    indexes: { commande_id: string; synchronise: number };
  };
  mouvements_compte_fournisseur: {
    key: string;
    value: MouvementCompteFournisseurLocal;
    indexes: { fournisseur_id: string; synchronise: number };
  };
  evenements_commande: {
    key: string;
    value: EvenementCommandeLocal;
    indexes: { commande_id: string; synchronise: number };
  };
  retours_fournisseur: {
    key: string;
    value: RetourFournisseurLocale;
    indexes: { reception_id: string; commande_id: string; synchronise: number };
  };
  lignes_retour_fournisseur: {
    key: string;
    value: LigneRetourFournisseurLocale;
    indexes: { retour_id: string; synchronise: number };
  };
  echeances_credit: {
    key: string;
    value: EcheanceCreditLocale;
    indexes: { credit_id: string; synchronise: number };
  };
  echeances_dette: {
    key: string;
    value: EcheanceDetteLocale;
    indexes: { dette_id: string; synchronise: number };
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
  operations_destockage: {
    key: string;
    value: OperationDestockageLocale;
    indexes: { boutique_id: string; synchronise: number };
  };
  destockages: {
    key: string;
    value: DestockageLocal;
    indexes: { variante_id: string; operation_id: string; synchronise: number };
  };
  releves_dormants: {
    key: string;
    value: ReleveDormantsLocal;
    indexes: { boutique_id: string; synchronise: number };
  };
  pertes_stock: {
    key: string;
    value: PerteStockLocal;
    indexes: { depot_id: string; synchronise: number };
  };
  detaillages: {
    key: string;
    value: DetaillageLocal;
    indexes: { depot_id: string; synchronise: number };
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
export const VERSION_BASE = 14;
