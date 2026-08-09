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

function echapperCsv(valeur: string): string {
  if (/[",\n]/.test(valeur)) return `"${valeur.replace(/"/g, '""')}"`;
  return valeur;
}

function genererCsv(colonnes: ColonneExport[], lignes: Record<string, unknown>[]): Buffer {
  const entete = colonnes.map((c) => echapperCsv(c.libelle)).join(",");
  const corps = lignes
    .map((ligne) => colonnes.map((c) => echapperCsv(String(ligne[c.cle] ?? ""))).join(","))
    .join("\r\n");
  const texte = entete + "\r\n" + corps + (lignes.length ? "\r\n" : "");
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  return Buffer.concat([bom, Buffer.from(texte, "utf-8")]);
}

async function genererXlsx(
  titre: string,
  colonnes: ColonneExport[],
  lignes: Record<string, unknown>[],
): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet(titre.slice(0, 31) || "Rapport");
  feuille.addRow(colonnes.map((c) => c.libelle));
  for (const ligne of lignes) {
    feuille.addRow(colonnes.map((c) => ligne[c.cle] ?? ""));
  }
  const buffer = await classeur.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function dessinerTableauPdf(
  doc: PDFKit.PDFDocument,
  titre: string,
  colonnes: ColonneExport[],
  lignes: Record<string, unknown>[],
): void {
  const margeGauche = 40;
  const largeurDisponible = doc.page.width - margeGauche * 2;
  const largeurColonne = largeurDisponible / colonnes.length;
  let y = 80;

  doc.fontSize(16).font("Helvetica-Bold").text(titre, margeGauche, 40);

  function ligneTableau(valeurs: string[], estEntete: boolean): void {
    const hauteur = 20;
    if (estEntete) {
      doc.rect(margeGauche, y, largeurDisponible, hauteur).fill("#1F4E79");
      doc.fillColor("white").font("Helvetica-Bold");
    } else {
      doc.fillColor("black").font("Helvetica");
    }
    valeurs.forEach((valeur, i) => {
      doc
        .fontSize(9)
        .text(valeur, margeGauche + i * largeurColonne + 4, y + 5, { width: largeurColonne - 8, ellipsis: true });
    });
    doc.rect(margeGauche, y, largeurDisponible, hauteur).stroke();
    y += hauteur;
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = 40;
    }
  }

  ligneTableau(
    colonnes.map((c) => c.libelle),
    true,
  );
  for (const ligne of lignes) {
    ligneTableau(
      colonnes.map((c) => String(ligne[c.cle] ?? "")),
      false,
    );
  }
}

function genererPdf(titre: string, colonnes: ColonneExport[], lignes: Record<string, unknown>[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
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
  if (format === "csv") return genererCsv(colonnes, lignes);
  if (format === "xlsx") return genererXlsx(titre, colonnes, lignes);
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
