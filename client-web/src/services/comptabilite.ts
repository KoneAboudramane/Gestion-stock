import { ouvrirBaseDeDonnees } from "../db";
import {
  libelleCategorieDepense,
  libelleCategorieMouvementCaisse,
  libelleModePaiement,
  libelleOperateurMobileMoney,
} from "../lib/libelles";
import { PLAN_COMPTABLE_SYSCOHADA, resoudreCompte } from "../lib/planComptableSyscohada";

/**
 * Aperçu comptable local (non officiel) : port TypeScript de
 * comptabilite/signals.py + rapports.py, recalculé à la volée depuis
 * IndexedDB pour rester consultable hors-ligne — comme services/rapports.ts.
 *
 * Contrairement au livre officiel du serveur (comptabilite/models.py::EcritureComptable,
 * numéroté séquentiellement), ces écritures ne sont ni persistées, ni
 * synchronisées, ni numérotées : elles n'ont aucune valeur légale, et ne
 * servent qu'à donner au commerçant une vue de ses comptes en attendant une
 * connexion. Voir pages/Comptabilite.tsx pour le bandeau "aperçu non
 * officiel" et le renvoi vers l'API pour le livre réel.
 */

export { PLAN_COMPTABLE_SYSCOHADA };

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

type Base = Awaited<ReturnType<typeof ouvrirBaseDeDonnees>>;

async function tauxTva(db: Base, boutiqueId: string): Promise<number> {
  const parametres = await db.getAllFromIndex("parametres", "boutique_id", boutiqueId);
  const parametre = parametres.find((p) => p.cle === "taux_tva" && !p.supprime);
  if (!parametre || !parametre.valeur) return 0;
  const taux = Number(parametre.valeur);
  return Number.isFinite(taux) ? taux : 0;
}

