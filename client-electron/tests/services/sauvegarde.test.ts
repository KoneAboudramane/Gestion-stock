import { constants, createPrivateKey, privateDecrypt, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executer } from "../../electron/db/helpers";
import {
  ErreurSauvegarde,
  SEUIL_ALERTE_JOURS,
  configurerSauvegarde,
  dechiffrer,
  definirCheminConfigSauvegardePourLesTests,
  definirSecoursPourLesTests,
  doitSauvegarder,
  etatSauvegarde,
  faireTournerSauvegardes,
  listerSauvegardes,
  prochaineSauvegarde,
  nomFichierSauvegarde,
  restaurerAvecSecours,
  restaurerSauvegarde,
  sauvegarderMaintenant,
  verifierSauvegardePlanifiee,
} from "../../electron/services/sauvegarde";
import { creerBaseDeTest } from "../setup";

// Lot 7 du plan réseau local : sauvegarde chiffrée de la boutique.

const MOT_DE_PASSE = "Bissap2026!";
const boutiqueId = randomUUID();
let dossier: string;
let dossierSauvegardes: string;

function fichiers(): string[] {
  return fs.readdirSync(dossierSauvegardes).filter((n) => n.endsWith(".gsbak"));
}

function configurer(): void {
  configurerSauvegarde({
    boutiqueId,
    boutiqueNom: "Boutique Élégance",
    dossier: dossierSauvegardes,
    heure: "21:00",
    conservation: "progressive",
    motDePasse: MOT_DE_PASSE,
  });
}

beforeEach(async () => {
  await creerBaseDeTest();
  executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [randomUUID(), boutiqueId, "Awa Koné"]);
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), "sauvegarde-"));
  dossierSauvegardes = path.join(dossier, "Google Drive", "Sauvegardes");
  fs.mkdirSync(dossierSauvegardes, { recursive: true });
  definirCheminConfigSauvegardePourLesTests(path.join(dossier, "sauvegarde.json"));
});

afterEach(() => {
  definirCheminConfigSauvegardePourLesTests(null);
  definirSecoursPourLesTests(null);
  fs.rmSync(dossier, { recursive: true, force: true });
});

describe("sauvegarde chiffrée", () => {
  it("le paramétrage fait une première sauvegarde, illisible sans le mot de passe du patron", () => {
    configurer();
    const [nom] = fichiers();
    expect(nom).toMatch(/^gestion-stock_Boutique-Elegance_\d{4}-\d{2}-\d{2}_\d{4}\.gsbak$/);
    const contenu = fs.readFileSync(path.join(dossierSauvegardes, nom));
    expect(contenu.includes(Buffer.from("Awa Koné"))).toBe(false); // chiffré
    expect(dechiffrer(contenu, MOT_DE_PASSE).subarray(0, 15).toString()).toBe("SQLite format 3");
    expect(() => dechiffrer(contenu, "mauvais")).toThrow(/Mot de passe incorrect/);
    expect(etatSauvegarde()).toMatchObject({ configuree: true, dernierFichier: nom, alerte: "aucune", echecsConsecutifs: 0 });
  });

  it("refuse un mot de passe trop court ou un dossier introuvable", () => {
    expect(() =>
      configurerSauvegarde({ boutiqueId, boutiqueNom: "B", dossier: dossierSauvegardes, heure: "21:00", conservation: "progressive", motDePasse: "court" }),
    ).toThrow(/8 caractères/);
    expect(() =>
      configurerSauvegarde({ boutiqueId, boutiqueNom: "B", dossier: path.join(dossier, "absent"), heure: "21:00", conservation: "progressive", motDePasse: MOT_DE_PASSE }),
    ).toThrow(/introuvable/);
  });

  it(`dossier débranché : l'échec est noté, alerte après ${SEUIL_ALERTE_JOURS} échecs de suite`, () => {
    configurer();
    fs.rmSync(dossierSauvegardes, { recursive: true, force: true });
    for (let i = 0; i < SEUIL_ALERTE_JOURS; i++) expect(() => sauvegarderMaintenant()).toThrow(ErreurSauvegarde);
    expect(etatSauvegarde()).toMatchObject({ echecsConsecutifs: SEUIL_ALERTE_JOURS, alerte: "echecs" });
    expect(etatSauvegarde().derniereErreur).toMatch(/Dossier introuvable/);
  });
});

