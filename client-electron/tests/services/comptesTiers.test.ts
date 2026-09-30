import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import { annulerReception, creerCommande, payerDette, receptionnerCommande, retournerAuFournisseur } from "../../electron/services/achats";
import { rembourserCredit } from "../../electron/services/clients";
import { genererEcrituresLocales } from "../../electron/services/comptabilite";
import {
  ErreurCompte,
  compteClient,
  deposerSurCompteClient,
  releveCompletClient,
  releveCompletFournisseur,
  remboursementFournisseur,
  rendreDuCompteClient,
  soldeCompteClient,
  soldeCompteFournisseur,
  verserAvanceFournisseur,
} from "../../electron/services/comptesTiers";
import { soldeCaisse, soldeMobileMoneyDisponible } from "../../electron/services/tresorerie";
import { annulerVente, creerVente } from "../../electron/services/ventes";
import { creerBaseDeTest } from "../setup";

const boutiqueId = randomUUID();
const depotId = randomUUID();
const clientId = randomUUID();
const fournisseurId = randomUUID();
let varianteId: string;

beforeEach(async () => {
  await creerBaseDeTest();
  executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
  executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [clientId, boutiqueId, "Mme Koné"]);
  executer("INSERT INTO fournisseurs (id, boutique_id, nom) VALUES (?, ?, ?)", [fournisseurId, boutiqueId, "Grossiste"]);
  const produitId = randomUUID();
  varianteId = randomUUID();
  executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Riz"]);
  executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [varianteId, produitId, 100, 1000]);
  executer("INSERT INTO stocks (id, variante_id, depot_id, quantite) VALUES (?, ?, ?, ?)", [randomUUID(), varianteId, depotId, 50]);
});

describe("compte client (miroir de clients/services.py)", () => {
  it("dépôt en espèces : entre en caisse ; argent rendu : en ressort", () => {
    const compte = deposerSurCompteClient(clientId, { montant: 5000, mode: "especes", depotId, utilisateurId: "1" });
    expect(compte.solde).toBe(5000);
    expect(soldeCaisse(depotId)).toBe(5000);
    expect(() => rendreDuCompteClient(clientId, { montant: 6000, mode: "especes", depotId })).toThrow(ErreurCompte);
    rendreDuCompteClient(clientId, { montant: 2000, mode: "especes", depotId });
    expect(soldeCompteClient(clientId)).toBe(3000);
    expect(soldeCaisse(depotId)).toBe(3000);
    expect(compteClient(clientId).mouvements.map((m) => m.montant)).toEqual([5000, -2000]);
  });

  it("dépôt Mobile Money : crédité à celui qui encaisse, pas à la caisse", () => {
    deposerSurCompteClient(clientId, { montant: 3000, mode: "mobile_money", operateur: "wave", utilisateurId: "u1" });
    expect(soldeCaisse(depotId)).toBe(0);
    expect(soldeMobileMoneyDisponible(boutiqueId, "u1", "wave")).toBe(3000);
  });

  it("vente payée en partie par le compte, puis annulée : l'argent revient sur le compte", () => {
    deposerSurCompteClient(clientId, { montant: 5000, mode: "especes", depotId });
    const vente = creerVente({
      boutiqueId,
      depotId,
      utilisateurId: "1",
      clientId,
      statut: "payee",
      lignes: [{ varianteId, quantite: 3 }],
      paiements: [
        { mode: "compte_client", montant: 2000 },
        { mode: "especes", montant: 1000 },
      ],
    });
    expect(soldeCompteClient(clientId)).toBe(3000);
    annulerVente(vente.id, "1");
    expect(soldeCompteClient(clientId)).toBe(5000);
  });

  it("refuse une vente si le compte ne suffit pas", () => {
    deposerSurCompteClient(clientId, { montant: 500, mode: "especes", depotId });
    expect(() =>
      creerVente({
        boutiqueId,
        depotId,
        utilisateurId: "1",
        clientId,
        statut: "payee",
        lignes: [{ varianteId, quantite: 1 }],
        paiements: [{ mode: "compte_client", montant: 1000 }],
      }),
    ).toThrow();
  });

  it("utiliser le compte pour régler un crédit (419 → 411)", () => {
    const vente = creerVente({
      boutiqueId,
      depotId,
      utilisateurId: "1",
      clientId,
      statut: "credit",
      lignes: [{ varianteId, quantite: 2 }],
      paiements: [{ mode: "credit", montant: 2000 }],
    });
    const creditId = unResultat<{ id: string }>("SELECT id FROM credits WHERE vente_id = ?", [vente.id])!.id;
    deposerSurCompteClient(clientId, { montant: 1500, mode: "especes", depotId });
    rembourserCredit(creditId, 1500, "compte_client", null, "1");
    expect(soldeCompteClient(clientId)).toBe(0);
    expect(Number(unResultat<{ solde: number }>("SELECT solde FROM credits WHERE id = ?", [creditId])!.solde)).toBe(500);
    const ecriture = genererEcrituresLocales(boutiqueId).find((e) => e.referenceType === "clients.PaiementCredit");
    expect(ecriture?.lignes.map((l) => l.compte)).toEqual(["419", "411"]);
  });
});

