import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer } from "../../electron/db/helpers";
import {
  calculerPlageDates,
  syntheseVentes,
  topClients,
  topProduits,
  valeurStock,
  ventesParJour,
  ventesParModePaiement,
} from "../../electron/services/rapports";
import { creerBaseDeTest } from "../setup";

const DEBUT = "2024-01-15T00:00:00.000Z";
const FIN = "2024-01-15T23:59:59.999Z";
const DANS_LA_PERIODE = "2024-01-15T10:00:00.000Z";
const HORS_PERIODE = "2024-01-20T10:00:00.000Z";

describe("rapports.syntheseVentes (miroir de rapports/services.py::synthese_ventes)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
    const produitId = randomUUID();
    varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Riz 25kg"]);
    executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
      varianteId,
      produitId,
      10000,
      12500,
    ]);
  });

  function creerVenteEtLigne(params: {
    dateCreation: string;
    statut: string;
    totalBrut: number;
    remise: number;
    totalNet: number;
    quantite: number;
    prixUnitaire: number;
    coutUnitaire: number;
    sousTotal: number;
  }) {
    const venteId = randomUUID();
    executer(
      `INSERT INTO ventes (id, boutique_id, depot_id, numero, total_brut, remise, total_net, statut, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        venteId,
        boutiqueId,
        depotId,
        `VTE-${venteId.slice(0, 4)}`,
        params.totalBrut,
        params.remise,
        params.totalNet,
        params.statut,
        params.dateCreation,
        params.dateCreation,
      ],
    );
    executer(
      `INSERT INTO lignes_vente (id, vente_id, variante_id, quantite, prix_unitaire, cout_unitaire, remise, sous_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), venteId, varianteId, params.quantite, params.prixUnitaire, params.coutUnitaire, 0, params.sousTotal],
    );
    return venteId;
  }

  it("exclut les ventes annulées et calcule le bénéfice sur le coût figé (cout_unitaire)", () => {
    creerVenteEtLigne({
      dateCreation: DANS_LA_PERIODE,
      statut: "payee",
      totalBrut: 12500,
      remise: 0,
      totalNet: 12500,
      quantite: 1,
      prixUnitaire: 12500,
      coutUnitaire: 10000,
      sousTotal: 12500,
    });
    creerVenteEtLigne({
      dateCreation: DANS_LA_PERIODE,
      statut: "annulee",
      totalBrut: 25000,
      remise: 0,
      totalNet: 25000,
      quantite: 2,
      prixUnitaire: 12500,
      coutUnitaire: 10000,
      sousTotal: 25000,
    });
    creerVenteEtLigne({
      dateCreation: HORS_PERIODE,
      statut: "payee",
      totalBrut: 12500,
      remise: 0,
      totalNet: 12500,
      quantite: 1,
      prixUnitaire: 12500,
      coutUnitaire: 10000,
      sousTotal: 12500,
    });

    const synthese = syntheseVentes(boutiqueId, DEBUT, FIN);
    expect(synthese.nombreVentes).toBe(1);
    expect(synthese.totalNet).toBe(12500);
    expect(synthese.panierMoyen).toBe(12500);
    expect(synthese.beneficeTotal).toBe(2500); // 12500 - 10000*1, même si prix_achat courant a changé depuis
  });

  it("renvoie des totaux à zéro sans vente sur la période", () => {
    const synthese = syntheseVentes(boutiqueId, DEBUT, FIN);
    expect(synthese.nombreVentes).toBe(0);
    expect(synthese.totalNet).toBe(0);
    expect(synthese.panierMoyen).toBe(0);
  });
});

