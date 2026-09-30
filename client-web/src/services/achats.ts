import { ouvrirBaseDeDonnees } from "../db";
import { ecrireLigne, maintenant, obtenirLigne, suiviSyncNeuf } from "../db/helpers";
import { calculerEcheances, erreurTranches, type EcheanceDetail, type StatutEcheance } from "./echeancier";
export type { EcheanceDetail, StatutEcheance } from "./echeancier";
import type {
  EcheanceDetteLocale,
  EvenementCommandeLocal,
  CommandeAchatLocale,
  DetteFournisseurLocale,
  FournisseurLocal,
  LigneAchatLocale,
  LigneRetourFournisseurLocale,
  PaiementDetteFournisseurLocale,
  ReceptionLocale,
  RetourFournisseurLocale,
} from "../db/schema";
import { appliquerMouvement } from "./stock";
import { enregistrerMouvement } from "./tresorerie";

/**
 * Port navigateur de client-electron/electron/services/achats.ts : une
 * commande calcule ses sous-totaux/total à la saisie, une réception crée une
 * entrée de stock par ligne et une dette fournisseur si non payé.
 */

export class ErreurAchat extends Error {}

export type StatutCommande = "brouillon" | "commandee" | "recue" | "annulee";
export type StatutDette = "en_cours" | "solde";

// --- Fournisseurs ---

export interface FournisseurResume {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  contact: string;
}

