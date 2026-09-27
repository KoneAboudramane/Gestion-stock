/** Libellés et styles des statuts d'échéance (dettes fournisseur, crédits clients). */
export const LIBELLES_STATUT_ECHEANCE: Record<string, { label: string; classe: string }> = {
  payee: { label: "✅ Payée", classe: "badge-payee" },
  partielle: { label: "🟡 Partielle", classe: "badge-commandee" },
  a_venir: { label: "⏳ À venir", classe: "badge-brouillon" },
  en_retard: { label: "🔴 En retard", classe: "badge-retard" },
};
