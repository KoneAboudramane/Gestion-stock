import { randomUUID } from "node:crypto";

import { dansUneTransaction, executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";
import { calculerEcheances, erreurTranches, type EcheanceDetail } from "./echeancier";
import { enregistrerMouvement } from "./tresorerie";

/**
 * Miroir de clients/services.py (Django, Étape 6) : un Credit naît uniquement
 * d'une vente à crédit (cf. ventes.ts::creerVente) — pas de création ici.
 * Contrairement à fournisseurs.DetteFournisseur, chaque règlement laisse
 * une trace (PaiementCredit), pas seulement une mutation du solde.
 */

export class ErreurClient extends Error {}

export type StatutCredit = "en_cours" | "solde";

// --- Clients ---

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

export function listerClientsDetail(boutiqueId: string, terme = ""): ClientDetailResume[] {
  // Le répertoire clients n'affiche que les clients permanents — les clients
  // occasionnels (saisis à la volée pour une vente à crédit) n'y figurent
  // jamais, ils ne sont visibles que via le carnet de crédit (listerCredits)
  // tant que leur solde n'est pas soldé.
  const conditions = ["c.boutique_id = ?", "c.supprime = 0", "c.est_permanent = 1"];
  const parametres: string[] = [boutiqueId];
  if (terme.trim()) {
    conditions.push("(c.nom LIKE ? OR c.telephone LIKE ?)");
    const motif = `%${terme.trim()}%`;
    parametres.push(motif, motif);
  }

  return tousLesResultats<ClientDetailResume>(
    `SELECT c.id as id, c.nom as nom, c.telephone as telephone, c.adresse as adresse,
            COALESCE((
              SELECT SUM(cr.solde) FROM credits cr
              WHERE cr.client_id = c.id AND cr.statut = 'en_cours' AND cr.supprime = 0
            ), 0) as soldeCredit,
            COALESCE((SELECT SUM(v.total_net) FROM ventes v
              WHERE v.client_id = c.id AND v.statut != 'annulee' AND v.supprime = 0), 0) as totalAchats,
            (SELECT COUNT(*) FROM ventes v
              WHERE v.client_id = c.id AND v.statut != 'annulee' AND v.supprime = 0) as nombreAchats,
            (SELECT MAX(v.date_creation) FROM ventes v
              WHERE v.client_id = c.id AND v.statut != 'annulee' AND v.supprime = 0) as dernierAchat,
            c.date_creation as dateCreation
     FROM clients c
     WHERE ${conditions.join(" AND ")}
     ORDER BY c.nom`,
    parametres,
  ).map((c) => ({
    ...c,
    soldeCredit: Number(c.soldeCredit),
    totalAchats: Number(c.totalAchats),
    nombreAchats: Number(c.nombreAchats),
    dernierAchat: c.dernierAchat ?? null,
  }));
}

// Contrairement à listerClientsDetail, n'importe quel client (permanent ou
// occasionnel) peut être récupéré ici — nécessaire pour afficher/modifier ses
// informations depuis le carnet de crédit (DetailCredit), où figurent aussi
// des clients de passage absents du répertoire principal.
export function obtenirClient(id: string): ClientDetailResume | undefined {
  return unResultat<ClientDetailResume>(
    `SELECT c.id as id, c.nom as nom, c.telephone as telephone, c.adresse as adresse,
            COALESCE((
              SELECT SUM(cr.solde) FROM credits cr
              WHERE cr.client_id = c.id AND cr.statut = 'en_cours' AND cr.supprime = 0
            ), 0) as soldeCredit,
            COALESCE((SELECT SUM(v.total_net) FROM ventes v
              WHERE v.client_id = c.id AND v.statut != 'annulee' AND v.supprime = 0), 0) as totalAchats,
            (SELECT COUNT(*) FROM ventes v
              WHERE v.client_id = c.id AND v.statut != 'annulee' AND v.supprime = 0) as nombreAchats,
            (SELECT MAX(v.date_creation) FROM ventes v
              WHERE v.client_id = c.id AND v.statut != 'annulee' AND v.supprime = 0) as dernierAchat,
            c.date_creation as dateCreation
     FROM clients c
     WHERE c.id = ? AND c.supprime = 0`,
    [id],
  );
}

export function creerClient(
  boutiqueId: string,
  nom: string,
  telephone = "",
  adresse = "",
  estPermanent = true,
): string {
  if (!nom.trim()) throw new ErreurClient("Le nom du client est obligatoire.");
  const id = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    `INSERT INTO clients (id, boutique_id, nom, telephone, adresse, est_permanent, date_creation, date_modification)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, boutiqueId, nom.trim(), telephone, adresse, estPermanent ? 1 : 0, maintenant, maintenant],
  );
  sauvegarder();
  return id;
}

export function modifierClient(
  id: string,
  champs: Partial<{ nom: string; telephone: string; adresse: string }>,
): void {
  const colonnes = Object.keys(champs);
  if (colonnes.length === 0) return;
  const maintenant = new Date().toISOString();
  const valeurs = colonnes.map((c) => (champs as Record<string, string>)[c]);
  executer(
    `UPDATE clients SET ${colonnes.map((c) => `${c} = ?`).join(", ")}, synchronise = 0, date_modification = ?
     WHERE id = ?`,
    [...valeurs, maintenant, id],
  );
  sauvegarder();
}

export function supprimerClient(id: string): void {
  const maintenant = new Date().toISOString();
  executer("UPDATE clients SET supprime = 1, synchronise = 0, date_modification = ? WHERE id = ?", [
    maintenant,
    id,
  ]);
  sauvegarder();
}

// --- Crédits ---

export interface CreditResume {
  id: string;
  clientNom: string;
  // SQLite renvoie 0/1 (comme "actif" ailleurs dans ce fichier), pas un booléen.
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

export function listerCredits(boutiqueId: string, clientId?: string, statut?: StatutCredit): CreditResume[] {
  const conditions = ["cl.boutique_id = ?", "cr.supprime = 0"];
  const parametres: string[] = [boutiqueId];
  if (clientId) {
    conditions.push("cr.client_id = ?");
    parametres.push(clientId);
  }
  if (statut) {
    conditions.push("cr.statut = ?");
    parametres.push(statut);
  }

  return tousLesResultats<Omit<CreditResume, "prochaineEcheance">>(
    `SELECT cr.id as id, cl.nom as clientNom, cl.est_permanent as clientEstPermanent,
            COALESCE(cl.telephone, '') as clientTelephone, v.numero as venteNumero,
            cr.montant as montant, cr.montant_paye as montantPaye, cr.solde as solde,
            cr.echeance as echeance, cr.statut as statut, cr.date_creation as dateCreation
     FROM credits cr
     JOIN clients cl ON cl.id = cr.client_id
     LEFT JOIN ventes v ON v.id = cr.vente_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY cr.date_creation DESC`,
    parametres,
  ).map((c) => {
    const prochaine = c.statut === "en_cours" ? echeancierCredit(c.id).find((e) => e.statut !== "payee") : undefined;
    return {
      ...c,
      prochaineEcheance: prochaine
        ? { date: prochaine.dateEcheance, reste: prochaine.montant - prochaine.couvert, enRetard: prochaine.statut === "en_retard" }
        : null,
    };
  });
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

export function obtenirCredit(id: string): CreditDetail | undefined {
  const credit = unResultat<Omit<CreditDetail, "paiements">>(
    `SELECT cr.id as id, cl.id as clientId, cl.nom as clientNom, v.numero as venteNumero,
            cr.montant as montant, cr.montant_paye as montantPaye, cr.solde as solde,
            cr.echeance as echeance, cr.statut as statut, cr.date_creation as dateCreation
     FROM credits cr
     JOIN clients cl ON cl.id = cr.client_id
     LEFT JOIN ventes v ON v.id = cr.vente_id
     WHERE cr.id = ? AND cr.supprime = 0`,
    [id],
  );
  if (!credit) return undefined;

  const paiements = tousLesResultats<PaiementCreditDetail>(
    "SELECT id, montant, mode, date_creation as dateCreation, utilisateur_id as utilisateurId FROM paiements_credit WHERE credit_id = ? AND supprime = 0 ORDER BY date_creation DESC",
    [id],
  );

  return { ...credit, paiements };
}

/**
 * Miroir exact de clients/services.py::rembourser_credit : refuse un montant
 * invalide, crée une trace PaiementCredit, met à jour montant_paye/solde/statut.
 */
export function rembourserCredit(
  creditId: string,
  montant: number,
  mode = "",
  depotId: string | null = null,
  utilisateurId: string | null = null,
): void {
  const credit = unResultat<{ montant_paye: number; solde: number; client_nom: string }>(
    `SELECT cr.montant_paye as montant_paye, cr.solde as solde, cl.nom as client_nom
     FROM credits cr JOIN clients cl ON cl.id = cr.client_id WHERE cr.id = ?`,
    [creditId],
  );
  if (!credit) throw new ErreurClient("Crédit introuvable.");
  if (montant <= 0) {
    throw new ErreurClient("Le montant remboursé doit être strictement positif.");
  }
  if (montant > Number(credit.solde)) {
    throw new ErreurClient("Le montant remboursé ne peut pas dépasser le solde restant.");
  }

  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    const paiementId = randomUUID();
    executer(
      `INSERT INTO paiements_credit (id, credit_id, montant, mode, utilisateur_id, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [paiementId, creditId, montant, mode, utilisateurId, maintenant, maintenant],
    );

    const nouveauMontantPaye = Number(credit.montant_paye) + montant;
    const nouveauSolde = Number(credit.solde) - montant;
    executer(
      `UPDATE credits SET montant_paye = ?, solde = ?, statut = ?, synchronise = 0, date_modification = ?
       WHERE id = ?`,
      [nouveauMontantPaye, nouveauSolde, nouveauSolde === 0 ? "solde" : "en_cours", maintenant, creditId],
    );

    if (mode === "especes" && depotId) {
      enregistrerMouvement({
        depotId,
        type: "entree",
        categorie: "remboursement_credit",
        montant,
        motif: `Règlement crédit ${credit.client_nom}`,
        utilisateurId,
        referenceType: "clients.PaiementCredit",
        referenceId: paiementId,
      });
    }
  });

  sauvegarder();
}
/** Tranche non réglée d'un crédit en cours (alertes). */
export interface EcheanceCreditEnCours extends EcheanceDetail {
  creditId: string;
  clientNom: string;
  venteNumero: string | null;
}

