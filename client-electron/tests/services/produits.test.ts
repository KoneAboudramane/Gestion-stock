import { beforeEach, describe, expect, it } from "vitest";

import { executer, tousLesResultats, unResultat } from "../../electron/db/helpers";
import {
  creerAttribut,
  creerCategorie,
  creerProduit,
  creerUnite,
  creerValeurAttribut,
  creerVariante,
  listerAttributs,
  listerCategories,
  listerUnites,
  modifierAttribut,
  modifierCategorie,
  modifierProduit,
  modifierUnite,
  modifierVariante,
  obtenirProduit,
  supprimerAttribut,
  supprimerCategorie,
  supprimerUnite,
} from "../../electron/services/produits";
import { creerBaseDeTest } from "../setup";

const BOUTIQUE_ID = "b1";

beforeEach(async () => {
  await creerBaseDeTest();
});

describe("creerProduit (règle CLAUDE.md #5 : une variante par défaut)", () => {
  it("crée le produit et sa variante par défaut avec les prix fournis", () => {
    const { produitId, varianteId } = creerProduit({
      boutiqueId: BOUTIQUE_ID,
      nom: "Savon",
      prixAchat: 200,
      prixVente: 350,
      seuilAlerte: 5,
    });

    const produit = obtenirProduit(produitId)!;
    expect(produit.nom).toBe("Savon");
    expect(produit.variantes).toHaveLength(1);
    expect(produit.variantes[0].id).toBe(varianteId);
    expect(produit.variantes[0].prixVente).toBe(350);
    expect(produit.variantes[0].prixAchat).toBe(200);
  });

  it("marque le produit et sa variante comme non synchronisés", () => {
    const { produitId, varianteId } = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Riz" });

    const produit = unResultat<{ synchronise: number }>("SELECT synchronise FROM produits WHERE id = ?", [
      produitId,
    ]);
    const variante = unResultat<{ synchronise: number }>("SELECT synchronise FROM variantes WHERE id = ?", [
      varianteId,
    ]);
    expect(Number(produit!.synchronise)).toBe(0);
    expect(Number(variante!.synchronise)).toBe(0);
  });
});

describe("modifierProduit", () => {
  it("marque synchronise=0 après une modification", () => {
    const { produitId } = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Huile" });
    // Simule un produit déjà synchronisé avant la modification.
    executer("UPDATE produits SET synchronise = 1 WHERE id = ?", [produitId]);

    modifierProduit(produitId, { nom: "Huile 1L" });

    const produit = unResultat<{ nom: string; synchronise: number }>(
      "SELECT nom, synchronise FROM produits WHERE id = ?",
      [produitId],
    );
    expect(produit!.nom).toBe("Huile 1L");
    expect(Number(produit!.synchronise)).toBe(0);
  });
});

describe("creerVariante avec attributs", () => {
  it("crée les lignes variante_valeurs correspondantes", () => {
    const { produitId } = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "T-shirt" });
    const attributId = creerAttribut(BOUTIQUE_ID, "Couleur");
    const valeurId = creerValeurAttribut(attributId, "Rouge");

    const varianteId = creerVariante({
      produitId,
      reference: "TS-ROUGE",
      prixVente: 5000,
      valeurAttributIds: [valeurId],
    });

    const produit = obtenirProduit(produitId)!;
    const variante = produit.variantes.find((v) => v.id === varianteId)!;
    expect(variante.valeurs).toEqual(["Couleur: Rouge"]);
  });
});

