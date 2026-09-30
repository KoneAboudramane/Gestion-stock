import { ouvrirBaseDeDonnees } from "../db";
import { suiviSyncNeuf } from "../db/helpers";
import type { MouvementCompteClientLocal, MouvementCompteFournisseurLocal } from "../db/schema";
import {
  assemblerReleveClient,
  assemblerReleveFournisseur,
  type MouvementBrut,
  type OperationTiers,
  type PaiementCreditBrut,
  type PaiementDetteBrut,
  type ReceptionBrute,
  type RetourBrut,
  type VenteBrute,
} from "./relevesTiers";
import { enregistrerMouvement } from "./tresorerie";

/**
 * Port navigateur de client-electron/electron/services/comptesTiers.ts : le
 * « compte » d'un client (son argent laissé d'avance) et celui d'un
 * fournisseur (avances versées, avoirs de retour). Solde jamais stocké :
 * entrées moins sorties des mouvements (ajout seul).
 */

export class ErreurCompte extends Error {}

export type ModeArgent = "especes" | "mobile_money" | "banque";
export type TypeMouvementCompteClient = "depot" | "utilisation" | "rendu" | "annulation";
export type TypeMouvementCompteFournisseur = "avance" | "avoir" | "utilisation" | "remboursement" | "annulation";

const ENTREES_CLIENT = ["depot", "annulation"];
const ENTREES_FOURNISSEUR = ["avance", "avoir", "annulation"];
const MODES_ARGENT: ModeArgent[] = ["especes", "mobile_money", "banque"];

export interface MouvementCompte {
  id: string;
  type: string;
  /** Positif = entrée sur le compte, négatif = sortie. */
  montant: number;
  mode: string;
  operateur: string;
  depotId: string | null;
  venteId: string | null;
  venteNumero: string | null;
  creditId: string | null;
  receptionId: string | null;
  retourId: string | null;
  detteId: string | null;
  commandeNumero: string | null;
  utilisateurId: string | null;
  motif: string;
  dateCreation: string;
}

export interface CompteTiers {
  solde: number;
  mouvements: MouvementCompte[];
}

export interface OperationCompte {
  montant: number;
  mode: ModeArgent;
  operateur?: string;
  depotId?: string | null;
  utilisateurId?: string | null;
  motif?: string;
}

function verifierOperation(op: OperationCompte): void {
  if (!(op.montant > 0)) throw new ErreurCompte("Le montant doit être strictement positif.");
  if (!MODES_ARGENT.includes(op.mode)) throw new ErreurCompte("Mode de paiement inconnu.");
  if (op.mode === "mobile_money" && !op.operateur) throw new ErreurCompte("Choisissez l'opérateur Mobile Money.");
  if (op.mode === "especes" && !op.depotId) {
    throw new ErreurCompte("Choisissez le dépôt dont la caisse reçoit ou donne l'argent.");
  }
}

const signe = (entrees: string[], type: string, montant: number) =>
  entrees.includes(type) ? Number(montant) : -Number(montant);

// --- Client ---

export interface NouveauMouvementClient {
  clientId: string;
  type: TypeMouvementCompteClient;
  montant: number;
  mode?: string;
  operateur?: string;
  depotId?: string | null;
  venteId?: string | null;
  creditId?: string | null;
  utilisateurId?: string | null;
  motif?: string;
}

export async function ajouterMouvementCompteClient(m: NouveauMouvementClient): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  const ligne: MouvementCompteClientLocal = {
    id: crypto.randomUUID(),
    client_id: m.clientId,
    type: m.type,
    montant: m.montant,
    mode: m.mode ?? "",
    operateur: m.operateur ?? "",
    depot_id: m.depotId ?? null,
    vente_id: m.venteId ?? null,
    credit_id: m.creditId ?? null,
    utilisateur_id: m.utilisateurId ?? null,
    motif: (m.motif ?? "").trim().slice(0, 255),
    ...suiviSyncNeuf(),
  };
  await db.put("mouvements_compte_client", ligne);
  return ligne.id;
}

