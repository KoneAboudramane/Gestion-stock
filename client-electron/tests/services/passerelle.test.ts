import { randomUUID } from "node:crypto";
import http from "node:http";
import initSqlJs, { type Database } from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import { definirBaseDeDonneesPourLesTests } from "../../electron/db/index";
import { installerSuiviReseau } from "../../electron/db/reseau";
import { SCHEMA_SQL } from "../../electron/db/schema";
import {
  appliquerPull,
  construireChangements,
  extraireDepuis,
  marquerEnvoyes,
  recevoirChangements,
  synchroniserVers,
  type Changement,
  type CibleSynchro,
} from "../../electron/services/sync";

// Lot 4 du plan réseau local : le poste principal, passerelle vers internet.
// Un faux serveur en ligne imite le contrat Django (/sync/push/, /sync/pull/).

const boutiqueId = randomUUID();
let principal: Database;
let caisse: Database;

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

function client(id: string): { nom: string; synchronise: number; synchro_reseau: number } | undefined {
  return unResultat("SELECT nom, synchronise, synchro_reseau FROM clients WHERE id = ?", [id]);
}

/** Faux serveur en ligne : garde ce qu'il reçoit ; `conflits` = ids refusés ; `versionServeur` = renvoyée au pull complet. */
class FauxServeur {
  recus: Changement[] = [];
  pulls: (string | null)[] = [];
  conflits = new Set<string>();
  versionServeur: { table: string; enregistrements: Record<string, unknown>[] }[] = [];
  private serveur: http.Server | null = null;
  port = 0;

  async demarrer(port = 0): Promise<void> {
    this.serveur = http.createServer((requete, reponse) => {
      const url = new URL(requete.url ?? "/", "http://serveur");
      const morceaux: Buffer[] = [];
      requete.on("data", (m: Buffer) => morceaux.push(m));
      requete.on("end", () => {
        reponse.setHeader("Content-Type", "application/json");
        if (url.pathname === "/sync/push/") {
          const { changements } = JSON.parse(Buffer.concat(morceaux).toString() || "{}") as { changements: Changement[] };
          this.recus.push(...changements);
          const resultats = changements.map((c) => ({
            table: c.table,
            enregistrement_id: c.enregistrement_id,
            statut: this.conflits.has(c.enregistrement_id) ? "conflit" : "synchronise",
          }));
          reponse.end(JSON.stringify({ resultats }));
        } else {
          const depuis = url.searchParams.get("depuis");
          this.pulls.push(depuis);
          reponse.end(JSON.stringify({ maintenant: "2026-10-31T12:00:00Z", tables: depuis ? [] : this.versionServeur }));
        }
      });
    });
    await new Promise<void>((resoudre) => this.serveur!.listen(port, "127.0.0.1", resoudre));
    this.port = (this.serveur!.address() as { port: number }).port;
  }

  async arreter(): Promise<void> {
    if (this.serveur) await new Promise<void>((resoudre) => this.serveur!.close(() => resoudre()));
    this.serveur = null;
  }

  cible(): CibleSynchro {
    return { canal: "en_ligne", urlBase: `http://127.0.0.1:${this.port}`, enTetes: { Authorization: "Bearer test" } };
  }
}

let serveur: FauxServeur;

beforeEach(async () => {
  principal = await nouveauPoste();
  caisse = await nouveauPoste();
  serveur = new FauxServeur();
});

afterEach(async () => {
  await serveur.arreter();
});

