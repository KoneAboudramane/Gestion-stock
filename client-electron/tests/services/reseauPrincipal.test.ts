import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executer } from "../../electron/db/helpers";
import {
  POSTES_MAX,
  annulerCodeAppairage,
  arreterPostePrincipal,
  debrancherAppareil,
  definirAutorisationReseauPourLesTests,
  definirCheminConfigReseauPourLesTests,
  demarrerPostePrincipal,
  devenirPostePrincipal,
  estAdressePrivee,
  etatReseau,
  mettreEnPausePostePrincipal,
  nouveauCodeAppairage,
  quitterPostePrincipal,
  redemarrerPostePrincipal,
  verifierAutorisationReseau,
  reprendrePostePrincipal,
} from "../../electron/services/reseauPrincipal";
import { appliquerMouvement } from "../../electron/services/stock";
import { creerBaseDeTest } from "../setup";

// Lot 2 du plan réseau local : le serveur du poste principal, interrogé en vrai
// HTTP sur la machine (127.0.0.1), comme le feraient les caisses.

const boutiqueId = randomUUID();
let dossier: string;
let base: string;

async function devenirPrincipalSurPortLibre(): Promise<void> {
  await devenirPostePrincipal({ boutiqueId, boutiqueNom: "Boutique test", nomPoste: "Bureau" });
  // devenirPostePrincipal démarre sur 47800 ; les tests prennent un port libre au hasard.
  await arreterPostePrincipal();
  const port = await demarrerPostePrincipal({ port: 0, annonce: false });
  base = `http://127.0.0.1:${port}`;
}