async function mouvementsClient(clientId: string): Promise<MouvementCompteClientLocal[]> {
  const db = await ouvrirBaseDeDonnees();
  return (await db.getAllFromIndex("mouvements_compte_client", "client_id", clientId))
    .filter((m) => !m.supprime)
    .sort((a, b) => a.date_creation.localeCompare(b.date_creation));
}

export async function soldeCompteClient(clientId: string): Promise<number> {
  return (await mouvementsClient(clientId)).reduce((t, m) => t + signe(ENTREES_CLIENT, m.type, m.montant), 0);
}

/** Soldes de tous les clients qui ont (ou ont eu) un compte, pour les listes. */
export async function soldesComptesClients(boutiqueId: string): Promise<Record<string, number>> {
  const db = await ouvrirBaseDeDonnees();
  const clients = new Set(
    (await db.getAllFromIndex("clients", "boutique_id", boutiqueId)).map((c) => c.id),
  );
  const soldes: Record<string, number> = {};
  for (const m of await db.getAll("mouvements_compte_client")) {
    if (m.supprime || !clients.has(m.client_id)) continue;
    soldes[m.client_id] = (soldes[m.client_id] ?? 0) + signe(ENTREES_CLIENT, m.type, m.montant);
  }
  return soldes;
}

export async function compteClient(clientId: string): Promise<CompteTiers> {
  const db = await ouvrirBaseDeDonnees();
  const mouvements: MouvementCompte[] = [];
  for (const m of await mouvementsClient(clientId)) {
    const vente = m.vente_id ? await db.get("ventes", m.vente_id) : undefined;
    mouvements.push({
      id: m.id,
      type: m.type,
      montant: signe(ENTREES_CLIENT, m.type, m.montant),
      mode: m.mode ?? "",
      operateur: m.operateur ?? "",
      depotId: m.depot_id ?? null,
      venteId: m.vente_id ?? null,
      venteNumero: vente?.numero ?? null,
      creditId: m.credit_id ?? null,
      receptionId: null,
      retourId: null,
      detteId: null,
      commandeNumero: null,
      utilisateurId: m.utilisateur_id ?? null,
      motif: m.motif ?? "",
      dateCreation: m.date_creation,
    });
  }
  return { solde: mouvements.reduce((t, m) => t + m.montant, 0), mouvements };
}

async function nomClient(clientId: string): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  const client = await db.get("clients", clientId);
  if (!client) throw new ErreurCompte("Client introuvable.");
  return client.nom;
}

export async function deposerSurCompteClient(clientId: string, op: OperationCompte): Promise<CompteTiers> {
  verifierOperation(op);
  const nom = await nomClient(clientId);
  const id = await ajouterMouvementCompteClient({
    clientId,
    type: "depot",
    montant: op.montant,
    mode: op.mode,
    operateur: op.mode === "mobile_money" ? op.operateur : "",
    depotId: op.depotId ?? null,
    utilisateurId: op.utilisateurId ?? null,
    motif: op.motif,
  });
  if (op.mode === "especes") {
    await enregistrerMouvement({
      depotId: op.depotId!,
      type: "entree",
      categorie: "depot_client",
      montant: op.montant,
      motif: `Dépôt de ${nom}`,
      utilisateurId: op.utilisateurId ?? null,
      referenceType: "clients.MouvementCompteClient",
      referenceId: id,
    });
  }
  return compteClient(clientId);
}