describe("planification et conservation", () => {
  it("sauvegarde une fois par jour, après l'heure choisie", () => {
    const soir = new Date(2026, 9, 31, 21, 5);
    // Avant 21 h, la sauvegarde d'hier soir déjà faite suffit.
    expect(doitSauvegarder("21:00", new Date(2026, 9, 30, 21, 1).toISOString(), new Date(2026, 9, 31, 20, 59))).toBe(false);
    expect(doitSauvegarder("21:00", null, new Date(2026, 9, 31, 20, 59))).toBe(true); // jamais sauvegardé
    expect(doitSauvegarder("21:00", null, soir)).toBe(true);
    expect(doitSauvegarder("21:00", new Date(2026, 9, 31, 21, 1).toISOString(), soir)).toBe(false);
    expect(doitSauvegarder("21:00", new Date(2026, 9, 30, 21, 1).toISOString(), soir)).toBe(true);
    // Ordinateur éteint à 21 h : rattrapé le lendemain matin.
    expect(doitSauvegarder("21:00", new Date(2026, 9, 30, 21, 1).toISOString(), new Date(2026, 10, 1, 8, 0))).toBe(true);
  });

  it("la tâche planifiée ne refait pas la sauvegarde déjà faite", () => {
    configurer();
    const apres = new Date(Date.now() + 60_000);
    verifierSauvegardePlanifiee(apres);
    verifierSauvegardePlanifiee(apres);
    expect(fichiers().length).toBeLessThanOrEqual(2);
  });

  it("conservation progressive : chaque jour 30 j, une par semaine jusqu'à 6 mois, une par mois ensuite ; seulement ses fichiers", () => {
    const maintenant = new Date(2026, 9, 31, 22, 0);
    // Deux ans de sauvegardes quotidiennes à 21 h.
    for (let j = 0; j < 730; j++) {
      const date = new Date(2026, 9, 31 - j, 21, 0);
      fs.writeFileSync(path.join(dossierSauvegardes, nomFichierSauvegarde("B", date)), "x");
    }
    const autre = path.join(dossierSauvegardes, "photo-vacances.gsbak.jpg");
    fs.writeFileSync(autre, "x");

    faireTournerSauvegardes(dossierSauvegardes, "progressive", maintenant);
    const restants = fichiers();
    const age = (nom: string) => {
      const [, a, m, j] = /_(\d{4})-(\d{2})-(\d{2})_/.exec(nom)!;
      return (maintenant.getTime() - new Date(Number(a), Number(m) - 1, Number(j), 21).getTime()) / 86400000;
    };
    expect(restants.filter((n) => age(n) <= 30)).toHaveLength(30); // les 30 derniers jours, une par jour
    const hebdo = restants.filter((n) => age(n) > 30 && age(n) <= 183);
    expect(hebdo.length).toBeGreaterThanOrEqual(21);
    expect(hebdo.length).toBeLessThanOrEqual(23);
    const mensuelles = restants.filter((n) => age(n) > 183);
    const mois = new Set(mensuelles.map((n) => /_(\d{4}-\d{2})-/.exec(n)![1]));
    expect(mensuelles.length).toBe(mois.size); // une seule par mois
    expect(mois.size).toBeGreaterThanOrEqual(18);
    expect(restants.length).toBeLessThan(80); // au lieu de 730
    expect(fs.existsSync(autre)).toBe(true);
  });

  it("liste des copies (de la plus récente), catégorie, taille ; prochaine sauvegarde", () => {
    const maintenant = new Date(2026, 9, 31, 22, 0);
    for (const j of [0, 10, 60, 300]) {
      fs.writeFileSync(path.join(dossierSauvegardes, nomFichierSauvegarde("B", new Date(2026, 9, 31 - j, 21))), "xyz");
    }
    fs.writeFileSync(path.join(dossierSauvegardes, "autre-fichier.txt"), "x");
    const liste = listerSauvegardes(dossierSauvegardes, maintenant);
    expect(liste.accessible).toBe(true);
    expect(liste.copies.map((c) => c.categorie)).toEqual(["jour", "jour", "semaine", "mois"]);
    expect(liste.tailleTotale).toBe(12);
    expect(listerSauvegardes(path.join(dossier, "absent"), maintenant)).toMatchObject({ accessible: false, copies: [] });

    expect(prochaineSauvegarde("21:00", new Date(2026, 9, 31, 20, 0))).toEqual(new Date(2026, 9, 31, 21, 0));
    expect(prochaineSauvegarde("21:00", maintenant)).toEqual(new Date(2026, 10, 1, 21, 0));
  });

  it("ne jamais supprimer : tout est gardé", () => {
    for (let j = 0; j < 100; j++) {
      fs.writeFileSync(path.join(dossierSauvegardes, nomFichierSauvegarde("B", new Date(2026, 9, 31 - j, 21))), "x");
    }
    expect(faireTournerSauvegardes(dossierSauvegardes, "illimitee", new Date(2026, 9, 31, 22))).toEqual([]);
    expect(fichiers()).toHaveLength(100);
  });
});

