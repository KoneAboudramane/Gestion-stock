import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, tousLesResultats } from "../../electron/db/helpers";
import { memoriserAbonnementBoutique, verifierAbonnementActif } from "../../electron/services/abonnement";
import { genererAlertesAbonnement } from "../../electron/services/notifications";
import { creerBaseDeTest } from "../setup";

describe("alertes et blocage de fin d'abonnement", () => {
  let boutiqueId: string;

  function expirationDans(jours: number) {
    const date = new Date(Date.now() + jours * 86_400_000).toISOString();
    executer("UPDATE boutiques SET date_expiration_abonnement = ? WHERE id = ?", [date, boutiqueId]);
  }

  function alertes() {
    return tousLesResultats<{ type: string; message: string }>(
      "SELECT type, message FROM notifications WHERE boutique_id = ? ORDER BY date_creation",
      [boutiqueId],
    );
  }

  beforeEach(async () => {
    await creerBaseDeTest();
    boutiqueId = randomUUID();
    executer("INSERT INTO boutiques (id, nom) VALUES (?, ?)", [boutiqueId, "Boutique"]);
  });

  it("aucune alerte tant qu'il reste plus de 7 jours", () => {
    expirationDans(20);
    expect(genererAlertesAbonnement(boutiqueId)).toEqual([]);
  });

  it("une seule alerte « proche » par étape, même si l'appli est ouverte plusieurs fois", () => {
    expirationDans(5);
    expect(genererAlertesAbonnement(boutiqueId)).toHaveLength(1);
    expect(genererAlertesAbonnement(boutiqueId)).toHaveLength(0);
    expect(alertes()[0].type).toBe("abonnement_proche");
    expect(alertes()[0].message).toContain("dans 5 jours");
  });

  it("délai de grâce : alerte « expiré », la vente reste permise", () => {
    expirationDans(-1);
    expect(genererAlertesAbonnement(boutiqueId)).toHaveLength(1);
    expect(alertes()[0].type).toBe("abonnement_expire");
    expect(alertes()[0].message).toContain("La vente reste possible jusqu'au");
    expect(() => verifierAbonnementActif(boutiqueId)).not.toThrow();
  });

  it("après le délai de grâce : vente bloquée avec un message clair", () => {
    expirationDans(-4);
    expect(() => verifierAbonnementActif(boutiqueId)).toThrow(/délai de grâce terminé/);
  });
});

describe("échéance reçue du serveur sans synchro (memoriserAbonnementBoutique)", () => {
  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("crée la boutique si elle manque, puis met à jour formule et échéance", () => {
    const id = randomUUID();
    memoriserAbonnementBoutique({
      id,
      nom: "Boutique sans synchro",
      formule: "essentiel",
      date_expiration_abonnement: "2026-10-18T10:00:00Z",
      synchro_autorisee: false,
    });
    memoriserAbonnementBoutique({
      id,
      nom: "Boutique sans synchro",
      formule: "pro",
      date_expiration_abonnement: "2027-01-18T10:00:00Z",
      synchro_autorisee: false,
    });
    const lignes = tousLesResultats<{ formule: string; date_expiration_abonnement: string }>(
      "SELECT formule, date_expiration_abonnement FROM boutiques WHERE id = ?",
      [id],
    );
    expect(lignes).toEqual([{ formule: "pro", date_expiration_abonnement: "2027-01-18T10:00:00Z" }]);
  });
});