export async function rendreDuCompteClient(clientId: string, op: OperationCompte): Promise<CompteTiers> {
  verifierOperation(op);
  const nom = await nomClient(clientId);
  if (op.montant > (await soldeCompteClient(clientId))) {
    throw new ErreurCompte("On ne peut pas rendre plus que ce que le client a sur son compte.");
  }
  const id = await ajouterMouvementCompteClient({
    clientId,
    type: "rendu",
    montant: op.montant,
    mode: op.mode,
    operateur: op.mode === "mobile_money" ? op.operateur : "",
    depotId: op.depotId ?? null,
    utilisateurId: op.utilisateurId ?? null,
    motif: op.motif,
  });
  if (op.mode === "especes") {
    await enregistrerMouvement({
      depotId: op.depotId!,
      type: "sortie",
      categorie: "rendu_client",
      montant: op.montant,
      motif: `Rendu à ${nom}`,
      utilisateurId: op.utilisateurId ?? null,
      referenceType: "clients.MouvementCompteClient",
      referenceId: id,
    });
  }
  return compteClient(clientId);
}

// --- Fournisseur ---

export interface NouveauMouvementFournisseur {
  fournisseurId: string;
  type: TypeMouvementCompteFournisseur;
  montant: number;
  mode?: string;
  operateur?: string;
  depotId?: string | null;
  receptionId?: string | null;
  retourId?: string | null;
  detteId?: string | null;
  utilisateurId?: string | null;
  motif?: string;
}

export async function ajouterMouvementCompteFournisseur(m: NouveauMouvementFournisseur): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  const ligne: MouvementCompteFournisseurLocal = {
    id: crypto.randomUUID(),
    fournisseur_id: m.fournisseurId,
    type: m.type,
    montant: m.montant,
    mode: m.mode ?? "",
    operateur: m.operateur ?? "",
    depot_id: m.depotId ?? null,
    reception_id: m.receptionId ?? null,
    retour_id: m.retourId ?? null,
    dette_id: m.detteId ?? null,
    utilisateur_id: m.utilisateurId ?? null,
    motif: (m.motif ?? "").trim().slice(0, 255),
    ...suiviSyncNeuf(),
  };
  await db.put("mouvements_compte_fournisseur", ligne);
  return ligne.id;
}

async function mouvementsFournisseur(fournisseurId: string): Promise<MouvementCompteFournisseurLocal[]> {
  const db = await ouvrirBaseDeDonnees();
  return (await db.getAllFromIndex("mouvements_compte_fournisseur", "fournisseur_id", fournisseurId))
    .filter((m) => !m.supprime)
    .sort((a, b) => a.date_creation.localeCompare(b.date_creation));
}

export async function soldeCompteFournisseur(fournisseurId: string): Promise<number> {
  return (await mouvementsFournisseur(fournisseurId)).reduce(
    (t, m) => t + signe(ENTREES_FOURNISSEUR, m.type, m.montant),
    0,
  );
}

export async function soldesComptesFournisseurs(boutiqueId: string): Promise<Record<string, number>> {
  const db = await ouvrirBaseDeDonnees();
  const fournisseurs = new Set(
    (await db.getAllFromIndex("fournisseurs", "boutique_id", boutiqueId)).map((f) => f.id),
  );
  const soldes: Record<string, number> = {};
  for (const m of await db.getAll("mouvements_compte_fournisseur")) {
    if (m.supprime || !fournisseurs.has(m.fournisseur_id)) continue;
    soldes[m.fournisseur_id] = (soldes[m.fournisseur_id] ?? 0) + signe(ENTREES_FOURNISSEUR, m.type, m.montant);
  }
  return soldes;
}

