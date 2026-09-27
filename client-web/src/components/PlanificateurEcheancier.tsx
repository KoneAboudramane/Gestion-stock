import { useState } from "react";

import ChampMontant from "./ChampMontant";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";

const RYTHMES_ECHEANCIER = [
  { valeur: "semaine", label: "Chaque semaine" },
  { valeur: "2semaines", label: "Toutes les 2 semaines" },
  { valeur: "mois", label: "Chaque mois" },
] as const;

function jourIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Dates des tranches à partir de la première, selon le rythme (fin de mois gérée). */
function datesTranches(premiere: string, nombre: number, rythme: string): string[] {
  const depart = new Date(`${premiere}T00:00:00`);
  return Array.from({ length: nombre }, (_, i) => {
    if (rythme === "mois") {
      const cible = new Date(depart.getFullYear(), depart.getMonth() + i, 1);
      const dernierJour = new Date(cible.getFullYear(), cible.getMonth() + 1, 0).getDate();
      cible.setDate(Math.min(depart.getDate(), dernierJour));
      return jourIso(cible);
    }
    const d = new Date(depart);
    d.setDate(d.getDate() + i * (rythme === "semaine" ? 7 : 14));
    return jourIso(d);
  });
}

/** Tranches égales ; la dernière absorbe l'arrondi. */
function montantsTranches(reste: number, nombre: number): number[] {
  let part = Math.ceil(reste / nombre);
  if (reste - part * (nombre - 1) <= 0) part = Math.floor(reste / nombre);
  return Array.from({ length: nombre }, (_, i) => (i < nombre - 1 ? part : reste - part * (nombre - 1)));
}

/** Préparation d'un échéancier : proposition automatique, puis chaque tranche corrigeable. */
export default function PlanificateurEcheancier({
  reste,
  dejaPlanifie,
  onAnnuler,
  onEnregistrer,
}: {
  reste: number;
  dejaPlanifie: boolean;
  onAnnuler: () => void;
  onEnregistrer: (tranches: { dateEcheance: string; montant: number }[]) => void;
}) {
  const devise = useDevise();
  const dansUnMois = new Date();
  dansUnMois.setMonth(dansUnMois.getMonth() + 1);
  const [nombre, setNombre] = useState("3");
  const [premiere, setPremiere] = useState(jourIso(dansUnMois));
  const [rythme, setRythme] = useState<string>("mois");
  const [tranches, setTranches] = useState<{ dateEcheance: string; montant: string }[]>([]);

  function proposer() {
    const n = Math.max(1, Math.min(60, Math.floor(Number(nombre) || 1)));
    const dates = datesTranches(premiere, n, rythme);
    const montants = montantsTranches(reste, n);
    setTranches(dates.map((d, i) => ({ dateEcheance: d, montant: String(montants[i]) })));
  }

  const total = tranches.reduce((t, x) => t + (Number(x.montant) || 0), 0);
  const ecart = Math.round((reste - total) * 100) / 100;
  const valide = tranches.length > 0 && ecart === 0 && tranches.every((t) => t.dateEcheance && Number(t.montant) > 0);

  return (
    <div className="planificateur-echeancier">
      <div className="barre-actions barre-filtres-historique">
        <label className="case-a-cocher">
          Nombre de tranches
          <input type="number" min={1} max={60} value={nombre} onChange={(e) => setNombre(e.target.value)} style={{ width: "70px" }} />
        </label>
        <label className="case-a-cocher">
          Première le
          <input type="date" value={premiere} onChange={(e) => setPremiere(e.target.value)} />
        </label>
        <select value={rythme} onChange={(e) => setRythme(e.target.value)}>
          {RYTHMES_ECHEANCIER.map((r) => (
            <option key={r.valeur} value={r.valeur}>
              {r.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={proposer} disabled={!premiere}>
          Proposer les tranches
        </button>
      </div>
      <p className="note-aide">
        À répartir : {formaterMontant(reste)} {devise} (le reste à payer).
        {dejaPlanifie && " Les tranches déjà payées sont gardées ; celles-ci remplacent les autres."}
      </p>
      {tranches.length > 0 && (
        <>
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Date</th>
                  <th>Montant</th>
                  <th className="colonne-actions-categorie" />
                </tr>
              </thead>
              <tbody>
                {tranches.map((t, i) => (
                  <tr key={i}>
                    <td data-label="N°">{i + 1}</td>
                    <td data-label="Date">
                      <input
                        type="date"
                        value={t.dateEcheance}
                        onChange={(e) => setTranches(tranches.map((x, j) => (j === i ? { ...x, dateEcheance: e.target.value } : x)))}
                      />
                    </td>
                    <td data-label="Montant">
                      <ChampMontant
                        value={t.montant}
                        onChange={(v) => setTranches(tranches.map((x, j) => (j === i ? { ...x, montant: v } : x)))}
                        style={{ width: "140px" }}
                      />
                    </td>
                    <td className="colonne-actions-categorie">
                      {tranches.length > 1 && (
                        <button
                          type="button"
                          className="lien-icone lien-icone-danger"
                          title="Retirer cette tranche"
                          onClick={() => setTranches(tranches.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="totaux">
            <div className={ecart === 0 ? undefined : "texte-erreur"}>
              Total : {formaterMontant(total)} {devise}
              {ecart !== 0 && ` · ${ecart > 0 ? "il manque" : "trop de"} ${formaterMontant(Math.abs(ecart))} ${devise}`}
            </div>
            <div className="actions-ligne">
              <button
                type="button"
                onClick={() =>
                  setTranches([...tranches, { dateEcheance: tranches[tranches.length - 1]?.dateEcheance ?? premiere, montant: String(Math.max(0, ecart)) }])
                }
              >
                + Tranche
              </button>
              <button type="button" onClick={onAnnuler}>
                Annuler
              </button>
              <button
                type="button"
                className="bouton-primaire"
                disabled={!valide}
                onClick={() => onEnregistrer(tranches.map((t) => ({ dateEcheance: t.dateEcheance, montant: Number(t.montant) })))}
              >
                Enregistrer l'échéancier
              </button>
            </div>
          </div>
        </>
      )}
      {tranches.length === 0 && (
        <div className="actions-ligne">
          <button type="button" onClick={onAnnuler}>
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}
