import { ouvrirBaseDeDonnees } from "../db";
import { suiviSyncNeuf } from "../db/helpers";
import type { TransactionMobileMoneyLocale } from "../db/schema";

/**
 * Port navigateur de client-electron/electron/services/paiements.ts : aucune
 * clé d'API Wave/Orange Money/MTN disponible ici, donc simulation locale
 * identique côté client — toujours "réussie" avec une référence factice. À
 * remplacer par un vrai appel HTTP quand les clés existeront.
 */

export class ErreurPaiement extends Error {}

export type FournisseurMobileMoney = "wave" | "orange_money" | "mtn";
export type StatutTransaction = "en_attente" | "reussie" | "echouee";

const PREFIXES_REFERENCE: Record<FournisseurMobileMoney, string> = {
  wave: "MOCK-WAVE",
  orange_money: "MOCK-OM",
  mtn: "MOCK-MTN",
};

function simulerInitiation(
  fournisseur: FournisseurMobileMoney,
  numeroTelephone: string,
  montant: number,
): { statut: StatutTransaction; referenceExterne: string; donneesBrutes: Record<string, unknown> } {
  const reference = `${PREFIXES_REFERENCE[fournisseur]}-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
  return {
    statut: "reussie",
    referenceExterne: reference,
    donneesBrutes: { simule: true, numeroTelephone, montant, reference },
  };
}

export interface ParametresInitiationMobileMoney {
  paiementId: string;
  fournisseur: FournisseurMobileMoney;
  numeroTelephone: string;
  montant: number;
}

export async function initierPaiementMobileMoney(params: ParametresInitiationMobileMoney): Promise<string> {
  const { paiementId, fournisseur, numeroTelephone, montant } = params;
  const resultat = simulerInitiation(fournisseur, numeroTelephone, montant);
  const id = crypto.randomUUID();

  const transaction: TransactionMobileMoneyLocale = {
    id,
    paiement_id: paiementId,
    fournisseur,
    numero_telephone: numeroTelephone,
    reference_externe: resultat.referenceExterne,
    statut: resultat.statut,
    montant,
    donnees_brutes: JSON.stringify(resultat.donneesBrutes),
    ...suiviSyncNeuf(),
  };
  const db = await ouvrirBaseDeDonnees();
  await db.put("transactions_mobile_money", transaction);
  return id;
}

export interface TransactionResume {
  id: string;
  paiementId: string;
  fournisseur: FournisseurMobileMoney;
  numeroTelephone: string;
  referenceExterne: string;
  statut: StatutTransaction;
  montant: number;
}

export async function obtenirTransactionPourPaiement(paiementId: string): Promise<TransactionResume | undefined> {
  const db = await ouvrirBaseDeDonnees();
  const transactions = (await db.getAllFromIndex("transactions_mobile_money", "paiement_id", paiementId)).filter(
    (t) => !t.supprime,
  );
  const t = transactions[0];
  if (!t) return undefined;
  return {
    id: t.id,
    paiementId: t.paiement_id,
    fournisseur: t.fournisseur,
    numeroTelephone: t.numero_telephone,
    referenceExterne: t.reference_externe,
    statut: t.statut,
    montant: t.montant,
  };
}