export function echeancierCredit(creditId: string): EcheanceDetail[] {
  const credit = unResultat<{ montant: number; montant_paye: number }>(
    "SELECT montant, montant_paye FROM credits WHERE id = ?",
    [creditId],
  );
  if (!credit) return [];
  const tranches = tousLesResultats<{ id: string; dateEcheance: string; montant: number }>(
    "SELECT id, date_echeance as dateEcheance, montant FROM echeances_credit WHERE credit_id = ? AND supprime = 0",
    [creditId],
  ).map((e) => ({ ...e, montant: Number(e.montant) }));
  return calculerEcheances({ montant: Number(credit.montant), montantPaye: Number(credit.montant_paye) }, tranches);
}

/**
 * (Re)planifie l'échéancier d'un crédit : les tranches déjà réglées sont
 * gardées, les autres retirées ; les nouvelles couvrent le reste dû.
 */
export function planifierEcheancierCredit(creditId: string, tranches: { dateEcheance: string; montant: number }[]): void {
  const credit = unResultat<{ solde: number; statut: string }>("SELECT solde, statut FROM credits WHERE id = ?", [creditId]);
  if (!credit) throw new ErreurClient("Crédit introuvable.");
  if (credit.statut !== "en_cours") throw new ErreurClient("Ce crédit est déjà soldé.");
  const erreur = erreurTranches(tranches, Number(credit.solde));
  if (erreur) throw new ErreurClient(erreur);
  const aRetirer = echeancierCredit(creditId).filter((e) => e.statut !== "payee");
  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    for (const e of aRetirer) {
      executer("UPDATE echeances_credit SET supprime = 1, synchronise = 0, date_modification = ? WHERE id = ?", [
        maintenant,
        e.id,
      ]);
    }
    for (const t of tranches) {
      executer(
        `INSERT INTO echeances_credit (id, credit_id, date_echeance, montant, date_creation, date_modification)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), creditId, t.dateEcheance, Math.round(t.montant * 100) / 100, maintenant, maintenant],
      );
    }
  });
  sauvegarder();
}

/** Tranches non réglées des crédits en cours de la boutique (alertes). */
export function echeancesCreditsEnCours(boutiqueId: string): EcheanceCreditEnCours[] {
  const resultat: EcheanceCreditEnCours[] = [];
  for (const c of tousLesResultats<{ id: string; clientNom: string; venteNumero: string | null }>(
    `SELECT cr.id as id, cl.nom as clientNom, v.numero as venteNumero
     FROM credits cr
     JOIN clients cl ON cl.id = cr.client_id
     LEFT JOIN ventes v ON v.id = cr.vente_id
     WHERE cl.boutique_id = ? AND cr.supprime = 0 AND cr.statut = 'en_cours'
       AND EXISTS (SELECT 1 FROM echeances_credit e WHERE e.credit_id = cr.id AND e.supprime = 0)`,
    [boutiqueId],
  )) {
    for (const e of echeancierCredit(c.id)) {
      if (e.statut !== "payee") resultat.push({ ...e, creditId: c.id, clientNom: c.clientNom, venteNumero: c.venteNumero });
    }
  }
  return resultat;
}

/** Total des règlements de crédits clients depuis une date ISO. */
export function montantRegleCreditsDepuis(boutiqueId: string, depuis: string): number {
  return Number(
    unResultat<{ total: number }>(
      `SELECT COALESCE(SUM(p.montant), 0) as total
       FROM paiements_credit p
       JOIN credits cr ON cr.id = p.credit_id
       JOIN clients cl ON cl.id = cr.client_id
       WHERE cl.boutique_id = ? AND p.supprime = 0 AND p.date_creation >= ?`,
      [boutiqueId, depuis],
    )?.total ?? 0,
  );
}
