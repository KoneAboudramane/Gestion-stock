import { randomUUID } from "node:crypto";
import initSqlJs, { type Database } from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import { definirBaseDeDonneesPourLesTests } from "../../electron/db/index";
import { installerSuiviReseau } from "../../electron/db/reseau";
import { SCHEMA_SQL } from "../../electron/db/schema";
import { appliquerMouvement } from "../../electron/services/stock";
import {
  appliquerPull,
  construireChangements,
  extraireDepuis,
  marquerEnvoyes,
  recevoirChangements,
  versDonneesServeur,
} from "../../electron/services/sync";
import { REGISTRE_CLIENT } from "../../electron/db/registre";

// Lot 1 du plan réseau local (docs/plan_reseau_local.md) : trois postes en
// mémoire — caisse 1, poste principal, caisse 2 — qui s'échangent leurs
// changements par le moteur de synchro, sans serveur ni réseau.

const boutiqueId = randomUUID();
let caisse1: Database;
let principal: Database;
let caisse2: Database;

async function nouveauPoste(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: (fichier) => require.resolve(`sql.js/dist/${fichier}`) });
  const base = new SQL.Database();
  base.run(SCHEMA_SQL);
  installerSuiviReseau(base);
  return base;
}

function sur<T>(poste: Database, action: () => T): T {
  definirBaseDeDonneesPourLesTests(poste);
  return action();
}

function stock(varianteId: string, depotId: string): number {
  return Number(
    unResultat<{ quantite: number }>("SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?", [varianteId, depotId])
      ?.quantite ?? 0,
  );
}

beforeEach(async () => {
  caisse1 = await nouveauPoste();
  principal = await nouveauPoste();
  caisse2 = await nouveauPoste();
});

describe("suivi réseau (déclencheurs)", () => {
  it("une insertion prend un numéro ; modifier une colonne métier en prend un nouveau et repasse « à envoyer »", () => {
    sur(caisse1, () => {
      const id = randomUUID();
      executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [id, boutiqueId, "Awa"]);
      const apresInsertion = unResultat<{ seq_reseau: number; synchro_reseau: number }>(
        "SELECT seq_reseau, synchro_reseau FROM clients WHERE id = ?",
        [id],
      )!;
      expect(apresInsertion.seq_reseau).toBeGreaterThan(0);
      expect(apresInsertion.synchro_reseau).toBe(0);

      executer("UPDATE clients SET synchro_reseau = 1, synchronise = 1 WHERE id = ?", [id]);
      // Marquer comme envoyé n'est pas une modification : même numéro, reste envoyé.
      expect(unResultat<{ seq_reseau: number }>("SELECT seq_reseau FROM clients WHERE id = ?", [id])!.seq_reseau).toBe(
        apresInsertion.seq_reseau,
      );

      executer("UPDATE clients SET nom = ?, synchronise = 0 WHERE id = ?", ["Awa Koné", id]);
      const apresModification = unResultat<{ seq_reseau: number; synchro_reseau: number }>(
        "SELECT seq_reseau, synchro_reseau FROM clients WHERE id = ?",
        [id],
      )!;
      expect(apresModification.seq_reseau).toBeGreaterThan(apresInsertion.seq_reseau);
      expect(apresModification.synchro_reseau).toBe(0);
    });
  });

  it("toutes les tables synchronisées reçoivent les colonnes de suivi", () => {
    sur(principal, () => {
      for (const { tableLocale } of REGISTRE_CLIENT) {
        const colonnes = (principal.exec(`PRAGMA table_info(${tableLocale})`)[0]?.values ?? []).map((l) => String(l[1]));
        expect(colonnes, tableLocale).toEqual(expect.arrayContaining(["synchro_reseau", "seq_reseau"]));
      }
    });
  });
});

