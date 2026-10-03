import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, tousLesResultats, unResultat } from "../../electron/db/helpers";
import { ErreurAchat, achatRapide } from "../../electron/services/achats";
import {
  CLE_PARAMETRE_FABRICATION_PROPRE,
  ErreurStock,
  appliquerMouvement,
  articlesSansStock,
  entreeDon,
  entreeFabrication,
  entreeStockOuverture,
  varianteSansMouvement,
} from "../../electron/services/stock";
import { creerBaseDeTest } from "../setup";

const boutiqueId = randomUUID();
const depotId = randomUUID();

function creerVariante(nom: string, prixAchat: number, prixVente: number): string {
  const produitId = randomUUID();
  const varianteId = randomUUID();
  executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, nom]);
  executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
    varianteId,
    produitId,
    prixAchat,
    prixVente,
  ]);
  return varianteId;
}

function quantiteEnStock(varianteId: string): number {
  return Number(
    unResultat<{ q: number }>("SELECT COALESCE(SUM(quantite), 0) as q FROM stocks WHERE variante_id = ?", [varianteId])
      ?.q ?? 0,
  );
}

function prixVariante(varianteId: string): { achat: number; vente: number } {
  const v = unResultat<{ prix_achat: number; prix_vente: number }>(
    "SELECT prix_achat, prix_vente FROM variantes WHERE id = ?",
    [varianteId],
  )!;
  return { achat: Number(v.prix_achat), vente: Number(v.prix_vente) };
}

function origines(varianteId: string): string[] {
  return tousLesResultats<{ reference_type: string }>(
    "SELECT reference_type FROM mouvements_stock WHERE variante_id = ?",
    [varianteId],
  ).map((m) => m.reference_type);
}

beforeEach(async () => {
  await creerBaseDeTest();
  executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
});

describe("achatRapide (commande + réception en une fois)", () => {
  it("sans fournisseur : crée « Divers », réceptionne tout, tient le CUMP et sort l'argent de la caisse", () => {
    const varianteId = creerVariante("Riz 25kg", 10000, 13000);
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 10 });

    const resultat = achatRapide({
      boutiqueId,
      depotId,
      fournisseurId: null,
      utilisateurId: null,
      lignes: [{ varianteId, quantite: 10, prixAchat: 12000, prixVente: 14000 }],
      montantPaye: 120000,
      modePaiement: "especes",
    });

    expect(resultat.total).toBe(120000);
    const commande = unResultat<{ statut: string; nom: string }>(
      "SELECT c.statut, f.nom FROM commandes_achat c JOIN fournisseurs f ON f.id = c.fournisseur_id WHERE c.id = ?",
      [resultat.commandeId],
    )!;
    expect(commande).toEqual({ statut: "recue", nom: "Divers" });
    expect(quantiteEnStock(varianteId)).toBe(20);
    expect(prixVariante(varianteId)).toEqual({ achat: 11000, vente: 14000 });
    const caisse = unResultat<{ montant: number; categorie: string }>(
      "SELECT montant, categorie FROM mouvements_caisse WHERE reference_type = 'achats.Reception'",
    )!;
    expect([Number(caisse.montant), caisse.categorie]).toEqual([120000, "paiement_fournisseur"]);
    expect(
      unResultat<{ n: number }>("SELECT COUNT(*) as n FROM dettes_fournisseur WHERE commande_id = ?", [
        resultat.commandeId,
      ])!.n,
    ).toBe(0);
  });

  it("réutilise « Divers » et crée une dette pour la partie non payée", () => {
    const varianteId = creerVariante("Huile 5L", 4000, 5000);
    const params = {
      boutiqueId,
      depotId,
      fournisseurId: null,
      utilisateurId: null,
      lignes: [{ varianteId, quantite: 5, prixAchat: 4000, prixVente: 5000 }],
      montantPaye: 0,
    };
    achatRapide(params);
    const second = achatRapide({ ...params, montantPaye: 5000, modePaiement: "especes" });

    expect(unResultat<{ n: number }>("SELECT COUNT(*) as n FROM fournisseurs WHERE nom = 'Divers'")!.n).toBe(1);
    const dette = unResultat<{ solde: number }>("SELECT solde FROM dettes_fournisseur WHERE commande_id = ?", [
      second.commandeId,
    ])!;
    expect(Number(dette.solde)).toBe(15000);
  });

  it("tout ou rien : un prix de vente sous le coût annule aussi la commande", () => {
    const varianteId = creerVariante("Sucre", 500, 600);
    expect(() =>
      achatRapide({
        boutiqueId,
        depotId,
        fournisseurId: null,
        utilisateurId: null,
        lignes: [{ varianteId, quantite: 2, prixAchat: 800, prixVente: 600 }],
        montantPaye: 0,
      }),
    ).toThrow(ErreurAchat);
    expect(unResultat<{ n: number }>("SELECT COUNT(*) as n FROM commandes_achat")!.n).toBe(0);
    expect(unResultat<{ n: number }>("SELECT COUNT(*) as n FROM fournisseurs")!.n).toBe(0);
    expect(quantiteEnStock(varianteId)).toBe(0);
  });
});

