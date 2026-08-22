import { ouvrirBaseDeDonnees } from "../db";
import { suiviSyncNeuf } from "../db/helpers";
import type {
  ClotureCaisseLocale,
  DepenseLocale,
  MouvementCaisseLocal,
  TransfertCaisseLocal,
} from "../db/schema";

/**
 * Port navigateur de client-electron/electron/services/tresorerie.ts (lui-même
 * miroir de tresorerie/services.py) : le solde de caisse d'un dépôt n'est
 * jamais stocké, toujours recalculé à la volée à partir de mouvements_caisse.
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

export async function enregistrerMouvement(params: ParametresMouvementCaisse): Promise<string> {
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

  const db = await ouvrirBaseDeDonnees();
  const id = crypto.randomUUID();
  const mouvement: MouvementCaisseLocal = {
    id,
    depot_id: depotId,
    type,
    categorie,
    montant,
    motif,
    reference_type: referenceType,
    reference_id: referenceId,
    utilisateur_id: utilisateurId,
    ...suiviSyncNeuf(),
  };
  await db.put("mouvements_caisse", mouvement);
  return id;
}

export async function soldeCaisse(depotId: string, jusqua?: string): Promise<number> {
  const db = await ouvrirBaseDeDonnees();
  const mouvements = (await db.getAllFromIndex("mouvements_caisse", "depot_id", depotId)).filter(
    (m) => !m.supprime && (!jusqua || m.date_creation <= jusqua),
  );
  return mouvements.reduce((total, m) => (m.type === "sortie" ? total - m.montant : total + m.montant), 0);
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

export async function listerMouvements(depotId: string, limite = 100): Promise<MouvementCaisseResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const mouvements = (await db.getAllFromIndex("mouvements_caisse", "depot_id", depotId)).filter((m) => !m.supprime);
  return mouvements
    .sort((a, b) => b.date_creation.localeCompare(a.date_creation))
    .slice(0, limite)
    .map((m) => ({
      id: m.id,
      type: m.type,
      categorie: m.categorie as CategorieMouvementCaisse,
      montant: m.montant,
      motif: m.motif,
      utilisateurId: m.utilisateur_id,
      dateCreation: m.date_creation,
    }));
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

export async function listerDepenses(depotId: string, limite = 100): Promise<DepenseResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const depenses = (await db.getAllFromIndex("depenses", "depot_id", depotId)).filter((d) => !d.supprime);
  return depenses
    .sort((a, b) => b.date_creation.localeCompare(a.date_creation))
    .slice(0, limite)
    .map((d) => ({
      id: d.id,
      categorie: d.categorie as CategorieDepense,
      montant: d.montant,
      description: d.description,
      utilisateurId: d.utilisateur_id,
      dateCreation: d.date_creation,
    }));
}

export async function enregistrerDepense(
  depotId: string,
  categorie: CategorieDepense,
  montant: number,
  description = "",
  utilisateurId: string | null = null,
): Promise<string> {
  if (montant <= 0) throw new ErreurTresorerie("Le montant de la dépense doit être strictement positif.");

  const db = await ouvrirBaseDeDonnees();
  const depenseId = crypto.randomUUID();
  const depense: DepenseLocale = {
    id: depenseId,
    depot_id: depotId,
    categorie,
    montant,
    description,
    utilisateur_id: utilisateurId,
    ...suiviSyncNeuf(),
  };
  await db.put("depenses", depense);

  await enregistrerMouvement({
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
}

// --- Retrait / Apport / Ajustement (réservés Patron/Gérant côté UI) ---

export async function effectuerRetrait(
  depotId: string,
  montant: number,
  motif = "",
  utilisateurId: string | null = null,
): Promise<string> {
  if (montant <= 0) throw new ErreurTresorerie("Le montant du retrait doit être strictement positif.");
  return enregistrerMouvement({ depotId, type: "sortie", categorie: "retrait", montant, motif, utilisateurId });
}

export async function enregistrerApport(
  depotId: string,
  montant: number,
  motif = "",
  utilisateurId: string | null = null,
): Promise<string> {
  if (montant <= 0) throw new ErreurTresorerie("Le montant de l'apport doit être strictement positif.");
  return enregistrerMouvement({ depotId, type: "entree", categorie: "apport", montant, motif, utilisateurId });
}

export async function ajusterCaisse(
  depotId: string,
  montantSigne: number,
  motif: string,
  utilisateurId: string | null = null,
): Promise<string> {
  if (montantSigne === 0) throw new ErreurTresorerie("Un ajustement ne peut pas être nul.");
  return enregistrerMouvement({
    depotId,
    type: "ajustement",
    categorie: "ajustement",
    montant: montantSigne,
    motif,
    utilisateurId,
  });
}

// --- Transfert mobile money -> caisse ---

/**
 * Miroir de tresorerie/services.py::solde_mobile_money_disponible : le mobile
 * money est toujours crédité à celui qui vend (jamais une ligne partagée).
 */
