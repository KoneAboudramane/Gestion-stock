import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import { ErreurAbonnement } from "../../electron/services/abonnement";
import { ErreurVente, annulerVente, creerVente } from "../../electron/services/ventes";
import { creerBaseDeTest } from "../setup";

describe("ventes.creerVente (miroir de ventes/services.py::creer_vente)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    const produitId = randomUUID();
    varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [
      produitId,
      boutiqueId,
      "Savon",
    ]);
    executer(
      "INSERT INTO variantes (id, produit_id, prix_achat, prix_vente, seuil_alerte) VALUES (?, ?, ?, ?, ?)",
      [varianteId, produitId, 200, 350, 5],
    );
  });

  function definirStock(quantite: number) {
    executer("INSERT INTO stocks (id, variante_id, depot_id, quantite) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      varianteId,
      depotId,
      quantite,
    ]);
  }

  it("crée une vente payée, décrémente le stock et fige le coût", () => {
    definirStock(30);

    const resultat = creerVente({
      boutiqueId,
      depotId,
      utilisateurId: "1",
      statut: "payee",
      lignes: [{ varianteId, quantite: 3 }],
      paiements: [{ mode: "especes", montant: 1050 }],
    });

    expect(resultat.numero).toMatch(/^VTE-\d{8}-0001$/);
    expect(resultat.totalNet).toBe(1050);

    const ligne = unResultat<{ cout_unitaire: number }>(
      "SELECT cout_unitaire FROM lignes_vente WHERE vente_id = ?",
      [resultat.id],
    );
    expect(Number(ligne!.cout_unitaire)).toBe(200);

    const stock = unResultat<{ quantite: number }>(
      "SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?",
      [varianteId, depotId],
    );
    expect(Number(stock!.quantite)).toBe(27);
  });

  it("refuse et n'écrit rien si le stock est insuffisant (transaction annulée)", () => {
    definirStock(2);

    expect(() =>
      creerVente({
        boutiqueId,
        depotId,
        utilisateurId: "1",
        statut: "payee",
        lignes: [{ varianteId, quantite: 5 }],
        paiements: [{ mode: "especes", montant: 1750 }],
      }),
    ).toThrow();

    const nombreVentes = unResultat<{ n: number }>("SELECT COUNT(*) as n FROM ventes")!;
    expect(Number(nombreVentes.n)).toBe(0);
    const stock = unResultat<{ quantite: number }>(
      "SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?",
      [varianteId, depotId],
    );
    expect(Number(stock!.quantite)).toBe(2);
  });

  it("refuse si la somme des paiements ne correspond pas au total net", () => {
    definirStock(10);
    expect(() =>
      creerVente({
        boutiqueId,
        depotId,
        utilisateurId: "1",
        statut: "payee",
        lignes: [{ varianteId, quantite: 1 }],
        paiements: [{ mode: "especes", montant: 100 }],
      }),
    ).toThrow(ErreurVente);
  });

  it("une vente à crédit crée une créance du montant payé en mode crédit", () => {
    definirStock(10);
    const clientId = randomUUID();
    executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [
      clientId,
      boutiqueId,
      "Mme Test",
    ]);

    const resultat = creerVente({
      boutiqueId,
      depotId,
      utilisateurId: "1",
      clientId,
      statut: "credit",
      lignes: [{ varianteId, quantite: 1 }],
      paiements: [{ mode: "credit", montant: 350 }],
    });

    const credit = unResultat<{ montant: number; solde: number }>(
      "SELECT montant, solde FROM credits WHERE vente_id = ?",
      [resultat.id],
    );
    expect(Number(credit!.montant)).toBe(350);
    expect(Number(credit!.solde)).toBe(350);
  });

  it("deux ventes le même jour incrémentent le compteur du numéro", () => {
    definirStock(10);
    const premiere = creerVente({
      boutiqueId,
      depotId,
      utilisateurId: "1",
      statut: "payee",
      lignes: [{ varianteId, quantite: 1 }],
      paiements: [{ mode: "especes", montant: 350 }],
    });
    const seconde = creerVente({
      boutiqueId,
      depotId,
      utilisateurId: "1",
      statut: "payee",
      lignes: [{ varianteId, quantite: 1 }],
      paiements: [{ mode: "especes", montant: 350 }],
    });
    expect(premiere.numero).toMatch(/-0001$/);
    expect(seconde.numero).toMatch(/-0002$/);
  });

  it("refuse la vente si l'abonnement de la boutique est expiré (lecture seule)", () => {
    definirStock(10);
    executer("INSERT INTO boutiques (id, nom, date_expiration_abonnement) VALUES (?, ?, ?)", [
      boutiqueId,
      "Boutique Test",
      "2000-01-01T00:00:00.000Z",
    ]);

    expect(() =>
      creerVente({
        boutiqueId,
        depotId,
        utilisateurId: "1",
        statut: "payee",
        lignes: [{ varianteId, quantite: 1 }],
        paiements: [{ mode: "especes", montant: 350 }],
      }),
    ).toThrow(ErreurAbonnement);
  });

  it("autorise la vente si l'abonnement est valide", () => {
    definirStock(10);
    executer("INSERT INTO boutiques (id, nom, date_expiration_abonnement) VALUES (?, ?, ?)", [
      boutiqueId,
      "Boutique Test",
      "2999-01-01T00:00:00.000Z",
    ]);

    expect(() =>
      creerVente({
        boutiqueId,
        depotId,
        utilisateurId: "1",
        statut: "payee",
        lignes: [{ varianteId, quantite: 1 }],
        paiements: [{ mode: "especes", montant: 350 }],
      }),
    ).not.toThrow();
  });
});

