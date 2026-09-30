import { randomUUID } from "node:crypto";

import { dansUneTransaction, executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";
import { enregistrerMouvement } from "./tresorerie";

/**
 * Miroir de clients/services.py et fournisseurs/services.py (Django) : le
 * « compte » d'un client (son argent laissé d'avance) et celui d'un
 * fournisseur (avances versées, avoirs de retour). Le solde n'est jamais
 * stocké : entrées moins sorties des mouvements (ajout seul).
 */

export class ErreurCompte extends Error {}

export type ModeArgent = "especes" | "mobile_money" | "banque";
export type TypeMouvementCompteClient = "depot" | "utilisation" | "rendu" | "annulation";
export type TypeMouvementCompteFournisseur = "avance" | "avoir" | "utilisation" | "remboursement" | "annulation";

const ENTREES_CLIENT: TypeMouvementCompteClient[] = ["depot", "annulation"];
const ENTREES_FOURNISSEUR: TypeMouvementCompteFournisseur[] = ["avance", "avoir", "annulation"];
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

/** NB : n'appelle pas sauvegarder() — à la charge de l'appelant (dans sa transaction). */
export function ajouterMouvementCompteClient(m: NouveauMouvementClient): string {
  const id = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    `INSERT INTO mouvements_compte_client
       (id, client_id, type, montant, mode, operateur, depot_id, vente_id, credit_id, utilisateur_id, motif,
        date_creation, date_modification)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      m.clientId,
      m.type,
      m.montant,
      m.mode ?? "",
      m.operateur ?? "",
      m.depotId ?? null,
      m.venteId ?? null,
      m.creditId ?? null,
      m.utilisateurId ?? null,
      (m.motif ?? "").trim().slice(0, 255),
      maintenant,
      maintenant,
    ],
  );
  return id;
}

export function soldeCompteClient(clientId: string): number {
  const r = unResultat<{ entrees: number; sorties: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type IN ('depot', 'annulation') THEN montant ELSE 0 END), 0) as entrees,
            COALESCE(SUM(CASE WHEN type IN ('depot', 'annulation') THEN 0 ELSE montant END), 0) as sorties
     FROM mouvements_compte_client WHERE client_id = ? AND supprime = 0`,
    [clientId],
  );
  return Number(r?.entrees ?? 0) - Number(r?.sorties ?? 0);
}

/** Soldes de tous les clients qui ont (ou ont eu) un compte, pour les listes. */
export function soldesComptesClients(boutiqueId: string): Record<string, number> {
  const lignes = tousLesResultats<{ client_id: string; solde: number }>(
    `SELECT m.client_id as client_id,
            SUM(CASE WHEN m.type IN ('depot', 'annulation') THEN m.montant ELSE -m.montant END) as solde
     FROM mouvements_compte_client m JOIN clients c ON c.id = m.client_id
     WHERE c.boutique_id = ? AND m.supprime = 0 GROUP BY m.client_id`,
    [boutiqueId],
  );
  return Object.fromEntries(lignes.map((l) => [l.client_id, Number(l.solde)]));
}

export function compteClient(clientId: string): CompteTiers {
  const mouvements = tousLesResultats<MouvementCompte>(
    `SELECT m.id, m.type, m.montant, COALESCE(m.mode, '') as mode, COALESCE(m.operateur, '') as operateur,
            m.depot_id as depotId, m.vente_id as venteId, v.numero as venteNumero, m.credit_id as creditId,
            NULL as receptionId, NULL as retourId, NULL as detteId, NULL as commandeNumero,
            m.utilisateur_id as utilisateurId, COALESCE(m.motif, '') as motif, m.date_creation as dateCreation
     FROM mouvements_compte_client m LEFT JOIN ventes v ON v.id = m.vente_id
     WHERE m.client_id = ? AND m.supprime = 0 ORDER BY m.date_creation`,
    [clientId],
  ).map((m) => ({
    ...m,
    montant: ENTREES_CLIENT.includes(m.type as TypeMouvementCompteClient) ? Number(m.montant) : -Number(m.montant),
  }));
  return { solde: soldeCompteClient(clientId), mouvements };
}

