import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import {
  initierPaiementMobileMoney,
  obtenirTransactionPourPaiement,
} from "../../electron/services/paiements";
import type { FournisseurMobileMoney } from "../../electron/services/paiements";
import { creerBaseDeTest } from "../setup";

describe("paiements.initierPaiementMobileMoney (miroir de paiements/services.py, squelette simulé)", () => {
  const paiementId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO paiements (id, vente_id, mode, montant) VALUES (?, ?, ?, ?)", [
      paiementId,
      randomUUID(),
      "mobile_money",
      12500,
    ]);
  });

  const fournisseurs: FournisseurMobileMoney[] = ["wave", "orange_money", "mtn"];

  it.each(fournisseurs)("crée une transaction 'reussie' avec une référence, quel que soit le fournisseur (%s)", (fournisseur) => {
    const id = initierPaiementMobileMoney({
      paiementId,
      fournisseur,
      numeroTelephone: "0700000000",
      montant: 12500,
    });

    const transaction = unResultat<{ statut: string; reference_externe: string; fournisseur: string }>(
      "SELECT statut, reference_externe, fournisseur FROM transactions_mobile_money WHERE id = ?",
      [id],
    );
    expect(transaction!.statut).toBe("reussie");
    expect(transaction!.reference_externe.length).toBeGreaterThan(0);
    expect(transaction!.fournisseur).toBe(fournisseur);
  });

  it("obtenirTransactionPourPaiement retrouve la transaction créée", () => {
    initierPaiementMobileMoney({
      paiementId,
      fournisseur: "wave",
      numeroTelephone: "0700000000",
      montant: 12500,
    });

    const transaction = obtenirTransactionPourPaiement(paiementId);
    expect(transaction).toBeDefined();
    expect(transaction!.fournisseur).toBe("wave");
    expect(transaction!.statut).toBe("reussie");
  });
});