async function appairer(nomAppareil = "Caisse 1"): Promise<{ statut: number; corps: Record<string, string> }> {
  const code = nouveauCodeAppairage().valeur;
  const reponse = await fetch(`${base}/reseau/appairer/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, nomAppareil }),
  });
  return { statut: reponse.status, corps: await reponse.json() };
}

beforeEach(async () => {
  definirAutorisationReseauPourLesTests(true);
  await creerBaseDeTest();
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), "reseau-"));
  definirCheminConfigReseauPourLesTests(path.join(dossier, "reseau.json"));
});

afterEach(async () => {
  definirAutorisationReseauPourLesTests(null);
  await arreterPostePrincipal();
  definirCheminConfigReseauPourLesTests(null);
  fs.rmSync(dossier, { recursive: true, force: true });
});

describe("réseau activé par l'administrateur", () => {
  it("désactivé : impossible de devenir poste principal ; désactivé en marche : serveur arrêté, caisses gardées", async () => {
    definirAutorisationReseauPourLesTests(null);
    executer("INSERT INTO boutiques (id, nom, reseau_autorise) VALUES (?, ?, 0)", [boutiqueId, "Boutique test"]);
    await expect(devenirPostePrincipal({ boutiqueId, boutiqueNom: "Boutique test" })).rejects.toThrow(/pas activé/);
    expect(etatReseau()).toMatchObject({ role: "seul", reseauAutorise: false });

    executer("UPDATE boutiques SET reseau_autorise = 1 WHERE id = ?", [boutiqueId]);
    await devenirPrincipalSurPortLibre();
    const { corps } = await appairer("Caisse 1");
    expect(etatReseau()).toMatchObject({ enMarche: true, reseauAutorise: true });

    // L'administrateur désactive le réseau : à la vérification suivante, le serveur s'arrête.
    executer("UPDATE boutiques SET reseau_autorise = 0 WHERE id = ?", [boutiqueId]);
    await verifierAutorisationReseau();
    expect(etatReseau()).toMatchObject({ enMarche: false, reseauAutorise: false, erreur: expect.stringMatching(/pas activé/) });
    expect(etatReseau().appareils.map((a) => a.id)).toEqual([corps.appareilId]);
  });
});

describe("poste principal : appairage et accès", () => {
  it("se présente sans jeton ; refuse un mauvais code ; un bon code donne un jeton (une seule fois)", async () => {
    await devenirPrincipalSurPortLibre();

    const presentation = await (await fetch(`${base}/reseau/etat/`)).json();
    expect(presentation).toMatchObject({ application: "gestion-stock", boutiqueId, nomPoste: "Bureau" });

    const mauvais = await fetch(`${base}/reseau/appairer/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000x", nomAppareil: "Intrus" }),
    });
    expect(mauvais.status).toBe(400);

    const code = nouveauCodeAppairage().valeur;
    const essai = (corps: object) =>
      fetch(`${base}/reseau/appairer/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    const premier = await essai({ code, nomAppareil: "Caisse 1" });
    expect(premier.status).toBe(200);
    expect((await premier.json()).jeton).toMatch(/^[0-9a-f]{64}$/);
    // Le même code ne sert pas deux fois.
    expect((await essai({ code, nomAppareil: "Caisse 2" })).status).toBe(400);

    expect(etatReseau().appareils.map((a) => a.nom)).toEqual(["Caisse 1"]);
  });

  it("un code arrêté ne branche plus rien ; les caisses déjà branchées restent reliées", async () => {
    await devenirPrincipalSurPortLibre();
    const { corps } = await appairer("Caisse 1");

    const code = nouveauCodeAppairage().valeur;
    annulerCodeAppairage();
    expect(etatReseau().code).toBeNull();
    const essai = await fetch(`${base}/reseau/appairer/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, nomAppareil: "Caisse 2" }),
    });
    expect(essai.status).toBe(400);

    expect((await fetch(`${base}/sync/pull/`, { headers: { Authorization: `Bearer ${corps.jeton}` } })).status).toBe(200);
    expect(etatReseau().appareils.map((a) => a.nom)).toEqual(["Caisse 1"]);
  });

  it("pause : serveur coupé, caisses gardées ; reprise sans nouveau code", async () => {
    await devenirPrincipalSurPortLibre();
    const { corps } = await appairer("Caisse 1");

    const enPause = await mettreEnPausePostePrincipal();
    expect(enPause).toMatchObject({ enMarche: false, enPause: true, code: null });
    expect(enPause.appareils.map((a) => a.nom)).toEqual(["Caisse 1"]);
    await expect(fetch(`${base}/reseau/etat/`)).rejects.toThrow();

    const repris = await reprendrePostePrincipal({ port: 0, annonce: false });
    expect(repris).toMatchObject({ enMarche: true, enPause: false });
    base = `http://127.0.0.1:${repris.port}`;
    expect((await fetch(`${base}/sync/pull/`, { headers: { Authorization: `Bearer ${corps.jeton}` } })).status).toBe(200);
  });

  it("redémarrage : serveur relancé, infos remises à zéro, caisses gardées", async () => {
    await devenirPrincipalSurPortLibre();
    const { corps } = await appairer("Caisse 1");
    const avant = etatReseau();
    expect(avant.demarreLe).not.toBeNull();
    expect(avant.requetesRecues).toBeGreaterThan(0);

    const apres = await redemarrerPostePrincipal({ port: 0, annonce: false });
    expect(apres).toMatchObject({ enMarche: true, enPause: false, requetesRecues: 0 });
    base = `http://127.0.0.1:${apres.port}`;
    expect((await fetch(`${base}/sync/pull/`, { headers: { Authorization: `Bearer ${corps.jeton}` } })).status).toBe(200);
    expect(etatReseau().requetesRecues).toBe(1);
  });

  it("données refusées sans jeton ou après débranchement", async () => {
    await devenirPrincipalSurPortLibre();
    expect((await fetch(`${base}/sync/pull/`)).status).toBe(401);

    const { corps } = await appairer();
    const avecJeton = { headers: { Authorization: `Bearer ${corps.jeton}` } };
    expect((await fetch(`${base}/sync/pull/`, avecJeton)).status).toBe(200);
    expect(etatReseau().appareils[0].relie).toBe(true);

    debrancherAppareil(corps.appareilId);
    expect((await fetch(`${base}/sync/pull/`, avecJeton)).status).toBe(401);
  });

  it(`${POSTES_MAX} postes au maximum, poste principal compris`, async () => {
    await devenirPrincipalSurPortLibre();
    for (let i = 1; i < POSTES_MAX; i++) expect((await appairer(`Caisse ${i}`)).statut).toBe(200);
    const deTrop = await appairer("Caisse de trop");
    expect(deTrop.statut).toBe(409);
    expect(deTrop.corps.detail).toMatch(/débranchez/);
  });

  it("ne répond qu'aux adresses du réseau privé", () => {
    for (const ip of ["192.168.1.20", "10.0.0.5", "172.20.1.2", "127.0.0.1", "::ffff:192.168.43.10", "::1"]) {
      expect(estAdressePrivee(ip), ip).toBe(true);
    }
    for (const ip of ["41.202.1.10", "8.8.8.8", "172.32.0.1", undefined]) expect(estAdressePrivee(ip), String(ip)).toBe(false);
  });
});

