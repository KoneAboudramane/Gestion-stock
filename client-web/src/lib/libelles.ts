const MODES_PAIEMENT: { valeur: string; label: string }[] = [
  { valeur: "especes", label: "Espèces" },
  { valeur: "mobile_money", label: "Mobile Money" },
  { valeur: "carte", label: "Carte" },
  { valeur: "credit", label: "Crédit" },
];

export function libelleModePaiement(mode: string): string {
  return MODES_PAIEMENT.find((m) => m.valeur === mode)?.label ?? mode;
}

export type OperateurMobileMoney = "orange_money" | "mtn_money" | "moov_money" | "wave";

export const OPERATEURS_MOBILE_MONEY: { valeur: OperateurMobileMoney; label: string }[] = [
  { valeur: "orange_money", label: "Orange Money" },
  { valeur: "mtn_money", label: "MTN Money" },
  { valeur: "moov_money", label: "Moov Money" },
  { valeur: "wave", label: "Wave" },
];

const LIBELLES_STATUT_VENTE: Record<string, string> = {
  payee: "Payée",
  credit: "Crédit",
  annulee: "Annulée",
};

/** Utilisé avec la classe CSS `badge-${statut}` (badge-payee/badge-credit/badge-annulee). */
export function libelleStatutVente(statut: string): string {
  return LIBELLES_STATUT_VENTE[statut] ?? statut;
}

const LIBELLES_CANAL_MESSAGE: Record<string, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  interne: "Interne",
};

export function libelleCanalMessage(canal: string): string {
  return LIBELLES_CANAL_MESSAGE[canal] ?? canal;
}