export async function listerFournisseurs(boutiqueId: string): Promise<FournisseurResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const fournisseurs = (await db.getAllFromIndex("fournisseurs", "boutique_id", boutiqueId)).filter((f) => !f.supprime);
  return fournisseurs
    .map((f) => ({ id: f.id, nom: f.nom, telephone: f.telephone, adresse: f.adresse, contact: f.contact }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}

/**
 * Port de client-electron/electron/services/achats.ts::obtenirDerniersFournisseurs :
 * pour chaque variante, le fournisseur de sa commande la plus récente (pour
 * pré-remplir "Commander" depuis une rupture). Pas d'index par variante_id sur
 * lignes_achat, donc on parcourt les commandes de la boutique triées par date
 * (même patron "itérer et filtrer en JS" que services/stock.ts).
 */
export async function obtenirDerniersFournisseurs(
  boutiqueId: string,
  varianteIds: string[],
): Promise<Record<string, { id: string; nom: string }>> {
  const resultat: Record<string, { id: string; nom: string }> = {};
  if (varianteIds.length === 0) return resultat;
  const idsRestants = new Set(varianteIds);

  const db = await ouvrirBaseDeDonnees();
  const commandes = (await db.getAllFromIndex("commandes_achat", "boutique_id", boutiqueId))
    .filter((c) => !c.supprime)
    .sort((a, b) => (a.date_creation < b.date_creation ? 1 : -1));

  for (const commande of commandes) {
    if (idsRestants.size === 0) break;
    const fournisseur = await obtenirLigne("fournisseurs", commande.fournisseur_id);
    if (!fournisseur) continue;
    const lignes = (await db.getAllFromIndex("lignes_achat", "commande_id", commande.id)).filter((l) => !l.supprime);
    for (const ligne of lignes) {
      if (!idsRestants.has(ligne.variante_id)) continue;
      resultat[ligne.variante_id] = { id: fournisseur.id, nom: fournisseur.nom };
      idsRestants.delete(ligne.variante_id);
    }
  }
  return resultat;
}

/** Nom comparable : sans accents, sans majuscules, sans espaces autour. */
function cleNomFournisseur(nom: string): string {
  return nom
    .trim()
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function verifierNomFournisseurLibre(boutiqueId: string, nom: string, saufId?: string): Promise<void> {
  if (!nom.trim()) throw new ErreurAchat("Le nom du fournisseur est obligatoire.");
  const cle = cleNomFournisseur(nom);
  if ((await listerFournisseurs(boutiqueId)).some((f) => f.id !== saufId && cleNomFournisseur(f.nom) === cle)) {
    throw new ErreurAchat(`Le fournisseur « ${nom.trim()} » existe déjà.`);
  }
}

export async function creerFournisseur(
  boutiqueId: string,
  nom: string,
  telephone = "",
  adresse = "",
  contact = "",
): Promise<string> {
  await verifierNomFournisseurLibre(boutiqueId, nom);
  const id = crypto.randomUUID();
  const fournisseur: FournisseurLocal = {
    id,
    boutique_id: boutiqueId,
    nom: nom.trim(),
    telephone,
    adresse,
    contact,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("fournisseurs", fournisseur);
  return id;
}

export async function modifierFournisseur(
  id: string,
  champs: Partial<{ nom: string; telephone: string; adresse: string; contact: string }>,
): Promise<void> {
  const fournisseur = await obtenirLigne("fournisseurs", id);
  if (!fournisseur) throw new ErreurAchat("Fournisseur introuvable.");
  if (champs.nom !== undefined) await verifierNomFournisseurLibre(fournisseur.boutique_id, champs.nom, id);
  await ecrireLigne("fournisseurs", {
    ...fournisseur,
    nom: champs.nom?.trim() ?? fournisseur.nom,
    telephone: champs.telephone ?? fournisseur.telephone,
    adresse: champs.adresse ?? fournisseur.adresse,
    contact: champs.contact ?? fournisseur.contact,
    date_modification: maintenant(),
    synchronise: 0,
  });
}

/**
 * Retire un fournisseur des listes (suppression douce, synchronisée) : ses
 * commandes, paiements et historiques restent consultables sous son nom.
 * Refusé tant qu'il a des commandes en cours ou une dette à payer.
 */
export async function supprimerFournisseur(id: string): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const fournisseur = await obtenirLigne("fournisseurs", id);
  if (!fournisseur) return;
  const enCours = (await db.getAllFromIndex("commandes_achat", "boutique_id", fournisseur.boutique_id)).filter(
    (c) => !c.supprime && c.fournisseur_id === id && (c.statut === "brouillon" || c.statut === "commandee"),
  ).length;
  if (enCours > 0) {
    throw new ErreurAchat(
      `Ce fournisseur a ${enCours} commande(s) en cours : recevez-les ou annulez-les avant de le supprimer.`,
    );
  }
  const reste = (await db.getAllFromIndex("dettes_fournisseur", "fournisseur_id", id))
    .filter((d) => !d.supprime && d.statut === "en_cours")
    .reduce((t, d) => t + Number(d.solde), 0);
  if (reste > 0) {
    throw new ErreurAchat(`Il reste ${reste} à payer à ce fournisseur : soldez ses dettes avant de le supprimer.`);
  }
  await ecrireLigne("fournisseurs", { ...fournisseur, supprime: 1, synchronise: 0, date_modification: maintenant() });
}

// --- Recherche d'articles pour la saisie d'une commande ---

export interface VarianteAchat {
  id: string;
  produitId: string;
  produitNom: string;
  reference: string;
  prixAchat: number;
}

export async function rechercherVariantesAchat(boutiqueId: string, terme: string): Promise<VarianteAchat[]> {
  const termeNormalise = terme.trim().toLowerCase();
  if (!termeNormalise) return [];
  const db = await ouvrirBaseDeDonnees();
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter(
    (p) => !p.supprime && p.nom.toLowerCase().includes(termeNormalise),
  );
  const resultat: VarianteAchat[] = [];
  for (const p of produits) {
    const variantes = (await db.getAllFromIndex("variantes", "produit_id", p.id)).filter((v) => !v.supprime);
    for (const v of variantes) {
      resultat.push({ id: v.id, produitId: p.id, produitNom: p.nom, reference: v.reference, prixAchat: v.prix_achat });
    }
  }
  return resultat;
}

// --- Numérotation ---

async function genererNumeroCommande(boutiqueId: string): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  const isoJour = new Date().toISOString().slice(0, 10);
  const commandesDuJour = (await db.getAllFromIndex("commandes_achat", "boutique_id", boutiqueId)).filter((c) =>
    c.date_creation.startsWith(isoJour),
  );
  const compteur = commandesDuJour.length + 1;
  return `CMD-${isoJour.replace(/-/g, "")}-${String(compteur).padStart(4, "0")}`;
}

// --- Commandes ---

export interface CommandeResume {
  id: string;
  numero: string;
  dateCreation: string;
  fournisseurId: string;
  fournisseurNom: string;
  statut: StatutCommande;
  total: number;
  /** Commande encore "commandee" dont au moins une ligne a déjà été livrée
   * — simple affichage (badge), pas un statut stocké. */
  partiellementRecue: boolean;
  /** Somme des quantités commandées / déjà reçues sur toutes les lignes
   * (colonne "Reste à recevoir" de l'onglet Réceptionner). */
  quantiteCommandee: number;
  quantiteRecue: number;
  /** Qui a passé la commande. */
  utilisateurId: string | null;
  /** Valeur des réceptions non annulées de la commande. */
  valeurRecue: number;
}

export async function listerCommandes(
  boutiqueId: string,
  fournisseurId?: string,
  statut?: StatutCommande,
  terme = "",
): Promise<CommandeResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const commandes = (await db.getAllFromIndex("commandes_achat", "boutique_id", boutiqueId)).filter((c) => !c.supprime);

  const resultat: CommandeResume[] = [];
  for (const c of commandes) {
    const fournisseur = await db.get("fournisseurs", c.fournisseur_id);
    const lignes = (await db.getAllFromIndex("lignes_achat", "commande_id", c.id)).filter((l) => !l.supprime);
    const quantiteCommandee = lignes.reduce((total, l) => total + l.quantite, 0);
    const quantiteRecue = lignes.reduce((total, l) => total + (l.quantite_recue ?? 0), 0);
    const partiellementRecue = c.statut === "commandee" && quantiteRecue > 0;
    const valeurRecue = (await db.getAllFromIndex("receptions", "commande_id", c.id))
      .filter((r) => !r.supprime && !r.annulee)
      .reduce((total, r) => total + Number(r.valeur_recue ?? 0), 0);
    // Anciennes réceptions (avant valeur_recue) : valeur déduite des quantités reçues × prix d'achat.
    const valeurLignesRecues = lignes.reduce((total, l) => total + (l.quantite_recue ?? 0) * l.prix_achat, 0);
    resultat.push({
      id: c.id,
      numero: c.numero,
      dateCreation: c.date_creation,
      fournisseurId: c.fournisseur_id,
      fournisseurNom: fournisseur?.nom ?? "",
      statut: c.statut,
      total: c.total,
      partiellementRecue,
      quantiteCommandee,
      quantiteRecue,
      utilisateurId: c.utilisateur_id ?? null,
      valeurRecue: valeurRecue || valeurLignesRecues,
    });
  }

  let filtres = resultat;
  if (fournisseurId) filtres = filtres.filter((c) => c.fournisseurId === fournisseurId);
  if (statut) filtres = filtres.filter((c) => c.statut === statut);
  if (terme.trim()) {
    const t = terme.trim().toLowerCase();
    filtres = filtres.filter((c) => c.numero.toLowerCase().includes(t));
  }
  return filtres.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
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

export async function obtenirCommande(id: string): Promise<CommandeDetail | undefined> {
  const db = await ouvrirBaseDeDonnees();
  const c = await db.get("commandes_achat", id);
  if (!c || c.supprime) return undefined;
  const fournisseur = await db.get("fournisseurs", c.fournisseur_id);

  const lignesRaw = (await db.getAllFromIndex("lignes_achat", "commande_id", id)).filter((l) => !l.supprime);
  const lignes: LigneAchatDetail[] = [];
  for (const l of lignesRaw) {
    const variante = await db.get("variantes", l.variante_id);
    const produit = variante ? await db.get("produits", variante.produit_id) : undefined;
    lignes.push({
      id: l.id,
      varianteId: l.variante_id,
      produitNom: produit?.nom ?? "",
      reference: variante?.reference ?? "",
      quantite: l.quantite,
      prixAchat: l.prix_achat,
      sousTotal: l.sous_total,
      prixVenteActuel: variante?.prix_vente ?? 0,
      quantiteRecue: l.quantite_recue ?? 0,
    });
  }

  return {
    id: c.id,
    numero: c.numero,
    dateCreation: c.date_creation,
    fournisseurId: c.fournisseur_id,
    fournisseurNom: fournisseur?.nom ?? "",
    statut: c.statut,
    total: c.total,
    lignes,
  };
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

function calculerLignesEtTotal(lignes: LigneAchatEntree[]): { lignes: (LigneAchatEntree & { sousTotal: number })[]; total: number } {
  let total = 0;
  const lignesCalculees = lignes.map((ligne) => {
    const sousTotal = Math.round(ligne.quantite * ligne.prixAchat);
    total += sousTotal;
    return { ...ligne, sousTotal };
  });
  return { lignes: lignesCalculees, total };
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

const LIBELLES_MODE_PAIEMENT: Record<string, string> = {
  especes: "Espèces",
  orange_money: "Orange Money",
  mtn_money: "MTN Money",
  moov_money: "Moov Money",
  wave: "Wave",
};

function texteArticles(quantite: number): string {
  return `${quantite} article${quantite > 1 ? "s" : ""}`;
}

function detailReglement(mode: string): string {
  return "Règlement de dette" + (mode ? ` · ${LIBELLES_MODE_PAIEMENT[mode] ?? mode}` : "");
}

/** Ajoute une étape au suivi de la commande. */
async function noterEtape(
  commandeId: string,
  type: TypeEtapeCommande,
  utilisateurId: string | null,
  detail = "",
  montant: number | null = null,
  referenceId: string | null = null,
): Promise<void> {
  const evenement: EvenementCommandeLocal = {
    id: crypto.randomUUID(),
    commande_id: commandeId,
    type,
    utilisateur_id: utilisateurId,
    detail: detail.slice(0, 255),
    montant,
    reference_id: referenceId,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("evenements_commande", evenement);
}

export async function creerCommande(params: ParametresCommande): Promise<{ id: string; numero: string; total: number }> {
  const { boutiqueId, fournisseurId, utilisateurId, statut, lignes } = params;
  if (lignes.length === 0) {
    throw new ErreurAchat("Une commande doit contenir au moins une ligne.");
  }

  const { lignes: lignesCalculees, total } = calculerLignesEtTotal(lignes);
  const db = await ouvrirBaseDeDonnees();
  const numero = await genererNumeroCommande(boutiqueId);
  const commandeId = crypto.randomUUID();

  const commande: CommandeAchatLocale = {
    id: commandeId,
    boutique_id: boutiqueId,
    fournisseur_id: fournisseurId,
    utilisateur_id: utilisateurId,
    numero,
    statut,
    total,
    ...suiviSyncNeuf(),
  };
  await db.put("commandes_achat", commande);

  for (const ligne of lignesCalculees) {
    const ligneAchat: LigneAchatLocale = {
      id: crypto.randomUUID(),
      commande_id: commandeId,
      variante_id: ligne.varianteId,
      quantite: ligne.quantite,
      prix_achat: ligne.prixAchat,
      sous_total: ligne.sousTotal,
      quantite_recue: 0,
      ...suiviSyncNeuf(),
    };
    await db.put("lignes_achat", ligneAchat);
  }
  await noterEtape(commandeId, "creee", utilisateurId, statut === "commandee" ? "Directement commandée" : "En brouillon", total);

  return { id: commandeId, numero, total };
}

export interface ParametresModifierCommande {
  fournisseurId?: string;
  statut?: StatutCommande;
  lignes?: LigneAchatEntree[];
  /** Qui fait la modification (suivi des étapes). */
  utilisateurId?: string | null;
}

export async function modifierCommande(id: string, champs: ParametresModifierCommande): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const commande = await obtenirLigne("commandes_achat", id);
  if (!commande) throw new ErreurAchat("Commande introuvable.");
  if (commande.statut === "recue" || commande.statut === "annulee") {
    throw new ErreurAchat("Cette commande ne peut plus être modifiée.");
  }

  const lignesActuelles = (await db.getAllFromIndex("lignes_achat", "commande_id", id)).filter((l) => !l.supprime);
  const dejaReceptionnee = lignesActuelles.some((l) => (l.quantite_recue ?? 0) > 0);
  if (champs.statut === "annulee" && dejaReceptionnee) {
    throw new ErreurAchat("Cette commande a déjà été partiellement réceptionnée, elle ne peut plus être annulée.");
  }
  if (champs.lignes && dejaReceptionnee) {
    throw new ErreurAchat(
      "Cette commande a déjà été partiellement réceptionnée, ses lignes ne peuvent plus être modifiées.",
    );
  }

  const heure = maintenant();
  let total = commande.total;
  if (champs.lignes) {
    const calcul = calculerLignesEtTotal(champs.lignes);
    total = calcul.total;
    for (const ligne of lignesActuelles) {
      await db.put("lignes_achat", { ...ligne, supprime: 1, synchronise: 0, date_modification: heure });
    }
    for (const ligne of calcul.lignes) {
      const ligneAchat: LigneAchatLocale = {
        id: crypto.randomUUID(),
        commande_id: id,
        variante_id: ligne.varianteId,
        quantite: ligne.quantite,
        prix_achat: ligne.prixAchat,
        sous_total: ligne.sousTotal,
        quantite_recue: 0,
        ...suiviSyncNeuf(),
      };
      await db.put("lignes_achat", ligneAchat);
    }
  }

  await ecrireLigne("commandes_achat", {
    ...commande,
    fournisseur_id: champs.fournisseurId ?? commande.fournisseur_id,
    statut: champs.statut ?? commande.statut,
    total,
    date_modification: heure,
    synchronise: 0,
  });

  const utilisateurId = champs.utilisateurId ?? null;
  if (champs.fournisseurId && champs.fournisseurId !== commande.fournisseur_id) {
    const ancien = await db.get("fournisseurs", commande.fournisseur_id);
    const nouveau = await db.get("fournisseurs", champs.fournisseurId);
    await noterEtape(id, "modifiee", utilisateurId, `Fournisseur : ${ancien?.nom ?? ""} → ${nouveau?.nom ?? ""}`);
  }
  if (champs.lignes) await noterEtape(id, "modifiee", utilisateurId, "Articles modifiés", total);
  if (champs.statut && champs.statut !== commande.statut && champs.statut === "commandee") {
    await noterEtape(id, "commandee", utilisateurId, "", total);
  }
  if (champs.statut && champs.statut !== commande.statut && champs.statut === "annulee") {
    await noterEtape(id, "annulee", utilisateurId);
  }
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
  /** Comment le montant déjà payé a été réglé : espèces (sortie de caisse), Mobile Money ou banque. */
  modePaiement?: "especes" | "mobile_money" | "banque" | "";
  operateurPaiement?: string;
  lignes: LigneReceptionEntree[];
}

/**
 * Réceptionne tout ou partie d'une commande : `lignes` porte la quantité
 * effectivement livrée pour chaque variante (réception partielle possible sur
 * plusieurs livraisons). La commande ne repasse au statut "recue" que
 * lorsque toutes ses lignes ont atteint leur quantité commandée.
 */
export async function receptionnerCommande(params: ParametresReception): Promise<string> {
  const { commandeId, depotId, utilisateurId, montantDejaPaye = 0, lignes: lignesEntree } = params;
  const modePaiement = montantDejaPaye > 0 ? (params.modePaiement ?? "") : "";
  const operateurPaiement = modePaiement === "mobile_money" ? (params.operateurPaiement ?? "") : "";
  const db = await ouvrirBaseDeDonnees();
  const commande = await db.get("commandes_achat", commandeId);
  if (!commande) throw new ErreurAchat("Commande introuvable.");
  if (commande.statut !== "commandee") {
    throw new ErreurAchat("Seule une commande au statut 'commandée' peut être réceptionnée.");
  }

  const aReceptionner = lignesEntree.filter((l) => l.quantite > 0);
  if (aReceptionner.length === 0) {
    throw new ErreurAchat("Indiquez au moins une quantité à réceptionner.");
  }

  const lignesCommande = (await db.getAllFromIndex("lignes_achat", "commande_id", commandeId)).filter(
    (l) => !l.supprime,
  );
  const ligneParVariante = new Map(lignesCommande.map((l) => [l.variante_id, l]));

  let valeurRecue = 0;
  for (const donnee of aReceptionner) {
    const ligne = ligneParVariante.get(donnee.varianteId);
    if (!ligne) throw new ErreurAchat("Cette variante ne fait pas partie de la commande.");
    const restant = ligne.quantite - (ligne.quantite_recue ?? 0);
    if (donnee.quantite > restant) {
      throw new ErreurAchat("Quantité reçue supérieure à la quantité restante pour un article.");
    }
    valeurRecue += donnee.quantite * ligne.prix_achat;
  }
  if (montantDejaPaye > valeurRecue) {
    throw new ErreurAchat("Le montant déjà payé ne peut pas dépasser la valeur reçue.");
  }

  const receptionId = crypto.randomUUID();
  const maintenantDate = maintenant();

  for (const donnee of aReceptionner) {
    const ligne = ligneParVariante.get(donnee.varianteId)!;
    const prixAchatReception = ligne.prix_achat;
    let motif = `Réception ${commande.numero}`;

    if (donnee.prixVente !== undefined) {
      const variante = await db.get("variantes", ligne.variante_id);
      if (variante) {
        // CUMP (coût unitaire moyen pondéré) : on pondère le prix d'achat existant par le
        // stock encore présent plutôt que de l'écraser par le dernier prix reçu — sinon la
        // valorisation du stock et le bénéfice des ventes seraient faussés dès que le prix
        // d'achat varie d'une commande à l'autre. Sans stock restant, rien à pondérer : on
        // repart simplement du prix de cette réception.
        const stocks = await db.getAllFromIndex(
          "stocks",
          "variante_depot",
          IDBKeyRange.bound([ligne.variante_id, ""], [ligne.variante_id, "￿"]),
        );
        const stockActuel = stocks.reduce((somme, s) => somme + s.quantite, 0);
        const ancienPrixAchat = variante.prix_achat;
        const nouveauPrixAchat =
          stockActuel > 0
            ? Math.round(
                (stockActuel * ancienPrixAchat + donnee.quantite * prixAchatReception) / (stockActuel + donnee.quantite),
              )
            : prixAchatReception;

        if (donnee.prixVente < nouveauPrixAchat) {
          throw new ErreurAchat("Le prix de vente ne peut pas être inférieur au prix d'achat (CUMP).");
        }

        motif += ` (Prix achat : ${ancienPrixAchat} → ${nouveauPrixAchat} FCFA [CUMP], Prix vente : ${variante.prix_vente} → ${donnee.prixVente} FCFA)`;
        await db.put("variantes", {
          ...variante,
          prix_achat: nouveauPrixAchat,
          prix_vente: donnee.prixVente,
          synchronise: 0,
          date_modification: maintenantDate,
        });
      }
    }

    await appliquerMouvement({
      varianteId: ligne.variante_id,
      depotId,
      type: "entree",
      quantite: donnee.quantite,
      motif,
      utilisateurId,
      // Référencé sur la réception (pas la commande) pour pouvoir
      // retrouver ce qui a été livré à chaque livraison, voir
      // listerReceptionsCommande.
      referenceType: "achats.Reception",
      referenceId: receptionId,
    });

    await db.put("lignes_achat", {
      ...ligne,
      quantite_recue: (ligne.quantite_recue ?? 0) + donnee.quantite,
      synchronise: 0,
      date_modification: maintenantDate,
    });
  }

  const reception: ReceptionLocale = {
    id: receptionId,
    commande_id: commandeId,
    depot_id: depotId,
    utilisateur_id: utilisateurId,
    valeur_recue: valeurRecue,
    montant_paye: montantDejaPaye,
    mode_paiement: modePaiement,
    operateur_paiement: operateurPaiement,
    ...suiviSyncNeuf(),
  };
  await db.put("receptions", reception);
  // Payé en espèces à la livraison : l'argent sort de la caisse du dépôt
  // (un achat de marchandise, pas une dépense : il n'apparaît pas dans Dépenses).
  if (montantDejaPaye > 0 && modePaiement === "especes") {
    await enregistrerMouvement({
      depotId,
      type: "sortie",
      categorie: "paiement_fournisseur",
      montant: montantDejaPaye,
      motif: `Paiement réception ${commande.numero}`,
      utilisateurId,
      referenceType: "achats.Reception",
      referenceId: receptionId,
    });
  }

  const solde = valeurRecue - montantDejaPaye;
  if (solde > 0) {
    const dette: DetteFournisseurLocale = {
      id: crypto.randomUUID(),
      fournisseur_id: commande.fournisseur_id,
      commande_id: commandeId,
      reception_id: receptionId,
      montant: valeurRecue,
      montant_paye: montantDejaPaye,
      solde,
      statut: "en_cours",
      ...suiviSyncNeuf(),
    };
    await db.put("dettes_fournisseur", dette);
  }

  const lignesApres = (await db.getAllFromIndex("lignes_achat", "commande_id", commandeId)).filter((l) => !l.supprime);
  const totalementRecue = lignesApres.every((l) => (l.quantite_recue ?? 0) >= l.quantite);
  if (totalementRecue) {
    await db.put("commandes_achat", { ...commande, statut: "recue", synchronise: 0, date_modification: maintenantDate });
  }
  const depot = await db.get("depots", depotId);
  await noterEtape(
    commandeId,
    "reception",
    utilisateurId,
    `${texteArticles(aReceptionner.reduce((t, l) => t + l.quantite, 0))} reçus au dépôt ${depot?.nom ?? ""} · ` +
      (totalementRecue ? "commande complète" : "reçue en partie"),
    valeurRecue,
    receptionId,
  );
  if (montantDejaPaye > 0) {
    await noterEtape(commandeId, "paiement", utilisateurId, "Payé à la réception", montantDejaPaye, receptionId);
  }

  return receptionId;
}

// --- Dettes fournisseur ---

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

export async function listerDettes(boutiqueId: string, fournisseurId?: string, statut?: StatutDette): Promise<DetteResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const fournisseurs = await db.getAllFromIndex("fournisseurs", "boutique_id", boutiqueId);
  const fournisseursParId = new Map(fournisseurs.map((f) => [f.id, f]));

  let dettes = fournisseurId
    ? await db.getAllFromIndex("dettes_fournisseur", "fournisseur_id", fournisseurId)
    : (await db.getAll("dettes_fournisseur")).filter((d) => fournisseursParId.has(d.fournisseur_id));
  dettes = dettes.filter((d) => !d.supprime);
  if (statut) dettes = dettes.filter((d) => d.statut === statut);

  const resultat: DetteResume[] = [];
  for (const d of dettes) {
    const fournisseur = fournisseursParId.get(d.fournisseur_id);
    const commande = d.commande_id ? await db.get("commandes_achat", d.commande_id) : undefined;
    resultat.push({
      id: d.id,
      fournisseurNom: fournisseur?.nom ?? "",
      commandeId: d.commande_id ?? null,
      commandeNumero: commande?.numero ?? null,
      montant: d.montant,
      montantPaye: d.montant_paye,
      solde: d.solde,
      statut: d.statut,
      dateCreation: d.date_creation,
      dateModification: d.date_modification ?? d.date_creation,
      prochaineEcheance: null,
    });
  }
  for (const d of resultat) {
    if (d.statut !== "en_cours") continue;
    const prochaine = (await echeancierDette(d.id)).find((e) => e.statut !== "payee");
    if (prochaine) {
      d.prochaineEcheance = {
        date: prochaine.dateEcheance,
        reste: prochaine.montant - prochaine.couvert,
        enRetard: prochaine.statut === "en_retard",
      };
    }
  }
  return resultat.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}

export interface LigneReceptionDetail {
  varianteId: string;
  produitNom: string;
  reference: string;
  quantite: number;
  /** Déjà renvoyé au fournisseur (retours). */
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

/** Historique des réceptions d'une commande (une par livraison, voir
 * receptionnerCommande) — trié de la plus ancienne à la plus récente, avec
 * les articles livrés à chacune (lus dans les mouvements de stock). */
export async function listerReceptionsCommande(commandeId: string): Promise<ReceptionDetail[]> {
  const db = await ouvrirBaseDeDonnees();
  const receptions = (await db.getAllFromIndex("receptions", "commande_id", commandeId)).filter((r) => !r.supprime);
  const variantesCommande = [
    ...new Set(
      (await db.getAllFromIndex("lignes_achat", "commande_id", commandeId)).filter((l) => !l.supprime).map((l) => l.variante_id),
    ),
  ];

  async function lignesDesMouvements(
    depotId: string,
    referenceType: string,
    referenceId: string,
  ): Promise<Omit<LigneReceptionDetail, "quantiteRetournee">[]> {
    const lignes: Omit<LigneReceptionDetail, "quantiteRetournee">[] = [];
    for (const varianteId of variantesCommande) {
      const quantite = (await db.getAllFromIndex("mouvements_stock", "variante_depot", [varianteId, depotId]))
        .filter(
          (m) => !m.supprime && m.type === "entree" && m.reference_type === referenceType && m.reference_id === referenceId,
        )
        .reduce((total, m) => total + m.quantite, 0);
      if (quantite === 0) continue;
      const variante = await db.get("variantes", varianteId);
      const produit = variante ? await db.get("produits", variante.produit_id) : undefined;
      lignes.push({ varianteId, produitNom: produit?.nom ?? "", reference: variante?.reference ?? "", quantite });
    }
    return lignes.sort((a, b) => a.produitNom.localeCompare(b.produitNom));
  }

  const resultat: ReceptionDetail[] = [];
  for (const r of receptions) {
    const depot = await db.get("depots", r.depot_id);
    let lignes = await lignesDesMouvements(r.depot_id, "achats.Reception", r.id);
    // Anciennes réceptions : les mouvements étaient référencés sur la
    // commande. Tant qu'il n'y a qu'une réception, ils lui reviennent tous.
    if (lignes.length === 0 && receptions.length === 1) {
      lignes = await lignesDesMouvements(r.depot_id, "achats.CommandeAchat", commandeId);
    }
    resultat.push({
      id: r.id,
      dateCreation: r.date_creation,
      depotNom: depot?.nom ?? "",
      valeurRecue: r.valeur_recue,
      montantPaye: r.montant_paye,
      ...(await completerReception(r, lignes)),
    });
  }
  return resultat.sort((a, b) => a.dateCreation.localeCompare(b.dateCreation));
}

export interface ReceptionHistorique extends ReceptionDetail {
  commandeId: string;
  commandeNumero: string;
  fournisseurNom: string;
}

/** Toutes les réceptions de la boutique, toutes commandes confondues (modale
 * "Historique des réceptions"), de la plus récente à la plus ancienne. */
export async function listerHistoriqueReceptions(
  boutiqueId: string,
  fournisseurId?: string,
  terme = "",
  limite = 200,
): Promise<ReceptionHistorique[]> {
  const db = await ouvrirBaseDeDonnees();
  let commandes = (await db.getAllFromIndex("commandes_achat", "boutique_id", boutiqueId)).filter((c) => !c.supprime);
  if (fournisseurId) commandes = commandes.filter((c) => c.fournisseur_id === fournisseurId);
  if (terme.trim()) {
    const t = terme.trim().toLowerCase();
    commandes = commandes.filter((c) => c.numero.toLowerCase().includes(t));
  }

  const resultat: ReceptionHistorique[] = [];
  for (const c of commandes) {
    const receptions = await listerReceptionsCommande(c.id);
    if (receptions.length === 0) continue;
    const fournisseur = await db.get("fournisseurs", c.fournisseur_id);
    for (const r of receptions) {
      resultat.push({ ...r, commandeId: c.id, commandeNumero: c.numero, fournisseurNom: fournisseur?.nom ?? "" });
    }
  }
  return resultat.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation)).slice(0, limite);
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

/** Sans limite de nombre : l'écran filtre ensuite par période, fournisseur et numéro. */
export async function historiqueAchats(boutiqueId: string): Promise<HistoriqueAchats> {
  const db = await ouvrirBaseDeDonnees();
  const commandes = await listerCommandes(boutiqueId);
  const receptions = await listerHistoriqueReceptions(boutiqueId, undefined, "", 1_000_000);
  const commandesParId = new Map(commandes.map((c) => [c.id, c]));
  const fournisseurs = new Map(
    (await db.getAllFromIndex("fournisseurs", "boutique_id", boutiqueId)).map((f) => [f.id, f.nom]),
  );

  const reglements: PaiementFournisseurHistorique[] = [];
  for (const dette of await db.getAll("dettes_fournisseur")) {
    if (dette.supprime || !fournisseurs.has(dette.fournisseur_id)) continue;
    const commande = dette.commande_id ? commandesParId.get(dette.commande_id) : undefined;
    for (const p of await db.getAllFromIndex("paiements_dette_fournisseur", "dette_id", dette.id)) {
      if (p.supprime) continue;
      reglements.push({
        id: p.id,
        dateCreation: p.date_creation,
        fournisseurNom: fournisseurs.get(dette.fournisseur_id) ?? "",
        commandeId: dette.commande_id ?? null,
        commandeNumero: commande?.numero ?? null,
        montant: Number(p.montant),
        mode: p.mode ?? "",
        origine: "dette",
        annulee: Boolean(p.annulee),
      });
    }
  }
  const paiements: PaiementFournisseurHistorique[] = [
    ...receptions
      .filter((r) => r.montantPaye > 0)
      .map((r) => ({
        id: `reception-${r.id}`,
        dateCreation: r.dateCreation,
        fournisseurNom: r.fournisseurNom,
        commandeId: r.commandeId,
        commandeNumero: r.commandeNumero,
        montant: r.montantPaye,
        mode: "",
        origine: "reception" as const,
        annulee: r.annulee,
      })),
    ...reglements,
  ].sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));

  const retours: RetourFournisseurHistorique[] = [];
  for (const rf of await db.getAll("retours_fournisseur")) {
    const commande = commandesParId.get(rf.commande_id);
    if (rf.supprime || !commande) continue;
    const depot = await db.get("depots", rf.depot_id);
    const lignes = (await db.getAllFromIndex("lignes_retour_fournisseur", "retour_id", rf.id)).filter((l) => !l.supprime);
    retours.push({
      id: rf.id,
      dateCreation: rf.date_creation,
      commandeId: commande.id,
      commandeNumero: commande.numero,
      fournisseurNom: commande.fournisseurNom,
      depotNom: depot?.nom ?? "",
      motif: rf.motif ?? "",
      montant: Number(rf.montant),
      avoir: Number(rf.avoir),
      quantite: lignes.reduce((total, l) => total + Number(l.quantite), 0),
      utilisateurId: rf.utilisateur_id ?? null,
    });
  }
  retours.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
  return { commandes, receptions, paiements, retours };
}

