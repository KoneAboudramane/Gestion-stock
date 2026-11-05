import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, tousLesResultats, unResultat } from "../../electron/db/helpers";
import { ErreurAchat, achatRapide } from "../../electron/services/achats";
import { releveCompletFournisseur } from "../../electron/services/comptesTiers";
import {
  CLE_PARAMETRE_FABRICATION_PROPRE,
  ErreurStock,
  appliquerMouvement,
  articlesSansStock,
  entreeDon,
  entreeFabrication,
  entreeStockOuverture,
  listerMouvements,
  creerMouvementsGroupe,
  creerTransfertsGroupe,
  declarerPertesGroupe,
  listerPertes,
  listerTransferts,
  varianteSansMouvement,
} from "../../electron/services/stock";
import {
  ErreurRecette,
  enregistrerRecette,
  obtenirRecette,
  supprimerRecette,
} from "../../electron/services/recettes";
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

  it("Mouvements : toute la période sans limite, avec la commande d'origine et le coût de l'article", () => {
    const varianteId = creerVariante("Lait", 500, 700);
    const { commandeId } = achatRapide({
      boutiqueId,
      depotId,
      fournisseurId: null,
      utilisateurId: null,
      lignes: [{ varianteId, quantite: 3, prixAchat: 500, prixVente: 700 }],
      montantPaye: 0,
    });
    const depuis = new Date(Date.now() - 60_000).toISOString();
    const jusqua = new Date(Date.now() + 60_000).toISOString();

    const [m] = listerMouvements(boutiqueId, undefined, null, depuis, jusqua);
    expect([m.referenceType, m.commandeId, m.prixAchat]).toEqual(["achats.Reception", commandeId, 500]);
    expect(listerMouvements(boutiqueId, undefined, null, jusqua, null)).toEqual([]);
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

  it("une fois par dépôt : permis dans un second dépôt, coût moyenné (CUMP), refusé deux fois au même dépôt", () => {
    const boutiqueDepot = randomUUID();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [boutiqueDepot, boutiqueId, "Boutique"]);
    const varianteId = creerVariante("Lait en poudre", 0, 3000);

    entreeStockOuverture({ depotId, lignes: [{ varianteId, quantite: 10, prixAchat: 2000 }] });
    expect(varianteSansMouvement(varianteId, depotId)).toBe(false);
    expect(varianteSansMouvement(varianteId, boutiqueDepot)).toBe(true);

    entreeStockOuverture({ depotId: boutiqueDepot, lignes: [{ varianteId, quantite: 5, prixAchat: 2300 }] });
    expect(quantiteEnStock(varianteId)).toBe(15);
    expect(prixVariante(varianteId).achat).toBe(2100);

    expect(() =>
      entreeStockOuverture({ depotId: boutiqueDepot, lignes: [{ varianteId, quantite: 1, prixAchat: 2300 }] }),
    ).toThrow(ErreurStock);
  });
});

