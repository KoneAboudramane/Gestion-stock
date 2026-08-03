import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import {
  envoyerMessage,
  genererRappelsCredit,
  genererTicketWhatsapp,
  listerMessages,
} from "../../electron/services/messages";
import { creerBaseDeTest } from "../setup";

describe("messages.genererRappelsCredit (miroir de notifications/services.py::generer_rappels_credit)", () => {
  const boutiqueId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("crée un message par crédit en_cours, avec le téléphone du client si connu", () => {
    const clientId = randomUUID();
    executer("INSERT INTO clients (id, boutique_id, nom, telephone) VALUES (?, ?, ?, ?)", [
      clientId,
      boutiqueId,
      "Mme Test",
      "0700000000",
    ]);
    executer(
      "INSERT INTO credits (id, client_id, montant, montant_paye, solde, statut) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), clientId, 10000, 0, 10000, "en_cours"],
    );
    // Un credit deja solde ne doit generer aucun rappel.
    executer(
      "INSERT INTO credits (id, client_id, montant, montant_paye, solde, statut) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), clientId, 5000, 5000, 0, "solde"],
    );

    const ids = genererRappelsCredit(boutiqueId);
    expect(ids).toHaveLength(1);

    const messages = listerMessages(boutiqueId);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("rappel_credit");
    expect(messages[0].canal).toBe("whatsapp");
    expect(messages[0].destinataire).toBe("0700000000");
    expect(messages[0].message).toContain("Mme Test");
    expect(messages[0].message).toContain("10000");
    expect(messages[0].depotId).toBeNull();
    expect(messages[0].referenceType).toBe("clients.Credit");
  });

  it("reprend le dépôt de la vente liée au crédit, si elle existe", () => {
    const depotId = randomUUID();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
    const clientId = randomUUID();
    executer("INSERT INTO clients (id, boutique_id, nom, telephone) VALUES (?, ?, ?, ?)", [
      clientId,
      boutiqueId,
      "Mme Test",
      "",
    ]);
    const venteId = randomUUID();
    executer(
      "INSERT INTO ventes (id, boutique_id, depot_id, client_id, utilisateur_id, numero, total_net, statut) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [venteId, boutiqueId, depotId, clientId, "1", "VTE-TEST-0001", 10000, "credit"],
    );
    executer(
      "INSERT INTO credits (id, client_id, vente_id, montant, montant_paye, solde, statut) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), clientId, venteId, 10000, 0, 10000, "en_cours"],
    );

    genererRappelsCredit(boutiqueId);

    const messages = listerMessages(boutiqueId);
    expect(messages[0].depotId).toBe(depotId);
    expect(messages[0].depotNom).toBe("Magasin");
  });

  it("ne recrée pas de rappel pour le même crédit si un existe déjà (< 24h)", () => {
    const clientId = randomUUID();
    executer("INSERT INTO clients (id, boutique_id, nom, telephone) VALUES (?, ?, ?, ?)", [
      clientId,
      boutiqueId,
      "Mme Test",
      "",
    ]);
    executer(
      "INSERT INTO credits (id, client_id, montant, montant_paye, solde, statut) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), clientId, 10000, 0, 10000, "en_cours"],
    );

    const premiereGeneration = genererRappelsCredit(boutiqueId);
    expect(premiereGeneration).toHaveLength(1);

    const deuxiemeGeneration = genererRappelsCredit(boutiqueId);
    expect(deuxiemeGeneration).toHaveLength(0);
    expect(listerMessages(boutiqueId)).toHaveLength(1);
  });
});

