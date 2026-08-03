import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, tousLesResultats, unResultat } from "../../electron/db/helpers";
import { REGISTRE_CLIENT } from "../../electron/db/registre";
import {
  definirLogoBoutique,
  definirParametre,
  listerParametres,
  modifierBoutique,
  obtenirLogoBoutique,
  supprimerParametre,
} from "../../electron/services/reglages";
import { creerBaseDeTest } from "../setup";

describe("reglages.modifierBoutique", () => {
  const boutiqueId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
    executer(
      "INSERT INTO boutiques (id, nom, adresse, telephone, email, devise, synchronise) VALUES (?, ?, ?, ?, ?, ?, 1)",
      [boutiqueId, "Ancien nom", "", "", "", "FCFA"],
    );
  });

  it("met à jour les champs fournis et marque synchronise = 0", () => {
    modifierBoutique(boutiqueId, { nom: "Nouveau nom", telephone: "0700000000" });

    const boutique = unResultat<{ nom: string; telephone: string; synchronise: number }>(
      "SELECT nom, telephone, synchronise FROM boutiques WHERE id = ?",
      [boutiqueId],
    );
    expect(boutique!.nom).toBe("Nouveau nom");
    expect(boutique!.telephone).toBe("0700000000");
    expect(Number(boutique!.synchronise)).toBe(0);
  });
});

describe("reglages.logoBoutique (local uniquement, jamais synchronisé)", () => {
  const boutiqueId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("retourne une chaîne vide si aucun logo n'a été défini", () => {
    expect(obtenirLogoBoutique(boutiqueId)).toBe("");
  });

  it("enregistre puis relit le logo", () => {
    definirLogoBoutique(boutiqueId, "data:image/png;base64,abc123");
    expect(obtenirLogoBoutique(boutiqueId)).toBe("data:image/png;base64,abc123");
  });

  it("remplace le logo existant sans créer de doublon (upsert)", () => {
    definirLogoBoutique(boutiqueId, "data:image/png;base64,abc123");
    definirLogoBoutique(boutiqueId, "data:image/png;base64,xyz789");

    expect(obtenirLogoBoutique(boutiqueId)).toBe("data:image/png;base64,xyz789");
    const lignes = tousLesResultats("SELECT boutique_id FROM boutique_logo WHERE boutique_id = ?", [boutiqueId]);
    expect(lignes).toHaveLength(1);
  });

  it("la table n'a pas de colonnes de suivi de synchro (jamais poussée au serveur)", () => {
    definirLogoBoutique(boutiqueId, "data:image/png;base64,abc123");
    const colonnes = tousLesResultats<{ name: string }>("PRAGMA table_info(boutique_logo)").map((c) => c.name);
    expect(colonnes).toEqual(["boutique_id", "logo"]);
  });

  it("n'est pas listée dans le registre de synchronisation", () => {
    const tablesRegistre = REGISTRE_CLIENT.map((e) => e.tableLocale);
    expect(tablesRegistre).not.toContain("boutique_logo");
  });
});

describe("reglages.definirParametre (upsert unique_together(boutique, cle))", () => {
  const boutiqueId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("crée la clé si absente", () => {
    definirParametre(boutiqueId, "tva", "18");
    const parametres = listerParametres(boutiqueId);
    expect(parametres).toHaveLength(1);
    expect(parametres[0].cle).toBe("tva");
    expect(parametres[0].valeur).toBe("18");
  });

  it("met à jour la valeur si la clé existe déjà, sans créer de doublon", () => {
    definirParametre(boutiqueId, "tva", "18");
    definirParametre(boutiqueId, "tva", "20");

    const parametres = listerParametres(boutiqueId);
    expect(parametres).toHaveLength(1);
    expect(parametres[0].valeur).toBe("20");
  });

  it("exclut les paramètres soft-supprimés de la liste", () => {
    definirParametre(boutiqueId, "format_ticket", "80mm");
    const parametre = unResultat<{ id: string }>("SELECT id FROM parametres WHERE boutique_id = ? AND cle = ?", [
      boutiqueId,
      "format_ticket",
    ]);
    executer("UPDATE parametres SET supprime = 1 WHERE id = ?", [parametre!.id]);

    expect(listerParametres(boutiqueId)).toHaveLength(0);
  });
});

describe("reglages.supprimerParametre", () => {
  const boutiqueId = randomUUID();

  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("fait un soft delete (n'apparaît plus dans listerParametres)", () => {
    definirParametre(boutiqueId, "tva", "18");
    const parametre = unResultat<{ id: string }>("SELECT id FROM parametres WHERE boutique_id = ? AND cle = ?", [
      boutiqueId,
      "tva",
    ]);

    supprimerParametre(parametre!.id);

    expect(listerParametres(boutiqueId)).toHaveLength(0);
    const ligne = unResultat<{ supprime: number; synchronise: number }>(
      "SELECT supprime, synchronise FROM parametres WHERE id = ?",
      [parametre!.id],
    );
    expect(Number(ligne!.supprime)).toBe(1);
    expect(Number(ligne!.synchronise)).toBe(0);
  });
});
