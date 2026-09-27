import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, tousLesResultats, unResultat } from "../../electron/db/helpers";
import {
  ErreurClient,
  echeancierCredit,
  listerClientsDetail,
  listerCredits,
  planifierEcheancierCredit,
  rembourserCredit,
} from "../../electron/services/clients";
import { genererAlertesDestockage } from "../../electron/services/notifications";
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

describe("clients : échéancier d'un crédit", () => {
  const boutiqueId = randomUUID();
  const clientId = randomUUID();
  let creditId: string;

  function jour(decalage: number): string {
    const d = new Date();
    d.setDate(d.getDate() + decalage);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO boutiques (id, nom) VALUES (?, ?)", [boutiqueId, "Boutique"]);
    executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [clientId, boutiqueId, "Mme Test"]);
    creditId = randomUUID();
    executer(
      "INSERT INTO credits (id, client_id, montant, montant_paye, solde, statut) VALUES (?, ?, ?, ?, ?, ?)",
      [creditId, clientId, 10000, 1000, 9000, "en_cours"],
    );
  });

  it("répartit les règlements sur les tranches, garde les réglées en replanifiant", () => {
    expect(() => planifierEcheancierCredit(creditId, [{ dateEcheance: jour(5), montant: 5000 }])).toThrow(ErreurClient);
    planifierEcheancierCredit(creditId, [
      { dateEcheance: jour(5), montant: 3000 },
      { dateEcheance: jour(35), montant: 6000 },
    ]);
    rembourserCredit(creditId, 4000);
    expect(echeancierCredit(creditId).map((e) => [e.statut, e.couvert])).toEqual([
      ["payee", 3000],
      ["partielle", 1000],
    ]);
    expect(listerCredits(boutiqueId)[0].prochaineEcheance).toMatchObject({ date: jour(35), reste: 5000 });
    planifierEcheancierCredit(creditId, [{ dateEcheance: jour(10), montant: 5000 }]);
    expect(echeancierCredit(creditId).map((e) => [e.montant, e.statut])).toEqual([
      [3000, "payee"],
      [5000, "a_venir"],
    ]);
  });

  it("crée une fois les alertes « proche » et « en retard »", () => {
    planifierEcheancierCredit(creditId, [
      { dateEcheance: jour(-2), montant: 4000 },
      { dateEcheance: jour(1), montant: 5000 },
    ]);
    genererAlertesDestockage(boutiqueId);
    genererAlertesDestockage(boutiqueId);
    const types = tousLesResultats<{ type: string }>(
      "SELECT type FROM notifications WHERE type IN ('credit_proche', 'credit_retard') ORDER BY type",
      [],
    ).map((n) => n.type);
    expect(types).toEqual(["credit_proche", "credit_retard"]);
  });
});
