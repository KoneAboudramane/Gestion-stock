import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { app } from "electron";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executer } from "../../electron/db/helpers";
import { prochainNumero } from "../../electron/services/numerotation";
import { creerBaseDeTest } from "../setup";

describe("numérotation des documents (code vendeur dans le numéro)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();
  const cheminSession = path.join(app.getPath("userData"), "session.json");
  const jour = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  function connecter(champs: Record<string, unknown>) {
    fs.writeFileSync(cheminSession, JSON.stringify({ utilisateurId: "7", username: "aboudramane", ...champs }));
  }

  function enregistrerVente(numero: string) {
    executer("INSERT INTO ventes (id, boutique_id, depot_id, numero) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      boutiqueId,
      depotId,
      numero,
    ]);
  }

  beforeEach(async () => {
    await creerBaseDeTest();
  });

  afterEach(() => {
    if (fs.existsSync(cheminSession)) fs.unlinkSync(cheminSession);
  });

  it("met le code vendeur de la session dans le numéro et compte à partir du plus grand", () => {
    connecter({ codeVendeur: "AKO" });
    expect(prochainNumero("ventes", "VTE", boutiqueId, "7")).toBe(`VTE-${jour}-AKO-0001`);

    enregistrerVente(`VTE-${jour}-AKO-0001`);
    // Reçu par la synchro depuis un autre appareil du même compte : on repart du plus grand.
    enregistrerVente(`VTE-${jour}-AKO-0005`);
    expect(prochainNumero("ventes", "VTE", boutiqueId, "7")).toBe(`VTE-${jour}-AKO-0006`);
  });

  it("deux vendeurs ne produisent jamais le même numéro", () => {
    connecter({ codeVendeur: "AKO" });
    enregistrerVente(`VTE-${jour}-AWA-0001`);
    enregistrerVente(`VTE-${jour}-AWA-0002`);
    // Les ventes d'AWA n'avancent pas le compteur d'AKO.
    expect(prochainNumero("ventes", "VTE", boutiqueId, "7")).toBe(`VTE-${jour}-AKO-0001`);
    // Les anciens numéros sans code ne gênent pas.
    enregistrerVente(`VTE-${jour}-0003`);
    expect(prochainNumero("ventes", "VTE", boutiqueId, "7")).toBe(`VTE-${jour}-AKO-0001`);
  });

  it("session enregistrée avant le code vendeur : abréviation de l'identifiant", () => {
    connecter({});
    expect(prochainNumero("ventes", "VTE", boutiqueId, "7")).toBe(`VTE-${jour}-ABO-0001`);
  });

  it("auteur inconnu : code de l'utilisateur connecté", () => {
    connecter({ codeVendeur: "AKO" });
    expect(prochainNumero("ventes", "VTE", boutiqueId, null)).toBe(`VTE-${jour}-AKO-0001`);
  });
});
