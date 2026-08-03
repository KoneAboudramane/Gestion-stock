import type {
  CanalMessage,
  FournisseurMobileMoney,
  ModePaiement,
  StatutTransaction,
  StatutVenteHistorique,
  TypeMouvement,
} from "../api/client";

/**
 * Source unique des libellés français pour les valeurs d'enum affichées à
 * l'écran — évite qu'un même code ("mobile_money", "en_attente"...) soit
 * traduit différemment (ou pas du tout) selon l'écran.
 */

export const MODES_PAIEMENT: { valeur: ModePaiement; label: string }[] = [
  { valeur: "especes", label: "Espèces" },
  { valeur: "mobile_money", label: "Mobile Money" },
  { valeur: "carte", label: "Carte" },
  { valeur: "credit", label: "Crédit" },
];

export function libelleModePaiement(mode: string): string {
  return MODES_PAIEMENT.find((m) => m.valeur === mode)?.label ?? mode;
}

export const FOURNISSEURS_MOBILE_MONEY: { valeur: FournisseurMobileMoney; label: string }[] = [
  { valeur: "wave", label: "Wave" },
  { valeur: "orange_money", label: "Orange Money" },
  { valeur: "mtn", label: "MTN Mobile Money" },
];

export function libelleFournisseurMobileMoney(fournisseur: string): string {
  return FOURNISSEURS_MOBILE_MONEY.find((f) => f.valeur === fournisseur)?.label ?? fournisseur;
}

const LIBELLES_STATUT_TRANSACTION: Record<StatutTransaction, string> = {
  en_attente: "En attente",
  reussie: "Réussie",
  echouee: "Échouée",
};

export function libelleStatutTransactionMobileMoney(statut: string): string {
  return LIBELLES_STATUT_TRANSACTION[statut as StatutTransaction] ?? statut;
}

const LIBELLES_TYPE_MOUVEMENT: Record<TypeMouvement, string> = {
  entree: "Entrée",
  sortie: "Sortie",
  ajustement: "Ajustement",
};

export function libelleTypeMouvement(type: string): string {
  return LIBELLES_TYPE_MOUVEMENT[type as TypeMouvement] ?? type;
}

const LIBELLES_CANAL_NOTIFICATION: Record<CanalMessage, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  interne: "Interne",
};

export function libelleCanalMessage(canal: string): string {
  return LIBELLES_CANAL_NOTIFICATION[canal as CanalMessage] ?? canal;
}

const LIBELLES_STATUT_VENTE: Record<StatutVenteHistorique, string> = {
  payee: "Payée",
  credit: "Crédit",
  annulee: "Annulée",
};

/** Utilisé avec la classe CSS `badge-${statut}` (badge-payee/badge-credit/badge-annulee). */
export function libelleStatutVente(statut: string): string {
  return LIBELLES_STATUT_VENTE[statut as StatutVenteHistorique] ?? statut;
}
