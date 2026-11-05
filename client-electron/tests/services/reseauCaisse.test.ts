import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import initSqlJs, { type Database } from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import { definirBaseDeDonneesPourLesTests } from "../../electron/db/index";
import { installerSuiviReseau } from "../../electron/db/reseau";
import { SCHEMA_SQL } from "../../electron/db/schema";
import {
  arreterBoucleCaisse,
  definirRecherchePourLesTests,
  rejoindreAvantConnexion,
  etatReseauComplet,
  normaliserAdresse,
  seBrancher,
  seDebrancher,
  synchroniserAvecPrincipal,
  verifierStockAvantVente,
} from "../../electron/services/reseauCaisse";
import {
  debrancherAppareil,
  definirAutorisationReseauPourLesTests,
  definirCheminConfigReseauPourLesTests,
  etatReseau,
  nouveauCodeAppairage,
  traiterRequete,
} from "../../electron/services/reseauPrincipal";
import { appliquerMouvement } from "../../electron/services/stock";

// Lot 3 du plan réseau local : une caisse et un poste principal, chacun avec sa
// base et sa configuration, qui se parlent en vrai HTTP sur la machine. Le
// serveur de test bascule sur la base / la configuration du poste principal le
// temps de chaque requête, puis rend la main à celles de la caisse.

const boutiqueId = randomUUID();
const depotId = randomUUID();
const produitId = randomUUID();
const varianteId = randomUUID();

let dossier: string;
let basePrincipal: Database;
let baseCaisse: Database;
let configPrincipal: string;
let configCaisse: string;
let serveur: http.Server | null;
let adresse: string;

async function nouvelleBase(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: (fichier) => require.resolve(`sql.js/dist/${fichier}`) });
  const base = new SQL.Database();
  base.run(SCHEMA_SQL);
  installerSuiviReseau(base);
  return base;
}

function cotePrincipal(): void {
  definirBaseDeDonneesPourLesTests(basePrincipal);
  definirCheminConfigReseauPourLesTests(configPrincipal);
}

function coteCaisse(): void {
  definirBaseDeDonneesPourLesTests(baseCaisse);
  definirCheminConfigReseauPourLesTests(configCaisse);
}

function surPrincipal<T>(action: () => T): T {
  cotePrincipal();
  try {
    return action();
  } finally {
    coteCaisse();
  }
}

function stock(): number {
  return Number(
    unResultat<{ quantite: number }>("SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?", [varianteId, depotId])
      ?.quantite ?? 0,
  );
}

async function demarrerServeurPrincipal(): Promise<void> {
  serveur = http.createServer((requete, reponse) => {
    cotePrincipal();
    void traiterRequete(requete, reponse).finally(coteCaisse);
  });
  await new Promise<void>((resoudre) => serveur!.listen(0, "127.0.0.1", resoudre));
  adresse = `127.0.0.1:${(serveur!.address() as { port: number }).port}`;
}

async function brancherCaisse(): Promise<void> {
  const code = nouveauCodeAppairage().valeur;
  await seBrancher({ adresse, code, boutiqueId, nomAppareil: "Caisse 1" });
  arreterBoucleCaisse(); // les tests déclenchent les échanges eux-mêmes
}

beforeEach(async () => {
  definirAutorisationReseauPourLesTests(true);
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), "reseau-caisse-"));
  configPrincipal = path.join(dossier, "principal.json");
  configCaisse = path.join(dossier, "caisse.json");
  basePrincipal = await nouvelleBase();
  baseCaisse = await nouvelleBase();

  // Poste principal : la boutique, un article à 10 en stock (seuil d'alerte 5).
  fs.writeFileSync(
    configPrincipal,
    JSON.stringify({ role: "principal", boutiqueId, boutiqueNom: "Boutique test", nomPoste: "Bureau", appareils: [] }),
  );
  surPrincipal(() => {
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Boutique"]);
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Riz"]);
    executer("INSERT INTO variantes (id, produit_id, seuil_alerte) VALUES (?, ?, ?)", [varianteId, produitId, 5]);
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 10 });
  });
  coteCaisse();
  await demarrerServeurPrincipal();
});