describe("messages.genererTicketWhatsapp (miroir de notifications/services.py::generer_ticket_whatsapp)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
  });

  it("construit le message et cible le téléphone du client lié à la vente", () => {
    const clientId = randomUUID();
    executer("INSERT INTO clients (id, boutique_id, nom, telephone) VALUES (?, ?, ?, ?)", [
      clientId,
      boutiqueId,
      "M. Client",
      "0711111111",
    ]);
    const produitId = randomUUID();
    const varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Riz 25kg"]);
    executer("INSERT INTO variantes (id, produit_id) VALUES (?, ?)", [varianteId, produitId]);
    const venteId = randomUUID();
    executer(
      "INSERT INTO ventes (id, boutique_id, depot_id, client_id, utilisateur_id, numero, total_net, statut) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [venteId, boutiqueId, depotId, clientId, "7", "VTE-TEST-0001", 12500, "payee"],
    );
    executer(
      "INSERT INTO lignes_vente (id, vente_id, variante_id, quantite, prix_unitaire, sous_total) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), venteId, varianteId, 1, 12500, 12500],
    );

    const id = genererTicketWhatsapp(venteId);
    const message = unResultat<{
      message: string;
      destinataire: string;
      type: string;
      canal: string;
      depot_id: string;
      utilisateur_id: string;
    }>("SELECT message, destinataire, type, canal, depot_id, utilisateur_id FROM messages WHERE id = ?", [id]);
    expect(message!.type).toBe("ticket_whatsapp");
    expect(message!.canal).toBe("whatsapp");
    expect(message!.destinataire).toBe("0711111111");
    expect(message!.message).toContain("VTE-TEST-0001");
    expect(message!.message).toContain("Riz 25kg");
    expect(message!.message).toContain("12500");
    expect(message!.depot_id).toBe(depotId);
    expect(message!.utilisateur_id).toBe("7");
  });

  it("reste interne (canal) quand la vente n'a pas de client avec téléphone", () => {
    const venteId = randomUUID();
    executer(
      "INSERT INTO ventes (id, boutique_id, depot_id, utilisateur_id, numero, total_net, statut) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [venteId, boutiqueId, depotId, "7", "VTE-TEST-0002", 5000, "payee"],
    );

    const id = genererTicketWhatsapp(venteId);
    const message = unResultat<{ canal: string }>("SELECT canal FROM messages WHERE id = ?", [id]);
    expect(message!.canal).toBe("interne");
  });
});

describe("messages.listerMessages (filtres dépôt/caissier)", () => {
  const boutiqueId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("filtre par dépôt et par caissier", () => {
    const depotA = randomUUID();
    const depotB = randomUUID();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotA, boutiqueId, "Dépôt A"]);
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotB, boutiqueId, "Dépôt B"]);
    executer(
      "INSERT INTO messages (id, boutique_id, depot_id, utilisateur_id, type, canal, message, statut) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), boutiqueId, depotA, "1", "ticket_whatsapp", "whatsapp", "Ticket A / caissier 1", "envoyee"],
    );
    executer(
      "INSERT INTO messages (id, boutique_id, depot_id, utilisateur_id, type, canal, message, statut) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), boutiqueId, depotB, "2", "ticket_whatsapp", "whatsapp", "Ticket B / caissier 2", "envoyee"],
    );

    const pourDepotA = listerMessages(boutiqueId, { depotId: depotA });
    expect(pourDepotA).toHaveLength(1);
    expect(pourDepotA[0].depotNom).toBe("Dépôt A");

    const pourCaissier2 = listerMessages(boutiqueId, { utilisateurId: "2" });
    expect(pourCaissier2).toHaveLength(1);
    expect(pourCaissier2[0].message).toContain("caissier 2");
  });
});

describe("messages.envoyerMessage", () => {
  const boutiqueId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("passe le statut à 'envoyee' et pose date_envoi", () => {
    const id = randomUUID();
    executer(
      "INSERT INTO messages (id, boutique_id, type, canal, message, statut) VALUES (?, ?, ?, ?, ?, ?)",
      [id, boutiqueId, "rappel_credit", "whatsapp", "Test", "en_attente"],
    );

    envoyerMessage(id);

    const message = unResultat<{ statut: string; date_envoi: string | null }>(
      "SELECT statut, date_envoi FROM messages WHERE id = ?",
      [id],
    );
    expect(message!.statut).toBe("envoyee");
    expect(message!.date_envoi).not.toBeNull();
  });
});
