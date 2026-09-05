import { URL_BASE_API } from "../config";
import { tousLesResultats, unResultat } from "../db/helpers";
import type { Session } from "./auth";
import { resoudreCompte } from "./planComptableSyscohada";
import { appelerAvecDelai } from "./sync";

export { PLAN_COMPTABLE_SYSCOHADA } from "./planComptableSyscohada";

/**
 * Aperçu comptable local (non officiel) : miroir de comptabilite/signals.py
 * + rapports.py (Django), recalculé à la volée depuis SQLite pour rester
 * consultable hors-ligne — même principe que services/rapports.ts.
 *
 * Contrairement au livre officiel du serveur (comptabilite.EcritureComptable,
 * numéroté séquentiellement), ces écritures ne sont ni persistées, ni
 * synchronisées, ni numérotées : elles n'ont aucune valeur légale, et ne
 * servent qu'à donner au commerçant une vue de ses comptes en attendant une
 * connexion. Voir src/pages/Comptabilite.tsx pour le bandeau "aperçu non
 * officiel" et le renvoi vers l'API pour le livre réel.
 */

const OPERATEUR_VERS_COMPTE: Record<string, string> = {
  wave: "551",
  orange_money: "552",
  mtn_money: "553",
  moov_money: "554",
};

const CATEGORIE_DEPENSE_VERS_COMPTE: Record<string, string> = {
  transport: "61",
  reparation: "624",
  achat_marchandise: "601",
  achat_divers: "605",
  remboursement_client: "658",
  autre: "658",
};

const LIBELLES_MODE_PAIEMENT: Record<string, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  credit: "Crédit",
};

const LIBELLES_OPERATEUR: Record<string, string> = {
  orange_money: "Orange Money",
  mtn_money: "MTN Money",
  moov_money: "Moov Money",
  wave: "Wave",
};

const LIBELLES_CATEGORIE_DEPENSE: Record<string, string> = {
  transport: "Transport",
  reparation: "Réparation",
  achat_marchandise: "Achat de marchandise",
  achat_divers: "Achat divers",
  remboursement_client: "Remboursement client",
  autre: "Autre",
};

const LIBELLES_CATEGORIE_MOUVEMENT: Record<string, string> = {
  apport: "Mise de fonds",
  retrait: "Retrait",
  ajustement: "Ajustement",
};

export interface LigneEcritureLocale {
  compte: string;
  libelleCompte: string;
  debit: number;
  credit: number;
}

export interface EcritureLocale {
  id: string;
  date: string; // YYYY-MM-DD
  journal: "CA" | "VE" | "AC" | "OD";
  libelle: string;
  referenceType: string;
  referenceId: string;
  lignes: LigneEcritureLocale[];
}

function ligne(compte: string, debit = 0, credit = 0): LigneEcritureLocale {
  const c = resoudreCompte(compte);
  return { compte: c.numero, libelleCompte: c.libelle, debit, credit };
}

function compteSourcePaiement(mode: string, operateur: string): string {
  if (mode === "especes") return "571";
  if (mode === "mobile_money") return OPERATEUR_VERS_COMPTE[operateur] ?? "55";
  if (mode === "credit") return "411";
  return "47";
}

function decomposerTtc(montantTtc: number, taux: number): [number, number] {
  if (!taux) return [montantTtc, 0];
  const ht = Math.round(montantTtc / (1 + taux / 100));
  return [ht, montantTtc - ht];
}

function tauxTva(boutiqueId: string): number {
  const parametre = unResultat<{ valeur: string }>(
    `SELECT valeur FROM parametres WHERE boutique_id = ? AND cle = 'taux_tva' AND supprime = 0 LIMIT 1`,
    [boutiqueId],
  );
  if (!parametre?.valeur) return 0;
  const taux = Number(parametre.valeur);
  return Number.isFinite(taux) ? taux : 0;
}