afterEach(async () => {
  arreterBoucleCaisse();
  definirRecherchePourLesTests(null);
  definirAutorisationReseauPourLesTests(null);
  if (serveur) await new Promise<void>((resoudre) => serveur!.close(() => resoudre()));
  serveur = null;
  definirCheminConfigReseauPourLesTests(null);
  fs.rmSync(dossier, { recursive: true, force: true });
});

describe("caisse : branchement au poste principal", () => {
  it("adresse sans port → port 47800", () => {
    expect(normaliserAdresse("192.168.1.10")).toBe("192.168.1.10:47800");
    expect(normaliserAdresse(" http://192.168.1.10:47805/ ")).toBe("192.168.1.10:47805");
  });

  it("refuse le poste principal d'une autre boutique, ou un mauvais code", async () => {
    await expect(seBrancher({ adresse, code: nouveauCodeAppairage().valeur, boutiqueId: randomUUID() })).rejects.toThrow(
      /autre boutique/,
    );
    await expect(seBrancher({ adresse, code: "999999x", boutiqueId })).rejects.toThrow(/Code incorrect/);
    expect(etatReseauComplet().role).toBe("seul");
  });

  it("ordinateur neuf, avant toute connexion : rejoint la boutique du poste principal et reçoit ses données", async () => {
    const resultat = await rejoindreAvantConnexion({ adresse, code: nouveauCodeAppairage().valeur });
    arreterBoucleCaisse();
    expect(resultat).toMatchObject({ nomPostePrincipal: "Bureau", relie: true });
    expect(etatReseauComplet().role).toBe("caisse");
    expect(stock()).toBe(10);
    // Cet ordinateur a la même boutique : il peut se rebrancher avant la connexion.
    seDebrancher();
    executer("INSERT INTO boutiques (id, nom) VALUES (?, ?)", [boutiqueId, "Boutique test"]);
    await expect(rejoindreAvantConnexion({ adresse, code: nouveauCodeAppairage().valeur })).resolves.toMatchObject({ relie: true });
    arreterBoucleCaisse();
    // Une autre boutique : refusé (impossible de détourner un poste).
    seDebrancher();
    executer("UPDATE boutiques SET id = ?, nom = ? WHERE id = ?", [randomUUID(), "Autre boutique", boutiqueId]);
    await expect(rejoindreAvantConnexion({ adresse, code: nouveauCodeAppairage().valeur })).rejects.toThrow(/autre boutique/);
  });

  it("introuvable : message clair sur le réseau", async () => {
    await expect(seBrancher({ adresse: "127.0.0.1:1", code: "123456", boutiqueId })).rejects.toThrow(/même Wi-Fi/);
  });

  it("branchée : reçoit tout du poste principal, relié, appareil visible côté principal", async () => {
    await brancherCaisse();
    expect(stock()).toBe(10);
    const etat = etatReseauComplet();
    expect(etat.role).toBe("caisse");
    expect(etat.caisse).toMatchObject({ nomPostePrincipal: "Bureau", relie: true, enAttente: 0, erreur: null });
    expect(surPrincipal(() => etatReseau().appareils.map((a) => a.nom))).toEqual(["Caisse 1"]);
  });
});

