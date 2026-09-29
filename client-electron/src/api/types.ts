export interface Session {
  accessToken: string;
  refreshToken: string;
  utilisateurId: string;
  username: string;
  boutiqueId: string;
  boutiqueNom: string;
  role: string;
  permissions: Record<string, boolean>;
  depotId: string | null;
  depotNom: string | null;
  // Synchro serveur activée par l'administrateur pour cette boutique (voir
  // comptes.Boutique.synchro_autorisee côté backend) — certains commerçants
  // ne veulent pas que leurs données quittent leur poste.
  synchroAutorisee: boolean;
}

export interface AbonnementBoutique {
  boutiqueId: string;
  boutiqueNom: string;
  formule: string;
  dateExpirationAbonnement: string | null;
  synchroAutorisee: boolean;
}

export interface ChampsAbonnement {
  formule?: string;
  dateExpirationAbonnement?: string | null;
  synchroAutorisee?: boolean;
}

export interface AbonnementEnAttente {
  boutiqueId: string;
  boutiqueNom: string;
  champs: ChampsAbonnement;
}

export type ResultatAbonnement = { statut: "synchronise" } | { statut: "horsLigne" };

export type ResultatCreationEnLigne = { statut: "enLigne"; session: Session } | { statut: "horsLigne"; session: Session };

export interface PatronResume {
  username: string;
  boutiqueNom: string;
}

export interface BoutiqueLocaleEnAttente {
  boutiqueId: string;
  utilisateurIdLocal: string;
  boutiqueNom: string;
  adresse: string;
  telephone: string;
  email: string;
  devise: string;
  patronUsername: string;
  patronEmail: string;
  patronTelephone: string;
}

export interface VarianteRecherchee {
  id: string;
  produitId: string;
  produitNom: string;
  reference: string;
  codeBarres: string;
  prixVente: number;
  prixAchat: number;
  seuilAlerte: number;
}

export interface VarianteCatalogue extends VarianteRecherchee {
  categorieNom: string | null;
  quantiteDisponible: number;
  /** Article en déstockage : prixVente est alors le prix de déstockage, prixNormal l'ancien prix. */
  prixNormal: number | null;
}

export interface Depot {
  id: string;
  nom: string;
}

export interface ClientBoutique {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
}

export type ModePaiement = "especes" | "mobile_money" | "carte" | "credit";
export type OperateurMobileMoney = "orange_money" | "mtn_money" | "moov_money" | "wave";
export type StatutVente = "payee" | "credit";

export interface LigneVenteEntree {
  varianteId: string;
  quantite: number;
  prixUnitaire?: number;
  remise?: number;
}

export interface PaiementEntree {
  mode: ModePaiement;
  operateur?: OperateurMobileMoney | "";
  montant: number;
}

export interface ParametresVente {
  boutiqueId: string;
  depotId: string;
  utilisateurId: string | null;
  clientId?: string | null;
  statut: StatutVente;
  lignes: LigneVenteEntree[];
  paiements: PaiementEntree[];
  remiseGlobale?: number;
}

export interface VenteCreee {
  id: string;
  numero: string;
  totalBrut: number;
  totalNet: number;
}

export type ResultatVente = { succes: true; vente: VenteCreee } | { succes: false; message: string };

export type StatutVenteHistorique = "payee" | "credit" | "annulee";

export interface VenteResume {
  id: string;
  numero: string;
  dateCreation: string;
  depotNom: string;
  clientNom: string | null;
  statut: StatutVenteHistorique;
  totalNet: number;
  utilisateurId: string | null;
  /** Quantité totale d'articles vendus. */
  nombreArticles: number;
  /** Part de la vente payée à crédit. */
  montantCredit: number;
}

export interface LigneVenteDetail {
  id: string;
  produitNom: string;
  reference: string;
  quantite: number;
  prixUnitaire: number;
  remise: number;
  sousTotal: number;
  /** Renseigné si l'article a été vendu en déstockage (prix normal du moment). */
  prixNormal: number | null;
}

export interface LigneVenteHistorique {
  venteId: string;
  venteNumero: string;
  dateCreation: string;
  clientNom: string | null;
  statut: StatutVenteHistorique;
  quantite: number;
  prixUnitaire: number;
  sousTotal: number;
}

export interface PaiementDetail {
  id: string;
  mode: ModePaiement;
  operateur?: OperateurMobileMoney | "";
  montant: number;
}

export interface VenteDetail {
  id: string;
  numero: string;
  dateCreation: string;
  depotNom: string;
  clientNom: string | null;
  clientTelephone: string | null;
  statut: StatutVenteHistorique;
  totalBrut: number;
  remise: number;
  totalNet: number;
  utilisateurId: string | null;
  lignes: LigneVenteDetail[];
  paiements: PaiementDetail[];
}

export interface ResultatPush {
  table: string;
  enregistrement_id: string;
  statut: "synchronise" | "conflit" | "erreur";
  message?: string;
}

export type ResultatSynchro =
  | { succes: true; push: ResultatPush[]; derniereSynchro: string }
  | { succes: false; message: string };

export interface EtatSynchro {
  derniereSynchro: string | null;
  enLigne: boolean;
}

export interface ReferenceNommee {
  id: string;
  nom: string;
}

export interface CategorieDetail {
  id: string;
  nom: string;
  /** Articles (produits non supprimés) rangés dans cette catégorie. */
  nombreArticles: number;
}

export interface ArticleCategorie {
  varianteId: string;
  produitId: string;
  produitNom: string;
  reference: string;
  prixVente: number;
  /** Stock total, tous dépôts confondus. */
  quantiteStock: number;
  /** Catégorie de l'article (null = sans catégorie). */
  categorieId: string | null;
  prixAchat: number;
  seuilAlerte: number;
}

export interface UniteResume extends ReferenceNommee {
  abreviation: string;
}

export interface ValeurAttributResume {
  id: string;
  valeur: string;
  attributId: string;
}

export interface ProduitResume {
  id: string;
  nom: string;
  reference: string | null;
  categorieNom: string | null;
  actif: number;
  prixVente: number | null;
  prixAchat: number | null;
  dateCreation: string;
  enStock: number;
  /** Toutes variantes et tous dépôts confondus. */
  quantiteStock: number;
  /** Seuil d'alerte de la variante par défaut. */
  seuilAlerte: number;
  /** Stock valorisé au prix d'achat de chaque variante. */
  valeurStock: number;
}

export interface VarianteDetail {
  id: string;
  reference: string;
  codeBarres: string;
  prixAchat: number;
  prixVente: number;
  seuilAlerte: number;
  actif: number;
  quantiteStock: number;
  valeurs: string[];
}

export interface ProduitDetail {
  id: string;
  nom: string;
  categorieId: string | null;
  categorieNom: string | null;
  uniteId: string | null;
  uniteNom: string | null;
  description: string;
  actif: number;
  variantes: VarianteDetail[];
}

