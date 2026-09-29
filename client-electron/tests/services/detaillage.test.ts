import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import { listerVariantesCatalogue } from "../../electron/services/catalogue";
import { creerArticleDetail, definirArticleDetail, infoDetailVariante } from "../../electron/services/produits";
import {
  ErreurStock,
  annulerDetaillage,
  appliquerMouvement,
  detaillerOuRegrouper,
  listerArticlesDetaillables,
  listerDetaillages,
  listerStock,
} from "../../electron/services/stock";
import { creerBaseDeTest } from "../setup";

const BOUTIQUE_ID = "b1";

function creerArticle(nom: string, prixAchat: number, prixVente: number): string {
  const produitId = randomUUID();
  const varianteId = randomUUID();
  executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, BOUTIQUE_ID, nom]);
  executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
    varianteId,
    produitId,
    prixAchat,
    prixVente,
  ]);
  return varianteId;
}

function stock(varianteId: string, depotId: string): number {
  return Number(
    unResultat<{ quantite: number }>("SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?", [varianteId, depotId])
      ?.quantite ?? 0,
  );
}

function prixAchat(varianteId: string): number {
  return Number(unResultat<{ prix_achat: number }>("SELECT prix_achat FROM variantes WHERE id = ?", [varianteId])!.prix_achat);
}