describe("restauration", () => {
  it("vérifie avant de toucher à quoi que ce soit, met la base actuelle de côté, puis la remplace", () => {
    configurer();
    const sauvegarde = path.join(dossierSauvegardes, fichiers()[0]);
    const base = path.join(dossier, "gestion_stock.sqlite");
    fs.writeFileSync(base, "base actuelle");

    expect(() => restaurerSauvegarde(sauvegarde, "mauvais", base)).toThrow(/Mot de passe incorrect/);
    expect(fs.readFileSync(base, "utf-8")).toBe("base actuelle");

    restaurerSauvegarde(sauvegarde, MOT_DE_PASSE, base);
    expect(fs.readFileSync(base).subarray(0, 15).toString()).toBe("SQLite format 3");
    const misDeCote = fs.readdirSync(dossier).filter((n) => n.startsWith("gestion_stock.sqlite.avant-restauration-"));
    expect(misDeCote).toHaveLength(1);
    expect(fs.readFileSync(path.join(dossier, misDeCote[0]), "utf-8")).toBe("base actuelle");
  });
});

// Clé de test (manage.py generer_cle_secours --bits 1024) : la même paire sert aux tests serveur (comptes/tests.py).
const SECOURS_PUBLIQUE = {"kty": "RSA", "n": "3gNph8mdFkXgpI4nlnRdpci01-qzgrV3o6yVOfNJQLJYiph0OpJhuo5jLRu4YAcDTXaU60-cIdbGFT0ggxBkQszfhn8tavydJnr-prbwrTs7rBl1_jSITprlw1R-yTHrrUUujlbdmzfR89T6rra7FDJ7_hghAvj4FPASDW8qHkc", "e": "AQAB"};
const SECOURS_PRIVEE = {"kty": "RSA", "n": "3gNph8mdFkXgpI4nlnRdpci01-qzgrV3o6yVOfNJQLJYiph0OpJhuo5jLRu4YAcDTXaU60-cIdbGFT0ggxBkQszfhn8tavydJnr-prbwrTs7rBl1_jSITprlw1R-yTHrrUUujlbdmzfR89T6rra7FDJ7_hghAvj4FPASDW8qHkc", "e": "AQAB", "d": "A54yng_fC3ngC051vrHuxMDckZg1jK_AX150oBki3HcLklahrkKsbQnc--MzwfzbROvlyV_mv3Zsi_QPD5O4zoYahf1KmZRuAfzCArA0yxDTVpxztg76eAk_4tjdBVS-MSd8zbDZRN__wGcg2CJ4-6441nZrs1NgOUTNf79gSUE", "p": "6Scab9wHmA_UYRNEsbYw0audIzzBOjuixjHHEVxUoFteTc6KCeI9g9-RyKGppbCMlDfPgRZHrKkjp6ORkjWfyQ", "q": "88TdPihuLBTkIoyYJAjNhcAiMCdgxHruDj_yfpyn684tAXPeguySIg8M-7_JyNzzMcwq7ruw-QAqkKMWBTd1jw", "dp": "IigBXnvMfQFsqqAJA0PemQjcJ2piIGbWLNTkBe4R08Au65Ujcdk8C9K3572PPd_EaH5Ynt-ltmy89XUoAVRryQ", "dq": "i9J0sM2R_Bjzjlmkfq7J7Bj7wzEjETAN0gCeAD-tFdWJ_RZQIDq_y2dkpBYrENqjaAHa8lqYNQsCXzocTFu2Qw", "qi": "EYyh58pLJAAyCpqPEh-ZYG5QHclt2kqbO2a7nrs1xFV7lljCRbaeTSfX0Y2R39-VWwErjRhKIxtLY_AeQu9r5w"};

