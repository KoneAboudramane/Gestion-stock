import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import { listerVariantesCatalogue } from "../../electron/services/catalogue";
import {
  ErreurStock,
  appliquerMouvement,
  annulerPerte,
  arreterDestockage,
  arreterOperationDestockage,
  declarerPerte,
  demarrerDestockage,
  demarrerOperationDestockage,
  listerDestockages,
  listerPertes,
  modifierDestockage,
} from "../../electron/services/stock";
import { annulerVente, creerVente } from "../../electron/services/ventes";
import { creerBaseDeTest } from "../setup";

describe("déstockage (miroir de stock/services.py)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
    const produitId = randomUUID();
    varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Chemise"]);
    executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
      varianteId,
      produitId,
      3000,
      5000,
    ]);
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 5 });
  });

  function vendre(quantite: number, montant: number) {
    return creerVente({
      boutiqueId,
      depotId,
      utilisateurId: "1",
      statut: "payee",
      lignes: [{ varianteId, quantite }],
      paiements: [{ mode: "especes", montant }],
    });
  }

  it("la caisse vend au prix de déstockage et affiche l'ancien prix", () => {
    demarrerDestockage({ varianteId, prixDestockage: 2500, utilisateurId: null });
    const article = listerVariantesCatalogue(boutiqueId, depotId).find((v) => v.id === varianteId)!;
    expect(article.prixVente).toBe(2500);
    expect(article.prixNormal).toBe(5000);
  });

  it("trace la vente sur le déstockage et calcule son bilan (vente à perte comprise)", () => {
    const destockageId = demarrerDestockage({ varianteId, prixDestockage: 2500, utilisateurId: null });
    const vente = vendre(2, 5000);

    const ligne = unResultat<{ prix_unitaire: number; prix_normal: number; destockage_id: string }>(
      "SELECT prix_unitaire, prix_normal, destockage_id FROM lignes_vente WHERE vente_id = ?",
      [vente.id],
    );
    expect(ligne).toMatchObject({ destockage_id: destockageId });
    expect(Number(ligne!.prix_unitaire)).toBe(2500);
    expect(Number(ligne!.prix_normal)).toBe(5000);

    const [bilan] = listerDestockages(boutiqueId);
    expect(bilan).toMatchObject({
      statut: "en_cours",
      quantiteVendue: 2,
      chiffreAffaires: 5000,
      marge: -1000, // 2 × (2500 − 3000)
      manqueAGagner: 5000, // 2 × (5000 − 2500)
      stockRestant: 3,
    });
  });

  it("une vente annulée ne compte plus dans le bilan", () => {
    demarrerDestockage({ varianteId, prixDestockage: 2500, utilisateurId: null });
    const vente = vendre(1, 2500);
    annulerVente(vente.id, "1");
    expect(listerDestockages(boutiqueId)[0].quantiteVendue).toBe(0);
  });

  it("se termine tout seul quand le stock est épuisé (vente ou perte)", () => {
    demarrerDestockage({ varianteId, prixDestockage: 2500, utilisateurId: null });
    vendre(4, 10000);
    expect(listerDestockages(boutiqueId)[0].statut).toBe("en_cours");
    declarerPerte({ varianteId, depotId, quantite: 1, motif: "abime", utilisateurId: null });
    expect(listerDestockages(boutiqueId)[0]).toMatchObject({ statut: "termine", motifFin: "epuise" });
    expect(listerVariantesCatalogue(boutiqueId, depotId).find((v) => v.id === varianteId)!.prixNormal).toBeNull();
  });

  it("arrêt manuel : retour au prix normal", () => {
    const id = demarrerDestockage({ varianteId, prixDestockage: 2500, utilisateurId: null });
    arreterDestockage(id);
    expect(listerDestockages(boutiqueId)[0]).toMatchObject({ statut: "termine", motifFin: "manuel" });
    expect(listerVariantesCatalogue(boutiqueId, depotId).find((v) => v.id === varianteId)!.prixVente).toBe(5000);
  });

  it("une date de fin passée termine le déstockage", () => {
    const id = demarrerDestockage({ varianteId, prixDestockage: 2500, utilisateurId: null });
    executer("UPDATE destockages SET date_fin = '2000-01-01' WHERE id = ?", [id]);
    expect(listerDestockages(boutiqueId)[0]).toMatchObject({ statut: "termine", motifFin: "date" });
    expect(listerVariantesCatalogue(boutiqueId, depotId).find((v) => v.id === varianteId)!.prixVente).toBe(5000);
  });

  it("refuse un prix ≥ prix normal, une date passée et un double déstockage", () => {
    expect(() => demarrerDestockage({ varianteId, prixDestockage: 5000, utilisateurId: null })).toThrow(ErreurStock);
    expect(() =>
      demarrerDestockage({ varianteId, prixDestockage: 2500, dateFin: "2000-01-01", utilisateurId: null }),
    ).toThrow(ErreurStock);
    demarrerDestockage({ varianteId, prixDestockage: 2500, utilisateurId: null });
    expect(() => demarrerDestockage({ varianteId, prixDestockage: 2000, utilisateurId: null })).toThrow(ErreurStock);
  });

  describe("opérations de déstockage (plusieurs articles)", () => {
    let pantalonId: string;

    beforeEach(() => {
      const produitId = randomUUID();
      pantalonId = randomUUID();
      executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Pantalon"]);
      executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
        pantalonId,
        produitId,
        4000,
        8000,
      ]);
      appliquerMouvement({ varianteId: pantalonId, depotId, type: "entree", quantite: 3 });
    });

    it("crée un déstockage par article, rattaché à l'opération", () => {
      demarrerOperationDestockage({
        boutiqueId,
        nom: "Fin de saison",
        lignes: [
          { varianteId, prixDestockage: 3500 },
          { varianteId: pantalonId, prixDestockage: 6000 },
        ],
        utilisateurId: null,
      });
      const destockages = listerDestockages(boutiqueId);
      expect(destockages).toHaveLength(2);
      expect(new Set(destockages.map((d) => d.operationNom))).toEqual(new Set(["Fin de saison"]));
      expect(listerVariantesCatalogue(boutiqueId, depotId).find((v) => v.id === pantalonId)!.prixVente).toBe(6000);
    });

    it("tout ou rien : un article refusé annule toute l'opération", () => {
      expect(() =>
        demarrerOperationDestockage({
          boutiqueId,
          nom: "Fin de saison",
          lignes: [
            { varianteId, prixDestockage: 3500 },
            { varianteId: pantalonId, prixDestockage: 9000 },
          ],
          utilisateurId: null,
        }),
      ).toThrow(/Pantalon/);
      expect(listerDestockages(boutiqueId)).toHaveLength(0);
      expect(unResultat<{ n: number }>("SELECT COUNT(*) as n FROM operations_destockage")!.n).toBe(0);
    });

    it("arrêter l'opération arrête tous ses articles", () => {
      const operationId = demarrerOperationDestockage({
        boutiqueId,
        nom: "Fin de saison",
        lignes: [
          { varianteId, prixDestockage: 3500 },
          { varianteId: pantalonId, prixDestockage: 6000 },
        ],
        utilisateurId: null,
      });
      arreterOperationDestockage(operationId);
      expect(listerDestockages(boutiqueId).every((d) => d.statut === "termine" && d.motifFin === "manuel")).toBe(true);
      expect(() => arreterOperationDestockage(operationId)).toThrow(ErreurStock);
    });
  });

  it("modifier un déstockage en cours : nouveau prix en caisse, ventes passées inchangées", () => {
    const id = demarrerDestockage({ varianteId, prixDestockage: 2500, utilisateurId: null });
    vendre(1, 2500);
    modifierDestockage(id, { prixDestockage: 2000, dateFin: "2999-12-31" });
    expect(listerVariantesCatalogue(boutiqueId, depotId).find((v) => v.id === varianteId)!.prixVente).toBe(2000);
    const [bilan] = listerDestockages(boutiqueId);
    expect(bilan).toMatchObject({ prixDestockage: 2000, dateFin: "2999-12-31", quantiteVendue: 1, chiffreAffaires: 2500 });
    expect(() => modifierDestockage(id, { prixDestockage: 6000 })).toThrow(ErreurStock);
    arreterDestockage(id);
    expect(() => modifierDestockage(id, { prixDestockage: 1500 })).toThrow(ErreurStock);
  });

  it("annuler une perte remet le stock et la garde visible, marquée annulée", () => {
    const perteId = declarerPerte({ varianteId, depotId, quantite: 2, motif: "abime", utilisateurId: null });
    annulerPerte(perteId, null);
    const stock = unResultat<{ quantite: number }>("SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?", [
      varianteId,
      depotId,
    ]);
    expect(Number(stock!.quantite)).toBe(5);
    expect(listerPertes(boutiqueId)[0].annulee).toBe(true);
    expect(() => annulerPerte(perteId, null)).toThrow(ErreurStock);
  });
});