/** Génère l'aperçu local des écritures pour toute la boutique (tous dépôts confondus). */
export function genererEcrituresLocales(boutiqueId: string): EcritureLocale[] {
  const taux = tauxTva(boutiqueId);
  const ecritures: EcritureLocale[] = [];

  // --- Ventes ---
  const paiements = tousLesResultats<{
    id: string; mode: string; operateur: string; montant: number;
    venteId: string; numero: string; venteDateCreation: string; venteDateModification: string; statut: string;
  }>(
    `SELECT p.id as id, p.mode as mode, p.operateur as operateur, p.montant as montant,
            v.id as venteId, v.numero as numero, v.date_creation as venteDateCreation,
            v.date_modification as venteDateModification, v.statut as statut
     FROM paiements p
     JOIN ventes v ON v.id = p.vente_id
     WHERE v.boutique_id = ? AND v.supprime = 0 AND p.supprime = 0`,
    [boutiqueId],
  );
  for (const p of paiements) {
    const [ht, tva] = decomposerTtc(p.montant, taux);
    const compteSource = compteSourcePaiement(p.mode, p.operateur);
    const lignes = [ligne(compteSource, p.montant, 0), ligne("701", 0, ht)];
    if (tva) lignes.push(ligne("4431", 0, tva));
    ecritures.push({
      id: `vente-paiement-${p.id}`,
      date: p.venteDateCreation.slice(0, 10),
      journal: "VE",
      libelle: `Vente ${p.numero || p.venteId} (${LIBELLES_MODE_PAIEMENT[p.mode] ?? p.mode})`,
      referenceType: "ventes.Paiement",
      referenceId: p.id,
      lignes,
    });

    if (p.statut === "annulee") {
      const [htA, tvaA] = decomposerTtc(p.montant, taux);
      const lignesAnnulation = [ligne("701", htA, 0)];
      if (tvaA) lignesAnnulation.push(ligne("4431", tvaA, 0));
      lignesAnnulation.push(ligne(compteSource, 0, p.montant));
      ecritures.push({
        id: `vente-annulation-${p.id}`,
        date: p.venteDateModification.slice(0, 10),
        journal: "VE",
        libelle: `Annulation vente ${p.numero || p.venteId} (${LIBELLES_MODE_PAIEMENT[p.mode] ?? p.mode})`,
        referenceType: "ventes.Paiement:annulation",
        referenceId: p.id,
        lignes: lignesAnnulation,
      });
    }
  }

  // --- Achats : réception ---
  const receptions = tousLesResultats<{ commandeId: string; numero: string; total: number; receptionDate: string }>(
    `SELECT c.id as commandeId, c.numero as numero, c.total as total, MIN(r.date_creation) as receptionDate
     FROM commandes_achat c
     JOIN receptions r ON r.commande_id = c.id AND r.supprime = 0
     WHERE c.boutique_id = ? AND c.supprime = 0 AND c.statut = 'recue'
     GROUP BY c.id`,
    [boutiqueId],
  );
  const commandesAvecDette = new Set(
    tousLesResultats<{ commandeId: string }>(
      `SELECT DISTINCT commande_id as commandeId FROM dettes_fournisseur WHERE supprime = 0 AND commande_id IS NOT NULL`,
    ).map((r) => r.commandeId),
  );
  for (const r of receptions) {
    // achats/services.ts ne trace pas de mouvement de caisse pour un paiement
    // immédiat à la réception : toute réception finance donc 100% via 401 si
    // une dette existe, 100% via 571 sinon (voir comptabilite/signals.py).
    const compteContrepartie = commandesAvecDette.has(r.commandeId) ? "401" : "571";
    ecritures.push({
      id: `achat-reception-${r.commandeId}`,
      date: r.receptionDate.slice(0, 10),
      journal: "AC",
      libelle: `Réception ${r.numero || r.commandeId}`,
      referenceType: "achats.CommandeAchat",
      referenceId: r.commandeId,
      lignes: [ligne("601", r.total, 0), ligne(compteContrepartie, 0, r.total)],
    });
  }

  // --- Paiements de dettes fournisseur ---
  const paiementsDette = tousLesResultats<{ id: string; montant: number; mode: string; dateCreation: string; fournisseurNom: string }>(
    `SELECT pd.id as id, pd.montant as montant, pd.mode as mode, pd.date_creation as dateCreation, f.nom as fournisseurNom
     FROM paiements_dette_fournisseur pd
     JOIN dettes_fournisseur d ON d.id = pd.dette_id
     JOIN fournisseurs f ON f.id = d.fournisseur_id
     WHERE f.boutique_id = ? AND pd.supprime = 0 AND d.supprime = 0`,
    [boutiqueId],
  );
  for (const p of paiementsDette) {
    const compteSource = p.mode === "especes" ? "571" : "55";
    ecritures.push({
      id: `paiement-dette-${p.id}`,
      date: p.dateCreation.slice(0, 10),
      journal: "AC",
      libelle: `Paiement dette ${p.fournisseurNom}`,
      referenceType: "fournisseurs.PaiementDetteFournisseur",
      referenceId: p.id,
      lignes: [ligne("401", p.montant, 0), ligne(compteSource, 0, p.montant)],
    });
  }

  // --- Règlements de crédit client ---
  const paiementsCredit = tousLesResultats<{ id: string; montant: number; mode: string; dateCreation: string; clientNom: string }>(
    `SELECT pc.id as id, pc.montant as montant, pc.mode as mode, pc.date_creation as dateCreation, cl.nom as clientNom
     FROM paiements_credit pc
     JOIN credits cr ON cr.id = pc.credit_id
     JOIN clients cl ON cl.id = cr.client_id
     WHERE cl.boutique_id = ? AND pc.supprime = 0`,
    [boutiqueId],
  );
  for (const p of paiementsCredit) {
    const compteSource = p.mode === "especes" ? "571" : "55";
    ecritures.push({
      id: `paiement-credit-${p.id}`,
      date: p.dateCreation.slice(0, 10),
      journal: "VE",
      libelle: `Règlement crédit ${p.clientNom}`,
      referenceType: "clients.PaiementCredit",
      referenceId: p.id,
      lignes: [ligne(compteSource, p.montant, 0), ligne("411", 0, p.montant)],
    });
  }

  // --- Dépenses ---
  const depenses = tousLesResultats<{ id: string; categorie: string; montant: number; dateCreation: string }>(
    `SELECT d.id as id, d.categorie as categorie, d.montant as montant, d.date_creation as dateCreation
     FROM depenses d
     JOIN depots dep ON dep.id = d.depot_id
     WHERE dep.boutique_id = ? AND d.supprime = 0`,
    [boutiqueId],
  );
  for (const d of depenses) {
    const compteCharge = CATEGORIE_DEPENSE_VERS_COMPTE[d.categorie] ?? "658";
    ecritures.push({
      id: `depense-${d.id}`,
      date: d.dateCreation.slice(0, 10),
      journal: "CA",
      libelle: LIBELLES_CATEGORIE_DEPENSE[d.categorie] ?? d.categorie,
      referenceType: "tresorerie.Depense",
      referenceId: d.id,
      lignes: [ligne(compteCharge, d.montant, 0), ligne("571", 0, d.montant)],
    });
  }

  // --- Transferts mobile money ---
  const transferts = tousLesResultats<{ id: string; operateur: string; montant: number; dateCreation: string }>(
    `SELECT t.id as id, t.operateur as operateur, t.montant as montant, t.date_creation as dateCreation
     FROM transferts_caisse t
     JOIN depots dep ON dep.id = t.depot_id
     WHERE dep.boutique_id = ? AND t.supprime = 0`,
    [boutiqueId],
  );
  for (const t of transferts) {
    const compteMobileMoney = OPERATEUR_VERS_COMPTE[t.operateur] ?? "55";
    ecritures.push({
      id: `transfert-${t.id}`,
      date: t.dateCreation.slice(0, 10),
      journal: "CA",
      libelle: `Transfert ${LIBELLES_OPERATEUR[t.operateur] ?? t.operateur}`,
      referenceType: "tresorerie.Transfert",
      referenceId: t.id,
      lignes: [ligne("571", t.montant, 0), ligne(compteMobileMoney, 0, t.montant)],
    });
  }

  // --- Apports / retraits / ajustements ---
  const mouvements = tousLesResultats<{ id: string; categorie: string; montant: number; motif: string; dateCreation: string }>(
    `SELECT m.id as id, m.categorie as categorie, m.montant as montant, m.motif as motif, m.date_creation as dateCreation
     FROM mouvements_caisse m
     JOIN depots dep ON dep.id = m.depot_id
     WHERE dep.boutique_id = ? AND m.supprime = 0 AND m.categorie IN ('apport', 'retrait', 'ajustement')`,
    [boutiqueId],
  );
  for (const m of mouvements) {
    const libelleMvt = m.motif || LIBELLES_CATEGORIE_MOUVEMENT[m.categorie] || m.categorie;
    let lignes: LigneEcritureLocale[];
    if (m.categorie === "apport") {
      lignes = [ligne("571", m.montant, 0), ligne("46", 0, m.montant)];
    } else if (m.categorie === "retrait") {
      lignes = [ligne("46", m.montant, 0), ligne("571", 0, m.montant)];
    } else {
      const montant = m.montant;
      lignes = montant >= 0
        ? [ligne("571", montant, 0), ligne("758", 0, montant)]
        : [ligne("658", -montant, 0), ligne("571", 0, -montant)];
    }
    ecritures.push({
      id: `mouvement-${m.id}`,
      date: m.dateCreation.slice(0, 10),
      journal: "CA",
      libelle: libelleMvt,
      referenceType: "tresorerie.MouvementCaisse",
      referenceId: m.id,
      lignes,
    });
  }

  return ecritures.sort((a, b) => a.date.localeCompare(b.date));
}

