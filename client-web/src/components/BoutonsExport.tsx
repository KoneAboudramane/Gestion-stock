import { useState } from "react";

import { exporterTableau, type ColonneExport, type FormatExport } from "../lib/export";

/** Boutons d'export d'un rapport (CSV / Excel / PDF), port de BoutonsExport côté Electron. */
export default function BoutonsExport({
  titre,
  colonnes,
  lignes,
}: {
  titre: string;
  colonnes: ColonneExport[];
  lignes: Record<string, unknown>[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<FormatExport | null>(null);

  async function exporter(format: FormatExport) {
    setMessage(null);
    setEnCours(format);
    try {
      await exporterTableau(titre, colonnes, lignes, format);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Export impossible.");
    } finally {
      setEnCours(null);
    }
  }

  return (
    <div className="barre-export">
      <button type="button" onClick={() => exporter("csv")} disabled={enCours !== null || lignes.length === 0}>
        Export CSV
      </button>
      <button type="button" onClick={() => exporter("xlsx")} disabled={enCours !== null || lignes.length === 0}>
        {enCours === "xlsx" ? "Préparation…" : "Export Excel"}
      </button>
      <button type="button" onClick={() => exporter("pdf")} disabled={enCours !== null || lignes.length === 0}>
        Export PDF
      </button>
      {message && <span className="note-aide">{message}</span>}
    </div>
  );
}