export interface EcheanceEnCours extends EcheanceDetail {
  detteId: string;
  fournisseurNom: string;
  commandeNumero: string | null;
}


async function tranchesDeLaDette(detteId: string): Promise<{ id: string; dateEcheance: string; montant: number }[]> {
  const db = await ouvrirBaseDeDonnees();
  return (await db.getAllFromIndex("echeances_dette", "dette_id", detteId))
    .filter((e) => !e.supprime)
    .map((e) => ({ id: e.id, dateEcheance: e.date_echeance, montant: Number(e.montant) }));
}

export async function echeancierDette(detteId: string): Promise<EcheanceDetail[]> {
  const db = await ouvrirBaseDeDonnees();
  const dette = await db.get("dettes_fournisseur", detteId);
  if (!dette) return [];
  return calculerEcheances(
    { montant: Number(dette.montant), montantPaye: Number(dette.montant_paye) },
    await tranchesDeLaDette(detteId),
  );
}

/**
 * (Re)planifie l'échéancier d'une dette : les tranches déjà payées sont
 * gardées, les autres retirées ; les nouvelles tranches couvrent le reste à payer.
 */
export async function planifierEcheancier(
  detteId: string,
  tranches: { dateEcheance: string; montant: number }[],
): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const dette = await db.get("dettes_fournisseur", detteId);
  if (!dette) throw new ErreurAchat("Dette introuvable.");
  if (dette.statut !== "en_cours") throw new ErreurAchat("Cette dette est déjà soldée.");
  const erreur = erreurTranches(tranches, Number(dette.solde));
  if (erreur) throw new ErreurAchat(erreur);
  const instant = maintenant();
  for (const e of (await echeancierDette(detteId)).filter((x) => x.statut !== "payee")) {
    const ligne = await db.get("echeances_dette", e.id);
    if (ligne) await ecrireLigne("echeances_dette", { ...ligne, supprime: 1, synchronise: 0, date_modification: instant });
  }
  for (const t of tranches) {
    const echeance: EcheanceDetteLocale = {
      id: crypto.randomUUID(),
      dette_id: detteId,
      date_echeance: t.dateEcheance,
      montant: Math.round(t.montant * 100) / 100,
      ...suiviSyncNeuf(),
    };
    await ecrireLigne("echeances_dette", echeance);
  }
}

