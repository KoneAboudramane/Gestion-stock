import type { PeriodeHistorique } from "../lib/periode";

/** Sélecteur de période des historiques (dates personnalisées au besoin). */
export default function FiltrePeriodeHistorique({
  periode,
  setPeriode,
  debutPerso,
  setDebutPerso,
  finPerso,
  setFinPerso,
}: {
  periode: PeriodeHistorique;
  setPeriode: (p: PeriodeHistorique) => void;
  debutPerso: string;
  setDebutPerso: (v: string) => void;
  finPerso: string;
  setFinPerso: (v: string) => void;
}) {
  return (
    <>
      <select value={periode} onChange={(e) => setPeriode(e.target.value as PeriodeHistorique)}>
        <option value="tout">Toutes les dates</option>
        <option value="7j">7 derniers jours</option>
        <option value="30j">30 derniers jours</option>
        <option value="mois">Ce mois</option>
        <option value="mois_dernier">Mois dernier</option>
        <option value="annee">Cette année</option>
        <option value="personnalisee">Période personnalisée</option>
      </select>
      {periode === "personnalisee" && (
        <>
          <input type="date" value={debutPerso} onChange={(e) => setDebutPerso(e.target.value)} />
          <input type="date" value={finPerso} onChange={(e) => setFinPerso(e.target.value)} />
        </>
      )}
    </>
  );
}