describe("rapports.topProduits (miroir de rapports/services.py::top_produits)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
  });

  function creerProduitVendu(nom: string, quantite: number) {
    const produitId = randomUUID();
    const varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, nom]);
    executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
      varianteId,
      produitId,
      1000,
      1500,
    ]);
    const venteId = randomUUID();
    executer(
      `INSERT INTO ventes (id, boutique_id, depot_id, numero, total_brut, total_net, statut, date_creation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [venteId, boutiqueId, depotId, `VTE-${nom}`, quantite * 1500, quantite * 1500, "payee", DANS_LA_PERIODE],
    );
    executer(
      `INSERT INTO lignes_vente (id, vente_id, variante_id, quantite, prix_unitaire, cout_unitaire, sous_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), venteId, varianteId, quantite, 1500, 1000, quantite * 1500],
    );
  }

  it("trie par quantité vendue décroissante et respecte la limite", () => {
    creerProduitVendu("Riz", 10);
    creerProduitVendu("Sucre", 30);
    creerProduitVendu("Huile", 20);

    const resultat = topProduits(boutiqueId, DEBUT, FIN, 2, "desc");
    expect(resultat).toHaveLength(2);
    expect(resultat[0].produit).toBe("Sucre");
    expect(resultat[1].produit).toBe("Huile");
  });

  it("trie par quantité vendue croissante quand ordre='asc'", () => {
    creerProduitVendu("Riz", 10);
    creerProduitVendu("Sucre", 30);

    const resultat = topProduits(boutiqueId, DEBUT, FIN, 10, "asc");
    expect(resultat[0].produit).toBe("Riz");
  });
});

describe("rapports.valeurStock (miroir de rapports/services.py::valeur_stock)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
  });

  it("calcule valeur_achat/valeur_vente_potentielle et compte les ruptures", () => {
    const produitA = randomUUID();
    const varianteA = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitA, boutiqueId, "Riz"]);
    executer(
      "INSERT INTO variantes (id, produit_id, prix_achat, prix_vente, seuil_alerte) VALUES (?, ?, ?, ?, ?)",
      [varianteA, produitA, 1000, 1500, 5],
    );
    executer("INSERT INTO stocks (id, variante_id, depot_id, quantite) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      varianteA,
      depotId,
      20,
    ]);

    const produitB = randomUUID();
    const varianteB = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitB, boutiqueId, "Sucre"]);
    executer(
      "INSERT INTO variantes (id, produit_id, prix_achat, prix_vente, seuil_alerte) VALUES (?, ?, ?, ?, ?)",
      [varianteB, produitB, 500, 800, 10],
    );
    executer("INSERT INTO stocks (id, variante_id, depot_id, quantite) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      varianteB,
      depotId,
      3, // <= seuil_alerte (10) : en rupture
    ]);

    const resultat = valeurStock(boutiqueId);
    expect(resultat.valeurAchat).toBe(20 * 1000 + 3 * 500);
    expect(resultat.valeurVentePotentielle).toBe(20 * 1500 + 3 * 800);
    expect(resultat.nombreVariantes).toBe(2);
    expect(resultat.nombreRuptures).toBe(1);
  });
});