/** Tranches non payées des dettes en cours de la boutique (alertes). */
export async function echeancesEnCours(boutiqueId: string): Promise<EcheanceEnCours[]> {
  const resultat: EcheanceEnCours[] = [];
  for (const d of await listerDettes(boutiqueId, undefined, "en_cours")) {
    for (const e of await echeancierDette(d.id)) {
      if (e.statut !== "payee") resultat.push({ ...e, detteId: d.id, fournisseurNom: d.fournisseurNom, commandeNumero: d.commandeNumero });
    }
  }
  return resultat;
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

export async function listerPaiementsDette(detteId: string): Promise<PaiementDetteDetail[]> {
  const db = await ouvrirBaseDeDonnees();
  const paiements = (await db.getAllFromIndex("paiements_dette_fournisseur", "dette_id", detteId)).filter(
    (p) => !p.supprime,
  );
  return paiements
    .map((p) => ({
      id: p.id,
      montant: p.montant,
      mode: p.mode,
      dateCreation: p.date_creation,
      annulee: Boolean(p.annulee),
      dateAnnulation: p.date_annulation ?? null,
      annuleParId: p.annule_par_id ?? null,
      motifAnnulation: p.motif_annulation ?? "",
    }))
    .sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}

/**
 * Remboursement saisi par erreur : il reste visible, marqué annulé ; son
 * montant revient dans le solde de la dette (qui redevient en cours). S'il
 * était en espèces, l'argent revient dans la caisse du même dépôt.
 */
export async function annulerPaiementDette(paiementId: string, utilisateurId: string | null, motif = ""): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const paiement = await db.get("paiements_dette_fournisseur", paiementId);
  if (!paiement) throw new ErreurAchat("Remboursement introuvable.");
  if (paiement.annulee) throw new ErreurAchat("Ce remboursement est déjà annulé.");
  const dette = await db.get("dettes_fournisseur", paiement.dette_id);
  if (!dette) throw new ErreurAchat("Dette introuvable.");
  const fournisseur = await db.get("fournisseurs", dette.fournisseur_id);
  const instant = maintenant();
  const motifPropre = motif.trim().slice(0, 255);

  await ecrireLigne("dettes_fournisseur", {
    ...dette,
    montant_paye: dette.montant_paye - paiement.montant,
    solde: dette.solde + paiement.montant,
    statut: "en_cours",
    synchronise: 0,
    date_modification: instant,
  });
  await ecrireLigne("paiements_dette_fournisseur", {
    ...paiement,
    annulee: 1,
    date_annulation: instant,
    annule_par_id: utilisateurId,
    motif_annulation: motifPropre,
    synchronise: 0,
    date_modification: instant,
  });
  const sortie = (await db.getAll("mouvements_caisse")).find(
    (m) =>
      !m.supprime &&
      m.type === "sortie" &&
      m.reference_type === "fournisseurs.PaiementDetteFournisseur" &&
      m.reference_id === paiementId,
  );
  if (sortie) {
    await enregistrerMouvement({
      depotId: sortie.depot_id,
      type: "entree",
      categorie: "paiement_dette_fournisseur",
      montant: paiement.montant,
      motif: `Annulation paiement dette ${fournisseur?.nom ?? ""}`,
      utilisateurId,
      referenceType: "fournisseurs.PaiementDetteFournisseur:annulation",
      referenceId: paiementId,
    });
  }
  if (dette.commande_id) {
    await noterEtape(
      dette.commande_id,
      "paiement_annule",
      utilisateurId,
      "Remboursement annulé" + (motifPropre ? ` · ${motifPropre}` : ""),
      paiement.montant,
      paiementId,
    );
  }
}