export interface ParametresProduit {
  boutiqueId: string;
  nom: string;
  categorieId?: string | null;
  uniteId?: string | null;
  description?: string;
  reference?: string;
  codeBarres?: string;
  prixAchat?: number;
  prixVente?: number;
  seuilAlerte?: number;
}

export interface ChampsProduit {
  nom?: string;
  categorieId?: string | null;
  uniteId?: string | null;
  description?: string;
  actif?: boolean;
}

export interface ParametresVarianteEntree {
  produitId: string;
  reference?: string;
  codeBarres?: string;
  prixAchat?: number;
  prixVente?: number;
  seuilAlerte?: number;
  valeurAttributIds?: string[];
}

export interface ChampsVariante {
  reference?: string;
  codeBarres?: string;
  prixAchat?: number;
  prixVente?: number;
  seuilAlerte?: number;
  actif?: boolean;
  valeurAttributIds?: string[];
}

export type ResultatEcriture<T> = { succes: true; resultat: T } | { succes: false; message: string };

export interface DepotResume {
  id: string;
  nom: string;
  adresse: string;
}

export interface ChampsDepot {
  nom?: string;
  adresse?: string;
}

export interface ChampsUnite {
  nom?: string;
  abreviation?: string;
}

export type TypeMouvement = "entree" | "sortie" | "ajustement";

/** Pré-remplissage du bouton "Commander" depuis une ligne en rupture (Stock ou Notifications). */
export interface LigneAchatInitiale {
  varianteId: string;
  produitNom: string;
  prixAchat: number;
  prixVente: number;
  depotId: string;
  depotNom: string;
}

export interface ParametresEntreeProduction {
  varianteId: string;
  depotId: string;
  quantite: number;
  prixAchat: number;
  prixVente?: number;
  motif?: string;
  utilisateurId?: string | null;
}

export interface LigneStock {
  id: string;
  varianteId: string;
  produitId: string;
  produitNom: string;
  reference: string;
  depotId: string;
  depotNom: string;
  quantite: number;
  seuilAlerte: number;
  prixAchat: number;
  prixVente: number;
  enRupture: number;
  /** Article de gros : son article de détail et combien il en contient. */
  detailNom?: string | null;
  quantiteDetail?: number | null;
  /** Article de détail : son article de gros et le stock de gros dans ce dépôt. */
  grosNom?: string | null;
  grosStock?: number | null;
  /** Unités (carton, paquet…) pour « 12 cartons (= 288 paquets) ». */
  detailUnite?: string | null;
  grosUnite?: string | null;
  /** Article de détail : son article de gros (pour l'ouvrir depuis la ligne). */
  grosVarianteId?: string | null;
}

export interface MouvementResume {
  id: string;
  produitNom: string;
  reference: string;
  depotNom: string;
  type: TypeMouvement;
  quantite: number;
  motif: string;
  dateCreation: string;
  /** Qui a fait l'opération (voir hooks/useNomsUtilisateurs.ts). */
  utilisateurId: string | null;
  /** Document à l'origine du mouvement (ex. « ventes.Vente ») ; vide pour une saisie manuelle. */
  referenceType: string;
}

export interface ParametresMouvement {
  varianteId: string;
  depotId: string;
  type: TypeMouvement;
  quantite: number;
  motif?: string;
  utilisateurId?: string | null;
  referenceType?: string;
  referenceId?: string | null;
}

export interface ParametresTransfert {
  varianteId: string;
  depotSourceId: string;
  depotDestinationId: string;
  quantite: number;
  utilisateurId: string | null;
}

export interface TransfertResume {
  id: string;
  produitNom: string;
  reference: string;
  depotSourceNom: string;
  depotDestinationNom: string;
  quantite: number;
  dateCreation: string;
  /** Qui a fait l'opération (voir hooks/useNomsUtilisateurs.ts). */
  utilisateurId: string | null;
}

export interface ReleveDormants {
  date: string;
  nombreArticles: number;
  valeurImmobilisee: number;
}

export type ActionSortieDormance = "revendu" | "perte" | "destockage";

export interface SortieDormance {
  id: string;
  date: string;
  varianteId: string;
  produitNom: string;
  reference: string;
  joursSansVente: number;
  action: ActionSortieDormance;
  motif: string;
  detail: string;
  quantite: number;
  montant: number;
}

export interface LigneProduitDormant {
  varianteId: string;
  produitId: string;
  produitNom: string;
  reference: string;
  codeBarres: string;
  prixVente: number;
  prixAchat: number;
  seuilAlerte: number;
  quantiteStock: number;
  derniereVente: string | null;
  joursSansVente: number;
  valeurImmobilisee: number;
  enDestockage: boolean;
}

export interface ParametresDestockage {
  varianteId: string;
  prixDestockage: number;
  dateFin?: string | null;
  utilisateurId: string | null;
}

export interface ParametresOperationDestockage {
  boutiqueId: string;
  nom: string;
  lignes: { varianteId: string; prixDestockage: number }[];
  dateFin?: string | null;
  utilisateurId: string | null;
}

export type StatutDestockage = "en_cours" | "termine";
export type MotifFinDestockage = "" | "date" | "epuise" | "manuel";

export interface DestockageResume {
  id: string;
  varianteId: string;
  produitNom: string;
  reference: string;
  prixAchat: number;
  prixNormal: number;
  prixDestockage: number;
  dateCreation: string;
  dateFin: string | null;
  dateArret: string | null;
  statut: StatutDestockage;
  motifFin: MotifFinDestockage;
  operationId: string | null;
  operationNom: string | null;
  quantiteVendue: number;
  chiffreAffaires: number;
  marge: number;
  manqueAGagner: number;
  stockRestant: number;
  /** Qui a fait l'opération (voir hooks/useNomsUtilisateurs.ts). */
  utilisateurId: string | null;
}

export type MotifPerte = "perime" | "abime" | "vol" | "don" | "consommation" | "autre";

export interface ParametresPerte {
  varianteId: string;
  depotId: string;
  quantite: number;
  motif: MotifPerte;
  detail?: string;
  utilisateurId: string | null;
}

export interface PerteResume {
  id: string;
  dateCreation: string;
  produitNom: string;
  reference: string;
  depotNom: string;
  quantite: number;
  motif: MotifPerte;
  detail: string;
  valeur: number;
  /** Qui a fait l'opération (voir hooks/useNomsUtilisateurs.ts). */
  utilisateurId: string | null;
  annulee: boolean;
}

