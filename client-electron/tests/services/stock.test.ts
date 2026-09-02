import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, tousLesResultats, unResultat } from "../../electron/db/helpers";
import {
  ErreurStock,
  appliquerMouvement,
  creerDepot,
  creerEntreeProduction,
  demarrerInventaire,
  listerDepotsDetail,
  modifierLigneInventaire,
  supprimerDepot,
  transfererStock,
  validerInventaire,
} from "../../electron/services/stock";
import { creerBaseDeTest } from "../setup";

const BOUTIQUE_ID = "b1";

describe("stock.supprimerDepot", () => {
  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("fait un soft delete (n'apparaît plus dans listerDepotsDetail)", () => {
    const depotId = creerDepot(BOUTIQUE_ID, "Entrepôt secondaire");
    supprimerDepot(depotId);

    expect(listerDepotsDetail(BOUTIQUE_ID).find((d) => d.id === depotId)).toBeUndefined();
    const depot = unResultat<{ supprime: number; synchronise: number }>(
      "SELECT supprime, synchronise FROM depots WHERE id = ?",
      [depotId],
    );
    expect(Number(depot!.supprime)).toBe(1);
    expect(Number(depot!.synchronise)).toBe(0);
  });
});

describe("stock.creerDepot (formule Essentiel/Pro)", () => {
  beforeEach(async () => {
    await creerBaseDeTest();
  });

  function definirFormule(formule: "essentiel" | "pro") {
    executer(
      "INSERT INTO boutiques (id, nom, date_creation, date_modification, formule) VALUES (?, 'Boutique', ?, ?, ?)",
      [BOUTIQUE_ID, new Date().toISOString(), new Date().toISOString(), formule],
    );
  }

  it("refuse un deuxième dépôt en formule essentiel", () => {
    definirFormule("essentiel");
    creerDepot(BOUTIQUE_ID, "Magasin principal");
    expect(() => creerDepot(BOUTIQUE_ID, "Deuxième magasin")).toThrow(ErreurStock);
  });

  it("autorise plusieurs dépôts en formule pro", () => {
    definirFormule("pro");
    creerDepot(BOUTIQUE_ID, "Magasin principal");
    expect(() => creerDepot(BOUTIQUE_ID, "Deuxième magasin")).not.toThrow();
  });
});

describe("stock.appliquerMouvement (miroir de stock/services.py)", () => {
  const varianteId = randomUUID();
  const depotId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
  });

  function stockActuel(): number {
    const resultat = unResultat<{ quantite: number }>(
      "SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?",
      [varianteId, depotId],
    );
    return resultat ? Number(resultat.quantite) : 0;
  }

  it("une entrée incrémente le stock", () => {
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 10 });
    expect(stockActuel()).toBe(10);
  });

  it("une sortie décrémente le stock", () => {
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 10 });
    appliquerMouvement({ varianteId, depotId, type: "sortie", quantite: 4 });
    expect(stockActuel()).toBe(6);
  });

  it("refuse une sortie supérieure au stock disponible", () => {
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 5 });
    expect(() => appliquerMouvement({ varianteId, depotId, type: "sortie", quantite: 10 })).toThrow(
      ErreurStock,
    );
    expect(stockActuel()).toBe(5);
  });

  it("un ajustement applique le delta signé tel quel", () => {
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 10 });
    appliquerMouvement({ varianteId, depotId, type: "ajustement", quantite: -3 });
    expect(stockActuel()).toBe(7);
  });
});

describe("stock.transfererStock (miroir de transferer_stock, Étape 3)", () => {
  const varianteId = randomUUID();
  const depotSourceId = randomUUID();
  const depotDestinationId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotSourceId, "b1", "Entrepot"]);
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotDestinationId, "b1", "Boutique"]);
    appliquerMouvement({ varianteId, depotId: depotSourceId, type: "entree", quantite: 30 });
  });

  function stockDe(depotId: string): number {
    const resultat = unResultat<{ quantite: number }>(
      "SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?",
      [varianteId, depotId],
    );
    return resultat ? Number(resultat.quantite) : 0;
  }

  it("décrémente la source et incrémente la destination, crée les deux mouvements liés", () => {
    transfererStock({ varianteId, depotSourceId, depotDestinationId, quantite: 10, utilisateurId: null });

    expect(stockDe(depotSourceId)).toBe(20);
    expect(stockDe(depotDestinationId)).toBe(10);

    const mouvementsLies = tousLesResultats(
      "SELECT id FROM mouvements_stock WHERE reference_type = 'stock.TransfertStock'",
    );
    expect(mouvementsLies).toHaveLength(2);
  });

  it("refuse si le dépôt source et destination sont identiques", () => {
    expect(() =>
      transfererStock({
        varianteId,
        depotSourceId,
        depotDestinationId: depotSourceId,
        quantite: 5,
        utilisateurId: null,
      }),
    ).toThrow(ErreurStock);
  });
});