// --- Documents dérivés (purs, aucun accès DB : opèrent sur le tableau ci-dessus) ---

export interface LigneJournalLocal {
  date: string;
  journal: string;
  libelleEcriture: string;
  compte: string;
  libelleCompte: string;
  debit: number;
  credit: number;
}

export function journalLocal(
  ecritures: EcritureLocale[],
  debut: string,
  fin: string,
  journalCode?: string,
): LigneJournalLocal[] {
  const resultat: LigneJournalLocal[] = [];
  for (const e of ecritures) {
    if (e.date < debut || e.date > fin) continue;
    if (journalCode && e.journal !== journalCode) continue;
    for (const l of e.lignes) {
      resultat.push({
        date: e.date, journal: e.journal, libelleEcriture: e.libelle,
        compte: l.compte, libelleCompte: l.libelleCompte, debit: l.debit, credit: l.credit,
      });
    }
  }
  return resultat.sort((a, b) => a.date.localeCompare(b.date) || a.journal.localeCompare(b.journal));
}

export interface LigneGrandLivreLocal {
  date: string;
  journal: string;
  libelle: string;
  debit: number;
  credit: number;
  soldeCumule: number;
}

export function grandLivreLocal(ecritures: EcritureLocale[], compteNumero: string, debut: string, fin: string) {
  let solde = 0;
  const lignes: LigneGrandLivreLocal[] = [];
  const filtrees = [...ecritures].filter((e) => e.date >= debut && e.date <= fin).sort((a, b) => a.date.localeCompare(b.date));
  for (const e of filtrees) {
    for (const l of e.lignes) {
      if (l.compte !== compteNumero) continue;
      solde += l.debit - l.credit;
      lignes.push({ date: e.date, journal: e.journal, libelle: e.libelle, debit: l.debit, credit: l.credit, soldeCumule: solde });
    }
  }
  const compte = resoudreCompte(compteNumero);
  return { compte: compte.numero, libelle: compte.libelle, lignes, soldeFinal: solde };
}