export interface InventaireResume {
  id: string;
  depotId: string;
  depotNom: string;
  statut: string;
  dateCreation: string;
  dateValidation: string | null;
  utilisateurId: string | null;
  /** Articles comptés (lignes de l'inventaire). */
  nombreArticles: number;
  /** Articles trouvés en plus / en moins que le stock théorique. */
  ecartsPlus: number;
  ecartsMoins: number;
  /** Valeur de l'écart au coût d'achat (figé à la validation). */
  ecartValeur: number;
}

export interface LigneInventaireDetail {
  id: string;
  varianteId: string;
  produitNom: string;
  reference: string;
  codeBarres: string;
  qteTheorique: number;
  qtePhysique: number;
  ecart: number;
  prixAchat: number;
  valeurTheorique: number;
  valeurPhysique: number;
  valeurEcart: number;
  caPeriode: number;
}

export interface InventaireDetail {
  id: string;
  depotId: string;
  depotNom: string;
  statut: string;
  dateValidation: string | null;
  lignes: LigneInventaireDetail[];
  valeurTheorique: number;
  valeurPhysique: number;
  ecartValeur: number;
  caPeriode: number;
}

export type StatutCommande = "brouillon" | "commandee" | "recue" | "annulee";
export type StatutDette = "en_cours" | "solde";

export interface FournisseurResume {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  contact: string;
}

export interface ChampsFournisseur {
  nom?: string;
  telephone?: string;
  adresse?: string;
  contact?: string;
}

export interface CommandeResume {
  id: string;
  numero: string;
  dateCreation: string;
  fournisseurNom: string;
  statut: StatutCommande;
  total: number;
  partiellementRecue: boolean;
  quantiteCommandee: number;
  quantiteRecue: number;
  /** Qui a passé la commande. */
  utilisateurId: string | null;
  /** Valeur des réceptions non annulées de la commande. */
  valeurRecue: number;
}

export interface LigneAchatDetail {
  id: string;
  varianteId: string;
  produitNom: string;
  reference: string;
  quantite: number;
  prixAchat: number;
  sousTotal: number;
  prixVenteActuel: number;
  quantiteRecue: number;
}

export interface CommandeDetail {
  id: string;
  numero: string;
  dateCreation: string;
  fournisseurId: string;
  fournisseurNom: string;
  statut: StatutCommande;
  total: number;
  lignes: LigneAchatDetail[];
}

export interface LigneAchatEntree {
  varianteId: string;
  quantite: number;
  prixAchat: number;
}

export interface ParametresCommande {
  boutiqueId: string;
  fournisseurId: string;
  utilisateurId: string | null;
  statut: StatutCommande;
  lignes: LigneAchatEntree[];
}

export interface ParametresModifierCommande {
  fournisseurId?: string;
  statut?: StatutCommande;
  lignes?: LigneAchatEntree[];
  utilisateurId?: string | null;
}

export interface LigneReceptionEntree {
  varianteId: string;
  quantite: number;
  prixVente?: number;
}

export interface ParametresReception {
  commandeId: string;
  depotId: string;
  utilisateurId: string | null;
  montantDejaPaye?: number;
  lignes: LigneReceptionEntree[];
}

export interface DetteResume {
  id: string;
  fournisseurNom: string;
  commandeId: string | null;
  commandeNumero: string | null;
  montant: number;
  montantPaye: number;
  solde: number;
  statut: StatutDette;
  dateCreation: string;
  /** Dernière modification : pour une dette soldée, le moment où elle l'a été. */
  dateModification: string;
  /** Première tranche pas encore payée de son échéancier (null s'il n'y en a pas). */
  prochaineEcheance: { date: string; reste: number; enRetard: boolean } | null;
}

export type StatutEcheance = "payee" | "partielle" | "a_venir" | "en_retard";

/** Tranche d'un échéancier, avec ce que les paiements en couvrent déjà. */
export interface EcheanceDetail {
  id: string;
  dateEcheance: string;
  montant: number;
  couvert: number;
  statut: StatutEcheance;
}

/** Tranche non payée d'une dette en cours (alertes, prochaine échéance). */
export interface EcheanceEnCours extends EcheanceDetail {
  detteId: string;
  fournisseurNom: string;
  commandeNumero: string | null;
}

export interface PaiementDetteDetail {
  id: string;
  montant: number;
  mode: string;
  dateCreation: string;
  /** Remboursement annulé (reste visible ; son montant est revenu dans le solde). */
  annulee: boolean;
  dateAnnulation: string | null;
  annuleParId: string | null;
  motifAnnulation: string;
}

export interface LigneReceptionDetail {
  varianteId: string;
  produitNom: string;
  reference: string;
  quantite: number;
  quantiteRetournee: number;
}

export interface RetourFournisseurDetail {
  id: string;
  dateCreation: string;
  motif: string;
  montant: number;
  avoir: number;
  utilisateurId: string | null;
  lignes: { produitNom: string; quantite: number }[];
}

export interface ReceptionDetail {
  id: string;
  dateCreation: string;
  depotNom: string;
  valeurRecue: number;
  montantPaye: number;
  lignes: LigneReceptionDetail[];
  annulee: boolean;
  utilisateurId: string | null;
  retours: RetourFournisseurDetail[];
}

export interface ReceptionHistorique extends ReceptionDetail {
  commandeId: string;
  commandeNumero: string;
  fournisseurNom: string;
}

export interface PaiementFournisseurHistorique {
  id: string;
  dateCreation: string;
  fournisseurNom: string;
  commandeId: string | null;
  commandeNumero: string | null;
  montant: number;
  mode: string;
  /** Payé sur place à la réception, ou règlement d'une dette ensuite. */
  origine: "reception" | "dette";
  /** Paiement fait à une réception annulée depuis (hors totaux). */
  annulee: boolean;
}

export interface RetourFournisseurHistorique {
  id: string;
  dateCreation: string;
  commandeId: string;
  commandeNumero: string;
  fournisseurNom: string;
  depotNom: string;
  motif: string;
  montant: number;
  avoir: number;
  /** Quantité totale renvoyée. */
  quantite: number;
  utilisateurId: string | null;
}

/** Tout l'historique des achats de la boutique (carte « Historique » d'Achats & fournisseurs). */
export interface HistoriqueAchats {
  commandes: CommandeResume[];
  receptions: ReceptionHistorique[];
  paiements: PaiementFournisseurHistorique[];
  retours: RetourFournisseurHistorique[];
}

export type TypeEtapeCommande =
  | "creee"
  | "modifiee"
  | "commandee"
  | "reception"
  | "reception_annulee"
  | "retour"
  | "paiement"
  | "paiement_annule"
  | "annulee";

/** Une étape du suivi d'une commande (achats.EvenementCommande). */
export interface EtapeCommande {
  id: string;
  type: TypeEtapeCommande;
  dateCreation: string;
  utilisateurId: string | null;
  detail: string;
  montant: number | null;
  /** Déduite des données existantes (commande antérieure au suivi), jamais enregistrée. */
  reconstitue: boolean;
}

