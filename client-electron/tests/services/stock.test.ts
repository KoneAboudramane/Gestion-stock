import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, tousLesResultats, unResultat } from "../../electron/db/helpers";
import {
  CLE_PARAMETRE_FABRICATION_PROPRE,
  ErreurStock,
  ajouterLigneInventaire,
  appliquerMouvement,
  creerDepot,
  creerEntreeProduction,
  creerMouvementManuel,
  declarerPerte,
  listerPertes,
  listerInventaires,
  listerMouvements,
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

  it("demarrerInventaire refuse un second inventaire en cours sur le même dépôt", () => {
    const inventaireId = demarrerInventaire(boutiqueId, depotId, null);
    expect(() => demarrerInventaire(boutiqueId, depotId, null)).toThrow(ErreurStock);
    validerInventaire(inventaireId, null);
    expect(() => demarrerInventaire(boutiqueId, depotId, null)).not.toThrow();
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

  it("comptage à zéro : chaque article part de 0, un article non compté sort du stock à la validation", () => {
    const inventaireId = demarrerInventaire(boutiqueId, depotId, null, true);
    const ligne = ligneDe(inventaireId);
    expect(Number(ligne.qte_physique)).toBe(0);
    expect(Number(ligne.ecart)).toBe(-20);
    validerInventaire(inventaireId, null);
    const stock = unResultat<{ quantite: number }>("SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?", [
      varianteId,
      depotId,
    ]);
    expect(Number(stock!.quantite)).toBe(0);
  });

  it("ajouter un article absent de la liste pendant le comptage", () => {
    const inventaireId = demarrerInventaire(boutiqueId, depotId, null);
    const nouvelle = randomUUID();
    ajouterLigneInventaire(inventaireId, nouvelle, 4);
    const ajoutee = unResultat<{ qte_theorique: number; qte_physique: number; ecart: number }>(
      "SELECT qte_theorique, qte_physique, ecart FROM lignes_inventaire WHERE inventaire_id = ? AND variante_id = ?",
      [inventaireId, nouvelle],
    )!;
    expect([Number(ajoutee.qte_theorique), Number(ajoutee.qte_physique), Number(ajoutee.ecart)]).toEqual([0, 4, 4]);
    expect(() => ajouterLigneInventaire(inventaireId, nouvelle, 1)).toThrow(ErreurStock);
    validerInventaire(inventaireId, null);
    const stock = unResultat<{ quantite: number }>("SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?", [
      nouvelle,
      depotId,
    ]);
    expect(Number(stock!.quantite)).toBe(4);
  });
});

describe("Historique du stock : résumé des inventaires validés et origine des mouvements", () => {
  const boutiqueId = "b1";
  const depotId = randomUUID();
  const produitId = randomUUID();
  const varianteA = randomUUID();
  const varianteB = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Riz"]);
    for (const [id, prix] of [
      [varianteA, 500],
      [varianteB, 1000],
    ] as const) {
      executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [id, produitId, prix, prix]);
      appliquerMouvement({ varianteId: id, depotId, type: "entree", quantite: 10 });
    }
  });

  it("listerInventaires compte les articles, les écarts et leur valeur au coût figé", () => {
    const inventaireId = demarrerInventaire(boutiqueId, depotId, null);
    const lignes = tousLesResultats<{ id: string; variante_id: string }>(
      "SELECT id, variante_id FROM lignes_inventaire WHERE inventaire_id = ?",
      [inventaireId],
    );
    modifierLigneInventaire(lignes.find((l) => l.variante_id === varianteA)!.id, 12); // +2 × 500
    modifierLigneInventaire(lignes.find((l) => l.variante_id === varianteB)!.id, 7); // −3 × 1000
    validerInventaire(inventaireId, null);

    const [resume] = listerInventaires(boutiqueId);
    expect(resume.statut).toBe("valide");
    expect(resume.dateValidation).not.toBeNull();
    expect([resume.nombreArticles, resume.ecartsPlus, resume.ecartsMoins]).toEqual([2, 1, 1]);
    expect(resume.ecartValeur).toBe(1000 - 3000);
  });

  it("listerMouvements renvoie le document d'origine (vide pour une saisie manuelle)", () => {
    const inventaireId = demarrerInventaire(boutiqueId, depotId, null);
    const ligne = tousLesResultats<{ id: string }>("SELECT id FROM lignes_inventaire WHERE inventaire_id = ?", [
      inventaireId,
    ])[0];
    modifierLigneInventaire(ligne.id, 4);
    validerInventaire(inventaireId, null);

    const origines = listerMouvements(boutiqueId).map((m) => m.referenceType);
    expect(origines).toContain("stock.Inventaire");
    expect(origines).toContain("");
  });
});

describe("stock.creerEntreeProduction (boutique sans fournisseur : fabrication propre)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Atelier"]);
    executer("INSERT INTO parametres (id, boutique_id, cle, valeur) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      boutiqueId,
      CLE_PARAMETRE_FABRICATION_PROPRE,
      "1",
    ]);
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