describe("compte fournisseur (miroir de fournisseurs/services.py)", () => {
  function commande() {
    return creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 10, prixAchat: 100 }],
    });
  }

  it("avance en espèces, puis réception payée par le compte, annulée : l'avance revient", () => {
    verserAvanceFournisseur(fournisseurId, { montant: 700, mode: "especes", depotId });
    expect(soldeCaisse(depotId)).toBe(-700);
    const receptionId = receptionnerCommande({
      commandeId: commande().id,
      depotId,
      utilisateurId: "1",
      montantDejaPaye: 700,
      modePaiement: "compte_fournisseur",
      lignes: [{ varianteId, quantite: 10 }],
    });
    expect(soldeCompteFournisseur(fournisseurId)).toBe(0);
    expect(soldeCaisse(depotId)).toBe(-700);
    const ecriture = genererEcrituresLocales(boutiqueId).find(
      (e) => e.referenceType === "achats.Reception" && e.referenceId === receptionId,
    );
    const credits = Object.fromEntries(ecriture!.lignes.filter((l) => l.credit).map((l) => [l.compte, l.credit]));
    expect(credits).toEqual({ "409": 700, "401": 300 });
    annulerReception(receptionId, "1");
    expect(soldeCompteFournisseur(fournisseurId)).toBe(700);
  });

  it("refuse une réception payée par un compte insuffisant", () => {
    expect(() =>
      receptionnerCommande({
        commandeId: commande().id,
        depotId,
        utilisateurId: "1",
        montantDejaPaye: 100,
        modePaiement: "compte_fournisseur",
        lignes: [{ varianteId, quantite: 10 }],
      }),
    ).toThrow();
  });

  it("retour au-delà de la dette : l'avoir va sur le compte, le fournisseur le rembourse", () => {
    const receptionId = receptionnerCommande({
      commandeId: commande().id,
      depotId,
      utilisateurId: "1",
      montantDejaPaye: 800,
      modePaiement: "banque",
      lignes: [{ varianteId, quantite: 10 }],
    });
    const { avoir } = retournerAuFournisseur({ receptionId, utilisateurId: "1", lignes: [{ varianteId, quantite: 5 }] });
    expect(avoir).toBe(300);
    expect(soldeCompteFournisseur(fournisseurId)).toBe(300);
    const ecriture = genererEcrituresLocales(boutiqueId).find((e) => e.referenceType === "achats.RetourFournisseur");
    const debits = Object.fromEntries(ecriture!.lignes.filter((l) => l.debit).map((l) => [l.compte, l.debit]));
    expect(debits).toEqual({ "401": 200, "409": 300 });
    remboursementFournisseur(fournisseurId, { montant: 300, mode: "especes", depotId });
    expect(soldeCompteFournisseur(fournisseurId)).toBe(0);
    expect(soldeCaisse(depotId)).toBe(300);
  });
});

describe("relevé « Toutes les opérations » : la position finale égale compte − dû", () => {
  const position = (ops: { effet: number }[]) => ops.reduce((t, o) => t + o.effet, 0);

  it("client : achats (espèces, crédit, compte), règlements, annulation, dépôt, rendu", () => {
    deposerSurCompteClient(clientId, { montant: 5000, mode: "especes", depotId });
    const v1 = creerVente({
      boutiqueId, depotId, utilisateurId: "1", clientId, statut: "credit",
      lignes: [{ varianteId, quantite: 4 }],
      paiements: [
        { mode: "especes", montant: 1000 },
        { mode: "compte_client", montant: 1000 },
        { mode: "credit", montant: 2000 },
      ],
    });
    const creditId = unResultat<{ id: string }>("SELECT id FROM credits WHERE vente_id = ?", [v1.id])!.id;
    rembourserCredit(creditId, 500, "especes", depotId, "1");
    rembourserCredit(creditId, 700, "compte_client", null, "1");
    const v2 = creerVente({
      boutiqueId, depotId, utilisateurId: "1", clientId, statut: "credit",
      lignes: [{ varianteId, quantite: 3 }],
      paiements: [{ mode: "credit", montant: 3000 }],
    });
    const credit2 = unResultat<{ id: string }>("SELECT id FROM credits WHERE vente_id = ?", [v2.id])!.id;
    rembourserCredit(credit2, 1000, "especes", depotId, "1");
    annulerVente(v2.id, "1");
    rendreDuCompteClient(clientId, { montant: 300, mode: "especes", depotId });

    const du = Number(unResultat<{ t: number }>("SELECT COALESCE(SUM(solde), 0) as t FROM credits WHERE client_id = ?", [clientId])!.t);
    const ops = releveCompletClient(clientId);
    expect(position(ops)).toBe(soldeCompteClient(clientId) - du);
    expect(ops.map((o) => o.operation)).toContain("↺ Achat annulé");
  });

  it("fournisseur : commande, réception en partie par le compte, retour avec avoir, paiement, avance, remboursement", () => {
    verserAvanceFournisseur(fournisseurId, { montant: 500, mode: "especes", depotId });
    const commande = creerCommande({
      boutiqueId, fournisseurId, utilisateurId: "1", statut: "commandee",
      lignes: [{ varianteId, quantite: 10, prixAchat: 100 }],
    });
    const receptionId = receptionnerCommande({
      commandeId: commande.id, depotId, utilisateurId: "1", montantDejaPaye: 500,
      modePaiement: "compte_fournisseur", lignes: [{ varianteId, quantite: 10 }],
    });
    const detteId = unResultat<{ id: string }>("SELECT id FROM dettes_fournisseur WHERE reception_id = ?", [receptionId])!.id;
    payerDette(detteId, 200, "especes", depotId, "1");
    retournerAuFournisseur({ receptionId, utilisateurId: "1", lignes: [{ varianteId, quantite: 5 }] });
    remboursementFournisseur(fournisseurId, { montant: 100, mode: "especes", depotId });

    const du = Number(
      unResultat<{ t: number }>("SELECT COALESCE(SUM(solde), 0) as t FROM dettes_fournisseur WHERE fournisseur_id = ?", [fournisseurId])!.t,
    );
    const ops = releveCompletFournisseur(fournisseurId);
    expect(position(ops)).toBe(soldeCompteFournisseur(fournisseurId) - du);
    expect(ops.map((o) => o.operation)).toContain("⬆️ Avance versée");
  });
});
