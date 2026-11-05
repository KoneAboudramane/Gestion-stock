import { beforeEach, describe, expect, it } from "vitest";

import { executer, tousLesResultats, unResultat } from "../../electron/db/helpers";
import {
  attribuerReferencesManquantes,
  creerAttribut,
  creerCategorie,
  creerProduit,
  creerUnite,
  creerValeurAttribut,
  creerVariante,
  listerAttributs,
  listerArticlesCategorie,
  listerCategories,
  listerCategoriesDetail,
  listerProduits,
  listerUnites,
  modifierAttribut,
  modifierCategorie,
  modifierProduit,
  modifierUnite,
  modifierVariante,
  obtenirProduit,
  supprimerAttribut,
  supprimerCategorie,
  supprimerProduit,
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

describe("catégories : doublons, suppression protégée, articles d'une catégorie", () => {
  it("refuse un nom déjà pris (sans tenir compte des accents ni des majuscules) et trie à la française", () => {
    creerCategorie(BOUTIQUE_ID, "Électricité");
    creerCategorie(BOUTIQUE_ID, "Plomberie");
    expect(() => creerCategorie(BOUTIQUE_ID, "  electricite ")).toThrow(/existe déjà/);
    const id = creerCategorie(BOUTIQUE_ID, "Peinture");
    expect(() => modifierCategorie(id, "PLOMBERIE")).toThrow(/existe déjà/);
    modifierCategorie(id, "Peinture"); // son propre nom reste permis
    expect(listerCategories(BOUTIQUE_ID).map((c) => c.nom)).toEqual(["Électricité", "Peinture", "Plomberie"]);
  });

  it("compte les articles et refuse de supprimer une catégorie non vide sans dire où les déplacer", () => {
    const peinture = creerCategorie(BOUTIQUE_ID, "Peinture");
    const quincaillerie = creerCategorie(BOUTIQUE_ID, "Quincaillerie");
    const { produitId } = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Rouleau", categorieId: peinture, prixVente: 1500 });
    creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Pinceau", categorieId: peinture });

    expect(listerCategoriesDetail(BOUTIQUE_ID).find((c) => c.id === peinture)!.nombreArticles).toBe(2);
    expect(listerArticlesCategorie(peinture).map((a) => a.produitNom)).toEqual(["Pinceau", "Rouleau"]);

    expect(() => supprimerCategorie(peinture)).toThrow(/2 article\(s\)/);
    supprimerCategorie(peinture, quincaillerie);

    expect(listerCategories(BOUTIQUE_ID).map((c) => c.id)).toEqual([quincaillerie]);
    expect(obtenirProduit(produitId)!.categorieId).toBe(quincaillerie);
    expect(listerCategoriesDetail(BOUTIQUE_ID)[0].nombreArticles).toBe(2);
  });

  it("supprime une catégorie en laissant ses articles sans catégorie si on le choisit", () => {
    const peinture = creerCategorie(BOUTIQUE_ID, "Peinture");
    const { produitId } = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Rouleau", categorieId: peinture });
    supprimerCategorie(peinture, null);
    expect(obtenirProduit(produitId)!.categorieId).toBeNull();
  });
});

describe("noms et codes-barres d'articles uniques dans la boutique", () => {
  it("refuse un nom déjà pris, sans tenir compte des majuscules, accents et espaces", () => {
    creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Lait Nido carton" });
    expect(() => creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "  lait  nido CARTON " })).toThrow(/existe déjà/);
    creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Café" });
    expect(() => creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "cafe" })).toThrow(/existe déjà/);
  });

  it("accepte le nom d'un article supprimé", () => {
    const { produitId } = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Savon" });
    supprimerProduit(produitId);
    expect(() => creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Savon" })).not.toThrow();
  });

  it("refuse de renommer un article avec le nom d'un autre, mais laisse garder le sien", () => {
    creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Riz" });
    const { produitId } = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Sucre" });
    expect(() => modifierProduit(produitId, { nom: "RIZ" })).toThrow(/existe déjà/);
    expect(() => modifierProduit(produitId, { nom: "sucre" })).not.toThrow();
  });

  it("refuse un code-barres déjà utilisé, à la création comme à la modification", () => {
    creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Huile", codeBarres: "6111" });
    expect(() => creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Vinaigre", codeBarres: " 6111 " })).toThrow(
      /déjà utilisé par « Huile »/,
    );
    const { produitId, varianteId } = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Sel", codeBarres: "6222" });
    expect(() => modifierVariante(varianteId, { codeBarres: "6111" })).toThrow(/déjà utilisé/);
    expect(() => modifierVariante(varianteId, { codeBarres: "6222" })).not.toThrow();
    expect(() => creerVariante({ produitId, codeBarres: "6111" })).toThrow(/déjà utilisé/);
  });

  it("autorise plusieurs articles sans code-barres", () => {
    creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Article A" });
    expect(() => creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Article B" })).not.toThrow();
  });
});