export async function payerDette(
  detteId: string,
  montant: number,
  mode = "",
  depotId: string | null = null,
  utilisateurId: string | null = null,
): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const dette = await db.get("dettes_fournisseur", detteId);
  if (!dette) throw new ErreurAchat("Dette introuvable.");
  if (montant <= 0) {
    throw new ErreurAchat("Le montant payé doit être strictement positif.");
  }
  if (montant > dette.solde) {
    throw new ErreurAchat("Le montant payé ne peut pas dépasser le solde restant.");
  }

  const paiementId = crypto.randomUUID();
  const paiement: PaiementDetteFournisseurLocale = {
    id: paiementId,
    dette_id: detteId,
    montant,
    mode,
    ...suiviSyncNeuf(),
  };
  await db.put("paiements_dette_fournisseur", paiement);

  const nouveauMontantPaye = dette.montant_paye + montant;
  const nouveauSolde = dette.solde - montant;
  await db.put("dettes_fournisseur", {
    ...dette,
    montant_paye: nouveauMontantPaye,
    solde: nouveauSolde,
    statut: nouveauSolde === 0 ? "solde" : "en_cours",
    synchronise: 0,
    date_modification: maintenant(),
  });

  if (mode === "especes" && depotId) {
    const fournisseur = await db.get("fournisseurs", dette.fournisseur_id);
    await enregistrerMouvement({
      depotId,
      type: "sortie",
      categorie: "paiement_dette_fournisseur",
      montant,
      motif: `Paiement dette ${fournisseur?.nom ?? ""}`,
      utilisateurId,
      referenceType: "fournisseurs.PaiementDetteFournisseur",
      referenceId: paiementId,
    });
  }
  if (dette.commande_id) {
    await noterEtape(dette.commande_id, "paiement", utilisateurId, detailReglement(mode), montant, paiementId);
  }
}

