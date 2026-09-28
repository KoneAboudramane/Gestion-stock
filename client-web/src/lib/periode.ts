/** Périodes des historiques (Stock → Historique, Achats → Historique). */
export type PeriodeHistorique = "tout" | "7j" | "30j" | "mois" | "mois_dernier" | "annee" | "personnalisee";

export function jourLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Bornes [début, fin] en "AAAA-MM-JJ" (incluses), ou null pour « tout ». */
export function bornesPeriode(periode: PeriodeHistorique, debutPerso: string, finPerso: string): [string, string] | null {
  const aujourdhui = new Date();
  if (periode === "tout") return null;
  if (periode === "personnalisee") return [debutPerso || "0000-01-01", finPerso || "9999-12-31"];
  if (periode === "mois") {
    return [jourLocal(new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), 1)), jourLocal(aujourdhui)];
  }
  if (periode === "mois_dernier") {
    return [
      jourLocal(new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() - 1, 1)),
      jourLocal(new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), 0)),
    ];
  }
  if (periode === "annee") {
    return [jourLocal(new Date(aujourdhui.getFullYear(), 0, 1)), jourLocal(aujourdhui)];
  }
  const debut = new Date(aujourdhui);
  debut.setDate(debut.getDate() - (periode === "7j" ? 6 : 29));
  return [jourLocal(debut), jourLocal(aujourdhui)];
}

export function dansPeriode(dateIso: string, bornes: [string, string] | null): boolean {
  if (!bornes) return true;
  const jour = jourLocal(new Date(dateIso));
  return jour >= bornes[0] && jour <= bornes[1];
}