/** Faux serveur : ouvre la clé de secours avec la clé privée de test, comme comptes/views.py::SecoursSauvegardeView. */
function fauxServeurSecours(identifiantsAcceptes = true): typeof fetch {
  return (async (_url: string, options: { body: string }) => {
    const { username, cle_chiffree } = JSON.parse(options.body);
    if (!identifiantsAcceptes || username !== "admin") return new Response(JSON.stringify({ detail: "Accès refusé." }), { status: 403 });
    const clair = privateDecrypt(
      { key: createPrivateKey({ key: SECOURS_PRIVEE, format: "jwk" }), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(cle_chiffree, "base64"),
    );
    return new Response(JSON.stringify({ cle: clair.subarray(16).toString("base64"), boutique_nom: "Boutique Élégance" }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("clé de secours chez l'administrateur", () => {
  it("option cochée : la clé est aussi chiffrée pour l'administrateur (avec la boutique) ; le mot de passe marche toujours", () => {
    definirSecoursPourLesTests(SECOURS_PUBLIQUE);
    configurerSauvegarde({
      boutiqueId, boutiqueNom: "Boutique Élégance", dossier: dossierSauvegardes, heure: "21:00",
      conservation: "progressive", motDePasse: MOT_DE_PASSE, secours: true,
    });
    expect(etatSauvegarde().secours).toBe(true);
    const contenu = fs.readFileSync(path.join(dossierSauvegardes, fichiers()[0]));
    expect(contenu.subarray(0, 6).toString()).toBe("GSBAK2");
    const longueur = contenu.readUInt16BE(22);
    expect(longueur).toBe(128);
    const clair = privateDecrypt(
      { key: createPrivateKey({ key: SECOURS_PRIVEE, format: "jwk" }), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      contenu.subarray(24, 24 + longueur),
    );
    expect(clair.subarray(0, 16).toString("hex")).toBe(boutiqueId.replace(/-/g, ""));
    expect(dechiffrer(contenu, MOT_DE_PASSE).subarray(0, 15).toString()).toBe("SQLite format 3");
  });

  it("patron sans mot de passe : restauration par la clé de secours (admin), refus sans elle ou avec de mauvais identifiants", async () => {
    // Copie sans clé de secours : refusée.
    configurer();
    const sansSecours = path.join(dossierSauvegardes, fichiers()[0]);
    const base = path.join(dossier, "gestion_stock.sqlite");
    fs.writeFileSync(base, "base actuelle");
    definirSecoursPourLesTests(SECOURS_PUBLIQUE, fauxServeurSecours());
    await expect(restaurerAvecSecours(sansSecours, "admin", "x", base)).rejects.toThrow(/pas de clé de secours/);

    // Option cochée ensuite : les copies suivantes en ont une.
    fs.rmSync(sansSecours);
    const etat = etatSauvegarde();
    const { modifierReglagesSauvegarde } = await import("../../electron/services/sauvegarde");
    modifierReglagesSauvegarde({ dossier: etat.dossier!, heure: etat.heure!, conservation: "progressive", secours: true });
    sauvegarderMaintenant(new Date(Date.now() + 120_000));
    const avecSecours = path.join(dossierSauvegardes, fichiers()[0]);

    definirSecoursPourLesTests(SECOURS_PUBLIQUE, fauxServeurSecours(false));
    await expect(restaurerAvecSecours(avecSecours, "admin", "x", base)).rejects.toThrow(/refusés/);
    expect(fs.readFileSync(base, "utf-8")).toBe("base actuelle");

    definirSecoursPourLesTests(SECOURS_PUBLIQUE, fauxServeurSecours());
    await restaurerAvecSecours(avecSecours, "admin", "x", base);
    expect(fs.readFileSync(base).subarray(0, 15).toString()).toBe("SQLite format 3");
  });
});