function totauxParCompte(ecritures: EcritureLocale[], debut: string, fin: string): Map<string, { debit: number; credit: number }> {
  const totaux = new Map<string, { debit: number; credit: number }>();
  for (const e of ecritures) {
    if (e.date < debut || e.date > fin) continue;
    for (const l of e.lignes) {
      const t = totaux.get(l.compte) ?? { debit: 0, credit: 0 };
      t.debit += l.debit;
      t.credit += l.credit;
      totaux.set(l.compte, t);
    }
  }
  return totaux;
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

export function balanceGeneraleLocale(ecritures: EcritureLocale[], debut: string, fin: string) {
  const totaux = totauxParCompte(ecritures, debut, fin);
  const lignes: LigneBalanceLocale[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const [numero, t] of totaux) {
    const compte = resoudreCompte(numero);
    const solde = t.debit - t.credit;
    lignes.push({
      compte: numero, libelle: compte.libelle, classe: compte.classe,
      totalDebit: t.debit, totalCredit: t.credit,
      soldeDebiteur: solde > 0 ? solde : 0, soldeCrediteur: solde < 0 ? -solde : 0,
    });
    totalDebit += t.debit;
    totalCredit += t.credit;
  }
  lignes.sort((a, b) => a.compte.localeCompare(b.compte));
  return { lignes, totalDebit, totalCredit };
}

export interface LigneResultatLocale {
  compte: string;
  libelle: string;
  montant: number;
}

export function compteDeResultatLocal(ecritures: EcritureLocale[], debut: string, fin: string) {
  const totaux = totauxParCompte(ecritures, debut, fin);
  const charges: LigneResultatLocale[] = [];
  const produits: LigneResultatLocale[] = [];
  let totalCharges = 0;
  let totalProduits = 0;
  for (const [numero, t] of totaux) {
    const compte = resoudreCompte(numero);
    if (compte.classe === 6) {
      const montant = t.debit - t.credit;
      if (montant) {
        charges.push({ compte: numero, libelle: compte.libelle, montant });
        totalCharges += montant;
      }
    } else if (compte.classe === 7) {
      const montant = t.credit - t.debit;
      if (montant) {
        produits.push({ compte: numero, libelle: compte.libelle, montant });
        totalProduits += montant;
      }
    }
  }
  return { charges, produits, totalCharges, totalProduits, resultatNet: totalProduits - totalCharges };
}

export interface MasseBilan {
  masse: string;
  lignes: LigneResultatLocale[];
  sousTotal: number;
}

const ORDRE_MASSES_ACTIF = ["Actif immobilisé", "Actif circulant", "Trésorerie", "Autres"];
const ORDRE_MASSES_PASSIF = ["Capitaux propres", "Dettes financières", "Passif circulant", "Trésorerie", "Autres"];

function masseActif(numero: string): string {
  const prefixe = numero[0];
  if (prefixe === "2") return "Actif immobilisé";
  if (prefixe === "3" || prefixe === "4") return "Actif circulant";
  if (prefixe === "5") return "Trésorerie";
  // Cas rares (ex. classe 1 débitrice) — pas assez fréquents chez un
  // commerçant pour mériter leur propre masse.
  return "Autres";
}

function massePassif(numero: string): string {
  // 16/17/19 (emprunts, crédit-bail, provisions financières) avant le test
  // générique "commence par 1", sinon ils tomberaient dans Capitaux propres.
  if (numero.startsWith("16") || numero.startsWith("17") || numero.startsWith("19")) return "Dettes financières";
  const prefixe = numero[0];
  if (prefixe === "1") return "Capitaux propres";
  if (prefixe === "4") return "Passif circulant";
  if (prefixe === "5") return "Trésorerie";
  // Amortissements (28) et dépréciations (39, 49) créditeurs : dans un bilan
  // SYSCOHADA normal, ils viennent en déduction de l'actif brut plutôt que
  // comme une dette. Les mettre en Passif serait faux ; les nette contre
  // l'actif brut correspondant demanderait de repenser tout le calcul (hors
  // de portée ici) — "Autres" les isole en attendant plutôt que de les faire
  // passer pour une vraie dette.
  return "Autres";
}

function grouperParMasse(lignes: LigneResultatLocale[], masseDe: (numero: string) => string, ordre: string[]): MasseBilan[] {
  const groupes = new Map<string, LigneResultatLocale[]>(ordre.map((m) => [m, []]));
  for (const ligne of lignes) {
    groupes.get(masseDe(ligne.compte))!.push(ligne);
  }
  return ordre
    .filter((masse) => groupes.get(masse)!.length > 0)
    .map((masse) => {
      const lignesMasse = groupes.get(masse)!;
      return { masse, lignes: lignesMasse, sousTotal: lignesMasse.reduce((s, l) => s + l.montant, 0) };
    });
}

export function bilanLocal(ecritures: EcritureLocale[], dateFin: string) {
  const debutExercice = `${dateFin.slice(0, 4)}-01-01`;
  const totaux = totauxParCompte(ecritures, "0000-01-01", dateFin);
  const actifPlat: LigneResultatLocale[] = [];
  const passifPlat: LigneResultatLocale[] = [];
  let totalActif = 0;
  let totalPassif = 0;
  for (const [numero, t] of totaux) {
    const compte = resoudreCompte(numero);
    if (compte.classe < 1 || compte.classe > 5) continue;
    const solde = t.debit - t.credit;
    if (solde > 0) {
      actifPlat.push({ compte: numero, libelle: compte.libelle, montant: solde });
      totalActif += solde;
    } else if (solde < 0) {
      passifPlat.push({ compte: numero, libelle: compte.libelle, montant: -solde });
      totalPassif += -solde;
    }
  }
  const resultat = compteDeResultatLocal(ecritures, debutExercice, dateFin);
  if (resultat.resultatNet) {
    passifPlat.push({ compte: "12", libelle: "Résultat net de l'exercice", montant: resultat.resultatNet });
    totalPassif += resultat.resultatNet;
  }
  return {
    date: dateFin,
    actif: grouperParMasse(actifPlat, masseActif, ORDRE_MASSES_ACTIF),
    passif: grouperParMasse(passifPlat, massePassif, ORDRE_MASSES_PASSIF),
    totalActif,
    totalPassif,
  };
}

// --- Livre officiel : appelle directement l'API Django, nécessite une connexion ---
// Comme comptes.ts (roles/utilisateurs), qui appelle aussi Django en direct :
// contrairement au reste de ce client, il n'existe aucune version locale
// légale de ces documents (numérotation séquentielle impossible à garantir
// correctement sur plusieurs appareils hors-ligne — voir plus haut).

export class ErreurComptabilite extends Error {}

function entetes(session: Session): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` };
}

async function extraireMessageErreur(reponse: Response): Promise<string> {
  try {
    const corps = await reponse.json();
    const premiereValeur = Object.values(corps as Record<string, unknown>)[0];
    const message = Array.isArray(premiereValeur) ? premiereValeur[0] : premiereValeur;
    if (typeof message === "string") return message;
  } catch {
    // corps non-JSON ou vide : on retombe sur le message générique ci-dessous
  }
  return `HTTP ${reponse.status}`;
}

async function obtenirJson(session: Session, chemin: string): Promise<any> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}${chemin}`, { headers: entetes(session) });
  if (!reponse.ok) throw new ErreurComptabilite(await extraireMessageErreur(reponse));
  return reponse.json();
}

