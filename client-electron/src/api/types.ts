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
}

export interface LigneVenteDetail {
  id: string;
  produitNom: string;
  reference: string;
  quantite: number;
  prixUnitaire: number;
  remise: number;
  sousTotal: number;
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
}

export interface InventaireResume {
  id: string;
  depotNom: string;
  statut: string;
  dateCreation: string;
}

export interface LigneInventaireDetail {
  id: string;
  varianteId: string;
  produitNom: string;
  reference: string;
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
}

export interface LigneReceptionPrix {
  varianteId: string;
  prixVente: number;
}

export interface ParametresReception {
  commandeId: string;
  depotId: string;
  utilisateurId: string | null;
  montantDejaPaye?: number;
  lignesPrix?: LigneReceptionPrix[];
}

export interface DetteResume {
  id: string;
  fournisseurNom: string;
  commandeNumero: string | null;
  montant: number;
  montantPaye: number;
  solde: number;
  statut: StatutDette;
  dateCreation: string;
}

export interface PaiementDetteDetail {
  id: string;
  montant: number;
  mode: string;
  dateCreation: string;
}

export type StatutCredit = "en_cours" | "solde";

export interface ClientDetailResume {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  soldeCredit: number;
}

export interface ChampsClient {
  nom?: string;
  telephone?: string;
  adresse?: string;
}

export interface CreditResume {
  id: string;
  clientNom: string;
  clientEstPermanent: number;
  venteNumero: string | null;
  montant: number;
  montantPaye: number;
  solde: number;
  echeance: string | null;
  statut: StatutCredit;
  dateCreation: string;
}

export interface PaiementCreditDetail {
  id: string;
  montant: number;
  mode: string;
  dateCreation: string;
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

export type Periode = "jour" | "semaine" | "mois" | "tout" | "personnalise";

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

export interface BilanLocal {
  date: string;
  actif: LigneResultatLocale[];
  passif: LigneResultatLocale[];
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

export type TypeNotification = "alerte_rupture";

export interface NotificationResume {
  id: string;
  type: TypeNotification;
  message: string;
  dateCreation: string;
  depotId: string | null;
  depotNom: string | null;
  referenceType: string;
  referenceId: string | null;
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
    prochaineReference(boutiqueId: string): Promise<string>;
  };
  variantes: {
    creer(params: ParametresVarianteEntree): Promise<ResultatEcriture<string>>;
    modifier(id: string, champs: ChampsVariante): Promise<ResultatEcriture<void>>;
  };
  categories: {
    lister(boutiqueId: string): Promise<ReferenceNommee[]>;
    creer(boutiqueId: string, nom: string): Promise<ResultatEcriture<string>>;
    modifier(id: string, nom: string): Promise<ResultatEcriture<void>>;
    supprimer(id: string): Promise<ResultatEcriture<void>>;
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
  };
  depots: {
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
  transferts: {
    creer(params: ParametresTransfert): Promise<ResultatEcriture<string>>;
    lister(boutiqueId: string, limite?: number): Promise<TransfertResume[]>;
  };
  inventaires: {
    lister(boutiqueId: string): Promise<InventaireResume[]>;
    demarrer(boutiqueId: string, depotId: string, utilisateurId: string | null): Promise<ResultatEcriture<string>>;
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
  };
  dettes: {
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
    lister(boutiqueId: string, filtres?: FiltresNotifications): Promise<NotificationResume[]>;
    genererAlertesRupture(boutiqueId: string): Promise<ResultatEcriture<string[]>>;
    compterNonLues(boutiqueId: string, depotId?: string): Promise<number>;
    marquerLues(boutiqueId: string, depotId?: string): Promise<ResultatEcriture<void>>;
  };
  messages: {
    lister(boutiqueId: string, filtres?: FiltresMessages): Promise<MessageResume[]>;
    genererRappelsCredit(boutiqueId: string): Promise<ResultatEcriture<string[]>>;
    genererTicketWhatsapp(venteId: string): Promise<ResultatEcriture<string>>;
    envoyer(id: string): Promise<ResultatEcriture<void>>;
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
