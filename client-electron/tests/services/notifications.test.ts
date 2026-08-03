import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer } from "../../electron/db/helpers";
import {
  compterNotificationsNonLues,
  genererAlertesRupture,
  listerNotifications,
  marquerNotificationsLues,
} from "../../electron/services/notifications";
import { creerBaseDeTest } from "../setup";

describe("notifications.genererAlertesRupture (miroir de notifications/services.py::generer_alertes_rupture)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
  });

  function creerVarianteAvecStock(nom: string, quantite: number, seuilAlerte: number) {
    const produitId = randomUUID();
    const varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, nom]);
    executer("INSERT INTO variantes (id, produit_id, seuil_alerte) VALUES (?, ?, ?)", [
      varianteId,
      produitId,
      seuilAlerte,
    ]);
    executer("INSERT INTO stocks (id, variante_id, depot_id, quantite) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      varianteId,
      depotId,
      quantite,
    ]);
  }

  it("ne cible que les lignes de stock à ou sous le seuil d'alerte, rattachée au dépôt du stock", () => {
    creerVarianteAvecStock("Riz (rupture)", 2, 5);
    creerVarianteAvecStock("Sucre (ok)", 50, 5);

    const ids = genererAlertesRupture(boutiqueId);
    expect(ids).toHaveLength(1);

    const notifications = listerNotifications(boutiqueId);
    expect(notifications[0].type).toBe("alerte_rupture");
    expect(notifications[0].message).toContain("Riz (rupture)");
    expect(notifications[0].depotId).toBe(depotId);
    expect(notifications[0].depotNom).toBe("Magasin");
    expect(notifications[0].referenceType).toBe("stock.Stock");
  });

  it("ne recrée pas d'alerte pour le même stock si une existe déjà (< 24h)", () => {
    creerVarianteAvecStock("Riz (rupture)", 2, 5);

    const premiereGeneration = genererAlertesRupture(boutiqueId);
    expect(premiereGeneration).toHaveLength(1);

    const deuxiemeGeneration = genererAlertesRupture(boutiqueId);
    expect(deuxiemeGeneration).toHaveLength(0);
    expect(listerNotifications(boutiqueId)).toHaveLength(1);
  });
});

describe("notifications.listerNotifications (filtre par dépôt)", () => {
  const boutiqueId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("un caissier verrouillé sur un dépôt ne voit que les notifications de celui-ci", () => {
    const depotA = randomUUID();
    const depotB = randomUUID();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotA, boutiqueId, "Dépôt A"]);
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotB, boutiqueId, "Dépôt B"]);
    executer(
      "INSERT INTO notifications (id, boutique_id, depot_id, type, message) VALUES (?, ?, ?, ?, ?)",
      [randomUUID(), boutiqueId, depotA, "alerte_rupture", "Rupture dépôt A"],
    );
    executer(
      "INSERT INTO notifications (id, boutique_id, depot_id, type, message) VALUES (?, ?, ?, ?, ?)",
      [randomUUID(), boutiqueId, depotB, "alerte_rupture", "Rupture dépôt B"],
    );

    const pourDepotA = listerNotifications(boutiqueId, { depotId: depotA });
    expect(pourDepotA).toHaveLength(1);
    expect(pourDepotA[0].depotNom).toBe("Dépôt A");
  });
});

describe("notifications.compterNotificationsNonLues / marquerNotificationsLues", () => {
  const boutiqueId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("compte uniquement les notifications non lues de la boutique", () => {
    executer("INSERT INTO notifications (id, boutique_id, type, message) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      boutiqueId,
      "alerte_rupture",
      "Test 1",
    ]);
    executer("INSERT INTO notifications (id, boutique_id, type, message) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      boutiqueId,
      "alerte_rupture",
      "Test 2",
    ]);
    // Boutique différente : ne doit pas compter.
    executer("INSERT INTO notifications (id, boutique_id, type, message) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      randomUUID(),
      "alerte_rupture",
      "Autre boutique",
    ]);

    expect(compterNotificationsNonLues(boutiqueId)).toBe(2);
  });

  it("marquerNotificationsLues éteint le compteur", () => {
    executer("INSERT INTO notifications (id, boutique_id, type, message) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      boutiqueId,
      "alerte_rupture",
      "Test",
    ]);
    expect(compterNotificationsNonLues(boutiqueId)).toBe(1);

    marquerNotificationsLues(boutiqueId);

    expect(compterNotificationsNonLues(boutiqueId)).toBe(0);
  });

  it("un dépôt fourni ne compte/ne marque lu que les notifications de ce dépôt (caissier verrouillé)", () => {
    const depotA = randomUUID();
    const depotB = randomUUID();
    executer("INSERT INTO notifications (id, boutique_id, depot_id, type, message) VALUES (?, ?, ?, ?, ?)", [
      randomUUID(),
      boutiqueId,
      depotA,
      "alerte_rupture",
      "Depot A",
    ]);
    executer("INSERT INTO notifications (id, boutique_id, depot_id, type, message) VALUES (?, ?, ?, ?, ?)", [
      randomUUID(),
      boutiqueId,
      depotB,
      "alerte_rupture",
      "Depot B",
    ]);

    expect(compterNotificationsNonLues(boutiqueId, depotA)).toBe(1);

    marquerNotificationsLues(boutiqueId, depotA);

    expect(compterNotificationsNonLues(boutiqueId, depotA)).toBe(0);
    // Le dépôt B n'a jamais été consulté : son compteur reste intact.
    expect(compterNotificationsNonLues(boutiqueId, depotB)).toBe(1);
  });
});