export async function soldeMobileMoneyDisponible(
  boutiqueId: string,
  utilisateurSourceId: string,
  operateur: OperateurMobileMoney,
): Promise<number> {
  const db = await ouvrirBaseDeDonnees();

  const ventes = (await db.getAllFromIndex("ventes", "boutique_id", boutiqueId)).filter(
    (v) => v.utilisateur_id === utilisateurSourceId && v.statut !== "annulee",
  );
  const ventesId = new Set(ventes.map((v) => v.id));
  const tousPaiements = await db.getAll("paiements");
  const encaisse = tousPaiements
    .filter((p) => !p.supprime && p.mode === "mobile_money" && p.operateur === operateur && ventesId.has(p.vente_id))
    .reduce((somme, p) => somme + p.montant, 0);

  // transferts_caisse est indexé par dépôt, pas par boutique : filtrage manuel via les dépôts de la boutique.
  const depots = await db.getAllFromIndex("depots", "boutique_id", boutiqueId);
  const depotsId = new Set(depots.map((d) => d.id));
  const tousTransferts = await db.getAll("transferts_caisse");
  const transfere = tousTransferts
    .filter(
      (t) =>
        !t.supprime &&
        t.utilisateur_source_id === utilisateurSourceId &&
        t.operateur === operateur &&
        depotsId.has(t.depot_id),
    )
    .reduce((somme, t) => somme + t.montant, 0);

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

export async function effectuerTransfert(params: ParametresTransfertCaisse): Promise<string> {
  const { boutiqueId, depotId, utilisateurSourceId, operateur, montant, utilisateurId = null } = params;
  if (montant <= 0) throw new ErreurTresorerie("Le montant transféré doit être strictement positif.");

  const disponible = await soldeMobileMoneyDisponible(boutiqueId, utilisateurSourceId, operateur);
  if (montant > disponible) {
    throw new ErreurTresorerie("Le montant transféré dépasse le solde mobile money disponible.");
  }

  const db = await ouvrirBaseDeDonnees();
  const transfertId = crypto.randomUUID();
  const transfert: TransfertCaisseLocal = {
    id: transfertId,
    depot_id: depotId,
    utilisateur_source_id: utilisateurSourceId,
    operateur,
    montant,
    utilisateur_id: utilisateurId,
    ...suiviSyncNeuf(),
  };
  await db.put("transferts_caisse", transfert);

  await enregistrerMouvement({
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
}

export interface TransfertCaisseResume {
  id: string;
  utilisateurSourceId: string | null;
  operateur: OperateurMobileMoney;
  montant: number;
  utilisateurId: string | null;
  dateCreation: string;
}

export async function listerTransferts(depotId: string, limite = 100): Promise<TransfertCaisseResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const transferts = (await db.getAllFromIndex("transferts_caisse", "depot_id", depotId)).filter((t) => !t.supprime);
  return transferts
    .sort((a, b) => b.date_creation.localeCompare(a.date_creation))
    .slice(0, limite)
    .map((t) => ({
      id: t.id,
      utilisateurSourceId: t.utilisateur_source_id,
      operateur: t.operateur as OperateurMobileMoney,
      montant: t.montant,
      utilisateurId: t.utilisateur_id,
      dateCreation: t.date_creation,
    }));
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

export async function listerClotures(depotId: string, limite = 50): Promise<ClotureCaisseResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const clotures = (await db.getAllFromIndex("clotures_caisse", "depot_id", depotId)).filter((c) => !c.supprime);
  return clotures
    .sort((a, b) => b.date_creation.localeCompare(a.date_creation))
    .slice(0, limite)
    .map((c) => ({
      id: c.id,
      soldeTheorique: c.solde_theorique,
      soldeCompte: c.solde_compte,
      ecart: c.ecart,
      utilisateurId: c.utilisateur_id,
      dateCreation: c.date_creation,
    }));
}

export async function cloturerCaisse(
  depotId: string,
  soldeCompte: number,
  utilisateurId: string | null = null,
): Promise<string> {
  const theorique = await soldeCaisse(depotId);
  const db = await ouvrirBaseDeDonnees();
  const clotureId = crypto.randomUUID();
  const cloture: ClotureCaisseLocale = {
    id: clotureId,
    depot_id: depotId,
    solde_theorique: theorique,
    solde_compte: soldeCompte,
    ecart: soldeCompte - theorique,
    utilisateur_id: utilisateurId,
    ...suiviSyncNeuf(),
  };
  await db.put("clotures_caisse", cloture);
  return clotureId;
}