describe("poste principal : la dernière modification gagne", () => {
  it("une version plus ancienne envoyée par une caisse est refusée ; la caisse reçoit la version gagnante", () => {
    const id = randomUUID();
    // La caisse a reçu le client, puis le modifie avec une horloge en retard (10 h).
    const premier = sur(principal, () => {
      executer("INSERT INTO clients (id, boutique_id, nom, date_modification) VALUES (?, ?, ?, ?)", [
        id,
        boutiqueId,
        "Awa",
        "2026-10-31T09:00:00.000Z",
      ]);
      return extraireDepuis(boutiqueId, null);
    });
    sur(caisse, () => {
      appliquerPull(premier, "reseau");
      executer("UPDATE clients SET nom = ?, date_modification = ?, synchronise = 0 WHERE id = ?", [
        "Awa (caisse)",
        "2026-10-31T10:00:00.000Z",
        id,
      ]);
    });
    // Entre-temps le poste principal l'a modifié plus tard (11 h).
    sur(principal, () =>
      executer("UPDATE clients SET nom = ?, date_modification = ?, synchronise = 0 WHERE id = ?", [
        "Awa Koné",
        "2026-10-31T11:00:00.000Z",
        id,
      ]),
    );
    const curseur = premier.maintenant;

    const changements = sur(caisse, () => construireChangements(boutiqueId, "reseau"));
    const resultats = sur(principal, () => recevoirChangements(changements));
    expect(resultats).toEqual([{ table: "clients.Client", enregistrement_id: id, statut: "conflit" }]);
    sur(principal, () => expect(client(id)?.nom).toBe("Awa Koné"));

    // La caisse relit : la version gagnante remplace la sienne, plus rien à renvoyer.
    const suite = sur(principal, () => extraireDepuis(boutiqueId, curseur));
    sur(caisse, () => {
      marquerEnvoyes("reseau", resultats);
      appliquerPull(suite, "reseau");
      expect(client(id)).toMatchObject({ nom: "Awa Koné", synchro_reseau: 1 });
      expect(construireChangements(boutiqueId, "reseau")).toEqual([]);
    });
  });

  it("dates comparées pour de vrai, quel que soit leur format (serveur « +00:00 », appli « Z »)", () => {
    const id = randomUUID();
    sur(principal, () =>
      executer("INSERT INTO clients (id, boutique_id, nom, date_modification) VALUES (?, ?, ?, ?)", [
        id,
        boutiqueId,
        "Version du serveur",
        "2026-10-31T11:00:00+00:00",
      ]),
    );
    const resultats = sur(principal, () =>
      recevoirChangements([
        {
          table: "clients.Client",
          action: "cree",
          enregistrement_id: id,
          donnees: { id, boutique: boutiqueId, nom: "Plus récente", date_modification: "2026-10-31T11:00:00.500Z" },
        },
      ]),
    );
    expect(resultats[0].statut).toBe("synchronise");
  });

  it("une version plus récente envoyée par une caisse est acceptée", () => {
    const id = randomUUID();
    sur(principal, () =>
      executer("INSERT INTO clients (id, boutique_id, nom, date_modification) VALUES (?, ?, ?, ?)", [
        id,
        boutiqueId,
        "Moussa",
        "2026-10-31T09:00:00.000Z",
      ]),
    );
    const resultats = sur(principal, () =>
      recevoirChangements([
        {
          table: "clients.Client",
          action: "cree",
          enregistrement_id: id,
          donnees: { id, boutique: boutiqueId, nom: "Moussa Traoré", date_modification: "2026-10-31T10:00:00.000Z" },
        },
      ]),
    );
    expect(resultats[0].statut).toBe("synchronise");
    sur(principal, () => expect(client(id)).toMatchObject({ nom: "Moussa Traoré", synchronise: 0 }));
  });
});

describe("poste principal : passerelle vers le serveur en ligne", () => {
  it("coupure puis retour d'internet : tout arrive au serveur, une seule fois (ventes des caisses comprises)", async () => {
    const duPrincipal = randomUUID();
    const deLaCaisse = randomUUID();
    sur(principal, () =>
      executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [duPrincipal, boutiqueId, "Client du bureau"]),
    );
    const changements = sur(caisse, () => {
      executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [deLaCaisse, boutiqueId, "Client de la caisse"]);
      return construireChangements(boutiqueId, "reseau");
    });
    sur(principal, () => recevoirChangements(changements));

    // Pas d'internet : l'échange échoue, rien n'est perdu.
    await serveur.demarrer();
    const cible = serveur.cible();
    await serveur.arreter();
    await expect(sur(principal, () => synchroniserVers(cible, boutiqueId, "poste-principal", null))).rejects.toThrow();
    sur(principal, () => expect(construireChangements(boutiqueId, "en_ligne")).toHaveLength(2));

    // Internet revient (même adresse) : les deux clients partent, puis plus rien.
    await serveur.demarrer(Number(new URL(cible.urlBase).port));
    await sur(principal, () => synchroniserVers(cible, boutiqueId, "poste-principal", null));
    expect(serveur.recus.map((c) => c.enregistrement_id).sort()).toEqual([duPrincipal, deLaCaisse].sort());
    await sur(principal, () => synchroniserVers(cible, boutiqueId, "poste-principal", "2026-10-31T12:00:00Z"));
    expect(serveur.recus).toHaveLength(2);
  });

  it("conflit avec le serveur : sa version est rechargée, la ligne ne reste pas « en attente » pour toujours", async () => {
    const id = randomUUID();
    sur(principal, () =>
      executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [id, boutiqueId, "Version locale"]),
    );
    await serveur.demarrer();
    serveur.conflits.add(id);
    serveur.versionServeur = [
      { table: "clients.Client", enregistrements: [{ id, boutique: boutiqueId, nom: "Version du serveur", supprime: false }] },
    ];

    const { push } = await sur(principal, () => synchroniserVers(serveur.cible(), boutiqueId, "poste-principal", "2026-10-31T08:00:00Z"));
    expect(push[0].statut).toBe("conflit");
    expect(serveur.pulls).toEqual([null]); // rechargement complet, pas depuis le curseur
    sur(principal, () => {
      expect(client(id)).toMatchObject({ nom: "Version du serveur", synchronise: 1 });
      expect(construireChangements(boutiqueId, "en_ligne")).toEqual([]);
    });
  });
});
