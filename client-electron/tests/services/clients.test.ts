import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import { ErreurClient, listerClientsDetail, rembourserCredit } from "../../electron/services/clients";
import { creerBaseDeTest } from "../setup";

describe("clients.rembourserCredit (miroir de clients/services.py::rembourser_credit)", () => {
  const boutiqueId = randomUUID();
  const clientId = randomUUID();
  let creditId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [clientId, boutiqueId, "Mme Test"]);
    creditId = randomUUID();
    executer(
      "INSERT INTO credits (id, client_id, montant, montant_paye, solde, statut) VALUES (?, ?, ?, ?, ?, ?)",
      [creditId, clientId, 10000, 0, 10000, "en_cours"],
    );
  });

  it("crée une trace PaiementCredit et décrémente le solde", () => {
    rembourserCredit(creditId, 4000, "especes");

    const paiement = unResultat<{ montant: number; mode: string }>(
      "SELECT montant, mode FROM paiements_credit WHERE credit_id = ?",
      [creditId],
    );
    expect(Number(paiement!.montant)).toBe(4000);
    expect(paiement!.mode).toBe("especes");

    const credit = unResultat<{ montant_paye: number; solde: number }>(
      "SELECT montant_paye, solde FROM credits WHERE id = ?",
      [creditId],
    );
    expect(Number(credit!.montant_paye)).toBe(4000);
    expect(Number(credit!.solde)).toBe(6000);
  });

  it("passe le statut à 'solde' quand le solde atteint 0", () => {
    rembourserCredit(creditId, 10000);
    const credit = unResultat<{ solde: number; statut: string }>(
      "SELECT solde, statut FROM credits WHERE id = ?",
      [creditId],
    );
    expect(Number(credit!.solde)).toBe(0);
    expect(credit!.statut).toBe("solde");
  });

  it("refuse un montant négatif ou nul", () => {
    expect(() => rembourserCredit(creditId, 0)).toThrow(ErreurClient);
    expect(() => rembourserCredit(creditId, -500)).toThrow(ErreurClient);
  });

  it("refuse un montant supérieur au solde restant", () => {
    expect(() => rembourserCredit(creditId, 999999)).toThrow(ErreurClient);
  });
});

describe("clients.listerClientsDetail (agrégation du solde de crédit)", () => {
  const boutiqueId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("agrège le solde total dû par client sur plusieurs crédits en cours", () => {
    const clientId = randomUUID();
    executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [clientId, boutiqueId, "Mme Diallo"]);
    executer(
      "INSERT INTO credits (id, client_id, montant, montant_paye, solde, statut) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), clientId, 10000, 0, 10000, "en_cours"],
    );
    executer(
      "INSERT INTO credits (id, client_id, montant, montant_paye, solde, statut) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), clientId, 5000, 0, 5000, "en_cours"],
    );
    // Un crédit déjà soldé ne doit pas compter dans le total dû.
    executer(
      "INSERT INTO credits (id, client_id, montant, montant_paye, solde, statut) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), clientId, 3000, 3000, 0, "solde"],
    );

    const clients = listerClientsDetail(boutiqueId);
    expect(clients).toHaveLength(1);
    expect(Number(clients[0].soldeCredit)).toBe(15000);
  });

  it("renvoie un solde de 0 pour un client sans crédit", () => {
    const clientId = randomUUID();
    executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [clientId, boutiqueId, "M. Sans Credit"]);

    const clients = listerClientsDetail(boutiqueId);
    expect(Number(clients[0].soldeCredit)).toBe(0);
  });
});
