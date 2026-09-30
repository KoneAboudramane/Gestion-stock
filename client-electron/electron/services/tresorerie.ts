import { randomUUID } from "node:crypto";

import { dansUneTransaction, executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";

/**
 * Miroir de tresorerie/services.py (Django) : le solde de caisse d'un dépôt
 * n'est jamais stocké, toujours recalculé à la volée à partir de
 * mouvements_caisse (agrégat simple — pas de table dérivée comme "stocks").
 */

export type TypeMouvementCaisse = "entree" | "sortie" | "ajustement";
export type CategorieMouvementCaisse =
  | "vente_especes"
  | "remboursement_credit"
  | "transfert_mobile_money"
  | "apport"
  | "depense"
  | "retrait"
  | "paiement_dette_fournisseur"
  | "paiement_fournisseur"
  | "ajustement";
// Union de suggestions (autocomplétion) + (string & {}) : garde l'IDE-hint des
// valeurs connues tout en acceptant un type de dépense saisi librement (voir
// Depense.tsx — champ combobox, pour les cas hors de cette liste).
export type CategorieDepense =
  | "transport"
  | "reparation"
  | "achat_marchandise"
  | "achat_divers"
  | "remboursement_client"
  | "autre"
  | (string & {});
export type OperateurMobileMoney = "orange_money" | "mtn_money" | "moov_money" | "wave";

export class ErreurTresorerie extends Error {}

const LIBELLES_CATEGORIE_DEPENSE: Record<CategorieDepense, string> = {
  transport: "Transport",
  reparation: "Réparation",
  achat_marchandise: "Achat de marchandise",
  achat_divers: "Achat divers",
  remboursement_client: "Remboursement client",
  autre: "Autre",
};

const LIBELLES_OPERATEUR: Record<OperateurMobileMoney, string> = {
  orange_money: "Orange Money",
  mtn_money: "MTN Money",
  moov_money: "Moov Money",
  wave: "Wave",
};

// --- Mouvements de caisse (ledger, jamais créé directement depuis l'UI) ---

export interface ParametresMouvementCaisse {
  depotId: string;
  type: TypeMouvementCaisse;
  categorie: CategorieMouvementCaisse;
  montant: number;
  motif?: string;
  utilisateurId?: string | null;
  referenceType?: string;
  referenceId?: string | null;
}

/** NB : n'appelle pas sauvegarder(), comme stock.ts::appliquerMouvement — à la charge de l'appelant. */
export function enregistrerMouvement(params: ParametresMouvementCaisse): string {
  const {
    depotId,
    type,
    categorie,
    montant,
    motif = "",
    utilisateurId = null,
    referenceType = "",
    referenceId = null,
  } = params;

  const id = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    `INSERT INTO mouvements_caisse
       (id, depot_id, type, categorie, montant, motif, reference_type, reference_id, utilisateur_id, date_creation, date_modification)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, depotId, type, categorie, montant, motif, referenceType, referenceId, utilisateurId, maintenant, maintenant],
  );
  return id;
}

export function soldeCaisse(depotId: string, jusqua?: string): number {
  const conditions = ["depot_id = ?", "supprime = 0"];
  const parametres: string[] = [depotId];
  if (jusqua) {
    conditions.push("date_creation <= ?");
    parametres.push(jusqua);
  }
  const lignes = tousLesResultats<{ type: TypeMouvementCaisse; montant: number }>(
    `SELECT type, montant FROM mouvements_caisse WHERE ${conditions.join(" AND ")}`,
    parametres,
  );
  return lignes.reduce((total, m) => {
    const montant = Number(m.montant);
    return m.type === "sortie" ? total - montant : total + montant; // entrée et ajustement (signé)
  }, 0);
}

export interface MouvementCaisseResume {
  id: string;
  type: TypeMouvementCaisse;
  categorie: CategorieMouvementCaisse;
  montant: number;
  motif: string;
  utilisateurId: string | null;
  dateCreation: string;
}

export function listerMouvements(depotId: string, limite = 100): MouvementCaisseResume[] {
  return tousLesResultats<MouvementCaisseResume>(
    `SELECT id, type, categorie, montant, motif, utilisateur_id as utilisateurId, date_creation as dateCreation
     FROM mouvements_caisse
     WHERE depot_id = ? AND supprime = 0
     ORDER BY date_creation DESC
     LIMIT ?`,
    [depotId, limite],
  );
}

// --- Dépenses (accessibles à tout utilisateur sur son dépôt) ---

export interface DepenseResume {
  id: string;
  categorie: CategorieDepense;
  montant: number;
  description: string;
  utilisateurId: string | null;
  dateCreation: string;
}

export function listerDepenses(depotId: string, limite = 100): DepenseResume[] {
  return tousLesResultats<DepenseResume>(
    `SELECT id, categorie, montant, description, utilisateur_id as utilisateurId, date_creation as dateCreation
     FROM depenses
     WHERE depot_id = ? AND supprime = 0
     ORDER BY date_creation DESC
     LIMIT ?`,
    [depotId, limite],
  );
}

export function enregistrerDepense(
  depotId: string,
  categorie: CategorieDepense,
  montant: number,
  description = "",
  utilisateurId: string | null = null,
): string {
  if (montant <= 0) throw new ErreurTresorerie("Le montant de la dépense doit être strictement positif.");

  const id = dansUneTransaction(() => {
    const depenseId = randomUUID();
    const maintenant = new Date().toISOString();
    executer(
      `INSERT INTO depenses (id, depot_id, categorie, montant, description, utilisateur_id, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [depenseId, depotId, categorie, montant, description, utilisateurId, maintenant, maintenant],
    );
    enregistrerMouvement({
      depotId,
      type: "sortie",
      categorie: "depense",
      montant,
      motif: LIBELLES_CATEGORIE_DEPENSE[categorie] ?? categorie,
      utilisateurId,
      referenceType: "tresorerie.Depense",
      referenceId: depenseId,
    });
    return depenseId;
  });

  sauvegarder();
  return id;
}