describe("listerProduits", () => {
  it("affiche tous les articles de la boutique, sans limite de nombre", () => {
    for (let i = 1; i <= 250; i++) {
      creerProduit({ boutiqueId: BOUTIQUE_ID, nom: `Article ${String(i).padStart(3, "0")}` });
    }
    const liste = listerProduits(BOUTIQUE_ID);
    expect(liste).toHaveLength(250);
    expect(liste[249].nom).toBe("Article 250");
  });
});

describe("listerProduits — stock par dépôt (filtre « Dépôt » de la liste des articles)", () => {
  it("donne la quantité et la valeur par dépôt, ignore les dépôts supprimés", () => {
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES ('d1', ?, 'Magasin'), ('d2', ?, 'Entrepôt')", [
      BOUTIQUE_ID,
      BOUTIQUE_ID,
    ]);
    executer("INSERT INTO depots (id, boutique_id, nom, supprime) VALUES ('d3', ?, 'Ancien', 1)", [BOUTIQUE_ID]);
    const riz = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Riz", prixAchat: 100 });
    creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "Sucre" });
    executer(
      "INSERT INTO stocks (id, variante_id, depot_id, quantite) VALUES ('s1', ?, 'd1', 5), ('s2', ?, 'd2', 0), ('s3', ?, 'd3', 7)",
      [riz.varianteId, riz.varianteId, riz.varianteId],
    );

    const [produitRiz, produitSucre] = listerProduits(BOUTIQUE_ID);
    expect(produitRiz.stocksParDepot).toEqual({ d1: { quantite: 5, valeur: 500 }, d2: { quantite: 0, valeur: 0 } });
    expect(produitSucre.stocksParDepot).toEqual({});
  });
});

describe("attribuerReferencesManquantes (anciens articles créés avant la référence automatique)", () => {
  it("numérote à la suite, dans l'ordre de création, et les articles créés ensuite ne reprennent pas ces numéros", () => {
    const a = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "A" }); // REF-000001
    const b = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "B" }); // REF-000002
    const c = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "C" }); // REF-000003
    executer("UPDATE variantes SET reference = '', date_creation = '2026-07-01' WHERE id = ?", [b.varianteId]);
    executer("UPDATE variantes SET reference = NULL, date_creation = '2026-06-01' WHERE id = ?", [c.varianteId]);

    expect(attribuerReferencesManquantes(BOUTIQUE_ID)).toBe(2);
    const reference = (id: string) =>
      unResultat<{ reference: string }>("SELECT reference FROM variantes WHERE id = ?", [id])!.reference;
    expect(reference(a.varianteId)).toBe("REF-000001");
    expect(reference(c.varianteId)).toBe("REF-000004");
    expect(reference(b.varianteId)).toBe("REF-000005");

    const d = creerProduit({ boutiqueId: BOUTIQUE_ID, nom: "D" });
    expect(reference(d.varianteId)).toBe("REF-000006");
    expect(attribuerReferencesManquantes(BOUTIQUE_ID)).toBe(0);
  });
});