export async function compteFournisseur(fournisseurId: string): Promise<CompteTiers> {
  const db = await ouvrirBaseDeDonnees();
  const mouvements: MouvementCompte[] = [];
  for (const m of await mouvementsFournisseur(fournisseurId)) {
    const reception = m.reception_id ? await db.get("receptions", m.reception_id) : undefined;
    const dette = m.dette_id ? await db.get("dettes_fournisseur", m.dette_id) : undefined;
    const commandeId = reception?.commande_id ?? dette?.commande_id ?? null;
    const commande = commandeId ? await db.get("commandes_achat", commandeId) : undefined;
    mouvements.push({
      id: m.id,
      type: m.type,
      montant: signe(ENTREES_FOURNISSEUR, m.type, m.montant),
      mode: m.mode ?? "",
      operateur: m.operateur ?? "",
      depotId: m.depot_id ?? null,
      venteId: null,
      venteNumero: null,
      creditId: null,
      receptionId: m.reception_id ?? null,
      retourId: m.retour_id ?? null,
      detteId: m.dette_id ?? null,
      commandeNumero: commande?.numero ?? null,
      utilisateurId: m.utilisateur_id ?? null,
      motif: m.motif ?? "",
      dateCreation: m.date_creation,
    });
  }
  return { solde: mouvements.reduce((t, m) => t + m.montant, 0), mouvements };
}

async function nomFournisseur(fournisseurId: string): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  const fournisseur = await db.get("fournisseurs", fournisseurId);
  if (!fournisseur) throw new ErreurCompte("Fournisseur introuvable.");
  return fournisseur.nom;
}

export async function verserAvanceFournisseur(fournisseurId: string, op: OperationCompte): Promise<CompteTiers> {
  verifierOperation(op);
  const nom = await nomFournisseur(fournisseurId);
  const id = await ajouterMouvementCompteFournisseur({
    fournisseurId,
    type: "avance",
    montant: op.montant,
    mode: op.mode,
    operateur: op.mode === "mobile_money" ? op.operateur : "",
    depotId: op.depotId ?? null,
    utilisateurId: op.utilisateurId ?? null,
    motif: op.motif,
  });
  if (op.mode === "especes") {
    await enregistrerMouvement({
      depotId: op.depotId!,
      type: "sortie",
      categorie: "avance_fournisseur",
      montant: op.montant,
      motif: `Avance à ${nom}`,
      utilisateurId: op.utilisateurId ?? null,
      referenceType: "fournisseurs.MouvementCompteFournisseur",
      referenceId: id,
    });
  }
  return compteFournisseur(fournisseurId);
}

export async function remboursementFournisseur(fournisseurId: string, op: OperationCompte): Promise<CompteTiers> {
  verifierOperation(op);
  const nom = await nomFournisseur(fournisseurId);
  if (op.montant > (await soldeCompteFournisseur(fournisseurId))) {
    throw new ErreurCompte("Le fournisseur ne peut pas rendre plus que ce qu'il nous doit sur son compte.");
  }
  const id = await ajouterMouvementCompteFournisseur({
    fournisseurId,
    type: "remboursement",
    montant: op.montant,
    mode: op.mode,
    operateur: op.mode === "mobile_money" ? op.operateur : "",
    depotId: op.depotId ?? null,
    utilisateurId: op.utilisateurId ?? null,
    motif: op.motif,
  });
  if (op.mode === "especes") {
    await enregistrerMouvement({
      depotId: op.depotId!,
      type: "entree",
      categorie: "remboursement_fournisseur",
      montant: op.montant,
      motif: `Remboursement de ${nom}`,
      utilisateurId: op.utilisateurId ?? null,
      referenceType: "fournisseurs.MouvementCompteFournisseur",
      referenceId: id,
    });
  }
  return compteFournisseur(fournisseurId);
}

// --- Vue d'ensemble (page « 👛 Comptes ») ---

export interface ResumeCompte {
  id: string;
  nom: string;
  telephone: string;
  solde: number;
  derniereOperation: string | null;
  /** Entrées / sorties sur le compte depuis `depuis` (le début du mois à l'écran). */
  entreesPeriode: number;
  sortiesPeriode: number;
}