// --- Retrait / Apport / Ajustement (réservés Patron/Gérant côté UI) ---

export function effectuerRetrait(
  depotId: string,
  montant: number,
  motif = "",
  utilisateurId: string | null = null,
): string {
  if (montant <= 0) throw new ErreurTresorerie("Le montant du retrait doit être strictement positif.");
  const id = dansUneTransaction(() =>
    enregistrerMouvement({ depotId, type: "sortie", categorie: "retrait", montant, motif, utilisateurId }),
  );
  sauvegarder();
  return id;
}

export function enregistrerApport(
  depotId: string,
  montant: number,
  motif = "",
  utilisateurId: string | null = null,
): string {
  if (montant <= 0) throw new ErreurTresorerie("Le montant de l'apport doit être strictement positif.");
  const id = dansUneTransaction(() =>
    enregistrerMouvement({ depotId, type: "entree", categorie: "apport", montant, motif, utilisateurId }),
  );
  sauvegarder();
  return id;
}

export function ajusterCaisse(
  depotId: string,
  montantSigne: number,
  motif: string,
  utilisateurId: string | null = null,
): string {
  if (montantSigne === 0) throw new ErreurTresorerie("Un ajustement ne peut pas être nul.");
  const id = dansUneTransaction(() =>
    enregistrerMouvement({
      depotId,
      type: "ajustement",
      categorie: "ajustement",
      montant: montantSigne,
      motif,
      utilisateurId,
    }),
  );
  sauvegarder();
  return id;
}

// --- Transfert mobile money -> caisse ---

/**
 * Miroir de tresorerie/services.py::solde_mobile_money_disponible : le
 * mobile money est toujours crédité à celui qui vend (jamais une ligne
 * partagée), donc ce solde s'obtient en agrégeant ventes.Paiement — rien
 * n'est stocké séparément.
 */
export function soldeMobileMoneyDisponible(
  boutiqueId: string,
  utilisateurSourceId: string,
  operateur: OperateurMobileMoney,
): number {
  const encaisse = Number(
    unResultat<{ total: number }>(
      `SELECT COALESCE(SUM(p.montant), 0) as total
       FROM paiements p
       JOIN ventes v ON v.id = p.vente_id
       WHERE v.boutique_id = ? AND v.utilisateur_id = ? AND p.mode = 'mobile_money' AND p.operateur = ?
         AND v.statut != 'annulee' AND p.supprime = 0 AND v.supprime = 0`,
      [boutiqueId, utilisateurSourceId, operateur],
    )?.total ?? 0,
  );
  const transfere = Number(
    unResultat<{ total: number }>(
      `SELECT COALESCE(SUM(t.montant), 0) as total
       FROM transferts_caisse t
       JOIN depots d ON d.id = t.depot_id
       WHERE d.boutique_id = ? AND t.utilisateur_source_id = ? AND t.operateur = ? AND t.supprime = 0`,
      [boutiqueId, utilisateurSourceId, operateur],
    )?.total ?? 0,
  );
  return encaisse - transfere;
}

