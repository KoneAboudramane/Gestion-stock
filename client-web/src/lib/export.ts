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

function echapperHtml(valeur: string): string {
  return valeur.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Mise en forme commune (bureau et web) ---

const COULEUR_ENTETE = "1F4E79";
const COULEUR_ZEBRE = "F2F6FA";
const COULEUR_BORDURE = "9FB3C8";

/** Texte d'une cellule tel qu'affiché : nombres au format français (5 000). */
function texteCellule(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "";
  if (typeof valeur === "number") {
    return valeur.toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ");
  }
  return String(valeur);
}

/** Une colonne est « numérique » si toutes ses valeurs non vides sont des nombres (alignée à droite). */
function colonnesNumeriques(colonnes: ColonneExport[], lignes: Record<string, unknown>[]): Set<string> {
  const numeriques = new Set<string>();
  for (const c of colonnes) {
    const valeurs = lignes.map((l) => l[c.cle]).filter((v) => v !== "" && v !== null && v !== undefined);
    if (valeurs.length > 0 && valeurs.every((v) => typeof v === "number")) numeriques.add(c.cle);
  }
  return numeriques;
}

function dateExport(): string {
  return new Date().toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
}

/**
 * Classeur Excel mis en forme : titre, date d'export, en-tête coloré figé avec
 * filtres, bordures sur toutes les cellules, lignes alternées, nombres alignés
 * à droite au format « 5 000 », largeur des colonnes ajustée au contenu.
 */
async function construireClasseur(
  ExcelJS: { Workbook: new () => import("exceljs").Workbook },
  titre: string,
  colonnes: ColonneExport[],
  lignes: Record<string, unknown>[],
): Promise<ArrayBuffer> {
  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet((titre.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Export").trim());
  const numeriques = colonnesNumeriques(colonnes, lignes);
  const nb = Math.max(1, colonnes.length);
  const bordure = { style: "thin" as const, color: { argb: COULEUR_BORDURE } };
  const bordures = { top: bordure, left: bordure, bottom: bordure, right: bordure };

  // Titre et date, sur toute la largeur du tableau.
  feuille.mergeCells(1, 1, 1, nb);
  feuille.getCell(1, 1).value = titre;
  feuille.getCell(1, 1).font = { bold: true, size: 14, color: { argb: COULEUR_ENTETE } };
  feuille.getRow(1).height = 22;
  feuille.mergeCells(2, 1, 2, nb);
  feuille.getCell(2, 1).value = `Exporté le ${dateExport()} · ${lignes.length} ligne${lignes.length > 1 ? "s" : ""}`;
  feuille.getCell(2, 1).font = { italic: true, size: 9, color: { argb: "666666" } };

  const LIGNE_ENTETE = 4;
  const entete = feuille.getRow(LIGNE_ENTETE);
  colonnes.forEach((c, i) => {
    const cellule = entete.getCell(i + 1);
    cellule.value = c.libelle;
    cellule.font = { bold: true, color: { argb: "FFFFFF" } };
    cellule.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COULEUR_ENTETE } };
    cellule.alignment = { vertical: "middle", horizontal: numeriques.has(c.cle) ? "right" : "left", wrapText: true };
    cellule.border = bordures;
  });
  entete.height = 20;

  lignes.forEach((ligne, index) => {
    const rangee = feuille.getRow(LIGNE_ENTETE + 1 + index);
    colonnes.forEach((c, i) => {
      const cellule = rangee.getCell(i + 1);
      const valeur = ligne[c.cle];
      cellule.value = valeur === undefined || valeur === null ? "" : (valeur as string | number);
      cellule.border = bordures;
      cellule.alignment = { vertical: "top", horizontal: numeriques.has(c.cle) ? "right" : "left", wrapText: true };
      if (typeof valeur === "number") cellule.numFmt = Number.isInteger(valeur) ? "#,##0" : "#,##0.00";
      if (index % 2 === 1) cellule.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COULEUR_ZEBRE } };
    });
  });

  // Largeur : le plus long entre l'en-tête et les valeurs, bornée.
  colonnes.forEach((c, i) => {
    const longueurs = [c.libelle.length, ...lignes.map((l) => texteCellule(l[c.cle]).length)];
    feuille.getColumn(i + 1).width = Math.min(50, Math.max(10, Math.max(...longueurs) + 3));
  });
  feuille.views = [{ state: "frozen", ySplit: LIGNE_ENTETE }];
  if (colonnes.length) feuille.autoFilter = { from: { row: LIGNE_ENTETE, column: 1 }, to: { row: LIGNE_ENTETE, column: nb } };
  feuille.pageSetup = { orientation: colonnes.length > 6 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  return classeur.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** CSV lisible par Excel en français : séparateur « ; », BOM UTF-8, nombres sans espace. */
function construireCsv(colonnes: ColonneExport[], lignes: Record<string, unknown>[]): string {
  const echapper = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const valeur = (v: unknown) =>
    typeof v === "number" ? String(v).replace(".", ",") : v === null || v === undefined ? "" : String(v);
  return [
    colonnes.map((c) => echapper(c.libelle)).join(";"),
    ...lignes.map((l) => colonnes.map((c) => echapper(valeur(l[c.cle]))).join(";")),
  ].join("\r\n");
}

export async function exporterTableau(
  titre: string,
  colonnes: ColonneExport[],
  lignes: Record<string, unknown>[],
  format: FormatExport,
): Promise<void> {
  if (format === "csv") {
    telecharger(
      new Blob(["﻿" + construireCsv(colonnes, lignes)], { type: "text/csv;charset=utf-8" }),
      nomFichier(titre, "csv"),
    );
    return;
  }

  if (format === "xlsx") {
    const { default: ExcelJS } = await import("exceljs");
    const tampon = await construireClasseur(ExcelJS, titre, colonnes, lignes);
    telecharger(
      new Blob([tampon], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      nomFichier(titre, "xlsx"),
    );
    return;
  }

  // PDF : page d'impression du tableau mis en forme ; le navigateur propose « Enregistrer en PDF ».
  const numeriques = colonnesNumeriques(colonnes, lignes);
  const alignement = (cle: string) => (numeriques.has(cle) ? ' class="nombre"' : "");
  const fenetre = window.open("", "_blank");
  if (!fenetre) throw new Error("Autorisez les fenêtres pop-up pour exporter en PDF.");
  fenetre.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${echapperHtml(titre)}</title>
<style>
  @page { size: A4 ${colonnes.length > 6 ? "landscape" : "portrait"}; margin: 12mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; }
  h1 { font-size: 17px; margin: 0 0 2px; color: #1f4e79; }
  p { font-size: 11px; color: #666; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: ${colonnes.length > 8 ? 10 : 11}px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #9fb3c8; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #1f4e79; color: #fff; font-weight: bold; }
  tbody tr:nth-child(even) td { background: #f2f6fa; }
  .nombre { text-align: right; white-space: nowrap; }
</style></head><body>
<h1>${echapperHtml(titre)}</h1><p>Exporté le ${echapperHtml(dateExport())} · ${lignes.length} ligne${lignes.length > 1 ? "s" : ""}</p>
<table><thead><tr>${colonnes.map((c) => `<th${alignement(c.cle)}>${echapperHtml(c.libelle)}</th>`).join("")}</tr></thead>
<tbody>${lignes
    .map((l) => `<tr>${colonnes.map((c) => `<td${alignement(c.cle)}>${echapperHtml(texteCellule(l[c.cle]))}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>
</body></html>`);
  fenetre.document.close();
  fenetre.focus();
  fenetre.print();
}
