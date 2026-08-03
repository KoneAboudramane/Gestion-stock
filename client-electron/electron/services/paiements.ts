import { randomUUID } from "node:crypto";

import { executer, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";

/**
 * Miroir de paiements/services.py + adaptateurs.py (Phase 2, squelette) :
 * aucune clé d'API Wave/Orange Money/MTN disponible ici, donc simulation
 * locale identique côté client — toujours "réussie" avec une référence
 * factice. À remplacer par un vrai appel HTTP quand les clés existeront.
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
  const reference = `${PREFIXES_REFERENCE[fournisseur]}-${randomUUID().slice(0, 10).toUpperCase()}`;
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

export function initierPaiementMobileMoney(params: ParametresInitiationMobileMoney): string {
  const { paiementId, fournisseur, numeroTelephone, montant } = params;
  const resultat = simulerInitiation(fournisseur, numeroTelephone, montant);
  const id = randomUUID();
  const maintenant = new Date().toISOString();

  executer(
    `INSERT INTO transactions_mobile_money
       (id, paiement_id, fournisseur, numero_telephone, reference_externe, statut, montant, donnees_brutes,
        date_creation, date_modification)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      paiementId,
      fournisseur,
      numeroTelephone,
      resultat.referenceExterne,
      resultat.statut,
      montant,
      JSON.stringify(resultat.donneesBrutes),
      maintenant,
      maintenant,
    ],
  );
  sauvegarder();
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

export function obtenirTransactionPourPaiement(paiementId: string): TransactionResume | undefined {
  return unResultat<TransactionResume>(
    `SELECT id, paiement_id as paiementId, fournisseur, numero_telephone as numeroTelephone,
            reference_externe as referenceExterne, statut, montant
     FROM transactions_mobile_money WHERE paiement_id = ? AND supprime = 0`,
    [paiementId],
  );
}