export type StatutCredit = "en_cours" | "solde";

export interface ClientDetailResume {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  soldeCredit: number;
  /** Ventes non annulées du client : total, nombre, date de la plus récente. */
  totalAchats: number;
  nombreAchats: number;
  dernierAchat: string | null;
  dateCreation: string;
}

export interface ChampsClient {
  nom?: string;
  telephone?: string;
  adresse?: string;
}

export interface CreditResume {
  id: string;
  clientId: string;
  clientNom: string;
  clientEstPermanent: number;
  /** Pour la relance WhatsApp depuis la liste des crédits. */
  clientTelephone: string;
  venteNumero: string | null;
  montant: number;
  montantPaye: number;
  solde: number;
  echeance: string | null;
  statut: StatutCredit;
  dateCreation: string;
  /** Première tranche pas encore réglée de son échéancier (null s'il n'y en a pas). */
  prochaineEcheance: { date: string; reste: number; enRetard: boolean } | null;
}

export interface RemboursementClient {
  id: string;
  creditId: string;
  clientNom: string;
  venteNumero: string | null;
  montant: number;
  mode: string;
  dateCreation: string;
  utilisateurId: string | null;
}

export type TypeDetaillage = "detailler" | "regrouper";

export interface ParametresDetaillage {
  varianteGrosId: string;
  depotId: string;
  nombre: number;
  type: TypeDetaillage;
  utilisateurId: string | null;
}

export interface DetaillageResume {
  id: string;
  dateCreation: string;
  type: TypeDetaillage;
  depotNom: string;
  varianteSourceId: string;
  varianteCibleId: string;
  sourceNom: string;
  cibleNom: string;
  quantiteSource: number;
  quantiteCible: number;
  coutUnitaireCible: number;
  utilisateurId: string | null;
  depotId: string;
  uniteSource: string;
  uniteCible: string;
  dateAnnulation: string | null;
  /** Stock actuel de ce qui a été obtenu, dans ce dépôt (pour savoir si l'annulation est possible). */
  stockCibleActuel: number;
  annulee: boolean;
}

export interface ArticleDetaillable {
  varianteGrosId: string;
  grosNom: string;
  varianteDetailId: string;
  detailNom: string;
  /** Unités de détail dans un article de gros. */
  quantite: number;
  /** Stock (du dépôt demandé, sinon tous dépôts). */
  stockGros: number;
  stockDetail: number;
  /** Unités (Paramètres → Unités) : « carton », « paquet »… vides si non renseignées. */
  uniteGros: string;
  uniteDetail: string;
  prixAchatGros: number;
  prixAchatDetail: number;
  prixVenteDetail: number;
  /** Seuil d'alerte de l'article de détail (« à déballer » en dessous). */
  seuilDetail: number;
}

export interface GrosDisponible {
  varianteGrosId: string;
  grosNom: string;
  quantite: number;
  stockGros: number;
  uniteGros: string;
  uniteDetail: string;
}

export interface LienDetail {
  varianteId: string;
  nom: string;
  /** Unité de cet article lié (« paquet », « carton »…), vide si non renseignée. */
  unite: string;
  quantite: number;
}

export interface InfoDetail {
  detail: LienDetail | null;
  gros: LienDetail | null;
  /** Unité de l'article consulté lui-même. */
  uniteArticle: string;
}

export interface ParametresArticleDetail {
  varianteGrosId: string;
  nom: string;
  prixVente: number;
  quantite: number;
  /** Unité de l'article de détail (« paquet »…). */
  uniteId?: string | null;
}

export interface PaiementCreditDetail {
  id: string;
  montant: number;
  mode: string;
  dateCreation: string;
  utilisateurId: string | null;
}

export interface CreditDetail {
  id: string;
  clientId: string;
  clientNom: string;
  venteNumero: string | null;
  montant: number;
  montantPaye: number;
  solde: number;
  echeance: string | null;
  statut: StatutCredit;
  dateCreation: string;
  paiements: PaiementCreditDetail[];
}

export type Periode = "jour" | "semaine" | "mois" | "mois_dernier" | "annee" | "tout" | "personnalise";

export interface SyntheseVentes {
  totalBrut: number;
  totalRemises: number;
  totalNet: number;
  nombreVentes: number;
  panierMoyen: number;
  beneficeTotal: number;
}

export interface LigneTopProduit {
  varianteId: string;
  produit: string;
  reference: string;
  quantiteVendue: number;
  caGenere: number;
}

export interface ValeurStock {
  valeurAchat: number;
  valeurVentePotentielle: number;
  nombreVariantes: number;
  nombreRuptures: number;
}

export interface LigneVentesVendeur {
  utilisateurId: string | null;
  nombreVentes: number;
  totalNet: number;
}

export interface LigneVentesCategorie {
  categorieId: string | null;
  categorie: string;
  quantiteVendue: number;
  caGenere: number;
}

export interface LigneVentesModePaiement {
  mode: string;
  total: number;
}

export interface LigneVentesParJour {
  jour: string;
  totalNet: number;
}

export interface LigneTopClient {
  clientId: string;
  clientNom: string;
  nombreVentes: number;
  totalNet: number;
}

export interface CompteSyscohada {
  numero: string;
  libelle: string;
  classe: number;
}

export interface LigneJournalLocal {
  date: string;
  journal: string;
  libelleEcriture: string;
  compte: string;
  libelleCompte: string;
  debit: number;
  credit: number;
}

export interface LigneGrandLivreLocal {
  date: string;
  journal: string;
  libelle: string;
  debit: number;
  credit: number;
  soldeCumule: number;
}

export interface GrandLivreLocal {
  compte: string;
  libelle: string;
  lignes: LigneGrandLivreLocal[];
  soldeFinal: number;
}

export interface LigneBalanceLocale {
  compte: string;
  libelle: string;
  classe: number;
  totalDebit: number;
  totalCredit: number;
  soldeDebiteur: number;
  soldeCrediteur: number;
}

export interface BalanceLocale {
  lignes: LigneBalanceLocale[];
  totalDebit: number;
  totalCredit: number;
}

export interface LigneResultatLocale {
  compte: string;
  libelle: string;
  montant: number;
}

export interface CompteDeResultatLocal {
  charges: LigneResultatLocale[];
  produits: LigneResultatLocale[];
  totalCharges: number;
  totalProduits: number;
  resultatNet: number;
}

export interface MasseBilan {
  masse: string;
  lignes: LigneResultatLocale[];
  sousTotal: number;
}

export interface BilanLocal {
  date: string;
  actif: MasseBilan[];
  passif: MasseBilan[];
  totalActif: number;
  totalPassif: number;
}

export type FormatExport = "csv" | "xlsx" | "pdf";

export interface ColonneExport {
  cle: string;
  libelle: string;
}