/**
 * Suivi des étapes d'une commande, de la plus ancienne à la plus récente.
 * Pour une commande antérieure au suivi, ce qui peut se déduire des données
 * (création, réceptions, paiements, retours) est ajouté, marqué « reconstitué »
 * — sans rien écrire en base. Les changements de statut passés restent inconnus.
 */
export async function suiviCommande(commandeId: string): Promise<EtapeCommande[]> {
  const db = await ouvrirBaseDeDonnees();
  const commande = await db.get("commandes_achat", commandeId);
  if (!commande) return [];
  const notees = (await db.getAllFromIndex("evenements_commande", "commande_id", commandeId)).filter((e) => !e.supprime);
  const etapes: EtapeCommande[] = notees.map((e) => ({
    id: e.id,
    type: e.type as TypeEtapeCommande,
    dateCreation: e.date_creation,
    utilisateurId: e.utilisateur_id ?? null,
    detail: e.detail ?? "",
    montant: e.montant === null || e.montant === undefined ? null : Number(e.montant),
    reconstitue: false,
  }));
  const dejaNotees = new Set(notees.map((e) => `${e.type}:${e.reference_id ?? ""}`));
  const reconstituer = (cle: string, etape: Omit<EtapeCommande, "reconstitue">) => {
    if (!dejaNotees.has(cle)) etapes.push({ ...etape, reconstitue: true });
  };

  if (!notees.some((e) => e.type === "creee")) {
    etapes.push({
      id: `creee-${commandeId}`,
      type: "creee",
      dateCreation: commande.date_creation,
      utilisateurId: commande.utilisateur_id ?? null,
      detail: "",
      montant: Number(commande.total),
      reconstitue: true,
    });
  }
  const receptionsBrutes = new Map(
    (await db.getAllFromIndex("receptions", "commande_id", commandeId)).map((r) => [r.id, r]),
  );
  for (const r of await listerReceptionsCommande(commandeId)) {
    const quantite = r.lignes.reduce((t, l) => t + l.quantite, 0);
    reconstituer(`reception:${r.id}`, {
      id: `reception-${r.id}`,
      type: "reception",
      dateCreation: r.dateCreation,
      utilisateurId: r.utilisateurId,
      detail: `${quantite > 0 ? `${texteArticles(quantite)} reçus` : "Réception"} au dépôt ${r.depotNom}`,
      montant: r.valeurRecue,
    });
    if (r.montantPaye > 0) {
      reconstituer(`paiement:${r.id}`, {
        id: `paiement-${r.id}`,
        type: "paiement",
        dateCreation: r.dateCreation,
        utilisateurId: r.utilisateurId,
        detail: "Payé à la réception",
        montant: r.montantPaye,
      });
    }
    if (r.annulee) {
      reconstituer(`reception_annulee:${r.id}`, {
        id: `annulation-${r.id}`,
        type: "reception_annulee",
        dateCreation: receptionsBrutes.get(r.id)?.date_annulation ?? r.dateCreation,
        utilisateurId: null,
        detail: `Réception au dépôt ${r.depotNom} annulée`,
        montant: r.valeurRecue,
      });
    }
    for (const retour of r.retours) {
      reconstituer(`retour:${retour.id}`, {
        id: `retour-${retour.id}`,
        type: "retour",
        dateCreation: retour.dateCreation,
        utilisateurId: retour.utilisateurId,
        detail:
          `${texteArticles(retour.lignes.reduce((t, l) => t + l.quantite, 0))} renvoyés` +
          (retour.motif ? ` · ${retour.motif}` : ""),
        montant: retour.montant,
      });
    }
  }
  for (const dette of await db.getAll("dettes_fournisseur")) {
    if (dette.supprime || dette.commande_id !== commandeId) continue;
    for (const p of await db.getAllFromIndex("paiements_dette_fournisseur", "dette_id", dette.id)) {
      if (p.supprime) continue;
      reconstituer(`paiement:${p.id}`, {
        id: `paiement-${p.id}`,
        type: "paiement",
        dateCreation: p.date_creation,
        utilisateurId: null,
        detail: detailReglement(p.mode ?? ""),
        montant: Number(p.montant),
      });
      if (p.annulee) {
        reconstituer(`paiement_annule:${p.id}`, {
          id: `paiement-annule-${p.id}`,
          type: "paiement_annule",
          dateCreation: p.date_annulation ?? p.date_creation,
          utilisateurId: p.annule_par_id ?? null,
          detail: "Remboursement annulé",
          montant: Number(p.montant),
        });
      }
    }
  }
  return etapes.sort((a, b) => a.dateCreation.localeCompare(b.dateCreation));
}