function cumuler(
  mouvements: { tiers: string; type: string; montant: number; date: string }[],
  tiers: Map<string, { nom: string; telephone: string }>,
  entrees: string[],
  depuis: string,
): ResumeCompte[] {
  const parTiers = new Map<string, ResumeCompte>();
  for (const m of mouvements) {
    const info = tiers.get(m.tiers);
    if (!info) continue;
    const r = parTiers.get(m.tiers) ?? {
      id: m.tiers,
      nom: info.nom,
      telephone: info.telephone ?? "",
      solde: 0,
      derniereOperation: null,
      entreesPeriode: 0,
      sortiesPeriode: 0,
    };
    const entree = entrees.includes(m.type);
    r.solde += entree ? Number(m.montant) : -Number(m.montant);
    if (!r.derniereOperation || m.date > r.derniereOperation) r.derniereOperation = m.date;
    if (m.date >= depuis) {
      if (entree) r.entreesPeriode += Number(m.montant);
      else r.sortiesPeriode += Number(m.montant);
    }
    parTiers.set(m.tiers, r);
  }
  return [...parTiers.values()];
}

/** Clients qui ont (ou ont eu) un compte, même occasionnels. */
export async function resumesComptesClients(boutiqueId: string, depuis: string): Promise<ResumeCompte[]> {
  const db = await ouvrirBaseDeDonnees();
  const clients = new Map(
    (await db.getAllFromIndex("clients", "boutique_id", boutiqueId)).map((c) => [c.id, { nom: c.nom, telephone: c.telephone }]),
  );
  const mouvements = (await db.getAll("mouvements_compte_client"))
    .filter((m) => !m.supprime)
    .map((m) => ({ tiers: m.client_id, type: m.type, montant: m.montant, date: m.date_creation }));
  return cumuler(mouvements, clients, ENTREES_CLIENT, depuis);
}

export async function resumesComptesFournisseurs(boutiqueId: string, depuis: string): Promise<ResumeCompte[]> {
  const db = await ouvrirBaseDeDonnees();
  const fournisseurs = new Map(
    (await db.getAllFromIndex("fournisseurs", "boutique_id", boutiqueId)).map((f) => [f.id, { nom: f.nom, telephone: f.telephone }]),
  );
  const mouvements = (await db.getAll("mouvements_compte_fournisseur"))
    .filter((m) => !m.supprime)
    .map((m) => ({ tiers: m.fournisseur_id, type: m.type, montant: m.montant, date: m.date_creation }));
  return cumuler(mouvements, fournisseurs, ENTREES_FOURNISSEUR, depuis);
}

// --- Relevé « Toutes les opérations » ---

export async function releveCompletClient(clientId: string): Promise<OperationTiers[]> {
  const db = await ouvrirBaseDeDonnees();
  const client = await db.get("clients", clientId);
  if (!client) return [];
  const ventes = (await db.getAllFromIndex("ventes", "boutique_id", client.boutique_id)).filter(
    (v) => !v.supprime && v.client_id === clientId,
  );
  const ventesBrutes: VenteBrute[] = [];
  for (const v of ventes) {
    const paiements = (await db.getAllFromIndex("paiements", "vente_id", v.id)).filter((p) => !p.supprime);
    ventesBrutes.push({
      id: v.id,
      numero: v.numero,
      totalNet: v.total_net,
      statut: v.statut,
      dateCreation: v.date_creation,
      dateModification: v.date_modification,
      paiements: paiements.map((p) => ({ mode: p.mode, operateur: p.operateur ?? "", montant: p.montant })),
    });
  }
  const numeroVente = new Map(ventes.map((v) => [v.id, v.numero]));
  const credits = (await db.getAllFromIndex("credits", "client_id", clientId)).filter((c) => !c.supprime);
  const paiementsCredit: PaiementCreditBrut[] = [];
  for (const c of credits) {
    for (const p of await db.getAllFromIndex("paiements_credit", "credit_id", c.id)) {
      if (p.supprime) continue;
      paiementsCredit.push({
        id: p.id,
        creditId: c.id,
        venteNumero: c.vente_id ? (numeroVente.get(c.vente_id) ?? null) : null,
        montant: p.montant,
        mode: p.mode ?? "",
        dateCreation: p.date_creation,
      });
    }
  }
  const mouvements: MouvementBrut[] = (await mouvementsClient(clientId)).map((m) => ({
    id: m.id,
    type: m.type,
    montant: m.montant,
    mode: m.mode ?? "",
    operateur: m.operateur ?? "",
    motif: m.motif ?? "",
    dateCreation: m.date_creation,
  }));
  return assemblerReleveClient(
    ventesBrutes,
    credits.map((c) => ({ id: c.id, venteId: c.vente_id ?? null, montant: c.montant })),
    paiementsCredit,
    mouvements,
  );
}