export type ResultatExport = { annule: true } | { annule: false; chemin: string };
export type ResultatExporter = { succes: true; resultat: ResultatExport } | { succes: false; message: string };

export interface PlageDates {
  debut: string;
  fin: string;
}

export interface BoutiqueDetail {
  id: string;
  nom: string;
  adresse: string;
  telephone: string;
  email: string;
  devise: string;
  /** Abonnement (formule Essentiel/Pro et échéance), affiché dans Informations boutique. */
  formule: string;
  dateExpirationAbonnement: string | null;
}

/** Nombre d'articles qui utilisent chaque unité / chaque attribut (Réglages → Paramètres). */
export interface UsagesCatalogue {
  unites: Record<string, number>;
  attributs: Record<string, number>;
}

/** Changements locaux pas encore envoyés au serveur, par type. */
export interface EnAttenteSynchro {
  table: string;
  nombre: number;
}

/** Dépôt supprimé qui contient encore du stock (à rapatrier). */
export interface DepotSupprimeAvecStock {
  id: string;
  nom: string;
  articles: number;
  valeur: number;
}

export interface ChampsBoutique {
  nom?: string;
  adresse?: string;
  telephone?: string;
  email?: string;
  devise?: string;
}

export interface ParametreResume {
  id: string;
  cle: string;
  valeur: string;
}

export interface RoleResume {
  id: string;
  nom: string;
  permissions: Record<string, boolean>;
}

export interface UtilisateurResume {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  telephone: string;
  role: string | null;
  depot: string | null;
  is_active: boolean;
  date_joined: string;
}

export interface ParametresCreationUtilisateur {
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  telephone?: string;
  roleId?: string | null;
  depotId?: string | null;
}

export interface ChampsUtilisateur {
  roleId?: string | null;
  depotId?: string | null;
  isActive?: boolean;
  password?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  telephone?: string;
}

export type ResultatComptes<T> = { succes: true; resultat: T } | { succes: false; message: string };

export type FournisseurMobileMoney = "wave" | "orange_money" | "mtn";
export type StatutTransaction = "en_attente" | "reussie" | "echouee";

export interface ParametresInitiationMobileMoney {
  paiementId: string;
  fournisseur: FournisseurMobileMoney;
  numeroTelephone: string;
  montant: number;
}

export interface TransactionResume {
  id: string;
  paiementId: string;
  fournisseur: FournisseurMobileMoney;
  numeroTelephone: string;
  referenceExterne: string;
  statut: StatutTransaction;
  montant: number;
}

export type TypeNotification =
  | "alerte_rupture"
  | "alerte_dormants"
  | "fin_destockage"
  | "echeance_proche"
  | "echeance_retard"
  | "credit_proche"
  | "credit_retard";

export interface NotificationResume {
  id: string;
  type: TypeNotification;
  message: string;
  dateCreation: string;
  depotId: string | null;
  depotNom: string | null;
  referenceType: string;
  referenceId: string | null;
  /** Déjà vue (la page Notifications marque tout comme lu à l'ouverture). */
  lu: boolean;
}

export interface FiltresNotifications {
  depotId?: string;
}

export type TypeMessage = "rappel_credit" | "ticket_whatsapp";
export type CanalMessage = "sms" | "whatsapp" | "interne";
export type StatutMessage = "en_attente" | "envoyee" | "echouee";

export interface MessageResume {
  id: string;
  type: TypeMessage;
  canal: CanalMessage;
  destinataire: string;
  message: string;
  statut: StatutMessage;
  dateEnvoi: string | null;
  dateCreation: string;
  depotId: string | null;
  depotNom: string | null;
  utilisateurId: string | null;
  referenceType: string;
  referenceId: string | null;
  /** Client concerné (via le crédit ou la vente liés), pour la liste et l'envoi WhatsApp. */
  clientNom: string | null;
  clientTelephone: string | null;
}

export interface FiltresMessages {
  statut?: StatutMessage;
  depotId?: string;
  utilisateurId?: string;
}

// --- Trésorerie ---

export type TypeMouvementCaisse = "entree" | "sortie" | "ajustement";
export type CategorieMouvementCaisse =
  | "vente_especes"
  | "remboursement_credit"
  | "transfert_mobile_money"
  | "apport"
  | "depense"
  | "retrait"
  | "paiement_dette_fournisseur"
  | "ajustement";
export type CategorieDepense =
  | "transport"
  | "reparation"
  | "achat_marchandise"
  | "achat_divers"
  | "remboursement_client"
  | "autre"
  | (string & {});

export interface MouvementCaisseResume {
  id: string;
  type: TypeMouvementCaisse;
  categorie: CategorieMouvementCaisse;
  montant: number;
  motif: string;
  utilisateurId: string | null;
  dateCreation: string;
}

export interface DepenseResume {
  id: string;
  categorie: CategorieDepense;
  montant: number;
  description: string;
  utilisateurId: string | null;
  dateCreation: string;
}

export interface ParametresTransfertCaisse {
  boutiqueId: string;
  depotId: string;
  utilisateurSourceId: string;
  operateur: OperateurMobileMoney;
  montant: number;
  utilisateurId?: string | null;
}

export interface TransfertCaisseResume {
  id: string;
  utilisateurSourceId: string | null;
  operateur: OperateurMobileMoney;
  montant: number;
  utilisateurId: string | null;
  dateCreation: string;
}

export interface ClotureCaisseResume {
  id: string;
  soldeTheorique: number;
  soldeCompte: number;
  ecart: number;
  utilisateurId: string | null;
  dateCreation: string;
}