export async function journalOfficiel(
  session: Session, debut: string, fin: string, journalCode?: string,
): Promise<LigneJournalLocal[]> {
  const params = new URLSearchParams({ date_debut: debut, date_fin: fin });
  if (journalCode) params.set("journal", journalCode);
  const lignes = await obtenirJson(session, `/comptabilite/journal/?${params}`);
  return lignes.map((l: any) => ({
    date: l.date, journal: l.journal, libelleEcriture: l.libelle_ecriture,
    compte: l.compte, libelleCompte: l.libelle_compte, debit: Number(l.debit), credit: Number(l.credit),
  }));
}

export async function grandLivreOfficiel(
  session: Session, compte: string, debut: string, fin: string,
): Promise<{ compte: string; libelle: string; lignes: LigneGrandLivreLocal[]; soldeFinal: number }> {
  const params = new URLSearchParams({ compte, date_debut: debut, date_fin: fin });
  const donnees = await obtenirJson(session, `/comptabilite/grand-livre/?${params}`);
  return {
    compte: donnees.compte, libelle: donnees.libelle, soldeFinal: Number(donnees.solde_final),
    lignes: donnees.lignes.map((l: any) => ({
      date: l.date, journal: l.journal, libelle: l.libelle,
      debit: Number(l.debit), credit: Number(l.credit), soldeCumule: Number(l.solde_cumule),
    })),
  };
}