describe("modifierVariante", () => {
  it("remplace intégralement les valeurs d'attribut existantes", () => {
    const { produitId } = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "T-shirt" });
    const attributId = creerAttribut(BOUTIQUE_ID, "Couleur");
    const rouge = creerValeurAttribut(attributId, "Rouge");
    const bleu = creerValeurAttribut(attributId, "Bleu");

    const varianteId = creerVariante({ produitId, valeurAttributIds: [rouge] });
    modifierVariante(varianteId, { valeurAttributIds: [bleu] });

    const produit = obtenirProduit(produitId)!;
    const variante = produit.variantes.find((v) => v.id === varianteId)!;
    expect(variante.valeurs).toEqual(["Couleur: Bleu"]);

    // L'ancienne ligne est en soft delete, pas effacée (cohérent avec la synchro).
    const ancienne = tousLesResultats<{ supprime: number }>(
      "SELECT supprime FROM variante_valeurs WHERE variante_id = ? AND valeur_attribut_id = ?",
      [varianteId, rouge],
    )[0];
    expect(Number(ancienne.supprime)).toBe(1);
  });

  it("met à jour le prix et marque synchronise=0", () => {
    const { varianteId } = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Sucre", prixVente: 500 });
    executer("UPDATE variantes SET synchronise = 1 WHERE id = ?", [varianteId]);

    modifierVariante(varianteId, { prixVente: 600 });

    const variante = unResultat<{ prix_vente: number; synchronise: number }>(
      "SELECT prix_vente, synchronise FROM variantes WHERE id = ?",
      [varianteId],
    );
    expect(Number(variante!.prix_vente)).toBe(600);
    expect(Number(variante!.synchronise)).toBe(0);
  });
});

describe("modifierUnite / supprimerUnite", () => {
  it("modifie le nom et l'abréviation, et marque synchronise=0", () => {
    const uniteId = creerUnite(BOUTIQUE_ID, "Kilogramme", "kg");
    executer("UPDATE unites SET synchronise = 1 WHERE id = ?", [uniteId]);

    modifierUnite(uniteId, { nom: "Kilo", abreviation: "kilo" });

    const unite = unResultat<{ nom: string; abreviation: string; synchronise: number }>(
      "SELECT nom, abreviation, synchronise FROM unites WHERE id = ?",
      [uniteId],
    );
    expect(unite!.nom).toBe("Kilo");
    expect(unite!.abreviation).toBe("kilo");
    expect(Number(unite!.synchronise)).toBe(0);
  });

  it("supprimerUnite fait un soft delete (n'apparaît plus dans listerUnites)", () => {
    const uniteId = creerUnite(BOUTIQUE_ID, "Litre", "L");
    supprimerUnite(uniteId);

    expect(listerUnites(BOUTIQUE_ID).find((u) => u.id === uniteId)).toBeUndefined();
    const unite = unResultat<{ supprime: number }>("SELECT supprime FROM unites WHERE id = ?", [uniteId]);
    expect(Number(unite!.supprime)).toBe(1);
  });
});

describe("modifierAttribut / supprimerAttribut", () => {
  it("modifie le nom et marque synchronise=0", () => {
    const attributId = creerAttribut(BOUTIQUE_ID, "Couleur");
    executer("UPDATE attributs SET synchronise = 1 WHERE id = ?", [attributId]);

    modifierAttribut(attributId, "Coloris");

    const attribut = unResultat<{ nom: string; synchronise: number }>(
      "SELECT nom, synchronise FROM attributs WHERE id = ?",
      [attributId],
    );
    expect(attribut!.nom).toBe("Coloris");
    expect(Number(attribut!.synchronise)).toBe(0);
  });

  it("supprimerAttribut fait un soft delete (n'apparaît plus dans listerAttributs)", () => {
    const attributId = creerAttribut(BOUTIQUE_ID, "Taille");
    supprimerAttribut(attributId);

    expect(listerAttributs(BOUTIQUE_ID).find((a) => a.id === attributId)).toBeUndefined();
  });
});

describe("modifierCategorie / supprimerCategorie", () => {
  it("modifie le nom et marque synchronise=0", () => {
    const categorieId = creerCategorie(BOUTIQUE_ID, "Électricité");
    executer("UPDATE categories SET synchronise = 1 WHERE id = ?", [categorieId]);

    modifierCategorie(categorieId, "Électroménager");

    const categorie = unResultat<{ nom: string; synchronise: number }>(
      "SELECT nom, synchronise FROM categories WHERE id = ?",
      [categorieId],
    );
    expect(categorie!.nom).toBe("Électroménager");
    expect(Number(categorie!.synchronise)).toBe(0);
  });

  it("supprimerCategorie fait un soft delete (n'apparaît plus dans listerCategories)", () => {
    const categorieId = creerCategorie(BOUTIQUE_ID, "Quincaillerie");
    supprimerCategorie(categorieId);

    expect(listerCategories(BOUTIQUE_ID).find((c) => c.id === categorieId)).toBeUndefined();
  });
});
