export type NiveauAbonnement = "ok" | "bientot" | "grace" | "bloque" | "illimite";

export interface EtatAbonnement {
  niveau: NiveauAbonnement;
  libelle: string;
  jours: number | null;
}

export interface ResumeBoutique {
  id: string;
  nom: string;
  telephone: string;
  email: string;
  date_creation: string;
  actif: boolean;
  formule: "essentiel" | "pro";
  formule_libelle: string;
  date_expiration_abonnement: string | null;
  abonnement: EtatAbonnement;
  synchro_autorisee: boolean;
  reseau_autorise: boolean;
  /** Carte « 📱 Appli mobile » (QR de téléchargement) visible dans les Réglages de la boutique. */
  appli_mobile_autorisee: boolean;
  /** Essai gratuit donné depuis l'Espace Admin du bureau, à part de l'abonnement payé. */
  essai_formule: string;
  essai_fin: string | null;
  nb_utilisateurs: number;
  derniere_synchro: string | null;
  date_derniere_sauvegarde: string | null;
  patron: { username: string; nom: string; telephone: string; email: string } | null;
}

export interface FicheBoutique extends ResumeBoutique {
  adresse: string;
  devise: string;
  utilisateurs: {
    username: string;
    nom: string;
    role: string;
    telephone: string;
    actif: boolean;
    derniere_connexion: string | null;
  }[];
  postes: { appareil: string; derniere_synchro: string }[];
  demandes_reseau_en_attente: number;
  /** Essai gratuit en cours (sa formule s'applique, l'abonnement payé reprend ensuite). */
  essai_en_cours: boolean;
  formule_effective: "essentiel" | "pro";
  /** Ce que cet administrateur peut faire depuis la fiche (le serveur revérifie). */
  peut: { paiements: boolean; demandes_reseau: boolean; comptes: boolean };
  /** Droit « demandes_reseau » seulement. */
  demandes_reseau?: {
    id: string;
    date: string;
    demandeur: string;
    note: string;
    statut: "en_attente" | "acceptee" | "refusee";
    statut_libelle: string;
    date_traitement: string | null;
  }[];
  /** Droit « paiements » seulement. */
  tarifs?: { formule: string; duree_mois: number; prix: string; remise: string }[];
  paiements_declares_en_attente?: number;
  registre_abonnement?: {
    date: string;
    nature_libelle: string;
    formule_libelle: string;
    date_debut: string;
    date_fin: string | null;
    montant: string;
    mode_libelle: string;
    reference: string;
  }[];
}

export interface TableauDeBord {
  boutiques: {
    total: number;
    actives: number;
    nouvelles_ce_mois: number;
    synchro_activee: number;
    sans_sauvegarde_recente: number;
  };
  abonnements: Record<NiveauAbonnement, number>;
  a_traiter: Partial<Record<"inscriptions" | "paiements" | "demandes_reseau" | "signalements", number>>;
  a_surveiller: ResumeBoutique[];
}

export interface DemandeInscription {
  id: string;
  date: string;
  statut: "en_attente" | "approuvee" | "rejetee";
  statut_libelle: string;
  boutique_nom: string;
  boutique_adresse: string;
  boutique_telephone: string;
  boutique_email: string;
  boutique_devise: string;
  username: string;
  nom: string;
  email: string;
  telephone: string;
  formule: "essentiel" | "pro";
  formule_libelle: string;
}

export interface BoutiqueCourte {
  id: string;
  nom: string;
  formule: "essentiel" | "pro";
  date_expiration_abonnement: string | null;
  abonnement: EtatAbonnement;
}

export interface PaiementDeclare {
  id: string;
  date: string;
  boutique: BoutiqueCourte;
  demandeur: string;
  formule: string;
  formule_libelle: string;
  duree_mois: number;
  duree_libelle: string;
  montant: string;
  mode: string;
  mode_libelle: string;
  reference: string;
  note: string;
  statut: "en_attente" | "validee" | "rejetee";
  statut_libelle: string;
  motif_rejet: string;
  traitee_par: string;
  date_traitement: string | null;
}

export interface Registre {
  total_encaisse: string;
  nombre_paiements: number;
  par_mode: { mode: string; mode_libelle: string; total: string; nombre: number }[];
  lignes: {
    id: string;
    date: string;
    boutique: { id: string; nom: string };
    nature: string;
    nature_libelle: string;
    formule_libelle: string;
    date_debut: string;
    date_fin: string | null;
    montant: string;
    mode_libelle: string;
    reference: string;
    note: string;
    enregistre_par: string;
  }[];
}

export interface DemandeReseau {
  id: string;
  date: string;
  boutique: BoutiqueCourte & { reseau_autorise: boolean };
  demandeur: string;
  note: string;
  statut: "en_attente" | "acceptee" | "refusee";
  statut_libelle: string;
  traitee_par: string;
  date_traitement: string | null;
}

export interface Signalement {
  id: string;
  date: string;
  boutique: BoutiqueCourte;
  type: string;
  type_libelle: string;
  detail: string;
  traite: boolean;
}

export interface CompteBoutique {
  id: number;
  username: string;
  nom: string;
  boutique: { id: string; nom: string } | null;
  role: string;
  telephone: string;
  email: string;
  actif: boolean;
  derniere_connexion: string | null;
  doit_changer_mot_de_passe: boolean;
}

export interface Administrateur {
  id: number;
  username: string;
  nom: string;
  first_name: string;
  last_name: string;
  email: string;
  telephone: string;
  superuser: boolean;
  actif: boolean;
  droits: string[];
  droits_herites: boolean;
  double_verification_exigee: boolean;
  double_verification_active: boolean;
  derniere_connexion: string | null;
  date_creation: string;
  doit_changer_mot_de_passe: boolean;
}

export interface Reglages {
  numero_wave: string;
  numero_orange_money: string;
  numero_mtn: string;
  numero_moov: string;
  whatsapp: string;
  instructions: string;
  prix_mensuel_essentiel: string | null;
  prix_mensuel_pro: string | null;
  remise_3_mois: string;
  remise_6_mois: string;
  remise_12_mois: string;
  grille_tarifs: { formule: string; formule_libelle: string; duree_mois: number; prix: string; remise: string }[];
}

export interface LigneJournal {
  id: string;
  date: string;
  admin: string;
  action: string;
  boutique: { id: string | null; nom: string } | null;
  detail: string;
  donnees: Record<string, unknown>;
  origine: "espace_admin" | "bureau";
  origine_libelle: string;
  adresse_ip: string | null;
}