/** Génère l'aperçu local des écritures pour toute la boutique (tous dépôts confondus). */
export async function genererEcrituresLocales(boutiqueId: string): Promise<EcritureLocale[]> {
  const db = await ouvrirBaseDeDonnees();
  const taux = await tauxTva(db, boutiqueId);
  const ecritures: EcritureLocale[] = [];

  // --- Ventes ---
  const ventes = (await db.getAllFromIndex("ventes", "boutique_id", boutiqueId)).filter((v) => !v.supprime);
  for (const vente of ventes) {
    const paiements = (await db.getAllFromIndex("paiements", "vente_id", vente.id)).filter((p) => !p.supprime);
    for (const paiement of paiements) {
      const [ht, tva] = decomposerTtc(paiement.montant, taux);
      const compteSource = compteSourcePaiement(paiement.mode, paiement.operateur);
      const lignes = [ligne(compteSource, paiement.montant, 0), ligne("701", 0, ht)];
      if (tva) lignes.push(ligne("4431", 0, tva));
      ecritures.push({
        id: `vente-paiement-${paiement.id}`,
        date: vente.date_creation.slice(0, 10),
        journal: "VE",
        libelle: `Vente ${vente.numero || vente.id} (${libelleModePaiement(paiement.mode)})`,
        referenceType: "ventes.Paiement",
        referenceId: paiement.id,
        lignes,
      });
    }

    if (vente.statut === "annulee") {
      for (const paiement of paiements) {
        const [ht, tva] = decomposerTtc(paiement.montant, taux);
        const compteSource = compteSourcePaiement(paiement.mode, paiement.operateur);
        const lignes = [ligne("701", ht, 0)];
        if (tva) lignes.push(ligne("4431", tva, 0));
        lignes.push(ligne(compteSource, 0, paiement.montant));
        ecritures.push({
          id: `vente-annulation-${paiement.id}`,
          date: vente.date_modification.slice(0, 10),
          journal: "VE",
          libelle: `Annulation vente ${vente.numero || vente.id} (${libelleModePaiement(paiement.mode)})`,
          referenceType: "ventes.Paiement:annulation",
          referenceId: paiement.id,
          lignes,
        });
      }
    }
  }

  // --- Achats : réception ---
  const commandes = (await db.getAllFromIndex("commandes_achat", "boutique_id", boutiqueId)).filter(
    (c) => !c.supprime && c.statut === "recue",
  );
  // dettes_fournisseur n'est indexé que par fournisseur_id : on charge tout,
  // même échelle qu'une boutique de commerce (pas de souci de volumétrie ici.
  const toutesLesDettes = (await db.getAll("dettes_fournisseur")).filter((d) => !d.supprime);
  for (const commande of commandes) {
    const receptions = (await db.getAllFromIndex("receptions", "commande_id", commande.id)).filter((r) => !r.supprime);
    const reception = receptions[0];
    if (!reception) continue;
    // achats/services.py ne trace pas de mouvement de caisse pour un paiement
    // immédiat à la réception : toute réception finance donc 100% via 401 si
    // une dette existe (dette.montant == commande.total, jamais partiel), et
    // 100% via 571 sinon. Voir comptabilite/signals.py::sur_reception_achat.
    const aUneDette = toutesLesDettes.some((d) => d.commande_id === commande.id);
    const compteContrepartie = aUneDette ? "401" : "571";
    ecritures.push({
      id: `achat-reception-${commande.id}`,
      date: reception.date_creation.slice(0, 10),
      journal: "AC",
      libelle: `Réception ${commande.numero || commande.id}`,
      referenceType: "achats.CommandeAchat",
      referenceId: commande.id,
      lignes: [ligne("601", commande.total, 0), ligne(compteContrepartie, 0, commande.total)],
    });
  }

  // --- Paiements de dettes fournisseur ---
  const fournisseurs = await db.getAllFromIndex("fournisseurs", "boutique_id", boutiqueId);
  const fournisseursParId = new Map(fournisseurs.map((f) => [f.id, f]));
  for (const dette of toutesLesDettes.filter((d) => fournisseursParId.has(d.fournisseur_id))) {
    const paiements = (await db.getAllFromIndex("paiements_dette_fournisseur", "dette_id", dette.id)).filter(
      (p) => !p.supprime,
    );
    for (const paiement of paiements) {
      const compteSource = paiement.mode === "especes" ? "571" : "55";
      ecritures.push({
        id: `paiement-dette-${paiement.id}`,
        date: paiement.date_creation.slice(0, 10),
        journal: "AC",
        libelle: `Paiement dette ${fournisseursParId.get(dette.fournisseur_id)?.nom ?? ""}`,
        referenceType: "fournisseurs.PaiementDetteFournisseur",
        referenceId: paiement.id,
        lignes: [ligne("401", paiement.montant, 0), ligne(compteSource, 0, paiement.montant)],
      });
    }
  }

  // --- Règlements de crédit client ---
  const clients = await db.getAllFromIndex("clients", "boutique_id", boutiqueId);
  const clientsParId = new Map(clients.map((c) => [c.id, c]));
  const credits = (await db.getAll("credits")).filter((c) => clientsParId.has(c.client_id));
  for (const credit of credits) {
    const paiements = (await db.getAllFromIndex("paiements_credit", "credit_id", credit.id)).filter((p) => !p.supprime);
    for (const paiement of paiements) {
      const compteSource = paiement.mode === "especes" ? "571" : "55";
      ecritures.push({
        id: `paiement-credit-${paiement.id}`,
        date: paiement.date_creation.slice(0, 10),
        journal: "VE",
        libelle: `Règlement crédit ${clientsParId.get(credit.client_id)?.nom ?? ""}`,
        referenceType: "clients.PaiementCredit",
        referenceId: paiement.id,
        lignes: [ligne(compteSource, paiement.montant, 0), ligne("411", 0, paiement.montant)],
      });
    }
  }

  // --- Trésorerie : dépenses, transferts, apports/retraits/ajustements ---
  const depots = (await db.getAllFromIndex("depots", "boutique_id", boutiqueId)).filter((d) => !d.supprime);
  for (const depot of depots) {
    const depenses = (await db.getAllFromIndex("depenses", "depot_id", depot.id)).filter((d) => !d.supprime);
    for (const depense of depenses) {
      const compteCharge = CATEGORIE_DEPENSE_VERS_COMPTE[depense.categorie] ?? "658";
      ecritures.push({
        id: `depense-${depense.id}`,
        date: depense.date_creation.slice(0, 10),
        journal: "CA",
        libelle: libelleCategorieDepense(depense.categorie),
        referenceType: "tresorerie.Depense",
        referenceId: depense.id,
        lignes: [ligne(compteCharge, depense.montant, 0), ligne("571", 0, depense.montant)],
      });
    }

    const transferts = (await db.getAllFromIndex("transferts_caisse", "depot_id", depot.id)).filter(
      (t) => !t.supprime,
    );
    for (const transfert of transferts) {
      const compteMobileMoney = OPERATEUR_VERS_COMPTE[transfert.operateur] ?? "55";
      ecritures.push({
        id: `transfert-${transfert.id}`,
        date: transfert.date_creation.slice(0, 10),
        journal: "CA",
        libelle: `Transfert ${libelleOperateurMobileMoney(transfert.operateur)}`,
        referenceType: "tresorerie.Transfert",
        referenceId: transfert.id,
        lignes: [ligne("571", transfert.montant, 0), ligne(compteMobileMoney, 0, transfert.montant)],
      });
    }

    const mouvements = (await db.getAllFromIndex("mouvements_caisse", "depot_id", depot.id)).filter(
      (m) => !m.supprime && (m.categorie === "apport" || m.categorie === "retrait" || m.categorie === "ajustement"),
    );
    for (const mouvement of mouvements) {
      const libelleMvt = mouvement.motif || libelleCategorieMouvementCaisse(mouvement.categorie);
      let lignes: LigneEcritureLocale[];
      if (mouvement.categorie === "apport") {
        lignes = [ligne("571", mouvement.montant, 0), ligne("46", 0, mouvement.montant)];
      } else if (mouvement.categorie === "retrait") {
        lignes = [ligne("46", mouvement.montant, 0), ligne("571", 0, mouvement.montant)];
      } else {
        const montant = mouvement.montant;
        lignes =
          montant >= 0
            ? [ligne("571", montant, 0), ligne("758", 0, montant)]
            : [ligne("658", -montant, 0), ligne("571", 0, -montant)];
      }
      ecritures.push({
        id: `mouvement-${mouvement.id}`,
        date: mouvement.date_creation.slice(0, 10),
        journal: "CA",
        libelle: libelleMvt,
        referenceType: "tresorerie.MouvementCaisse",
        referenceId: mouvement.id,
        lignes,
      });
    }
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