describe("poste principal : synchronisation des caisses", () => {
  it("reçoit une vente d'une caisse et la sert aux autres ; stock du dépôt consultable", async () => {
    await devenirPrincipalSurPortLibre();
    const depotId = randomUUID();
    const produitId = randomUUID();
    const varianteId = randomUUID();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Boutique"]);
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Riz"]);
    executer("INSERT INTO variantes (id, produit_id) VALUES (?, ?)", [varianteId, produitId]);
    appliquerMouvement({ varianteId, depotId, type: "entree", quantite: 10 });

    const { corps } = await appairer();
    const enTetes = { Authorization: `Bearer ${corps.jeton}`, "Content-Type": "application/json" };

    // Premier pull d'une caisse : tout ce que le poste principal a.
    const premier = await (await fetch(`${base}/sync/pull/`, { headers: enTetes })).json();
    expect(premier.tables.map((t: { table: string }) => t.table)).toEqual(
      expect.arrayContaining(["stock.Depot", "catalogue.Produit", "catalogue.Variante", "stock.MouvementStock"]),
    );

    // Une caisse vend 3 : le mouvement arrive, le stock du poste principal suit.
    const mouvementId = randomUUID();
    const push = await fetch(`${base}/sync/push/`, {
      method: "POST",
      headers: enTetes,
      body: JSON.stringify({
        appareil: corps.appareilId,
        changements: [
          {
            table: "stock.MouvementStock",
            action: "cree",
            enregistrement_id: mouvementId,
            donnees: { id: mouvementId, variante: varianteId, depot: depotId, type: "sortie", quantite: 3, motif: "Vente", reference_type: "ventes.Vente" },
          },
        ],
      }),
    });
    expect((await push.json()).resultats[0].statut).toBe("synchronise");

    const stock = await (await fetch(`${base}/reseau/stock/?variante=${varianteId}&depot=${depotId}`, { headers: enTetes })).json();
    expect(stock.quantite).toBe(7);

    // Les autres caisses reçoivent seulement la nouveauté.
    const suite = await (await fetch(`${base}/sync/pull/?depuis=${premier.maintenant}`, { headers: enTetes })).json();
    expect(suite.tables).toEqual([
      { table: "stock.MouvementStock", enregistrements: [expect.objectContaining({ id: mouvementId, quantite: 3 })] },
    ]);
  });

  it("quitter le rôle arrête le serveur et débranche les caisses", async () => {
    await devenirPrincipalSurPortLibre();
    await appairer();
    await quitterPostePrincipal();
    expect(etatReseau()).toMatchObject({ role: "seul", enMarche: false, appareils: [] });
    await expect(fetch(`${base}/reseau/etat/`)).rejects.toThrow();
  });
});