describe("articlesSansStock (liste à compléter du stock d'ouverture)", () => {
  it("par dépôt : un article ouvert dans un dépôt reste proposé pour les autres", () => {
    const autreDepot = randomUUID();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [autreDepot, boutiqueId, "Boutique"]);
    const varianteId = creerVariante("Biscuits", 100, 150);

    entreeStockOuverture({ depotId, lignes: [{ varianteId, quantite: 6, prixAchat: 100 }] });

    expect(articlesSansStock(boutiqueId, depotId)).toEqual([]);
    expect(articlesSansStock(boutiqueId, autreDepot).map((v) => v.produitNom)).toEqual(["Biscuits"]);
    expect(articlesSansStock(boutiqueId)).toEqual([]);
  });

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

describe("entreeFabrication avec recette", () => {
  function activerFabrication() {
    executer("INSERT INTO parametres (id, boutique_id, cle, valeur) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      boutiqueId,
      CLE_PARAMETRE_FABRICATION_PROPRE,
      "1",
    ]);
  }

  it("sort les ingrédients du dépôt (règle de trois sur le lot) et calcule le coût : ingrédients + frais", () => {
    activerFabrication();
    const jus = creerVariante("Jus de bissap", 0, 500);
    const bissap = creerVariante("Bissap (kg)", 1000, 1500);
    const sucre = creerVariante("Sucre (kg)", 600, 800);
    appliquerMouvement({ varianteId: bissap, depotId, type: "entree", quantite: 5 });
    appliquerMouvement({ varianteId: sucre, depotId, type: "entree", quantite: 10 });
    // Pour 20 jus : 2 kg de bissap + 5 kg de sucre, plus 50 F de frais par jus.
    enregistrerRecette({
      varianteId: jus,
      quantiteLot: 20,
      fraisParUnite: 50,
      lignes: [
        { ingredientId: bissap, quantite: 2 },
        { ingredientId: sucre, quantite: 5 },
      ],
    });

    // Le coût saisi (999) est ignoré : celui de la recette s'applique.
    entreeFabrication({ depotId, lignes: [{ varianteId: jus, quantite: 10, prixAchat: 999 }] });

    expect(quantiteEnStock(jus)).toBe(10);
    expect(quantiteEnStock(bissap)).toBe(4);
    expect(quantiteEnStock(sucre)).toBe(7.5);
    // (2 × 1000 + 5 × 600) / 20 + 50 = 300
    expect(prixVariante(jus).achat).toBe(300);
    expect(origines(bissap)).toContain("stock.ConsommationFabrication");
  });

  it("bloque s'il manque un ingrédient, sans rien écrire", () => {
    activerFabrication();
    const pain = creerVariante("Pain", 0, 200);
    const farine = creerVariante("Farine (kg)", 500, 700);
    appliquerMouvement({ varianteId: farine, depotId, type: "entree", quantite: 1 });
    enregistrerRecette({ varianteId: pain, quantiteLot: 10, fraisParUnite: 0, lignes: [{ ingredientId: farine, quantite: 2 }] });

    expect(() => entreeFabrication({ depotId, lignes: [{ varianteId: pain, quantite: 10 }] })).toThrow(/il manque 1/);
    expect(quantiteEnStock(pain)).toBe(0);
    expect(quantiteEnStock(farine)).toBe(1);
  });

  it("modifier la recette garde, change ou retire les lignes ; refuse l'article comme son propre ingrédient", () => {
    const savon = creerVariante("Savon", 0, 300);
    const huile = creerVariante("Huile", 100, 150);
    const soude = creerVariante("Soude", 200, 250);
    enregistrerRecette({ varianteId: savon, quantiteLot: 5, fraisParUnite: 0, lignes: [{ ingredientId: huile, quantite: 1 }] });
    enregistrerRecette({ varianteId: savon, quantiteLot: 10, fraisParUnite: 20, lignes: [{ ingredientId: soude, quantite: 3 }] });

    const recette = obtenirRecette(savon)!;
    expect([recette.quantiteLot, recette.fraisParUnite]).toEqual([10, 20]);
    expect(recette.lignes.map((l) => [l.ingredientId, l.quantite])).toEqual([[soude, 3]]);
    expect(() =>
      enregistrerRecette({ varianteId: savon, quantiteLot: 1, fraisParUnite: 0, lignes: [{ ingredientId: savon, quantite: 1 }] }),
    ).toThrow(ErreurRecette);

    supprimerRecette(savon);
    expect(obtenirRecette(savon)).toBeNull();
  });
});

describe("entreeDon", () => {
  it("reçu gratuitement : entre à 0, le coût moyen baisse ; le don apparaît dans le relevé du fournisseur", () => {
    const fournisseurId = randomUUID();
    executer("INSERT INTO fournisseurs (id, boutique_id, nom) VALUES (?, ?, ?)", [fournisseurId, boutiqueId, "Savonnerie"]);
    const varianteId = creerVariante("Savon", 200, 300);
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 10 });

    entreeDon({ depotId, fournisseurId, lignes: [{ varianteId, quantite: 2 }] });

    expect(quantiteEnStock(varianteId)).toBe(12);
    // (10 × 200 + 2 × 0) / 12 = 166,67 → 167
    expect(prixVariante(varianteId).achat).toBe(167);
    expect(origines(varianteId)).toContain("stock.EntreeDon");
    const don = releveCompletFournisseur(fournisseurId).find((o) => o.operation === "🎁 Don reçu")!;
    expect(don.detail).toContain("2 × Savon");
    expect([don.montant, don.effet]).toEqual([0, 0]);
  });

  it("article sans coût ni stock : aucune valeur à saisir, il reste à 0", () => {
    const varianteId = creerVariante("Échantillon crème", 0, 1500);

    entreeDon({ depotId, lignes: [{ varianteId, quantite: 3 }] });

    expect(quantiteEnStock(varianteId)).toBe(3);
    expect(prixVariante(varianteId).achat).toBe(0);
  });
});