describe("ventes.annulerVente (miroir de ventes/services.py::annuler_vente)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    const produitId = randomUUID();
    varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [
      produitId,
      boutiqueId,
      "Savon",
    ]);
    executer(
      "INSERT INTO variantes (id, produit_id, prix_achat, prix_vente, seuil_alerte) VALUES (?, ?, ?, ?, ?)",
      [varianteId, produitId, 200, 350, 5],
    );
    executer("INSERT INTO stocks (id, variante_id, depot_id, quantite) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      varianteId,
      depotId,
      30,
    ]);
  });

  function stockActuel(): number {
    const resultat = unResultat<{ quantite: number }>(
      "SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?",
      [varianteId, depotId],
    );
    return resultat ? Number(resultat.quantite) : 0;
  }

  it("recrée le stock consommé par chaque ligne", () => {
    const vente = creerVente({
      boutiqueId,
      depotId,
      utilisateurId: "1",
      statut: "payee",
      lignes: [{ varianteId, quantite: 3 }],
      paiements: [{ mode: "especes", montant: 1050 }],
    });
    expect(stockActuel()).toBe(27);

    annulerVente(vente.id, "1");
    expect(stockActuel()).toBe(30);
  });

  it("passe le statut de la vente à 'annulee'", () => {
    const vente = creerVente({
      boutiqueId,
      depotId,
      utilisateurId: "1",
      statut: "payee",
      lignes: [{ varianteId, quantite: 1 }],
      paiements: [{ mode: "especes", montant: 350 }],
    });

    annulerVente(vente.id, "1");
    const apres = unResultat<{ statut: string }>("SELECT statut FROM ventes WHERE id = ?", [vente.id]);
    expect(apres!.statut).toBe("annulee");
  });

  it("solde toute créance liée à la vente annulée", () => {
    const clientId = randomUUID();
    executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [
      clientId,
      boutiqueId,
      "Mme Test",
    ]);
    const vente = creerVente({
      boutiqueId,
      depotId,
      utilisateurId: "1",
      clientId,
      statut: "credit",
      lignes: [{ varianteId, quantite: 1 }],
      paiements: [{ mode: "credit", montant: 350 }],
    });

    annulerVente(vente.id, "1");

    const credit = unResultat<{ montant: number; montant_paye: number; solde: number; statut: string }>(
      "SELECT montant, montant_paye, solde, statut FROM credits WHERE vente_id = ?",
      [vente.id],
    );
    expect(Number(credit!.montant_paye)).toBe(350);
    expect(Number(credit!.solde)).toBe(0);
    expect(credit!.statut).toBe("solde");
  });

  it("refuse une seconde annulation", () => {
    const vente = creerVente({
      boutiqueId,
      depotId,
      utilisateurId: "1",
      statut: "payee",
      lignes: [{ varianteId, quantite: 1 }],
      paiements: [{ mode: "especes", montant: 350 }],
    });

    annulerVente(vente.id, "1");
    expect(() => annulerVente(vente.id, "1")).toThrow(ErreurVente);
  });
});