describe("détailler / regrouper (carton ↔ paquets)", () => {
  const depotId = "d1";
  let carton: string;
  let paquet: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, BOUTIQUE_ID, "Magasin"]);
    carton = creerArticle("Biscuit carton", 9600, 12000);
    paquet = creerArticle("Biscuit paquet", 0, 600);
    definirArticleDetail(carton, paquet, 24);
    appliquerMouvement({ varianteId: carton, depotId, type: "entree", quantite: 5 });
  });

  it("détaille : sort les cartons, entre les paquets au bon coût", () => {
    detaillerOuRegrouper({ varianteGrosId: carton, depotId, nombre: 2, type: "detailler", utilisateurId: null });
    expect(stock(carton, depotId)).toBe(3);
    expect(stock(paquet, depotId)).toBe(48);
    expect(prixAchat(paquet)).toBe(400);
    const operations = listerDetaillages(BOUTIQUE_ID);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ type: "detailler", quantiteSource: 2, quantiteCible: 48, annulee: false });
  });

  it("regroupe des paquets en un carton, au coût des paquets", () => {
    detaillerOuRegrouper({ varianteGrosId: carton, depotId, nombre: 1, type: "detailler", utilisateurId: null });
    detaillerOuRegrouper({ varianteGrosId: carton, depotId, nombre: 1, type: "regrouper", utilisateurId: null });
    expect(stock(carton, depotId)).toBe(5);
    expect(stock(paquet, depotId)).toBe(0);
    expect(prixAchat(carton)).toBe(9600);
  });

  it("refuse sans assez de stock, un nombre non entier, ou un prix de détail sous le coût", () => {
    expect(() =>
      detaillerOuRegrouper({ varianteGrosId: carton, depotId, nombre: 1, type: "regrouper", utilisateurId: null }),
    ).toThrow(ErreurStock);
    expect(() =>
      detaillerOuRegrouper({ varianteGrosId: carton, depotId, nombre: 1.5, type: "detailler", utilisateurId: null }),
    ).toThrow(ErreurStock);
    executer("UPDATE variantes SET prix_vente = 300 WHERE id = ?", [paquet]);
    expect(() =>
      detaillerOuRegrouper({ varianteGrosId: carton, depotId, nombre: 1, type: "detailler", utilisateurId: null }),
    ).toThrow(/inférieur à son coût/);
  });

  it("annule tant que les paquets sont en stock, puis refuse une fois vendus", () => {
    const premier = detaillerOuRegrouper({ varianteGrosId: carton, depotId, nombre: 1, type: "detailler", utilisateurId: null });
    annulerDetaillage(premier, null);
    expect(stock(carton, depotId)).toBe(5);
    expect(stock(paquet, depotId)).toBe(0);
    expect(prixAchat(carton)).toBe(9600);
    expect(() => annulerDetaillage(premier, null)).toThrow(/déjà annulée/);

    const second = detaillerOuRegrouper({ varianteGrosId: carton, depotId, nombre: 1, type: "detailler", utilisateurId: null });
    appliquerMouvement({ varianteId: paquet, depotId, type: "sortie", quantite: 1 });
    expect(() => annulerDetaillage(second, null)).toThrow(/plus tous en stock/);
  });

  it("caisse : le détail jamais stocké reste visible tant que son carton est en stock", () => {
    executer("UPDATE produits SET actif = 1");
    const ids = listerVariantesCatalogue(BOUTIQUE_ID, depotId).map((v) => v.id);
    expect(ids).toContain(carton);
    expect(ids).toContain(paquet);
    expect(listerVariantesCatalogue(BOUTIQUE_ID, depotId).find((v) => v.id === paquet)?.quantiteDisponible).toBe(0);
  });

  it("stock : le carton montre son équivalent en paquets, le paquet ce qu'il reste à détailler", () => {
    executer("UPDATE produits SET boutique_id = ?", [BOUTIQUE_ID]);
    detaillerOuRegrouper({ varianteGrosId: carton, depotId, nombre: 1, type: "detailler", utilisateurId: null });
    const lignes = listerStock(BOUTIQUE_ID, depotId);
    expect(lignes.find((l) => l.varianteId === carton)).toMatchObject({ detailNom: "Biscuit paquet", quantiteDetail: 24 });
    expect(lignes.find((l) => l.varianteId === paquet)).toMatchObject({ grosNom: "Biscuit carton", grosStock: 4 });
  });

  it("unités : le carton et le paquet donnent leur unité (carton, paquet) partout", () => {
    executer("INSERT INTO unites (id, boutique_id, nom) VALUES ('u-carton', ?, 'Carton'), ('u-paquet', ?, 'Paquet')", [
      BOUTIQUE_ID,
      BOUTIQUE_ID,
    ]);
    executer("UPDATE produits SET unite_id = 'u-carton' WHERE id = (SELECT produit_id FROM variantes WHERE id = ?)", [carton]);
    const sac = creerArticle("Sucre sac", 20000, 25000);
    const kilo = creerArticleDetail({ varianteGrosId: sac, nom: "Sucre au kilo", prixVente: 600, quantite: 50, uniteId: "u-paquet" });
    expect(infoDetailVariante(sac).detail).toMatchObject({ varianteId: kilo, unite: "Paquet" });
    expect(infoDetailVariante(carton).uniteArticle).toBe("Carton");
    const article = listerArticlesDetaillables(BOUTIQUE_ID, depotId).find((a) => a.varianteGrosId === carton);
    expect(article).toMatchObject({ uniteGros: "Carton", prixAchatGros: 9600, prixVenteDetail: 600 });
  });

  it("lien de détail : info dans les deux sens, pas de boucle, création sur place", () => {
    expect(infoDetailVariante(carton).detail).toMatchObject({ varianteId: paquet, quantite: 24 });
    expect(infoDetailVariante(paquet).gros).toMatchObject({ varianteId: carton, quantite: 24 });
    expect(() => definirArticleDetail(paquet, carton, 24)).toThrow(/boucle/);
    expect(() => definirArticleDetail(carton, carton, 24)).toThrow();

    const sac = creerArticle("Riz sac 50 kg", 25000, 30000);
    const kilo = creerArticleDetail({ varianteGrosId: sac, nom: "Riz au kilo", prixVente: 700, quantite: 50 });
    expect(infoDetailVariante(sac).detail).toMatchObject({ varianteId: kilo, nom: "Riz au kilo", quantite: 50 });
    expect(prixAchat(kilo)).toBe(500);
  });
});