describe("stock.demarrerInventaire / modifierLigneInventaire / validerInventaire (miroir Étape 3)", () => {
  const varianteId = randomUUID();
  const depotId = randomUUID();
  const boutiqueId = "b1";

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 20 });
  });

  function ligneDe(inventaireId: string) {
    return unResultat<{ id: string; qte_theorique: number; qte_physique: number; ecart: number }>(
      "SELECT id, qte_theorique, qte_physique, ecart FROM lignes_inventaire WHERE inventaire_id = ? AND variante_id = ?",
      [inventaireId, varianteId],
    )!;
  }

  it("démarrerInventaire snapshote qte_theorique depuis le stock existant", () => {
    const inventaireId = demarrerInventaire(boutiqueId, depotId, null);
    const ligne = ligneDe(inventaireId);
    expect(Number(ligne.qte_theorique)).toBe(20);
    expect(Number(ligne.qte_physique)).toBe(20);
    expect(Number(ligne.ecart)).toBe(0);
  });

  it("modifierLigneInventaire recalcule l'écart, refuse une fois l'inventaire validé", () => {
    const inventaireId = demarrerInventaire(boutiqueId, depotId, null);
    const ligne = ligneDe(inventaireId);

    modifierLigneInventaire(ligne.id, 17);
    const apres = unResultat<{ ecart: number }>("SELECT ecart FROM lignes_inventaire WHERE id = ?", [ligne.id]);
    expect(Number(apres!.ecart)).toBe(-3);

    validerInventaire(inventaireId, null);
    expect(() => modifierLigneInventaire(ligne.id, 5)).toThrow(ErreurStock);
  });

  it("validerInventaire crée un ajustement et met à jour le stock réel ; refuse une seconde validation", () => {
    const inventaireId = demarrerInventaire(boutiqueId, depotId, null);
    const ligne = ligneDe(inventaireId);
    modifierLigneInventaire(ligne.id, 17);

    validerInventaire(inventaireId, null);

    const stock = unResultat<{ quantite: number }>(
      "SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?",
      [varianteId, depotId],
    );
    expect(Number(stock!.quantite)).toBe(17);

    const inventaire = unResultat<{ statut: string }>("SELECT statut FROM inventaires WHERE id = ?", [inventaireId]);
    expect(inventaire!.statut).toBe("valide");

    expect(() => validerInventaire(inventaireId, null)).toThrow(ErreurStock);
  });
});

describe("stock.creerEntreeProduction (boutique sans fournisseur : fabrication propre)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Atelier"]);
    const produitId = randomUUID();
    varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Savon artisanal"]);
    executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
      varianteId,
      produitId,
      0,
      0,
    ]);
  });

  it("sans stock existant, le coût de cette entrée devient directement le prix d'achat", () => {
    creerEntreeProduction({ varianteId, depotId, quantite: 10, prixAchat: 500, prixVente: 1000 });

    const variante = unResultat<{ prix_achat: number; prix_vente: number }>(
      "SELECT prix_achat, prix_vente FROM variantes WHERE id = ?",
      [varianteId],
    );
    expect(Number(variante!.prix_achat)).toBe(500);
    expect(Number(variante!.prix_vente)).toBe(1000);

    const stock = unResultat<{ quantite: number }>(
      "SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?",
      [varianteId, depotId],
    );
    expect(Number(stock!.quantite)).toBe(10);
  });

  it("avec du stock existant, pondère le coût (CUMP) au lieu de l'écraser", () => {
    creerEntreeProduction({ varianteId, depotId, quantite: 10, prixAchat: 500, prixVente: 1000 });
    // (10 * 500 + 10 * 700) / 20 = 600
    creerEntreeProduction({ varianteId, depotId, quantite: 10, prixAchat: 700, prixVente: 1000 });

    const variante = unResultat<{ prix_achat: number }>("SELECT prix_achat FROM variantes WHERE id = ?", [varianteId]);
    expect(Number(variante!.prix_achat)).toBe(600);
  });

  it("sans nouveau prix de vente fourni, garde l'ancien", () => {
    executer("UPDATE variantes SET prix_vente = 1200 WHERE id = ?", [varianteId]);
    creerEntreeProduction({ varianteId, depotId, quantite: 5, prixAchat: 500 });

    const variante = unResultat<{ prix_vente: number }>("SELECT prix_vente FROM variantes WHERE id = ?", [varianteId]);
    expect(Number(variante!.prix_vente)).toBe(1200);
  });

  it("refuse un prix de vente inférieur au coût (CUMP)", () => {
    expect(() =>
      creerEntreeProduction({ varianteId, depotId, quantite: 10, prixAchat: 1000, prixVente: 500 }),
    ).toThrow(ErreurStock);
  });

  it("refuse un produit inexistant", () => {
    expect(() =>
      creerEntreeProduction({ varianteId: randomUUID(), depotId, quantite: 1, prixAchat: 100 }),
    ).toThrow(ErreurStock);
  });
});