export async function balanceOfficielle(
  session: Session, debut: string, fin: string,
): Promise<{ lignes: LigneBalanceLocale[]; totalDebit: number; totalCredit: number }> {
  const params = new URLSearchParams({ date_debut: debut, date_fin: fin });
  const donnees = await obtenirJson(session, `/comptabilite/balance/?${params}`);
  return {
    totalDebit: Number(donnees.total_debit), totalCredit: Number(donnees.total_credit),
    lignes: donnees.lignes.map((l: any) => ({
      compte: l.compte, libelle: l.libelle, classe: l.classe,
      totalDebit: Number(l.total_debit), totalCredit: Number(l.total_credit),
      soldeDebiteur: Number(l.solde_debiteur), soldeCrediteur: Number(l.solde_crediteur),
    })),
  };
}

export async function compteDeResultatOfficiel(
  session: Session, debut: string, fin: string,
): Promise<{ charges: LigneResultatLocale[]; produits: LigneResultatLocale[]; totalCharges: number; totalProduits: number; resultatNet: number }> {
  const params = new URLSearchParams({ date_debut: debut, date_fin: fin });
  const donnees = await obtenirJson(session, `/comptabilite/compte-de-resultat/?${params}`);
  return {
    totalCharges: Number(donnees.total_charges), totalProduits: Number(donnees.total_produits),
    resultatNet: Number(donnees.resultat_net),
    charges: donnees.charges.map((l: any) => ({ compte: l.compte, libelle: l.libelle, montant: Number(l.montant) })),
    produits: donnees.produits.map((l: any) => ({ compte: l.compte, libelle: l.libelle, montant: Number(l.montant) })),
  };
}

function mapperMassesBilan(masses: any[]): MasseBilan[] {
  return masses.map((m: any) => ({
    masse: m.masse,
    sousTotal: Number(m.sous_total),
    lignes: m.lignes.map((l: any) => ({ compte: l.compte, libelle: l.libelle, montant: Number(l.montant) })),
  }));
}

export async function bilanOfficiel(
  session: Session, dateFin: string,
): Promise<{ date: string; actif: MasseBilan[]; passif: MasseBilan[]; totalActif: number; totalPassif: number }> {
  const params = new URLSearchParams({ date_debut: dateFin, date_fin: dateFin });
  const donnees = await obtenirJson(session, `/comptabilite/bilan/?${params}`);
  return {
    date: donnees.date, totalActif: Number(donnees.total_actif), totalPassif: Number(donnees.total_passif),
    actif: mapperMassesBilan(donnees.actif),
    passif: mapperMassesBilan(donnees.passif),
  };
}