function nomClient(clientId: string): string {
  const client = unResultat<{ nom: string }>("SELECT nom FROM clients WHERE id = ?", [clientId]);
  if (!client) throw new ErreurCompte("Client introuvable.");
  return client.nom;
}

export function deposerSurCompteClient(clientId: string, op: OperationCompte): CompteTiers {
  verifierOperation(op);
  const nom = nomClient(clientId);
  dansUneTransaction(() => {
    const id = ajouterMouvementCompteClient({
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
      enregistrerMouvement({
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
  });
  sauvegarder();
  return compteClient(clientId);
}

export function rendreDuCompteClient(clientId: string, op: OperationCompte): CompteTiers {
  verifierOperation(op);
  const nom = nomClient(clientId);
  if (op.montant > soldeCompteClient(clientId)) {
    throw new ErreurCompte("On ne peut pas rendre plus que ce que le client a sur son compte.");
  }
  dansUneTransaction(() => {
    const id = ajouterMouvementCompteClient({
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
      enregistrerMouvement({
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
  });
  sauvegarder();
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

/** NB : n'appelle pas sauvegarder() — à la charge de l'appelant (dans sa transaction). */
export function ajouterMouvementCompteFournisseur(m: NouveauMouvementFournisseur): string {
  const id = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    `INSERT INTO mouvements_compte_fournisseur
       (id, fournisseur_id, type, montant, mode, operateur, depot_id, reception_id, retour_id, dette_id, utilisateur_id,
        motif, date_creation, date_modification)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      m.fournisseurId,
      m.type,
      m.montant,
      m.mode ?? "",
      m.operateur ?? "",
      m.depotId ?? null,
      m.receptionId ?? null,
      m.retourId ?? null,
      m.detteId ?? null,
      m.utilisateurId ?? null,
      (m.motif ?? "").trim().slice(0, 255),
      maintenant,
      maintenant,
    ],
  );
  return id;
}

export function soldeCompteFournisseur(fournisseurId: string): number {
  const r = unResultat<{ entrees: number; sorties: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type IN ('avance', 'avoir', 'annulation') THEN montant ELSE 0 END), 0) as entrees,
            COALESCE(SUM(CASE WHEN type IN ('avance', 'avoir', 'annulation') THEN 0 ELSE montant END), 0) as sorties
     FROM mouvements_compte_fournisseur WHERE fournisseur_id = ? AND supprime = 0`,
    [fournisseurId],
  );
  return Number(r?.entrees ?? 0) - Number(r?.sorties ?? 0);
}

export function soldesComptesFournisseurs(boutiqueId: string): Record<string, number> {
  const lignes = tousLesResultats<{ fournisseur_id: string; solde: number }>(
    `SELECT m.fournisseur_id as fournisseur_id,
            SUM(CASE WHEN m.type IN ('avance', 'avoir', 'annulation') THEN m.montant ELSE -m.montant END) as solde
     FROM mouvements_compte_fournisseur m JOIN fournisseurs f ON f.id = m.fournisseur_id
     WHERE f.boutique_id = ? AND m.supprime = 0 GROUP BY m.fournisseur_id`,
    [boutiqueId],
  );
  return Object.fromEntries(lignes.map((l) => [l.fournisseur_id, Number(l.solde)]));
}

export function compteFournisseur(fournisseurId: string): CompteTiers {
  const mouvements = tousLesResultats<MouvementCompte>(
    `SELECT m.id, m.type, m.montant, COALESCE(m.mode, '') as mode, COALESCE(m.operateur, '') as operateur,
            m.depot_id as depotId, NULL as venteId, NULL as venteNumero, NULL as creditId,
            m.reception_id as receptionId, m.retour_id as retourId, m.dette_id as detteId, c.numero as commandeNumero,
            m.utilisateur_id as utilisateurId, COALESCE(m.motif, '') as motif, m.date_creation as dateCreation
     FROM mouvements_compte_fournisseur m
     LEFT JOIN receptions r ON r.id = m.reception_id
     LEFT JOIN dettes_fournisseur d ON d.id = m.dette_id
     LEFT JOIN commandes_achat c ON c.id = COALESCE(r.commande_id, d.commande_id)
     WHERE m.fournisseur_id = ? AND m.supprime = 0 ORDER BY m.date_creation`,
    [fournisseurId],
  ).map((m) => ({
    ...m,
    montant: ENTREES_FOURNISSEUR.includes(m.type as TypeMouvementCompteFournisseur)
      ? Number(m.montant)
      : -Number(m.montant),
  }));
  return { solde: soldeCompteFournisseur(fournisseurId), mouvements };
}

function nomFournisseur(fournisseurId: string): string {
  const f = unResultat<{ nom: string }>("SELECT nom FROM fournisseurs WHERE id = ?", [fournisseurId]);
  if (!f) throw new ErreurCompte("Fournisseur introuvable.");
  return f.nom;
}

export function verserAvanceFournisseur(fournisseurId: string, op: OperationCompte): CompteTiers {
  verifierOperation(op);
  const nom = nomFournisseur(fournisseurId);
  dansUneTransaction(() => {
    const id = ajouterMouvementCompteFournisseur({
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
      enregistrerMouvement({
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
  });
  sauvegarder();
  return compteFournisseur(fournisseurId);
}

export function remboursementFournisseur(fournisseurId: string, op: OperationCompte): CompteTiers {
  verifierOperation(op);
  const nom = nomFournisseur(fournisseurId);
  if (op.montant > soldeCompteFournisseur(fournisseurId)) {
    throw new ErreurCompte("Le fournisseur ne peut pas rendre plus que ce qu'il nous doit sur son compte.");
  }
  dansUneTransaction(() => {
    const id = ajouterMouvementCompteFournisseur({
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
      enregistrerMouvement({
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
  });
  sauvegarder();
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

function resumes(table: string, colonneTiers: string, tableTiers: string, entrees: string[], boutiqueId: string, depuis: string): ResumeCompte[] {
  const listeEntrees = entrees.map((t) => `'${t}'`).join(", ");
  return tousLesResultats<ResumeCompte>(
    `SELECT t.id as id, t.nom as nom, COALESCE(t.telephone, '') as telephone,
            SUM(CASE WHEN m.type IN (${listeEntrees}) THEN m.montant ELSE -m.montant END) as solde,
            MAX(m.date_creation) as derniereOperation,
            SUM(CASE WHEN m.type IN (${listeEntrees}) AND m.date_creation >= ? THEN m.montant ELSE 0 END) as entreesPeriode,
            SUM(CASE WHEN m.type NOT IN (${listeEntrees}) AND m.date_creation >= ? THEN m.montant ELSE 0 END) as sortiesPeriode
     FROM ${table} m JOIN ${tableTiers} t ON t.id = m.${colonneTiers}
     WHERE t.boutique_id = ? AND m.supprime = 0
     GROUP BY t.id`,
    [depuis, depuis, boutiqueId],
  ).map((r) => ({
    ...r,
    solde: Number(r.solde),
    entreesPeriode: Number(r.entreesPeriode),
    sortiesPeriode: Number(r.sortiesPeriode),
  }));
}

/** Clients qui ont (ou ont eu) un compte, même occasionnels. */
export function resumesComptesClients(boutiqueId: string, depuis: string): ResumeCompte[] {
  return resumes("mouvements_compte_client", "client_id", "clients", ENTREES_CLIENT, boutiqueId, depuis);
}

export function resumesComptesFournisseurs(boutiqueId: string, depuis: string): ResumeCompte[] {
  return resumes("mouvements_compte_fournisseur", "fournisseur_id", "fournisseurs", ENTREES_FOURNISSEUR, boutiqueId, depuis);
}
