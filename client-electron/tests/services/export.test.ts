import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { genererContenu } from "../../electron/services/export";

const COLONNES = [
  { cle: "nom", libelle: "Nom" },
  { cle: "quantite", libelle: "Quantité" },
];
const LIGNES = [
  { nom: "Riz 25kg", quantite: 10 },
  { nom: "Café \"Excellence\"", quantite: 3 },
];

describe("export.genererContenu (miroir de rapports/export.py::exporter_tableau)", () => {
  it("génère un CSV avec BOM UTF-8, en-têtes et lignes, valeurs échappées", async () => {
    const buffer = await genererContenu("Rapport Test", COLONNES, LIGNES, "csv");
    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);

    const texte = buffer.subarray(3).toString("utf-8");
    const lignesTexte = texte.trim().split("\r\n");
    expect(lignesTexte[0]).toBe("Nom,Quantité");
    expect(lignesTexte[1]).toBe("Riz 25kg,10");
    expect(lignesTexte[2]).toBe('"Café ""Excellence""",3');
  });

  it("génère un classeur Excel lisible avec les bonnes valeurs", async () => {
    const buffer = await genererContenu("Rapport Test", COLONNES, LIGNES, "xlsx");
    expect(buffer.length).toBeGreaterThan(0);

    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(buffer as unknown as ArrayBuffer);
    const feuille = classeur.worksheets[0];
    expect(feuille.getRow(1).getCell(1).value).toBe("Nom");
    expect(feuille.getRow(1).getCell(2).value).toBe("Quantité");
    expect(feuille.getRow(2).getCell(1).value).toBe("Riz 25kg");
    expect(feuille.getRow(2).getCell(2).value).toBe(10);
  });

  it("génère un PDF valide (signature %PDF) et non vide", async () => {
    const buffer = await genererContenu("Rapport Test", COLONNES, LIGNES, "pdf");
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