describe("réglage fabrication propre (entrées de stock hors Achats)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();
  let varianteId: string;

  function stockActuel(): number {
    const ligne = unResultat<{ quantite: number }>("SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?", [
      varianteId,
      depotId,
    ]);
    return ligne ? Number(ligne.quantite) : 0;
  }

  function activerFabrication(): void {
    executer("INSERT INTO parametres (id, boutique_id, cle, valeur) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      boutiqueId,
      CLE_PARAMETRE_FABRICATION_PROPRE,
      "1",
    ]);
  }

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
    const produitId = randomUUID();
    varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Savon"]);
    executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
      varianteId,
      produitId,
      100,
      150,
    ]);
  });

  it("sans le réglage : le stock initial passe, une entrée manuelle suivante est refusée", () => {
    creerMouvementManuel({ varianteId, depotId, type: "entree", quantite: 10, motif: "Stock initial" });
    expect(() => creerMouvementManuel({ varianteId, depotId, type: "entree", quantite: 5 })).toThrow(ErreurStock);
    expect(stockActuel()).toBe(10);
  });

  it("sans le réglage : sortie et ajustement restent permis", () => {
    creerMouvementManuel({ varianteId, depotId, type: "entree", quantite: 10 });
    creerMouvementManuel({ varianteId, depotId, type: "sortie", quantite: 2 });
    creerMouvementManuel({ varianteId, depotId, type: "ajustement", quantite: -1 });
    expect(stockActuel()).toBe(7);
  });

  it("sans le réglage : l'entrée de production est refusée", () => {
    expect(() => creerEntreeProduction({ varianteId, depotId, quantite: 5, prixAchat: 100 })).toThrow(ErreurStock);
    expect(stockActuel()).toBe(0);
  });

  it("avec le réglage : entrées manuelles répétées et entrée de production permises", () => {
    activerFabrication();
    creerMouvementManuel({ varianteId, depotId, type: "entree", quantite: 10 });
    creerMouvementManuel({ varianteId, depotId, type: "entree", quantite: 5 });
    creerEntreeProduction({ varianteId, depotId, quantite: 5, prixAchat: 100 });
    expect(stockActuel()).toBe(20);
  });
});

describe("stock.declarerPerte (miroir de stock/services.py::declarer_perte)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();
  let varianteId: string;

  function stockActuel(): number {
    const ligne = unResultat<{ quantite: number }>("SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?", [
      varianteId,
      depotId,
    ]);
    return ligne ? Number(ligne.quantite) : 0;
  }

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
    const produitId = randomUUID();
    varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Yaourt"]);
    executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
      varianteId,
      produitId,
      250,
      400,
    ]);
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 20 });
  });

  it("sort du stock, fige la valeur au CUMP et trace un mouvement de sortie référencé", () => {
    const perteId = declarerPerte({ varianteId, depotId, quantite: 4, motif: "perime", utilisateurId: null });

    expect(stockActuel()).toBe(16);
    const pertes = listerPertes(boutiqueId);
    expect(pertes).toHaveLength(1);
    expect(pertes[0]).toMatchObject({ produitNom: "Yaourt", depotNom: "Magasin", motif: "perime" });
    expect(Number(pertes[0].valeur)).toBe(1000);

    const mouvement = unResultat<{ type: string; motif: string }>(
      "SELECT type, motif FROM mouvements_stock WHERE reference_type = 'stock.PerteStock' AND reference_id = ?",
      [perteId],
    );
    expect(mouvement).toMatchObject({ type: "sortie", motif: "Perte : Périmé" });
  });

  it("exige une précision pour le motif « autre »", () => {
    expect(() => declarerPerte({ varianteId, depotId, quantite: 1, motif: "autre", utilisateurId: null })).toThrow(ErreurStock);
    declarerPerte({ varianteId, depotId, quantite: 1, motif: "autre", detail: "Rongé", utilisateurId: null });
    expect(listerPertes(boutiqueId)[0].detail).toBe("Rongé");
  });

  it("refuse une perte supérieure au stock, sans rien enregistrer", () => {
    expect(() => declarerPerte({ varianteId, depotId, quantite: 50, motif: "vol", utilisateurId: null })).toThrow(ErreurStock);
    expect(listerPertes(boutiqueId)).toHaveLength(0);
    expect(stockActuel()).toBe(20);
  });

  it("filtre par période", () => {
    declarerPerte({ varianteId, depotId, quantite: 1, motif: "don", utilisateurId: null });
    expect(listerPertes(boutiqueId, "2000-01-01T00:00:00.000Z", "2999-12-31T23:59:59.999Z")).toHaveLength(1);
    expect(listerPertes(boutiqueId, "2999-01-01T00:00:00.000Z")).toHaveLength(0);
  });
});