// --- Annulation de réception et retour fournisseur (port de achats/services.py) ---

async function lignesRecues(reception: ReceptionLocale): Promise<Map<string, number>> {
  const db = await ouvrirBaseDeDonnees();
  const quantites = new Map<string, number>();
  for (const ligne of (await db.getAllFromIndex("lignes_achat", "commande_id", reception.commande_id)).filter((l) => !l.supprime)) {
    for (const m of await db.getAllFromIndex("mouvements_stock", "variante_depot", [ligne.variante_id, reception.depot_id])) {
      if (!m.supprime && m.type === "entree" && m.reference_type === "achats.Reception" && m.reference_id === reception.id) {
        quantites.set(m.variante_id, (quantites.get(m.variante_id) ?? 0) + m.quantite);
      }
    }
  }
  return quantites;
}

async function dejaRetourne(receptionId: string): Promise<Map<string, number>> {
  const db = await ouvrirBaseDeDonnees();
  const quantites = new Map<string, number>();
  for (const retour of await db.getAllFromIndex("retours_fournisseur", "reception_id", receptionId)) {
    if (retour.supprime) continue;
    for (const l of await db.getAllFromIndex("lignes_retour_fournisseur", "retour_id", retour.id)) {
      if (!l.supprime) quantites.set(l.variante_id, (quantites.get(l.variante_id) ?? 0) + l.quantite);
    }
  }
  return quantites;
}

/** Dette créée par cette réception (lien direct, ou pour une réception ancienne :
 * la dette de la commande de même montant, sans lien). */
async function detteDeLaReception(reception: ReceptionLocale): Promise<DetteFournisseurLocale | undefined> {
  const db = await ouvrirBaseDeDonnees();
  const dettes = (await db.getAll("dettes_fournisseur")).filter((d) => !d.supprime);
  return (
    dettes.find((d) => d.reception_id === reception.id) ??
    dettes
      .filter((d) => d.commande_id === reception.commande_id && !d.reception_id && d.montant === reception.valeur_recue)
      .sort((a, b) => a.date_creation.localeCompare(b.date_creation))[0]
  );
}

/** Vérifie qu'on peut sortir `quantite` du dépôt ; renvoie la sortie à appliquer
 * (coût moyen recalculé à l'envers) sans rien écrire. */
async function preparerSortieRetour(varianteId: string, depotId: string, quantite: number, prixAchat: number) {
  const db = await ouvrirBaseDeDonnees();
  const stockDepot = (await db.getFromIndex("stocks", "variante_depot", [varianteId, depotId]))?.quantite ?? 0;
  const variante = (await obtenirLigne("variantes", varianteId))!;
  if (stockDepot < quantite) {
    const produit = await obtenirLigne("produits", variante.produit_id);
    throw new ErreurAchat(`${produit?.nom ?? "Article"} : plus assez de stock dans ce dépôt (déjà vendu ?).`);
  }
  const stockTotal = (
    await db.getAllFromIndex("stocks", "variante_depot", IDBKeyRange.bound([varianteId, ""], [varianteId, "\uffff"]))
  ).reduce((total, s) => total + s.quantite, 0);
  const reste = stockTotal - quantite;
  const nouveauCump = reste > 0 ? Math.round((stockTotal * variante.prix_achat - quantite * prixAchat) / reste) : 0;
  return { variante, nouveauCump: nouveauCump > 0 ? nouveauCump : null };
}

/**
 * Réception saisie par erreur : la marchandise ressort, la commande attend de
 * nouveau ces quantités, la dette de la réception est soldée à zéro. Tout est
 * vérifié avant la moindre écriture. Renvoie le montant payé sur place à récupérer.
 */
export async function annulerReception(receptionId: string, utilisateurId: string | null): Promise<{ montantARecuperer: number }> {
  const db = await ouvrirBaseDeDonnees();
  const reception = await obtenirLigne("receptions", receptionId);
  if (!reception) throw new ErreurAchat("Réception introuvable.");
  if (reception.annulee) throw new ErreurAchat("Cette réception est déjà annulée.");
  const quantites = await lignesRecues(reception);
  if (quantites.size === 0) {
    throw new ErreurAchat("Réception trop ancienne : ses articles ne sont pas tracés, annulation impossible.");
  }
  if ((await dejaRetourne(receptionId)).size > 0) {
    throw new ErreurAchat("Des articles de cette réception ont déjà été retournés au fournisseur.");
  }
  const dette = await detteDeLaReception(reception);
  if (dette && dette.montant_paye > reception.montant_paye) {
    throw new ErreurAchat("Un règlement a déjà été fait sur la dette de cette réception : annulation impossible.");
  }
  const commande = (await obtenirLigne("commandes_achat", reception.commande_id))!;
  const lignesCommande = (await db.getAllFromIndex("lignes_achat", "commande_id", reception.commande_id)).filter((l) => !l.supprime);

  const sorties = [];
  for (const [varianteId, quantite] of quantites) {
    const ligne = lignesCommande.find((l) => l.variante_id === varianteId)!;
    sorties.push({ ligne, quantite, ...(await preparerSortieRetour(varianteId, reception.depot_id, quantite, ligne.prix_achat)) });
  }

  const instant = maintenant();
  for (const sortie of sorties) {
    if (sortie.nouveauCump) {
      await ecrireLigne("variantes", { ...sortie.variante, prix_achat: sortie.nouveauCump, date_modification: instant, synchronise: 0 });
    }
    await appliquerMouvement({
      varianteId: sortie.ligne.variante_id,
      depotId: reception.depot_id,
      type: "sortie",
      quantite: sortie.quantite,
      motif: `Annulation réception ${commande.numero}`,
      utilisateurId,
      referenceType: "achats.Reception",
      referenceId: receptionId,
    });
    await ecrireLigne("lignes_achat", {
      ...sortie.ligne,
      quantite_recue: Math.max(0, (sortie.ligne.quantite_recue ?? 0) - sortie.quantite),
      date_modification: instant,
      synchronise: 0,
    });
  }
  if (dette) {
    await ecrireLigne("dettes_fournisseur", {
      ...dette,
      montant: dette.montant_paye,
      solde: 0,
      statut: "solde",
      date_modification: instant,
      synchronise: 0,
    });
  }
  if (commande.statut === "recue") {
    await ecrireLigne("commandes_achat", { ...commande, statut: "commandee", date_modification: instant, synchronise: 0 });
  }
  // L'argent payé en espèces à la livraison revient dans la caisse.
  const sortieCaisse = (await db.getAllFromIndex("mouvements_caisse", "depot_id", reception.depot_id)).some(
    (m) => !m.supprime && m.type === "sortie" && m.reference_type === "achats.Reception" && m.reference_id === receptionId,
  );
  if (sortieCaisse) {
    await enregistrerMouvement({
      depotId: reception.depot_id,
      type: "entree",
      categorie: "paiement_fournisseur",
      montant: reception.montant_paye,
      motif: `Annulation réception ${commande.numero}`,
      utilisateurId,
      referenceType: "achats.Reception:annulation",
      referenceId: receptionId,
    });
  }
  await ecrireLigne("receptions", { ...reception, annulee: true, date_annulation: instant, date_modification: instant, synchronise: 0 });
  const depot = await db.get("depots", reception.depot_id);
  await noterEtape(
    reception.commande_id,
    "reception_annulee",
    utilisateurId,
    `${texteArticles([...quantites.values()].reduce((t, q) => t + q, 0))} ressortis du dépôt ${depot?.nom ?? ""}`,
    reception.valeur_recue,
    receptionId,
  );
  return { montantARecuperer: reception.montant_paye };
}