describe("creerMouvementsGroupe (formulaire « Nouveau mouvement »)", () => {
  it("tout ou rien : une sortie impossible n'enregistre aucune ligne", () => {
    const riz = creerVariante("Riz", 100, 150);
    const sel = creerVariante("Sel", 50, 80);
    appliquerMouvement({ varianteId: riz, depotId, type: "entree", quantite: 10 });
    appliquerMouvement({ varianteId: sel, depotId, type: "entree", quantite: 2 });

    expect(() =>
      creerMouvementsGroupe({
        depotId,
        type: "sortie",
        motif: "Erreur de saisie",
        lignes: [
          { varianteId: riz, quantite: 3 },
          { varianteId: sel, quantite: 5 },
        ],
      }),
    ).toThrow(/il n'y en a que 2/);
    expect(quantiteEnStock(riz)).toBe(10);
    expect(quantiteEnStock(sel)).toBe(2);
  });

  it("ajustement : la quantité comptée devient le stock, sans écart rien n'est écrit ; motif obligatoire", () => {
    const huile = creerVariante("Huile", 1000, 1200);
    const savon = creerVariante("Savon", 200, 300);
    appliquerMouvement({ varianteId: huile, depotId, type: "entree", quantite: 12 });
    appliquerMouvement({ varianteId: savon, depotId, type: "entree", quantite: 5 });

    const nombre = creerMouvementsGroupe({
      depotId,
      type: "ajustement",
      motif: "Recomptage",
      lignes: [
        { varianteId: huile, quantite: 9 },
        { varianteId: savon, quantite: 5 },
      ],
    });

    expect(nombre).toBe(1);
    expect(quantiteEnStock(huile)).toBe(9);
    expect(origines(savon)).toHaveLength(1);
    expect(() =>
      creerMouvementsGroupe({ depotId, type: "ajustement", motif: " ", lignes: [{ varianteId: huile, quantite: 1 }] }),
    ).toThrow(/motif/);
  });
});

describe("creerTransfertsGroupe (formulaire « Nouveau transfert »)", () => {
  it("tout ou rien : un article en manque au départ ne transfère aucune ligne ; sinon tout passe", () => {
    const boutique = randomUUID();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [boutique, boutiqueId, "Boutique"]);
    const riz = creerVariante("Riz", 100, 150);
    const sel = creerVariante("Sel", 50, 80);
    appliquerMouvement({ varianteId: riz, depotId, type: "entree", quantite: 10 });
    appliquerMouvement({ varianteId: sel, depotId, type: "entree", quantite: 2 });
    const params = { depotSourceId: depotId, depotDestinationId: boutique, utilisateurId: null };

    expect(() =>
      creerTransfertsGroupe({ ...params, lignes: [{ varianteId: riz, quantite: 4 }, { varianteId: sel, quantite: 5 }] }),
    ).toThrow(/il n'y en a que 2/);
    expect(quantiteEnStock(riz)).toBe(10);
    expect(listerTransferts(boutiqueId, null)).toEqual([]);

    creerTransfertsGroupe({ ...params, lignes: [{ varianteId: riz, quantite: 4 }, { varianteId: sel, quantite: 2 }] });
    expect(listerTransferts(boutiqueId, null)).toHaveLength(2);
    expect(quantiteEnStock(riz)).toBe(10); // 6 au départ + 4 à l'arrivée
  });
});

describe("declarerPertesGroupe (formulaire « Déclarer une perte »)", () => {
  it("un motif par ligne ; tout ou rien si un article manque ou si « Autre » n'est pas précisé", () => {
    const yaourt = creerVariante("Yaourt", 300, 500);
    const carton = creerVariante("Carton d'œufs", 2000, 2500);
    appliquerMouvement({ varianteId: yaourt, depotId, type: "entree", quantite: 10 });
    appliquerMouvement({ varianteId: carton, depotId, type: "entree", quantite: 1 });

    expect(() =>
      declarerPertesGroupe({
        depotId,
        utilisateurId: null,
        lignes: [
          { varianteId: yaourt, quantite: 3, motif: "perime" },
          { varianteId: carton, quantite: 1, motif: "autre" },
        ],
      }),
    ).toThrow(/précisez/);
    expect(listerPertes(boutiqueId)).toEqual([]);
    expect(quantiteEnStock(yaourt)).toBe(10);

    declarerPertesGroupe({
      depotId,
      utilisateurId: null,
      lignes: [
        { varianteId: yaourt, quantite: 3, motif: "perime" },
        { varianteId: carton, quantite: 1, motif: "abime" },
      ],
    });
    const pertes = listerPertes(boutiqueId);
    expect(pertes.map((p) => [p.produitNom, p.motif, p.valeur]).sort()).toEqual([
      ["Carton d'œufs", "abime", 2000],
      ["Yaourt", "perime", 900],
    ]);
    expect(quantiteEnStock(yaourt)).toBe(7);
  });
});
