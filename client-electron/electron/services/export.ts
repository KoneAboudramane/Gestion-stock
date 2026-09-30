import fs from "node:fs";

import { dialog } from "electron";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

/**
 * Miroir de rapports/export.py::exporter_tableau : export générique d'un
 * tableau de rapport en CSV, Excel (.xlsx) ou PDF, réutilisé par tous les
 * onglets de Rapports.tsx.
 */

export type FormatExport = "csv" | "xlsx" | "pdf";

export interface ColonneExport {
  cle: string;
  libelle: string;
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

/**
 * Les polices standard du PDF (Helvetica) ne connaissent que l'alphabet
 * latin : on remplace les espaces spéciaux, le signe moins typographique, et
 * on retire les pictogrammes (emoji) qui s'afficheraient en caractères faux.
 */
function textePdf(valeur: string): string {
  return valeur
    .replace(/[   ]/g, " ")
    .replace(/[−–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\u0000-ÿŒœ€]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function dessinerTableauPdf(
  doc: PDFKit.PDFDocument,
  titre: string,
  colonnes: ColonneExport[],
  lignes: Record<string, unknown>[],
): void {
  const marge = 36;
  const largeurDisponible = doc.page.width - marge * 2;
  const bas = () => doc.page.height - marge - 18;
  const taille = colonnes.length > 8 ? 7.5 : 8.5;
  const padding = 4;
  const numeriques = colonnesNumeriques(colonnes, lignes);
  const entetes = colonnes.map((c) => textePdf(c.libelle));
  const cellules = lignes.map((l) => colonnes.map((c) => textePdf(texteCellule(l[c.cle]))));

  // Largeur des colonnes : proportionnelle au contenu (en-tête compris), bornée.
  doc.fontSize(taille).font("Helvetica");
  const besoins = colonnes.map((_, i) => {
    doc.font("Helvetica-Bold");
    let besoin = doc.widthOfString(entetes[i]);
    doc.font("Helvetica");
    for (const ligne of cellules.slice(0, 300)) besoin = Math.max(besoin, doc.widthOfString(ligne[i]));
    return Math.min(Math.max(besoin + padding * 2, 40), largeurDisponible * 0.3);
  });
  const total = besoins.reduce((t, b) => t + b, 0) || 1;
  const largeurs = besoins.map((b) => (b / total) * largeurDisponible);
  const positions = largeurs.map((_, i) => marge + largeurs.slice(0, i).reduce((t, l) => t + l, 0));

  const hauteurLigne = (valeurs: string[], gras: boolean) => {
    doc.fontSize(taille).font(gras ? "Helvetica-Bold" : "Helvetica");
    return Math.max(...valeurs.map((v, i) => doc.heightOfString(v || " ", { width: largeurs[i] - padding * 2 }))) + padding * 2;
  };

  function dessinerLigne(valeurs: string[], y: number, hauteur: number, genre: "entete" | "pair" | "impair"): void {
    if (genre === "entete") doc.rect(marge, y, largeurDisponible, hauteur).fill("#1F4E79");
    else if (genre === "impair") doc.rect(marge, y, largeurDisponible, hauteur).fill("#F2F6FA");
    doc.fontSize(taille).font(genre === "entete" ? "Helvetica-Bold" : "Helvetica").fillColor(genre === "entete" ? "white" : "#111111");
    valeurs.forEach((v, i) => {
      doc.text(v, positions[i] + padding, y + padding, {
        width: largeurs[i] - padding * 2,
        align: numeriques.has(colonnes[i].cle) ? "right" : "left",
      });
    });
    // Grille : chaque cellule a sa bordure.
    doc.lineWidth(0.5).strokeColor("#9FB3C8");
    valeurs.forEach((_, i) => doc.rect(positions[i], y, largeurs[i], hauteur).stroke());
  }

  // En-tête du document.
  doc.fillColor("#1F4E79").fontSize(15).font("Helvetica-Bold").text(textePdf(titre), marge, marge);
  doc
    .fillColor("#666666")
    .fontSize(8.5)
    .font("Helvetica")
    .text(`Exporté le ${textePdf(dateExport())} · ${lignes.length} ligne${lignes.length > 1 ? "s" : ""}`, marge, doc.y + 2);
  let y = doc.y + 10;

  const hauteurEntete = hauteurLigne(entetes, true);
  dessinerLigne(entetes, y, hauteurEntete, "entete");
  y += hauteurEntete;

  cellules.forEach((valeurs, index) => {
    const hauteur = hauteurLigne(valeurs, false);
    if (y + hauteur > bas()) {
      doc.addPage();
      y = marge;
      dessinerLigne(entetes, y, hauteurEntete, "entete"); // en-tête répété sur chaque page
      y += hauteurEntete;
    }
    dessinerLigne(valeurs, y, hauteur, index % 2 === 1 ? "impair" : "pair");
    y += hauteur;
  });
  if (lignes.length === 0) {
    doc.fillColor("#666666").fontSize(taille).font("Helvetica-Oblique").text("Aucune ligne.", marge, y + 6);
  }

  // Numéros de page.
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(pages.start + i);
    doc.page.margins.bottom = 0; // sinon écrire dans la marge du bas ouvrirait une page vide
    doc
      .fillColor("#888888")
      .fontSize(7.5)
      .font("Helvetica")
      .text(`Page ${i + 1} / ${pages.count}`, marge, doc.page.height - marge + 4, {
        width: largeurDisponible,
        align: "right",
        lineBreak: false,
      });
  }
}

function genererPdf(titre: string, colonnes: ColonneExport[], lignes: Record<string, unknown>[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Beaucoup de colonnes : page à l'italienne.
    const doc = new PDFDocument({
      size: "A4",
      layout: colonnes.length > 6 ? "landscape" : "portrait",
      margin: 36,
      bufferPages: true,
    });
    const morceaux: Buffer[] = [];
    doc.on("data", (morceau) => morceaux.push(morceau));
    doc.on("end", () => resolve(Buffer.concat(morceaux)));
    doc.on("error", reject);
    dessinerTableauPdf(doc, titre, colonnes, lignes);
    doc.end();
  });
}

/** Génération pure du contenu (aucun I/O) : testable directement en Vitest. */
export async function genererContenu(
  titre: string,
  colonnes: ColonneExport[],
  lignes: Record<string, unknown>[],
  format: FormatExport,
): Promise<Buffer> {
  if (format === "csv") {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(construireCsv(colonnes, lignes), "utf-8")]);
  }
  if (format === "xlsx") return Buffer.from(await construireClasseur(ExcelJS, titre, colonnes, lignes));
  return genererPdf(titre, colonnes, lignes);
}

