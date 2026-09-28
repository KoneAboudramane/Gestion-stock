import { useState } from "react";

import { api } from "../api/client";
import type { ColonneExport, FormatExport } from "../api/client";

/** Boutons d'export d'un tableau (CSV / Excel / PDF) : Rapports, Historique des achats. */
export default function BoutonsExport({
  titre,
  colonnes,
  lignes,
  compact = false,
}: {
  titre: string;
  colonnes: ColonneExport[];
  lignes: Record<string, unknown>[];
  /** Libellés courts (CSV / Excel / PDF), pour une barre de filtres chargée. */
  compact?: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<FormatExport | null>(null);

  async function exporter(format: FormatExport) {
    setMessage(null);
    setEnCours(format);
    try {
      const resultat = await api.rapports.exporter(titre, colonnes, lignes, format);
      if (!resultat.succes) {
        setMessage(resultat.message);
      } else if (!resultat.resultat.annule) {
        setMessage(`Enregistré : ${resultat.resultat.chemin}`);
      }
    } finally {
      setEnCours(null);
    }
  }

  return (
    <div className="barre-export">
      <button type="button" onClick={() => exporter("csv")} disabled={enCours !== null}>
        {compact ? "CSV" : "Export CSV"}
      </button>
      <button type="button" onClick={() => exporter("xlsx")} disabled={enCours !== null}>
        {compact ? "Excel" : "Export Excel"}
      </button>
      <button type="button" onClick={() => exporter("pdf")} disabled={enCours !== null}>
        {compact ? "PDF" : "Export PDF"}
      </button>
      {message && <span className="note-aide">{message}</span>}
    </div>
  );
}