export async function releveCompletFournisseur(fournisseurId: string): Promise<OperationTiers[]> {
  const db = await ouvrirBaseDeDonnees();
  const fournisseur = await db.get("fournisseurs", fournisseurId);
  if (!fournisseur) return [];
  const commandes = (await db.getAllFromIndex("commandes_achat", "boutique_id", fournisseur.boutique_id)).filter(
    (c) => !c.supprime && c.fournisseur_id === fournisseurId,
  );
  const numero = new Map(commandes.map((c) => [c.id, c.numero]));
  const receptions: ReceptionBrute[] = [];
  const retours: RetourBrut[] = [];
  const avoirsSurCompte = new Set(
    (await mouvementsFournisseur(fournisseurId)).filter((m) => m.retour_id).map((m) => m.retour_id as string),
  );
  for (const c of commandes) {
    for (const r of await db.getAllFromIndex("receptions", "commande_id", c.id)) {
      if (r.supprime) continue;
      receptions.push({
        id: r.id,
        commandeNumero: c.numero,
        valeurRecue: r.valeur_recue ?? 0,
        montantPaye: r.montant_paye ?? 0,
        modePaiement: r.mode_paiement ?? "",
        operateurPaiement: r.operateur_paiement ?? "",
        annulee: !!r.annulee,
        dateCreation: r.date_creation,
        dateAnnulation: r.date_annulation ?? null,
      });
    }
    for (const rf of await db.getAllFromIndex("retours_fournisseur", "commande_id", c.id)) {
      if (rf.supprime) continue;
      retours.push({
        id: rf.id,
        commandeNumero: c.numero,
        montant: rf.montant,
        avoir: rf.avoir,
        avoirSurCompte: avoirsSurCompte.has(rf.id),
        motif: rf.motif ?? "",
        dateCreation: rf.date_creation,
      });
    }
  }
  const paiementsDette: PaiementDetteBrut[] = [];
  for (const d of await db.getAllFromIndex("dettes_fournisseur", "fournisseur_id", fournisseurId)) {
    if (d.supprime) continue;
    for (const p of await db.getAllFromIndex("paiements_dette_fournisseur", "dette_id", d.id)) {
      if (p.supprime) continue;
      paiementsDette.push({
        id: p.id,
        commandeNumero: d.commande_id ? (numero.get(d.commande_id) ?? null) : null,
        montant: p.montant,
        mode: p.mode ?? "",
        annulee: !!p.annulee,
        dateCreation: p.date_creation,
        dateAnnulation: p.date_annulation ?? null,
      });
    }
  }
  const mouvements: MouvementBrut[] = (await mouvementsFournisseur(fournisseurId)).map((m) => ({
    id: m.id,
    type: m.type,
    montant: m.montant,
    mode: m.mode ?? "",
    operateur: m.operateur ?? "",
    motif: m.motif ?? "",
    dateCreation: m.date_creation,
  }));
  return assemblerReleveFournisseur(
    commandes.map((c) => ({ id: c.id, numero: c.numero, statut: c.statut, total: c.total, dateCreation: c.date_creation })),
    receptions,
    retours,
    paiementsDette,
    mouvements,
  );
}
