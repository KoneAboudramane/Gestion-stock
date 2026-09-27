/**
 * Échéancier de remboursement (dettes fournisseur, crédits clients) : calcul
 * du statut des tranches. Les paiements restent libres et couvrent les
 * tranches dans l'ordre des dates ; le statut est calculé, jamais stocké.
 */

export type StatutEcheance = "payee" | "partielle" | "a_venir" | "en_retard";

/** Tranche d'un échéancier, avec ce que les paiements en couvrent déjà. */
export interface EcheanceDetail {
  id: string;
  dateEcheance: string;
  montant: number;
  couvert: number;
  statut: StatutEcheance;
}

function jourDuJour(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Les tranches couvrent la fin de la dette : ce qui a été payé au-delà de
 * (montant − total des tranches) leur revient, dans l'ordre des dates.
 */
export function calculerEcheances(
  dette: { montant: number; montantPaye: number },
  tranches: { id: string; dateEcheance: string; montant: number }[],
): EcheanceDetail[] {
  const triees = [...tranches].sort((a, b) => a.dateEcheance.localeCompare(b.dateEcheance));
  const total = triees.reduce((t, e) => t + e.montant, 0);
  let disponible = Math.max(0, dette.montantPaye - (dette.montant - total));
  const aujourdhui = jourDuJour();
  return triees.map((e) => {
    const couvert = Math.min(e.montant, disponible);
    disponible -= couvert;
    const statut: StatutEcheance =
      couvert >= e.montant - 0.001
        ? "payee"
        : e.dateEcheance < aujourdhui
          ? "en_retard"
          : couvert > 0
            ? "partielle"
            : "a_venir";
    return { ...e, couvert, statut };
  });
}

/** Message d'erreur si les tranches ne sont pas valables pour ce reste dû, sinon null. */
export function erreurTranches(tranches: { dateEcheance: string; montant: number }[], reste: number): string | null {
  if (tranches.length === 0) return "Ajoutez au moins une tranche.";
  if (tranches.some((t) => !/^\d{4}-\d{2}-\d{2}$/.test(t.dateEcheance))) return "Chaque tranche doit avoir une date.";
  if (tranches.some((t) => !(t.montant > 0))) return "Chaque tranche doit avoir un montant positif.";
  const total = tranches.reduce((t, e) => t + e.montant, 0);
  if (Math.abs(total - reste) > 0.5) {
    return `Le total des tranches (${total}) doit être égal au reste à payer (${reste}).`;
  }
  return null;
}