export interface WindowApi {
  auth: {
    connexion(username: string, password: string): Promise<ResultatEcriture<Session>>;
    inscription(params: {
      boutiqueNom: string;
      username: string;
      password: string;
      email: string;
    }): Promise<ResultatEcriture<void>>;
    verifierAccesAdmin(username: string, password: string): Promise<ResultatEcriture<boolean>>;
    verifierRevocationAdmin(): Promise<void>;
    session(): Promise<Session | null>;
    deconnexion(): Promise<void>;
    rafraichirPermissions(session: Session): Promise<Session>;
    demanderReinitialisationMotDePasse(email: string): Promise<ResultatEcriture<void>>;
    reinitialiserMotDePasse(
      email: string,
      code: string,
      nouveauMotDePasse: string,
    ): Promise<ResultatEcriture<void>>;
    reinitialiserMotDePasseAdmin(
      usernameAdmin: string,
      passwordAdmin: string,
      usernameCible: string,
      nouveauMotDePasse: string,
    ): Promise<ResultatEcriture<void>>;
    listerPatrons(usernameAdmin: string, passwordAdmin: string): Promise<PatronResume[]>;
  };
  admin: {
    boutiqueLocale(): Promise<AbonnementBoutique | null>;
    abonnementEnAttente(): Promise<AbonnementEnAttente | null>;
    soumettreAbonnement(
      username: string,
      password: string,
      boutiqueId: string,
      boutiqueNom: string,
      champs: ChampsAbonnement,
    ): Promise<ResultatEcriture<ResultatAbonnement>>;
    creerBoutiqueLocale(params: {
      boutiqueNom: string;
      username: string;
      password: string;
      email: string;
    }): Promise<ResultatEcriture<Session>>;
    creerBoutiqueEnLigne(
      usernameAdmin: string,
      passwordAdmin: string,
      params: { boutiqueNom: string; username: string; password: string; email: string },
    ): Promise<ResultatEcriture<ResultatCreationEnLigne>>;
    boutiqueLocaleEnAttente(): Promise<BoutiqueLocaleEnAttente | null>;
    activerEnLigne(
      usernameAdmin: string,
      passwordAdmin: string,
      patronPassword: string,
      session: Session,
    ): Promise<ResultatEcriture<Session>>;
  };
  catalogue: {
    rechercherVariantes(boutiqueId: string, terme: string): Promise<VarianteRecherchee[]>;
    listerVariantesCatalogue(boutiqueId: string, depotId?: string): Promise<VarianteCatalogue[]>;
    listerDepots(boutiqueId: string): Promise<Depot[]>;
    listerClients(boutiqueId: string): Promise<ClientBoutique[]>;
    obtenirStock(varianteId: string, depotId: string): Promise<number>;
  };
  ventes: {
    creer(params: ParametresVente): Promise<ResultatVente>;
    lister(
      boutiqueId: string,
      depotId?: string,
      statut?: StatutVenteHistorique,
      terme?: string,
      limite?: number,
      clientId?: string,
    ): Promise<VenteResume[]>;
    obtenir(id: string): Promise<VenteDetail | undefined>;
    annuler(id: string, utilisateurId: string | null): Promise<ResultatEcriture<void>>;
    listerParProduit(produitId: string, limite?: number): Promise<LigneVenteHistorique[]>;
  };
  produits: {
    lister(boutiqueId: string, terme?: string): Promise<ProduitResume[]>;
    obtenir(id: string): Promise<ProduitDetail | undefined>;
    creer(params: ParametresProduit): Promise<ResultatEcriture<{ produitId: string; varianteId: string }>>;
    modifier(id: string, champs: ChampsProduit): Promise<ResultatEcriture<void>>;
    supprimer(id: string): Promise<ResultatEcriture<void>>;
    usagesCatalogue(boutiqueId: string): Promise<UsagesCatalogue>;
    prochaineReference(boutiqueId: string): Promise<string>;
  };
  variantes: {
    creer(params: ParametresVarianteEntree): Promise<ResultatEcriture<string>>;
    modifier(id: string, champs: ChampsVariante): Promise<ResultatEcriture<void>>;
  };
  categories: {
    lister(boutiqueId: string): Promise<ReferenceNommee[]>;
    listerDetail(boutiqueId: string): Promise<CategorieDetail[]>;
    articles(categorieId: string): Promise<ArticleCategorie[]>;
    articlesBoutique(boutiqueId: string): Promise<ArticleCategorie[]>;
    creer(boutiqueId: string, nom: string): Promise<ResultatEcriture<string>>;
    modifier(id: string, nom: string): Promise<ResultatEcriture<void>>;
    /** remplacementId : où déplacer les articles de la catégorie (null = sans catégorie). */
    supprimer(id: string, remplacementId?: string | null): Promise<ResultatEcriture<void>>;
  };
  unites: {
    lister(boutiqueId: string): Promise<UniteResume[]>;
    creer(boutiqueId: string, nom: string, abreviation?: string): Promise<ResultatEcriture<string>>;
    modifier(id: string, champs: ChampsUnite): Promise<ResultatEcriture<void>>;
    supprimer(id: string): Promise<ResultatEcriture<void>>;
  };
  attributs: {
    lister(boutiqueId: string): Promise<ReferenceNommee[]>;
    creer(boutiqueId: string, nom: string): Promise<ResultatEcriture<string>>;
    modifier(id: string, nom: string): Promise<ResultatEcriture<void>>;
    supprimer(id: string): Promise<ResultatEcriture<void>>;
    listerValeurs(attributId: string): Promise<ValeurAttributResume[]>;
    creerValeur(attributId: string, valeur: string): Promise<ResultatEcriture<string>>;
    modifierValeur(id: string, valeur: string): Promise<ResultatEcriture<void>>;
    supprimerValeur(id: string): Promise<ResultatEcriture<void>>;
  };
  depots: {
    transfererTout(sourceId: string, destinationId: string, utilisateurId: string | null): Promise<ResultatEcriture<number>>;
    supprimesAvecStock(boutiqueId: string): Promise<DepotSupprimeAvecStock[]>;
    lister(boutiqueId: string): Promise<DepotResume[]>;
    creer(boutiqueId: string, nom: string, adresse?: string): Promise<ResultatEcriture<string>>;
    modifier(id: string, champs: ChampsDepot): Promise<ResultatEcriture<void>>;
    supprimer(id: string): Promise<ResultatEcriture<void>>;
  };
  stock: {
    lister(boutiqueId: string, depotId?: string, terme?: string): Promise<LigneStock[]>;
    obtenirLigne(id: string): Promise<LigneStock | undefined>;
  };
  mouvements: {
    lister(boutiqueId: string, depotId?: string, limite?: number): Promise<MouvementResume[]>;
    listerParProduit(produitId: string, limite?: number): Promise<MouvementResume[]>;
    creer(params: ParametresMouvement): Promise<ResultatEcriture<string>>;
    creerEntreeProduction(params: ParametresEntreeProduction): Promise<ResultatEcriture<string>>;
  };
  destockages: {
    lister(boutiqueId: string): Promise<DestockageResume[]>;
    demarrer(params: ParametresDestockage): Promise<ResultatEcriture<string>>;
    arreter(id: string): Promise<ResultatEcriture<void>>;
    modifier(id: string, champs: { prixDestockage?: number; dateFin?: string | null }): Promise<ResultatEcriture<void>>;
    demarrerOperation(params: ParametresOperationDestockage): Promise<ResultatEcriture<string>>;
    arreterOperation(id: string): Promise<ResultatEcriture<void>>;
  };
  detaillages: {
    operer(params: ParametresDetaillage): Promise<ResultatEcriture<string>>;
    annuler(id: string, utilisateurId: string | null): Promise<ResultatEcriture<void>>;
    lister(boutiqueId: string): Promise<DetaillageResume[]>;
    variantes(boutiqueId: string): Promise<{ id: string; nom: string }[]>;
    articles(boutiqueId: string, depotId?: string): Promise<ArticleDetaillable[]>;
    grosDisponible(varianteDetailId: string, depotId: string): Promise<GrosDisponible | null>;
    infoDetail(varianteId: string): Promise<InfoDetail>;
    definirDetail(varianteGrosId: string, varianteDetailId: string | null, quantite: number | null): Promise<ResultatEcriture<void>>;
    creerDetail(params: ParametresArticleDetail): Promise<ResultatEcriture<string>>;
  };
  pertes: {
    declarer(params: ParametresPerte): Promise<ResultatEcriture<string>>;
    annuler(id: string, utilisateurId: string | null): Promise<ResultatEcriture<void>>;
    lister(boutiqueId: string, debut?: string, fin?: string): Promise<PerteResume[]>;
  };
  transferts: {
    creer(params: ParametresTransfert): Promise<ResultatEcriture<string>>;
    lister(boutiqueId: string, limite?: number): Promise<TransfertResume[]>;
  };
  inventaires: {
    lister(boutiqueId: string): Promise<InventaireResume[]>;
    demarrer(
      boutiqueId: string,
      depotId: string,
      utilisateurId: string | null,
      aZero?: boolean,
    ): Promise<ResultatEcriture<string>>;
    ajouterLigne(inventaireId: string, varianteId: string, qtePhysique?: number): Promise<ResultatEcriture<string>>;
    obtenir(id: string): Promise<InventaireDetail | undefined>;
    validerLigne(id: string, qtePhysique: number): Promise<ResultatEcriture<void>>;
    valider(id: string, utilisateurId: string | null): Promise<ResultatEcriture<void>>;
  };
  fournisseurs: {
    lister(boutiqueId: string): Promise<FournisseurResume[]>;
    creer(
      boutiqueId: string,
      nom: string,
      telephone?: string,
      adresse?: string,
      contact?: string,
    ): Promise<ResultatEcriture<string>>;
    modifier(id: string, champs: ChampsFournisseur): Promise<ResultatEcriture<void>>;
    derniers(boutiqueId: string, varianteIds: string[]): Promise<Record<string, { id: string; nom: string }>>;
    supprimer(id: string): Promise<ResultatEcriture<void>>;
  };
  commandes: {
    lister(
      boutiqueId: string,
      fournisseurId?: string,
      statut?: StatutCommande,
      terme?: string,
    ): Promise<CommandeResume[]>;
    obtenir(id: string): Promise<CommandeDetail | undefined>;
    creer(params: ParametresCommande): Promise<ResultatEcriture<{ id: string; numero: string; total: number }>>;
    modifier(id: string, champs: ParametresModifierCommande): Promise<ResultatEcriture<void>>;
    receptionner(params: ParametresReception): Promise<ResultatEcriture<string>>;
    listerReceptions(commandeId: string): Promise<ReceptionDetail[]>;
    annulerReception(receptionId: string, utilisateurId: string | null): Promise<ResultatEcriture<{ montantARecuperer: number }>>;
    retournerAuFournisseur(params: {
      receptionId: string;
      lignes: { varianteId: string; quantite: number }[];
      motif?: string;
      utilisateurId: string | null;
    }): Promise<ResultatEcriture<{ montant: number; avoir: number }>>;
    historiqueReceptions(boutiqueId: string, fournisseurId?: string, terme?: string): Promise<ReceptionHistorique[]>;
    historique(boutiqueId: string): Promise<HistoriqueAchats>;
    suivi(commandeId: string): Promise<EtapeCommande[]>;
  };
  dettes: {
    echeancier(detteId: string): Promise<EcheanceDetail[]>;
    rembourseDepuis(boutiqueId: string, depuis: string): Promise<number>;
    planifier(detteId: string, tranches: { dateEcheance: string; montant: number }[]): Promise<ResultatEcriture<void>>;
    annulerPaiement(paiementId: string, utilisateurId: string | null, motif?: string): Promise<ResultatEcriture<void>>;
    lister(boutiqueId: string, fournisseurId?: string, statut?: StatutDette): Promise<DetteResume[]>;
    payer(
      id: string,
      montant: number,
      mode?: string,
      depotId?: string | null,
      utilisateurId?: string | null,
    ): Promise<ResultatEcriture<void>>;
    listerPaiements(detteId: string): Promise<PaiementDetteDetail[]>;
  };
  clients: {
    lister(boutiqueId: string, terme?: string): Promise<ClientDetailResume[]>;
    obtenir(id: string): Promise<ClientDetailResume | undefined>;
    creer(
      boutiqueId: string,
      nom: string,
      telephone?: string,
      adresse?: string,
      estPermanent?: boolean,
    ): Promise<ResultatEcriture<string>>;
    modifier(id: string, champs: ChampsClient): Promise<ResultatEcriture<void>>;
    supprimer(id: string): Promise<ResultatEcriture<void>>;
  };
  credits: {
    lister(boutiqueId: string, clientId?: string, statut?: StatutCredit): Promise<CreditResume[]>;
    obtenir(id: string): Promise<CreditDetail | undefined>;
    remboursements(boutiqueId: string): Promise<RemboursementClient[]>;
    echeancier(creditId: string): Promise<EcheanceDetail[]>;
    regleDepuis(boutiqueId: string, depuis: string): Promise<number>;
    planifier(creditId: string, tranches: { dateEcheance: string; montant: number }[]): Promise<ResultatEcriture<void>>;
    rembourser(
      id: string,
      montant: number,
      mode?: string,
      depotId?: string | null,
      utilisateurId?: string | null,
    ): Promise<ResultatEcriture<void>>;
  };
  rapports: {
    plageDates(periode?: Periode, dateDebut?: string, dateFin?: string): Promise<PlageDates>;
    syntheseVentes(boutiqueId: string, debut: string, fin: string): Promise<SyntheseVentes>;
    topProduits(
      boutiqueId: string,
      debut: string,
      fin: string,
      limite?: number,
      ordre?: "asc" | "desc",
    ): Promise<LigneTopProduit[]>;
    valeurStock(boutiqueId: string, depotId?: string): Promise<ValeurStock>;
    produitsDormants(boutiqueId: string, jours: number): Promise<LigneProduitDormant[]>;
    enregistrerReleveDormants(boutiqueId: string): Promise<ResultatEcriture<void>>;
    relevesDormants(boutiqueId: string): Promise<ReleveDormants[]>;
    sortiesDormance(boutiqueId: string, seuil: number): Promise<SortieDormance[]>;
    ventesParVendeur(boutiqueId: string, debut: string, fin: string): Promise<LigneVentesVendeur[]>;
    ventesParCategorie(boutiqueId: string, debut: string, fin: string): Promise<LigneVentesCategorie[]>;
    ventesParModePaiement(boutiqueId: string, debut: string, fin: string): Promise<LigneVentesModePaiement[]>;
    ventesParJour(boutiqueId: string, debut: string, fin: string): Promise<LigneVentesParJour[]>;
    topClients(boutiqueId: string, debut: string, fin: string, limite?: number): Promise<LigneTopClient[]>;
    exporter(
      titre: string,
      colonnes: ColonneExport[],
      lignes: Record<string, unknown>[],
      format: FormatExport,
      cheminForce?: string,
    ): Promise<ResultatExporter>;
  };
  comptabilite: {
    planComptable(): Promise<CompteSyscohada[]>;
    journal(boutiqueId: string, debut: string, fin: string, journalCode?: string): Promise<LigneJournalLocal[]>;
    grandLivre(boutiqueId: string, compte: string, debut: string, fin: string): Promise<GrandLivreLocal>;
    balance(boutiqueId: string, debut: string, fin: string): Promise<BalanceLocale>;
    compteDeResultat(boutiqueId: string, debut: string, fin: string): Promise<CompteDeResultatLocal>;
    bilan(boutiqueId: string, dateFin: string): Promise<BilanLocal>;
    journalOfficiel(
      session: Session, debut: string, fin: string, journalCode?: string,
    ): Promise<ResultatEcriture<LigneJournalLocal[]>>;
    grandLivreOfficiel(
      session: Session, compte: string, debut: string, fin: string,
    ): Promise<ResultatEcriture<GrandLivreLocal>>;
    balanceOfficielle(session: Session, debut: string, fin: string): Promise<ResultatEcriture<BalanceLocale>>;
    compteDeResultatOfficiel(
      session: Session, debut: string, fin: string,
    ): Promise<ResultatEcriture<CompteDeResultatLocal>>;
    bilanOfficiel(session: Session, dateFin: string): Promise<ResultatEcriture<BilanLocal>>;
  };
  reglages: {
    obtenirBoutique(boutiqueId: string): Promise<BoutiqueDetail | undefined>;
    modifierBoutique(id: string, champs: ChampsBoutique): Promise<ResultatEcriture<void>>;
    obtenirLogoBoutique(boutiqueId: string): Promise<string>;
    definirLogoBoutique(boutiqueId: string, logo: string): Promise<ResultatEcriture<void>>;
    listerParametres(boutiqueId: string): Promise<ParametreResume[]>;
    definirParametre(boutiqueId: string, cle: string, valeur: string): Promise<ResultatEcriture<void>>;
    supprimerParametre(id: string): Promise<ResultatEcriture<void>>;
  };
  comptes: {
    listerRoles(session: Session): Promise<ResultatComptes<RoleResume[]>>;
    modifierRole(session: Session, id: string, permissions: Record<string, boolean>): Promise<ResultatComptes<RoleResume>>;
    listerUtilisateurs(session: Session): Promise<ResultatComptes<UtilisateurResume[]>>;
    annuaire(session: Session): Promise<ResultatComptes<{ id: number; nom: string }[]>>;
    creerUtilisateur(
      session: Session,
      params: ParametresCreationUtilisateur,
    ): Promise<ResultatComptes<UtilisateurResume>>;
    modifierUtilisateur(
      session: Session,
      id: number,
      champs: ChampsUtilisateur,
    ): Promise<ResultatComptes<UtilisateurResume>>;
    supprimerUtilisateur(session: Session, id: number): Promise<ResultatComptes<void>>;
  };
  paiements: {
    initier(params: ParametresInitiationMobileMoney): Promise<ResultatEcriture<string>>;
    obtenirTransaction(paiementId: string): Promise<TransactionResume | undefined>;
  };
  notifications: {
    genererAlertesDestockage(boutiqueId: string): Promise<ResultatEcriture<string[]>>;
    lister(boutiqueId: string, filtres?: FiltresNotifications): Promise<NotificationResume[]>;
    genererAlertesRupture(boutiqueId: string): Promise<ResultatEcriture<string[]>>;
    compterNonLues(boutiqueId: string, depotId?: string): Promise<number>;
    marquerLues(boutiqueId: string, depotId?: string): Promise<ResultatEcriture<void>>;
  };
  messages: {
    lister(boutiqueId: string, filtres?: FiltresMessages): Promise<MessageResume[]>;
    genererRappelsCredit(boutiqueId: string): Promise<ResultatEcriture<string[]>>;
    genererTicketWhatsapp(venteId: string): Promise<ResultatEcriture<string>>;
    envoyer(id: string, texte?: string, destinataire?: string): Promise<ResultatEcriture<void>>;
    marquerTraite(id: string): Promise<ResultatEcriture<void>>;
    enregistrerRelanceCredit(
      creditId: string,
      destinataire: string,
      message: string,
      utilisateurId: string | null,
    ): Promise<ResultatEcriture<string>>;
  };
  tresorerie: {
    solde(depotId: string, jusqua?: string): Promise<number>;
    listerMouvements(depotId: string, limite?: number): Promise<MouvementCaisseResume[]>;
    listerDepenses(depotId: string, limite?: number): Promise<DepenseResume[]>;
    enregistrerDepense(
      depotId: string,
      categorie: CategorieDepense,
      montant: number,
      description?: string,
      utilisateurId?: string | null,
    ): Promise<ResultatEcriture<string>>;
    effectuerRetrait(
      depotId: string,
      montant: number,
      motif?: string,
      utilisateurId?: string | null,
    ): Promise<ResultatEcriture<string>>;
    enregistrerApport(
      depotId: string,
      montant: number,
      motif?: string,
      utilisateurId?: string | null,
    ): Promise<ResultatEcriture<string>>;
    ajusterCaisse(
      depotId: string,
      montantSigne: number,
      motif: string,
      utilisateurId?: string | null,
    ): Promise<ResultatEcriture<string>>;
    soldeMobileMoneyDisponible(
      boutiqueId: string,
      utilisateurSourceId: string,
      operateur: OperateurMobileMoney,
    ): Promise<number>;
    effectuerTransfert(params: ParametresTransfertCaisse): Promise<ResultatEcriture<string>>;
    listerTransferts(depotId: string, limite?: number): Promise<TransfertCaisseResume[]>;
    listerClotures(depotId: string, limite?: number): Promise<ClotureCaisseResume[]>;
    cloturer(depotId: string, soldeCompte: number, utilisateurId?: string | null): Promise<ResultatEcriture<string>>;
  };
  sync: {
    executer(session: Session): Promise<ResultatSynchro>;
    etat(): Promise<EtatSynchro>;
    enAttente(boutiqueId: string): Promise<EnAttenteSynchro[]>;
  };
  systeme: {
    /** Retourne une fonction de désabonnement. */
    onNaviguerNotifications(callback: () => void): () => void;
    exporterPdf(nomFichierDefaut: string): Promise<ResultatExporter>;
    ouvrirExterne(url: string): Promise<void>;
    version(): Promise<string>;
  };
}

declare global {
  interface Window {
    api: WindowApi;
  }
}