describe("entreeStockOuverture", () => {
  it("article neuf : entre au coût saisi, origine tracée", () => {
    const varianteId = creerVariante("Savon", 0, 300);
    expect(varianteSansMouvement(varianteId)).toBe(true);

    entreeStockOuverture({ depotId, lignes: [{ varianteId, quantite: 24, prixAchat: 200 }] });

    expect(quantiteEnStock(varianteId)).toBe(24);
    expect(prixVariante(varianteId)).toEqual({ achat: 200, vente: 300 });
    expect(origines(varianteId)).toEqual(["stock.EntreeOuverture"]);
    expect(varianteSansMouvement(varianteId)).toBe(false);
  });

  it("refuse un article qui a déjà bougé, sans rien écrire pour les autres lignes", () => {
    const neuf = creerVariante("Neuf", 0, 300);
    const ancien = creerVariante("Ancien", 100, 300);
    appliquerMouvement({ varianteId: ancien, depotId, type: "entree", quantite: 1 });

    expect(() =>
      entreeStockOuverture({
        depotId,
        lignes: [
          { varianteId: neuf, quantite: 5, prixAchat: 100 },
          { varianteId: ancien, quantite: 5, prixAchat: 100 },
        ],
      }),
    ).toThrow(ErreurStock);
    expect(quantiteEnStock(neuf)).toBe(0);
  });
});

describe("articlesSansStock (liste à compléter du stock d'ouverture)", () => {
  it("ne garde que les articles actifs qui n'ont jamais eu de mouvement", () => {
    const sansStock = creerVariante("Tuyau 100cm", 900, 1500);
    const dejaEnStock = creerVariante("Ciment", 4000, 4800);
    const inactif = creerVariante("Ancien modèle", 100, 200);
    executer("UPDATE variantes SET actif = 0 WHERE id = ?", [inactif]);
    appliquerMouvement({ varianteId: dejaEnStock, depotId, type: "entree", quantite: 3 });

    expect(articlesSansStock(boutiqueId).map((v) => v.produitNom)).toEqual(["Tuyau 100cm"]);

    entreeStockOuverture({ depotId, lignes: [{ varianteId: sansStock, quantite: 2, prixAchat: 900 }] });
    expect(articlesSansStock(boutiqueId)).toEqual([]);
  });
});

describe("entreeFabrication", () => {
  it("réservée aux boutiques qui fabriquent, CUMP pondéré", () => {
    const varianteId = creerVariante("Jus de bissap", 200, 500);
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 10 });
    expect(() => entreeFabrication({ depotId, lignes: [{ varianteId, quantite: 10, prixAchat: 300 }] })).toThrow(
      ErreurStock,
    );

    executer("INSERT INTO parametres (id, boutique_id, cle, valeur) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      boutiqueId,
      CLE_PARAMETRE_FABRICATION_PROPRE,
      "1",
    ]);
    entreeFabrication({ depotId, lignes: [{ varianteId, quantite: 10, prixAchat: 300 }] });

    expect(quantiteEnStock(varianteId)).toBe(20);
    expect(prixVariante(varianteId).achat).toBe(250);
    expect(origines(varianteId)).toContain("stock.EntreeFabrication");
  });
});

describe("entreeDon", () => {
  it("entre au coût moyen actuel, qui ne bouge pas", () => {
    const varianteId = creerVariante("Parfum", 3000, 5000);
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 4 });

    entreeDon({ depotId, lignes: [{ varianteId, quantite: 2, prixAchat: 0 }] });

    expect(quantiteEnStock(varianteId)).toBe(6);
    expect(prixVariante(varianteId).achat).toBe(3000);
    expect(origines(varianteId)).toContain("stock.EntreeDon");
  });

  it("article sans coût : la valeur estimée est obligatoire et devient le prix d'achat", () => {
    const varianteId = creerVariante("Échantillon crème", 0, 1500);
    expect(() => entreeDon({ depotId, lignes: [{ varianteId, quantite: 3 }] })).toThrow(ErreurStock);

    entreeDon({ depotId, lignes: [{ varianteId, quantite: 3, prixAchat: 700 }] });
    expect(prixVariante(varianteId).achat).toBe(700);
  });
});
