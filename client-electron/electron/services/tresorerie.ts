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