export interface ParametresRetourFournisseur {
  receptionId: string;
  lignes: { varianteId: string; quantite: number }[];
  motif?: string;
  utilisateurId: string | null;
}

/**
 * Renvoie une partie des articles d'une réception. La dette de la réception
 * baisse du montant retourné (au prix d'achat de la commande) ; ce qui dépasse
 * son solde devient un avoir à récupérer auprès du fournisseur.
 */
export async function retournerAuFournisseur(params: ParametresRetourFournisseur): Promise<{ montant: number; avoir: number }> {
  const { receptionId, utilisateurId } = params;
  const db = await ouvrirBaseDeDonnees();
  const reception = await obtenirLigne("receptions", receptionId);
  if (!reception) throw new ErreurAchat("Réception introuvable.");
  if (reception.annulee) throw new ErreurAchat("Cette réception est annulée.");
  const lignes = params.lignes.filter((l) => l.quantite > 0);
  if (lignes.length === 0) throw new ErreurAchat("Indiquez au moins une quantité à retourner.");
  const recues = await lignesRecues(reception);
  const retournees = await dejaRetourne(receptionId);
  const commande = (await obtenirLigne("commandes_achat", reception.commande_id))!;
  const lignesCommande = (await db.getAllFromIndex("lignes_achat", "commande_id", reception.commande_id)).filter((l) => !l.supprime);

  const sorties = [];
  let montant = 0;
  for (const donnee of lignes) {
    const ligne = lignesCommande.find((l) => l.variante_id === donnee.varianteId);
    const disponible = (recues.get(donnee.varianteId) ?? 0) - (retournees.get(donnee.varianteId) ?? 0);
    if (!ligne || donnee.quantite > disponible) throw new ErreurAchat("On ne peut pas retourner plus que ce qui a été reçu.");
    const sousTotal = Math.round(donnee.quantite * ligne.prix_achat);
    montant += sousTotal;
    sorties.push({
      donnee,
      ligne,
      sousTotal,
      ...(await preparerSortieRetour(donnee.varianteId, reception.depot_id, donnee.quantite, ligne.prix_achat)),
    });
  }
  const dette = await detteDeLaReception(reception);
  const deduit = dette ? Math.min(montant, dette.solde) : 0;

  const retourId = crypto.randomUUID();
  const retour: RetourFournisseurLocale = {
    id: retourId,
    commande_id: reception.commande_id,
    reception_id: receptionId,
    depot_id: reception.depot_id,
    motif: (params.motif ?? "").trim(),
    montant,
    avoir: montant - deduit,
    utilisateur_id: utilisateurId,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("retours_fournisseur", retour);
  const instant = maintenant();
  for (const sortie of sorties) {
    if (sortie.nouveauCump) {
      await ecrireLigne("variantes", { ...sortie.variante, prix_achat: sortie.nouveauCump, date_modification: instant, synchronise: 0 });
    }
    await appliquerMouvement({
      varianteId: sortie.donnee.varianteId,
      depotId: reception.depot_id,
      type: "sortie",
      quantite: sortie.donnee.quantite,
      motif: `Retour fournisseur ${commande.numero}`,
      utilisateurId,
      referenceType: "achats.RetourFournisseur",
      referenceId: retourId,
    });
    const ligneRetour: LigneRetourFournisseurLocale = {
      id: crypto.randomUUID(),
      retour_id: retourId,
      variante_id: sortie.donnee.varianteId,
      quantite: sortie.donnee.quantite,
      prix_achat: sortie.ligne.prix_achat,
      sous_total: sortie.sousTotal,
      ...suiviSyncNeuf(),
    };
    await ecrireLigne("lignes_retour_fournisseur", ligneRetour);
  }
  if (dette && deduit > 0) {
    const nouveauSolde = dette.solde - deduit;
    await ecrireLigne("dettes_fournisseur", {
      ...dette,
      montant: dette.montant - deduit,
      solde: nouveauSolde,
      statut: nouveauSolde <= 0 ? "solde" : "en_cours",
      date_modification: instant,
      synchronise: 0,
    });
  }
  const motif = (params.motif ?? "").trim();
  await noterEtape(
    reception.commande_id,
    "retour",
    utilisateurId,
    `${texteArticles(lignes.reduce((t, l) => t + l.quantite, 0))} renvoyés` + (motif ? ` · ${motif}` : ""),
    montant,
    retourId,
  );
  return { montant, avoir: montant - deduit };
}

/** Complète une réception : quantités déjà retournées, retours faits sur elle. */
async function completerReception(
  r: ReceptionLocale,
  lignes: Omit<LigneReceptionDetail, "quantiteRetournee">[],
): Promise<Pick<ReceptionDetail, "lignes" | "annulee" | "utilisateurId" | "retours">> {
  const db = await ouvrirBaseDeDonnees();
  const retournees = await dejaRetourne(r.id);
  const retours: RetourFournisseurDetail[] = [];
  for (const retour of (await db.getAllFromIndex("retours_fournisseur", "reception_id", r.id)).filter((x) => !x.supprime)) {
    const lignesRetour = [];
    for (const l of (await db.getAllFromIndex("lignes_retour_fournisseur", "retour_id", retour.id)).filter((x) => !x.supprime)) {
      const variante = await db.get("variantes", l.variante_id);
      const produit = variante ? await db.get("produits", variante.produit_id) : undefined;
      lignesRetour.push({ produitNom: produit?.nom ?? "", quantite: l.quantite });
    }
    retours.push({
      id: retour.id,
      dateCreation: retour.date_creation,
      motif: retour.motif ?? "",
      montant: retour.montant,
      avoir: retour.avoir,
      utilisateurId: retour.utilisateur_id ?? null,
      lignes: lignesRetour,
    });
  }
  return {
    lignes: lignes.map((l) => ({ ...l, quantiteRetournee: retournees.get(l.varianteId) ?? 0 })),
    annulee: !!r.annulee,
    utilisateurId: r.utilisateur_id ?? null,
    retours: retours.sort((a, b) => a.dateCreation.localeCompare(b.dateCreation)),
  };
}

/** Total des remboursements de dettes fournisseur (non annulés) depuis une date ISO. */
export async function montantRembourseDettesDepuis(boutiqueId: string, depuis: string): Promise<number> {
  const db = await ouvrirBaseDeDonnees();
  let total = 0;
  for (const d of await listerDettes(boutiqueId)) {
    for (const p of await db.getAllFromIndex("paiements_dette_fournisseur", "dette_id", d.id)) {
      if (!p.supprime && !p.annulee && p.date_creation >= depuis) total += Number(p.montant);
    }
  }
  return total;
}