describe("contenu envoyé selon la cible", () => {
  it("vers le serveur : sans suivi local ; vers le poste principal : ligne entière (id, date de création)", () => {
    const entree = REGISTRE_CLIENT.find((e) => e.table === "clients.Client")!;
    const ligne = {
      id: "x",
      boutique_id: boutiqueId,
      nom: "Awa",
      date_creation: "2026-10-31T10:00:00Z",
      synchronise: 0,
      synchro_reseau: 0,
      seq_reseau: 7,
    };
    const versServeur = versDonneesServeur(entree, ligne, "en_ligne");
    expect(Object.keys(versServeur)).not.toEqual(expect.arrayContaining(["synchro_reseau"]));
    expect(versServeur).not.toHaveProperty("seq_reseau");
    expect(versServeur).not.toHaveProperty("id");

    const versPrincipal = versDonneesServeur(entree, ligne, "reseau");
    expect(versPrincipal).toMatchObject({ id: "x", date_creation: "2026-10-31T10:00:00Z", boutique: boutiqueId });
    expect(versPrincipal).not.toHaveProperty("seq_reseau");
  });
});

describe("échange caisse → poste principal → autre caisse", () => {
  it("une vente de stock faite sur la caisse 1 arrive sur la caisse 2, stock recalculé partout", () => {
    const depotId = randomUUID();
    const produitId = randomUUID();
    const varianteId = randomUUID();

    // Caisse 1 : un article, 5 en stock.
    const changements = sur(caisse1, () => {
      executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Boutique"]);
      executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Riz"]);
      executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
        varianteId,
        produitId,
        100,
        150,
      ]);
      appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 5 });
      return construireChangements(boutiqueId, "reseau");
    });
    expect(changements.map((c) => c.table)).toEqual(
      expect.arrayContaining(["stock.Depot", "catalogue.Produit", "catalogue.Variante", "stock.MouvementStock"]),
    );

    // Poste principal : reçoit, recalcule le stock, garde « à envoyer au serveur ».
    const resultats = sur(principal, () => recevoirChangements(changements));
    expect(resultats.every((r) => r.statut === "synchronise")).toBe(true);
    sur(principal, () => {
      expect(stock(varianteId, depotId)).toBe(5);
      expect(construireChangements(boutiqueId, "en_ligne").length).toBe(changements.length);
    });

    // Caisse 1 : ses lignes sont marquées envoyées au poste principal (plus rien à envoyer).
    sur(caisse1, () => {
      marquerEnvoyes("reseau", resultats);
      expect(construireChangements(boutiqueId, "reseau")).toEqual([]);
    });

    // Caisse 2 : premier passage (curseur nul) → tout ; stock recalculé.
    const premier = sur(principal, () => extraireDepuis(boutiqueId, null));
    sur(caisse2, () => {
      appliquerPull(premier, "reseau");
      expect(stock(varianteId, depotId)).toBe(5);
      // Reçu du poste principal : rien à renvoyer, ni à lui ni au serveur.
      expect(construireChangements(boutiqueId, "reseau")).toEqual([]);
      expect(construireChangements(boutiqueId, "en_ligne")).toEqual([]);
    });

    // Passage suivant : seulement ce qui a changé depuis le curseur.
    sur(principal, () => appliquerMouvement({ varianteId, depotId, type: "sortie", quantite: 2 }));
    const suite = sur(principal, () => extraireDepuis(boutiqueId, premier.maintenant));
    expect(suite.tables.map((t) => t.table)).toEqual(["stock.MouvementStock"]);
    expect(Number(suite.maintenant)).toBeGreaterThan(Number(premier.maintenant));
    sur(caisse2, () => {
      appliquerPull(suite, "reseau");
      expect(stock(varianteId, depotId)).toBe(3);
    });

    // Rien de neuf : réponse vide, même curseur.
    const vide = sur(principal, () => extraireDepuis(boutiqueId, suite.maintenant));
    expect(vide).toEqual({ maintenant: suite.maintenant, tables: [] });
  });

  it("le poste principal qui envoie au serveur en ligne ne renvoie pas tout aux caisses", () => {
    const id = randomUUID();
    const changements = sur(caisse1, () => {
      executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [id, boutiqueId, "Moussa"]);
      return construireChangements(boutiqueId, "reseau");
    });
    const curseur = sur(principal, () => {
      recevoirChangements(changements);
      return extraireDepuis(boutiqueId, null).maintenant;
    });
    sur(principal, () => {
      marquerEnvoyes("en_ligne", [{ table: "clients.Client", enregistrement_id: id, statut: "synchronise" }]);
      expect(extraireDepuis(boutiqueId, curseur).tables).toEqual([]);
    });
  });
});
