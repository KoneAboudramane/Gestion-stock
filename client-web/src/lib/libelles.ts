import type { MotifPerte } from "../services/stock";

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

export function libelleOperateurMobileMoney(operateur: string): string {
  return OPERATEURS_MOBILE_MONEY.find((o) => o.valeur === operateur)?.label ?? operateur;
}

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

// Distinct de OperateurMobileMoney (ventes.Paiement.operateur, 4 choix) :
// paiements.TransactionMobileMoney.fournisseur n'en a que 3 (pas de Moov, "mtn" pas "mtn_money").
export type FournisseurMobileMoney = "wave" | "orange_money" | "mtn";

export const FOURNISSEURS_MOBILE_MONEY: { valeur: FournisseurMobileMoney; label: string }[] = [
  { valeur: "wave", label: "Wave" },
  { valeur: "orange_money", label: "Orange Money" },
  { valeur: "mtn", label: "MTN Mobile Money" },
];

export function libelleFournisseurMobileMoney(fournisseur: string): string {
  return FOURNISSEURS_MOBILE_MONEY.find((f) => f.valeur === fournisseur)?.label ?? fournisseur;
}

const LIBELLES_STATUT_TRANSACTION: Record<string, string> = {
  en_attente: "En attente",
  reussie: "Réussie",
  echouee: "Échouée",
};

export function libelleStatutTransactionMobileMoney(statut: string): string {
  return LIBELLES_STATUT_TRANSACTION[statut] ?? statut;
}

// --- Trésorerie ---

/**
 * Modes de règlement pour un règlement crédit ou un paiement dette
 * fournisseur : espèces + les 4 opérateurs mobile money. Valeurs codées
 * (comme côté Electron) : seul "especes" déclenche le mouvement de caisse
 * (rembourserCredit / payerDette), un libellé français ne matcherait rien.
 */
export const MODES_REGLEMENT: { valeur: string; label: string }[] = [
  { valeur: "especes", label: "Espèces" },
  ...OPERATEURS_MOBILE_MONEY,
];

export function libelleModeReglement(mode: string): string {
  return MODES_REGLEMENT.find((m) => m.valeur === mode)?.label ?? mode;
}

const LIBELLES_TYPE_MOUVEMENT_CAISSE: Record<string, string> = {
  entree: "Entrée",
  sortie: "Sortie",
  ajustement: "Ajustement",
};

export function libelleTypeMouvementCaisse(type: string): string {
  return LIBELLES_TYPE_MOUVEMENT_CAISSE[type] ?? type;
}

const LIBELLES_CATEGORIE_MOUVEMENT_CAISSE: Record<string, string> = {
  vente_especes: "Vente en espèces",
  remboursement_credit: "Règlement crédit",
  transfert_mobile_money: "Transfert mobile money",
  apport: "Mise de fonds",
  depense: "Dépense",
  retrait: "Retrait",
  paiement_dette_fournisseur: "Paiement dette fournisseur",
  paiement_fournisseur: "Paiement fournisseur (réception)",
  ajustement: "Ajustement",
};

export function libelleCategorieMouvementCaisse(categorie: string): string {
  return LIBELLES_CATEGORIE_MOUVEMENT_CAISSE[categorie] ?? categorie;
}

export const CATEGORIES_DEPENSE: { valeur: string; label: string }[] = [
  { valeur: "transport", label: "Transport" },
  { valeur: "reparation", label: "Réparation" },
  { valeur: "achat_marchandise", label: "Achat de marchandise" },
  { valeur: "achat_divers", label: "Achat divers" },
  { valeur: "remboursement_client", label: "Remboursement client" },
  { valeur: "autre", label: "Autre" },
];

export function libelleCategorieDepense(categorie: string): string {
  return CATEGORIES_DEPENSE.find((c) => c.valeur === categorie)?.label ?? categorie;
}

/** Motifs de perte de stock (stock.PerteStock.Motif côté Django). */
export const MOTIFS_PERTE: { valeur: MotifPerte; label: string }[] = [
  { valeur: "perime", label: "Périmé" },
  { valeur: "abime", label: "Abîmé / cassé" },
  { valeur: "vol", label: "Vol / disparu" },
  { valeur: "don", label: "Don" },
  { valeur: "consommation", label: "Consommation interne" },
  { valeur: "autre", label: "Autre" },
];

export function libelleMotifPerte(motif: string): string {
  return MOTIFS_PERTE.find((m) => m.valeur === motif)?.label ?? motif;
}

/** Statut affiché d'un déstockage (stock.Destockage) : "En cours" ou la raison de sa fin. */
export function libelleStatutDestockage(statut: string, motifFin: string): string {
  if (statut === "en_cours") return "En cours";
  if (motifFin === "epuise") return "Terminé (stock épuisé)";
  if (motifFin === "date") return "Terminé (date de fin)";
  if (motifFin === "manuel") return "Arrêté";
  return "Terminé";
}

/** Origine d'un mouvement de stock, déduite du document qui l'a créé. */
export type OrigineMouvement =
  | "vente"
  | "reception"
  | "retour"
  | "perte"
  | "transfert"
  | "detaillage"
  | "inventaire"
  | "manuel";

export const ORIGINES_MOUVEMENT: { valeur: OrigineMouvement; label: string }[] = [
  { valeur: "vente", label: "Vente" },
  { valeur: "reception", label: "Réception d'achat" },
  { valeur: "retour", label: "Retour fournisseur" },
  { valeur: "perte", label: "Perte" },
  { valeur: "transfert", label: "Transfert" },
  { valeur: "detaillage", label: "Déballage / remballage" },
  { valeur: "inventaire", label: "Inventaire" },
  { valeur: "manuel", label: "Saisie manuelle" },
];

export function origineMouvement(referenceType: string): OrigineMouvement {
  if (referenceType.startsWith("ventes.")) return "vente";
  if (referenceType.startsWith("achats.Reception")) return "reception";
  if (referenceType.startsWith("achats.RetourFournisseur")) return "retour";
  if (referenceType.startsWith("stock.PerteStock")) return "perte";
  if (referenceType.startsWith("stock.TransfertStock")) return "transfert";
  if (referenceType.startsWith("stock.Detaillage")) return "detaillage";
  if (referenceType.startsWith("stock.Inventaire")) return "inventaire";
  return "manuel";
}

export function libelleOrigineMouvement(referenceType: string): string {
  const origine = origineMouvement(referenceType);
  return ORIGINES_MOUVEMENT.find((o) => o.valeur === origine)?.label ?? "";
}
