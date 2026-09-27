/**
 * Port navigateur de client-electron/electron/services/export.ts : export d'un
 * tableau de rapport en CSV, Excel (.xlsx) ou PDF.
 * - CSV : généré ici, avec un BOM UTF-8 pour qu'Excel lise bien les accents.
 * - Excel : exceljs, chargé seulement au premier export (pas dans le bundle
 *   de démarrage de la PWA).
 * - PDF : page d'impression du tableau ; le navigateur propose « Enregistrer
 *   en PDF » (évite d'embarquer une seconde bibliothèque lourde).
 */

export type FormatExport = "csv" | "xlsx" | "pdf";

export interface ColonneExport {
  cle: string;
  libelle: string;
}

function nomFichier(titre: string, extension: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${titre.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}-${date}.${extension}`;
}

function telecharger(contenu: Blob, nom: string): void {
  const url = URL.createObjectURL(contenu);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function echapperCsv(valeur: string): string {
  return /[",;\n]/.test(valeur) ? `"${valeur.replace(/"/g, '""')}"` : valeur;
}

function echapperHtml(valeur: string): string {
  return valeur.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function exporterTableau(
  titre: string,
  colonnes: ColonneExport[],
  lignes: Record<string, unknown>[],
  format: FormatExport,
): Promise<void> {
  const valeur = (ligne: Record<string, unknown>, cle: string) => String(ligne[cle] ?? "");

  if (format === "csv") {
    const texte = [
      colonnes.map((c) => echapperCsv(c.libelle)).join(";"),
      ...lignes.map((l) => colonnes.map((c) => echapperCsv(valeur(l, c.cle))).join(";")),
    ].join("\r\n");
    telecharger(new Blob(["﻿" + texte], { type: "text/csv;charset=utf-8" }), nomFichier(titre, "csv"));
    return;
  }

  if (format === "xlsx") {
    const { default: ExcelJS } = await import("exceljs");
    const classeur = new ExcelJS.Workbook();
    const feuille = classeur.addWorksheet(titre.slice(0, 31));
    feuille.columns = colonnes.map((c) => ({ header: c.libelle, key: c.cle, width: Math.max(12, c.libelle.length + 4) }));
    feuille.getRow(1).font = { bold: true };
    for (const l of lignes) feuille.addRow(Object.fromEntries(colonnes.map((c) => [c.cle, l[c.cle] ?? ""])));
    const tampon = await classeur.xlsx.writeBuffer();
    telecharger(
      new Blob([tampon], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      nomFichier(titre, "xlsx"),
    );
    return;
  }

  // PDF : on imprime un tableau simple dans une fenêtre dédiée.
  const fenetre = window.open("", "_blank");
  if (!fenetre) throw new Error("Autorisez les fenêtres pop-up pour exporter en PDF.");
  fenetre.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${echapperHtml(titre)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { font-size: 12px; color: #555; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
  th { background: #eee; }
</style></head><body>
<h1>${echapperHtml(titre)}</h1><p>Exporté le ${new Date().toLocaleString("fr-FR")}</p>
<table><thead><tr>${colonnes.map((c) => `<th>${echapperHtml(c.libelle)}</th>`).join("")}</tr></thead>
<tbody>${lignes.map((l) => `<tr>${colonnes.map((c) => `<td>${echapperHtml(valeur(l, c.cle))}</td>`).join("")}</tr>`).join("")}</tbody></table>
</body></html>`);
  fenetre.document.close();
  fenetre.focus();
  fenetre.print();
}