describe("rapports.ventesParModePaiement (miroir de rapports/services.py::ventes_par_mode_paiement)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
  });

  function creerVenteAvecPaiement(mode: string, montant: number, dateCreation: string, statut = "payee") {
    const venteId = randomUUID();
    executer(
      `INSERT INTO ventes (id, boutique_id, depot_id, numero, total_net, statut, date_creation)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [venteId, boutiqueId, depotId, `VTE-${venteId.slice(0, 4)}`, montant, statut, dateCreation],
    );
    executer("INSERT INTO paiements (id, vente_id, mode, montant) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      venteId,
      mode,
      montant,
    ]);
  }

  it("regroupe correctement plusieurs paiements sur des ventes différentes", () => {
    creerVenteAvecPaiement("especes", 5000, DANS_LA_PERIODE);
    creerVenteAvecPaiement("especes", 3000, DANS_LA_PERIODE);
    creerVenteAvecPaiement("mobile_money", 7000, DANS_LA_PERIODE);
    creerVenteAvecPaiement("especes", 9999, HORS_PERIODE);
    creerVenteAvecPaiement("especes", 1000, DANS_LA_PERIODE, "annulee");

    const resultat = ventesParModePaiement(boutiqueId, DEBUT, FIN);
    const especes = resultat.find((r) => r.mode === "especes");
    const mobileMoney = resultat.find((r) => r.mode === "mobile_money");
    expect(Number(especes!.total)).toBe(8000);
    expect(Number(mobileMoney!.total)).toBe(7000);
  });
});

describe("rapports.ventesParJour (tendance du tableau de bord)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
  });

  function creerVente(totalNet: number, dateCreation: string, statut = "payee") {
    const venteId = randomUUID();
    executer(
      `INSERT INTO ventes (id, boutique_id, depot_id, numero, total_net, statut, date_creation)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [venteId, boutiqueId, depotId, `VTE-${venteId.slice(0, 4)}`, totalNet, statut, dateCreation],
    );
  }

  it("regroupe le total net par jour et exclut les ventes annulées", () => {
    creerVente(5000, "2024-01-15T09:00:00.000Z");
    creerVente(3000, "2024-01-15T18:00:00.000Z");
    creerVente(2000, "2024-01-16T09:00:00.000Z");
    creerVente(9999, "2024-01-15T12:00:00.000Z", "annulee");

    const resultat = ventesParJour(boutiqueId, "2024-01-15T00:00:00.000Z", "2024-01-16T23:59:59.999Z");

    expect(resultat).toEqual([
      { jour: "2024-01-15", totalNet: 8000 },
      { jour: "2024-01-16", totalNet: 2000 },
    ]);
  });
});

describe("rapports.topClients", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
  });

  function creerClient(nom: string): string {
    const clientId = randomUUID();
    executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [clientId, boutiqueId, nom]);
    return clientId;
  }

  function creerVente(clientId: string | null, totalNet: number, dateCreation: string, statut = "payee") {
    executer(
      `INSERT INTO ventes (id, boutique_id, depot_id, client_id, numero, total_net, statut, date_creation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), boutiqueId, depotId, clientId, `VTE-${randomUUID().slice(0, 4)}`, totalNet, statut, dateCreation],
    );
  }

  it("classe les clients par CA généré, en ignorant les ventes sans client et les ventes annulées", () => {
    const aicha = creerClient("Aïcha");
    const moussa = creerClient("Moussa");

    creerVente(aicha, 10000, DANS_LA_PERIODE);
    creerVente(aicha, 5000, DANS_LA_PERIODE);
    creerVente(moussa, 30000, DANS_LA_PERIODE);
    creerVente(null, 99999, DANS_LA_PERIODE);
    creerVente(moussa, 50000, DANS_LA_PERIODE, "annulee");

    const resultat = topClients(boutiqueId, DEBUT, FIN, 5);

    expect(resultat).toHaveLength(2);
    expect(resultat[0].clientNom).toBe("Moussa");
    expect(Number(resultat[0].totalNet)).toBe(30000);
    expect(resultat[1].clientNom).toBe("Aïcha");
    expect(Number(resultat[1].totalNet)).toBe(15000);
    expect(Number(resultat[1].nombreVentes)).toBe(2);
  });

  it("respecte la limite demandée", () => {
    for (let i = 0; i < 3; i++) {
      creerVente(creerClient(`Client ${i}`), 1000 * (i + 1), DANS_LA_PERIODE);
    }

    expect(topClients(boutiqueId, DEBUT, FIN, 2)).toHaveLength(2);
  });
});

describe("rapports.calculerPlageDates", () => {
  it("la période 'tout' couvre depuis une date très ancienne jusqu'à aujourd'hui", () => {
    const plage = calculerPlageDates("tout");
    const aujourdHui = new Date();
    const jourLocal = `${aujourdHui.getFullYear()}-${String(aujourdHui.getMonth() + 1).padStart(2, "0")}-${String(aujourdHui.getDate()).padStart(2, "0")}`;
    expect(plage.debut < "2001-01-01").toBe(true);
    expect(plage.fin.slice(0, 10)).toBe(jourLocal);
  });
});