export interface ParametresTransfertCaisse {
  boutiqueId: string;
  depotId: string;
  utilisateurSourceId: string;
  operateur: OperateurMobileMoney;
  montant: number;
  utilisateurId?: string | null;
}

export function effectuerTransfert(params: ParametresTransfertCaisse): string {
  const { boutiqueId, depotId, utilisateurSourceId, operateur, montant, utilisateurId = null } = params;
  if (montant <= 0) throw new ErreurTresorerie("Le montant transféré doit être strictement positif.");

  const disponible = soldeMobileMoneyDisponible(boutiqueId, utilisateurSourceId, operateur);
  if (montant > disponible) {
    throw new ErreurTresorerie("Le montant transféré dépasse le solde mobile money disponible.");
  }

  const id = dansUneTransaction(() => {
    const transfertId = randomUUID();
    const maintenant = new Date().toISOString();
    executer(
      `INSERT INTO transferts_caisse
         (id, depot_id, utilisateur_source_id, operateur, montant, utilisateur_id, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [transfertId, depotId, utilisateurSourceId, operateur, montant, utilisateurId, maintenant, maintenant],
    );
    enregistrerMouvement({
      depotId,
      type: "entree",
      categorie: "transfert_mobile_money",
      montant,
      motif: `Transfert ${LIBELLES_OPERATEUR[operateur] ?? operateur}`,
      utilisateurId,
      referenceType: "tresorerie.Transfert",
      referenceId: transfertId,
    });
    return transfertId;
  });

  sauvegarder();
  return id;
}

export interface TransfertCaisseResume {
  id: string;
  utilisateurSourceId: string | null;
  operateur: OperateurMobileMoney;
  montant: number;
  utilisateurId: string | null;
  dateCreation: string;
}

export function listerTransferts(depotId: string, limite = 100): TransfertCaisseResume[] {
  return tousLesResultats<TransfertCaisseResume>(
    `SELECT id, utilisateur_source_id as utilisateurSourceId, operateur, montant,
            utilisateur_id as utilisateurId, date_creation as dateCreation
     FROM transferts_caisse
     WHERE depot_id = ? AND supprime = 0
     ORDER BY date_creation DESC
     LIMIT ?`,
    [depotId, limite],
  );
}

// --- Clôture journalière ---

export interface ClotureCaisseResume {
  id: string;
  soldeTheorique: number;
  soldeCompte: number;
  ecart: number;
  utilisateurId: string | null;
  dateCreation: string;
}

export function listerClotures(depotId: string, limite = 50): ClotureCaisseResume[] {
  return tousLesResultats<ClotureCaisseResume>(
    `SELECT id, solde_theorique as soldeTheorique, solde_compte as soldeCompte, ecart,
            utilisateur_id as utilisateurId, date_creation as dateCreation
     FROM clotures_caisse
     WHERE depot_id = ? AND supprime = 0
     ORDER BY date_creation DESC
     LIMIT ?`,
    [depotId, limite],
  );
}

export function cloturerCaisse(depotId: string, soldeCompte: number, utilisateurId: string | null = null): string {
  const id = dansUneTransaction(() => {
    const theorique = soldeCaisse(depotId);
    const clotureId = randomUUID();
    const maintenant = new Date().toISOString();
    executer(
      `INSERT INTO clotures_caisse
         (id, depot_id, solde_theorique, solde_compte, ecart, utilisateur_id, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [clotureId, depotId, theorique, soldeCompte, soldeCompte - theorique, utilisateurId, maintenant, maintenant],
    );
    return clotureId;
  });

  sauvegarder();
  return id;
}

export interface LigneJournee {
  categorie: string;
  montant: number;
  nombre: number;
}

export interface CaissierJournee {
  utilisateurId: string | null;
  nombreVentes: number;
  especes: number;
  mobileMoney: number;
  credit: number;
  autres: number;
  total: number;
  /** Remboursements de crédit encaissés en espèces par cette personne. */
  remboursements: number;
  /** Espèces encaissées (ventes + crédits remboursés) : ce qu'elle doit avoir remis à la caisse. */
  aRemettre: number;
  premiereVente: string | null;
  derniereVente: string | null;
}

export interface VenteJournee {
  id: string;
  numero: string;
  dateCreation: string;
  clientNom: string | null;
  utilisateurId: string | null;
  totalNet: number;
  /** Modes de paiement, ex. ["especes", "mobile_money"]. */
  modes: string[];
}

/** Résumé d'une journée de caisse (un dépôt, ou tous si depotId est null). */
export interface JourneeCaisse {
  fondOuverture: number;
  entrees: LigneJournee[];
  sorties: LigneJournee[];
  ajustements: number;
  soldeAttendu: number;
  nombreVentes: number;
  chiffreAffaires: number;
  especes: number;
  credit: number;
  autres: number;
  mobileMoney: { operateur: string; montant: number }[];
  parCaissier: CaissierJournee[];
  ventes: VenteJournee[];
  clotures: (ClotureCaisseResume & { depotId: string })[];
}

function regrouper(lignes: { categorie: string; montant: number }[]): LigneJournee[] {
  const parCategorie = new Map<string, LigneJournee>();
  for (const l of lignes) {
    const actuel = parCategorie.get(l.categorie) ?? { categorie: l.categorie, montant: 0, nombre: 0 };
    actuel.montant += l.montant;
    actuel.nombre += 1;
    parCategorie.set(l.categorie, actuel);
  }
  return [...parCategorie.values()].sort((a, b) => b.montant - a.montant);
}

function assemblerJournee(
  fondOuverture: number,
  mouvements: { type: string; categorie: string; montant: number; utilisateurId: string | null }[],
  ventes: { id: string; numero: string; dateCreation: string; clientNom: string | null; utilisateurId: string | null; totalNet: number }[],
  paiements: { venteId: string; mode: string; operateur: string; montant: number }[],
  clotures: (ClotureCaisseResume & { depotId: string })[],
): JourneeCaisse {
  const entrees = regrouper(mouvements.filter((m) => m.type === "entree"));
  const sorties = regrouper(mouvements.filter((m) => m.type === "sortie"));
  const ajustements = mouvements.filter((m) => m.type === "ajustement").reduce((t, m) => t + m.montant, 0);
  const totalEntrees = entrees.reduce((t, l) => t + l.montant, 0);
  const totalSorties = sorties.reduce((t, l) => t + l.montant, 0);

  const auteurVente = new Map(ventes.map((v) => [v.id, v.utilisateurId]));
  const caissiers = new Map<string, CaissierJournee>();
  const caissier = (id: string | null) => {
    const cle = id ?? "";
    let c = caissiers.get(cle);
    if (!c) {
      c = {
        utilisateurId: id,
        nombreVentes: 0,
        especes: 0,
        mobileMoney: 0,
        credit: 0,
        autres: 0,
        total: 0,
        remboursements: 0,
        aRemettre: 0,
        premiereVente: null,
        derniereVente: null,
      };
      caissiers.set(cle, c);
    }
    return c;
  };
  for (const v of ventes) {
    const c = caissier(v.utilisateurId);
    c.nombreVentes += 1;
    c.total += v.totalNet;
    if (!c.premiereVente || v.dateCreation < c.premiereVente) c.premiereVente = v.dateCreation;
    if (!c.derniereVente || v.dateCreation > c.derniereVente) c.derniereVente = v.dateCreation;
  }
  const modesParVente = new Map<string, Set<string>>();
  for (const p of paiements) {
    if (!modesParVente.has(p.venteId)) modesParVente.set(p.venteId, new Set());
    modesParVente.get(p.venteId)!.add(p.mode);
  }
  let especes = 0;
  let credit = 0;
  let autres = 0;
  const parOperateur = new Map<string, number>();
  for (const p of paiements) {
    const c = caissier(auteurVente.get(p.venteId) ?? null);
    if (p.mode === "especes") {
      especes += p.montant;
      c.especes += p.montant;
    } else if (p.mode === "mobile_money") {
      parOperateur.set(p.operateur || "", (parOperateur.get(p.operateur || "") ?? 0) + p.montant);
      c.mobileMoney += p.montant;
    } else if (p.mode === "credit") {
      credit += p.montant;
      c.credit += p.montant;
    } else {
      autres += p.montant;
      c.autres += p.montant;
    }
  }
  for (const m of mouvements) {
    if (m.type === "entree" && m.categorie === "remboursement_credit") caissier(m.utilisateurId).remboursements += m.montant;
  }
  for (const c of caissiers.values()) c.aRemettre = c.especes + c.remboursements;
  return {
    fondOuverture,
    entrees,
    sorties,
    ajustements,
    soldeAttendu: fondOuverture + totalEntrees - totalSorties + ajustements,
    nombreVentes: ventes.length,
    chiffreAffaires: ventes.reduce((t, v) => t + v.totalNet, 0),
    especes,
    credit,
    autres,
    mobileMoney: [...parOperateur.entries()].map(([operateur, montant]) => ({ operateur, montant })).sort((a, b) => b.montant - a.montant),
    parCaissier: [...caissiers.values()].sort((a, b) => b.total - a.total),
    ventes: ventes
      .map((v) => ({ ...v, modes: [...(modesParVente.get(v.id) ?? [])] }))
      .sort((a, b) => a.dateCreation.localeCompare(b.dateCreation)),
    clotures,
  };
}

/** Journée de caisse entre debut (inclus) et fin (exclu), bornes ISO calculées en heure locale par l'écran. */
export function journeeCaisse(boutiqueId: string, depotId: string | null, debut: string, fin: string): JourneeCaisse {
  const depots = depotId
    ? [depotId]
    : tousLesResultats<{ id: string }>("SELECT id FROM depots WHERE boutique_id = ? AND supprime = 0", [boutiqueId]).map((d) => d.id);
  if (depots.length === 0) return assemblerJournee(0, [], [], [], []);
  const marques = depots.map(() => "?").join(", ");
  const fondOuverture = depots.reduce((t, d) => t + soldeAvant(d, debut), 0);
  const mouvements = tousLesResultats<{ type: string; categorie: string; montant: number; utilisateurId: string | null }>(
    `SELECT type, categorie, montant, utilisateur_id as utilisateurId FROM mouvements_caisse
     WHERE depot_id IN (${marques}) AND supprime = 0 AND date_creation >= ? AND date_creation < ?`,
    [...depots, debut, fin],
  ).map((m) => ({ ...m, montant: Number(m.montant) }));
  const ventes = tousLesResultats<{
    id: string;
    numero: string;
    dateCreation: string;
    clientNom: string | null;
    utilisateurId: string | null;
    totalNet: number;
  }>(
    `SELECT v.id as id, v.numero as numero, v.date_creation as dateCreation, c.nom as clientNom,
            v.utilisateur_id as utilisateurId, v.total_net as totalNet
     FROM ventes v LEFT JOIN clients c ON c.id = v.client_id
     WHERE v.depot_id IN (${marques}) AND v.supprime = 0 AND v.statut != 'annulee' AND v.date_creation >= ? AND v.date_creation < ?`,
    [...depots, debut, fin],
  ).map((v) => ({ ...v, totalNet: Number(v.totalNet) }));
  const paiements = tousLesResultats<{ venteId: string; mode: string; operateur: string; montant: number }>(
    `SELECT p.vente_id as venteId, p.mode as mode, COALESCE(p.operateur, '') as operateur, p.montant as montant
     FROM paiements p JOIN ventes v ON v.id = p.vente_id
     WHERE v.depot_id IN (${marques}) AND v.supprime = 0 AND v.statut != 'annulee' AND p.supprime = 0
       AND v.date_creation >= ? AND v.date_creation < ?`,
    [...depots, debut, fin],
  ).map((p) => ({ ...p, montant: Number(p.montant) }));
  const clotures = tousLesResultats<ClotureCaisseResume & { depotId: string }>(
    `SELECT id, depot_id as depotId, solde_theorique as soldeTheorique, solde_compte as soldeCompte, ecart,
            utilisateur_id as utilisateurId, date_creation as dateCreation
     FROM clotures_caisse
     WHERE depot_id IN (${marques}) AND supprime = 0 AND date_creation >= ? AND date_creation < ?
     ORDER BY date_creation DESC`,
    [...depots, debut, fin],
  );
  return assemblerJournee(fondOuverture, mouvements, ventes, paiements, clotures);
}

/** Solde de caisse d'un dépôt juste avant une date ISO (fond de caisse du matin). */
function soldeAvant(depotId: string, date: string): number {
  const lignes = tousLesResultats<{ type: TypeMouvementCaisse; montant: number }>(
    "SELECT type, montant FROM mouvements_caisse WHERE depot_id = ? AND supprime = 0 AND date_creation < ?",
    [depotId, date],
  );
  return lignes.reduce((t, m) => (m.type === "sortie" ? t - Number(m.montant) : t + Number(m.montant)), 0);
}
