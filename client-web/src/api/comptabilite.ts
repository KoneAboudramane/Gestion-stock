import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

/**
 * Livre comptable OFFICIEL : appelle directement l'API Django (voir
 * comptabilite/views.py + rapports.py côté serveur). Contrairement à
 * services/comptabilite.ts (aperçu local, non numéroté, recalculé depuis
 * IndexedDB pour le hors-ligne), ce module est la seule source à renvoyer de
 * vraies écritures numérotées (comptabilite.EcritureComptable) — nécessite
 * une connexion.
 */

async function obtenirJson<T>(chemin: string): Promise<T> {
  const reponse = await apiFetch(chemin);
  if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  return reponse.json();
}

export interface CompteComptableApi {
  id: string;
  numero: string;
  libelle: string;
  classe: number;
  compteParent: string | null;
  actif: boolean;
}

export function listerComptes(): Promise<ResultatEcriture<CompteComptableApi[]>> {
  return executerEnSecurite(async () => {
    const lignes = await obtenirJson<any[]>(`/comptabilite/comptes/`);
    return lignes.map((c) => ({
      id: c.id, numero: c.numero, libelle: c.libelle, classe: c.classe,
      compteParent: c.compte_parent, actif: c.actif,
    }));
  });
}

export interface LigneJournalApi {
  date: string;
  journal: string;
  numeroEcriture: number;
  libelleEcriture: string;
  compte: string;
  libelleCompte: string;
  libelleLigne: string;
  debit: number;
  credit: number;
}

export function journalOfficiel(
  dateDebut: string,
  dateFin: string,
  journalCode?: string,
): Promise<ResultatEcriture<LigneJournalApi[]>> {
  return executerEnSecurite(async () => {
    const params = new URLSearchParams({ date_debut: dateDebut, date_fin: dateFin });
    if (journalCode) params.set("journal", journalCode);
    const lignes = await obtenirJson<any[]>(`/comptabilite/journal/?${params}`);
    return lignes.map((l) => ({
      date: l.date, journal: l.journal, numeroEcriture: Number(l.numero_ecriture),
      libelleEcriture: l.libelle_ecriture, compte: l.compte, libelleCompte: l.libelle_compte,
      libelleLigne: l.libelle_ligne, debit: Number(l.debit), credit: Number(l.credit),
    }));
  });
}

export interface LigneGrandLivreApi {
  date: string;
  journal: string;
  numeroEcriture: number;
  libelle: string;
  debit: number;
  credit: number;
  soldeCumule: number;
}

export interface GrandLivreApi {
  compte: string;
  libelle: string;
  lignes: LigneGrandLivreApi[];
  soldeFinal: number;
}

export function grandLivreOfficiel(compte: string, dateDebut: string, dateFin: string): Promise<ResultatEcriture<GrandLivreApi>> {
  return executerEnSecurite(async () => {
    const params = new URLSearchParams({ compte, date_debut: dateDebut, date_fin: dateFin });
    const donnees = await obtenirJson<any>(`/comptabilite/grand-livre/?${params}`);
    return {
      compte: donnees.compte, libelle: donnees.libelle, soldeFinal: Number(donnees.solde_final),
      lignes: donnees.lignes.map((l: any) => ({
        date: l.date, journal: l.journal, numeroEcriture: Number(l.numero_ecriture),
        libelle: l.libelle, debit: Number(l.debit), credit: Number(l.credit), soldeCumule: Number(l.solde_cumule),
      })),
    };
  });
}

export interface LigneBalanceApi {
  compte: string;
  libelle: string;
  classe: number;
  totalDebit: number;
  totalCredit: number;
  soldeDebiteur: number;
  soldeCrediteur: number;
}

export interface BalanceApi {
  lignes: LigneBalanceApi[];
  totalDebit: number;
  totalCredit: number;
}

export function balanceOfficielle(dateDebut: string, dateFin: string): Promise<ResultatEcriture<BalanceApi>> {
  return executerEnSecurite(async () => {
    const params = new URLSearchParams({ date_debut: dateDebut, date_fin: dateFin });
    const donnees = await obtenirJson<any>(`/comptabilite/balance/?${params}`);
    return {
      totalDebit: Number(donnees.total_debit), totalCredit: Number(donnees.total_credit),
      lignes: donnees.lignes.map((l: any) => ({
        compte: l.compte, libelle: l.libelle, classe: l.classe,
        totalDebit: Number(l.total_debit), totalCredit: Number(l.total_credit),
        soldeDebiteur: Number(l.solde_debiteur), soldeCrediteur: Number(l.solde_crediteur),
      })),
    };
  });
}

export interface LigneResultatApi {
  compte: string;
  libelle: string;
  montant: number;
}

export interface CompteDeResultatApi {
  charges: LigneResultatApi[];
  produits: LigneResultatApi[];
  totalCharges: number;
  totalProduits: number;
  resultatNet: number;
}

export function compteDeResultatOfficiel(dateDebut: string, dateFin: string): Promise<ResultatEcriture<CompteDeResultatApi>> {
  return executerEnSecurite(async () => {
    const params = new URLSearchParams({ date_debut: dateDebut, date_fin: dateFin });
    const donnees = await obtenirJson<any>(`/comptabilite/compte-de-resultat/?${params}`);
    return {
      totalCharges: Number(donnees.total_charges), totalProduits: Number(donnees.total_produits),
      resultatNet: Number(donnees.resultat_net),
      charges: donnees.charges.map((l: any) => ({ compte: l.compte, libelle: l.libelle, montant: Number(l.montant) })),
      produits: donnees.produits.map((l: any) => ({ compte: l.compte, libelle: l.libelle, montant: Number(l.montant) })),
    };
  });
}

export interface BilanApi {
  date: string;
  actif: LigneResultatApi[];
  passif: LigneResultatApi[];
  totalActif: number;
  totalPassif: number;
}

export function bilanOfficiel(dateFin: string): Promise<ResultatEcriture<BilanApi>> {
  return executerEnSecurite(async () => {
    const params = new URLSearchParams({ date_debut: dateFin, date_fin: dateFin });
    const donnees = await obtenirJson<any>(`/comptabilite/bilan/?${params}`);
    return {
      date: donnees.date, totalActif: Number(donnees.total_actif), totalPassif: Number(donnees.total_passif),
      actif: donnees.actif.map((l: any) => ({ compte: l.compte, libelle: l.libelle, montant: Number(l.montant) })),
      passif: donnees.passif.map((l: any) => ({ compte: l.compte, libelle: l.libelle, montant: Number(l.montant) })),
    };
  });
}