function nomFichier(titre: string, extension: string): string {
  const slug = titre.toLowerCase().trim().replace(/\s+/g, "_");
  return `${slug}.${extension}`;
}

export type ResultatExport = { annule: true } | { annule: false; chemin: string };

/** Écrit un PDF déjà généré (ex. webContents.printToPDF) sur disque, via le même dialogue "Enregistrer sous". */
export async function exporterBufferPdf(
  buffer: Buffer,
  nomFichierDefaut: string,
  cheminForce?: string,
): Promise<ResultatExport> {
  let chemin = cheminForce;
  if (!chemin) {
    const resultat = await dialog.showSaveDialog({ defaultPath: nomFichierDefaut });
    if (resultat.canceled || !resultat.filePath) return { annule: true };
    chemin = resultat.filePath;
  }

  fs.writeFileSync(chemin, buffer);
  return { annule: false, chemin };
}

/**
 * `cheminForce` est réservé aux scripts de vérification/tests : il contourne
 * le dialogue natif "Enregistrer sous" (non pilotable par Playwright), même
 * esprit que `definirBaseDeDonneesPourLesTests`.
 */
export async function exporterTableau(
  titre: string,
  colonnes: ColonneExport[],
  lignes: Record<string, unknown>[],
  format: FormatExport,
  cheminForce?: string,
): Promise<ResultatExport> {
  const contenu = await genererContenu(titre, colonnes, lignes, format);

  let chemin = cheminForce;
  if (!chemin) {
    const resultat = await dialog.showSaveDialog({ defaultPath: nomFichier(titre, format) });
    if (resultat.canceled || !resultat.filePath) return { annule: true };
    chemin = resultat.filePath;
  }

  fs.writeFileSync(chemin, contenu);
  return { annule: false, chemin };
}