describe("caisse : échanges", () => {
  it("une vente faite sur la caisse arrive au poste principal ; une vente du principal arrive sur la caisse", async () => {
    await brancherCaisse();

    appliquerMouvement({ varianteId, depotId, type: "sortie", quantite: 4, referenceType: "ventes.Vente" });
    expect(etatReseauComplet().caisse?.enAttente).toBe(1);
    await synchroniserAvecPrincipal();
    expect(surPrincipal(stock)).toBe(6);
    expect(etatReseauComplet().caisse?.enAttente).toBe(0);

    surPrincipal(() => appliquerMouvement({ varianteId, depotId, type: "sortie", quantite: 1, referenceType: "ventes.Vente" }));
    await synchroniserAvecPrincipal();
    expect(stock()).toBe(5);
  });

  it("article presque en rupture : la caisse vérifie auprès du poste principal avant de vendre", async () => {
    await brancherCaisse();
    // Le poste principal vend 8 : il en reste 2 là-bas, la caisse croit encore en avoir 10.
    surPrincipal(() => appliquerMouvement({ varianteId, depotId, type: "sortie", quantite: 8 }));

    // 3 sur 10 : reste 7 en local, au-dessus du seuil (5) → pas de vérification.
    await expect(verifierStockAvantVente({ depotId, lignes: [{ varianteId, quantite: 3 }] })).resolves.toBeUndefined();
    // 6 sur 10 : passerait sous le seuil → vérifié → il n'en reste que 2.
    await expect(verifierStockAvantVente({ depotId, lignes: [{ varianteId, quantite: 6 }] })).rejects.toThrow(
      /« Riz » : il en reste 2/,
    );
  });

  it("poste principal éteint : la caisse continue (vente non bloquée), indicateur injoignable", async () => {
    await brancherCaisse();
    await new Promise<void>((resoudre) => serveur!.close(() => resoudre()));
    serveur = null;

    await synchroniserAvecPrincipal();
    expect(etatReseauComplet().caisse).toMatchObject({ relie: false, erreur: expect.stringMatching(/injoignable/) });
    await expect(verifierStockAvantVente({ depotId, lignes: [{ varianteId, quantite: 9 }] })).resolves.toBeUndefined();
  });

  it("adresse du poste principal changée : la caisse le retrouve seule, sans nouveau code ; un imposteur est ignoré", async () => {
    await brancherCaisse();
    // Le poste principal change d'adresse (routeur redémarré) : nouveau port ici.
    await new Promise<void>((resoudre) => serveur!.close(() => resoudre()));
    await demarrerServeurPrincipal();
    const nouvelle = adresse;
    // Un autre appareil du réseau se fait passer pour le poste principal de la boutique.
    let jetonRecuParImposteur = false;
    const imposteur = http.createServer((requete, reponse) => {
      if (requete.headers.authorization) jetonRecuParImposteur = true;
      reponse.writeHead(200, { "Content-Type": "application/json" });
      reponse.end(JSON.stringify({ preuve: "00".repeat(32) }));
    });
    await new Promise<void>((resoudre) => imposteur.listen(0, "127.0.0.1", resoudre));
    const adresseImposteur = `127.0.0.1:${(imposteur.address() as { port: number }).port}`;
    definirRecherchePourLesTests(async () => [
      { boutiqueId, boutiqueNom: "Boutique test", nomPoste: "Bureau", adresse: adresseImposteur },
      { boutiqueId, boutiqueNom: "Boutique test", nomPoste: "Bureau", adresse: nouvelle },
    ]);

    try {
      appliquerMouvement({ varianteId, depotId, type: "sortie", quantite: 3, referenceType: "ventes.Vente" });
      // Deux échecs à l'ancienne adresse → recherche → retrouvé → échange.
      await synchroniserAvecPrincipal();
      await synchroniserAvecPrincipal();

      expect(etatReseauComplet().caisse).toMatchObject({ relie: true, adresse: nouvelle, enAttente: 0 });
      expect(surPrincipal(stock)).toBe(7);
      expect(jetonRecuParImposteur).toBe(false);
    } finally {
      await new Promise<void>((resoudre) => imposteur.close(() => resoudre()));
    }
  });

  it("débranchée depuis le poste principal : la caisse le signale ; se débrancher la remet seule", async () => {
    await brancherCaisse();
    const appareilId = surPrincipal(() => etatReseau().appareils[0].id);
    surPrincipal(() => debrancherAppareil(appareilId));

    await synchroniserAvecPrincipal();
    expect(etatReseauComplet().caisse?.erreur).toMatch(/débranchée/);

    expect(seDebrancher().role).toBe("seul");
    expect(stock()).toBe(10); // les données restent sur la caisse
  });
});
