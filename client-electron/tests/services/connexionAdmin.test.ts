import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ECHECS_ADMIN_AVANT_ATTENTE,
  connexion,
  connexionAdmin,
  etatConnexionAdmin,
  ouvrirSessionLocale,
  type Session,
} from "../../electron/services/auth";

// Connexion à l'Espace Admin : protection anti-essais appliquée par le moteur,
// messages clairs sans jamais dire si c'est le mot de passe ou le compte.

function reponse(corps: unknown, statut = 200) {
  return { ok: statut < 400, status: statut, headers: new Headers(), json: async () => corps, text: async () => JSON.stringify(corps) };
}

beforeEach(() => {
  for (const fichier of ["essais-espace-admin.json", "essais-connexion.json", "identifiants-admin-locaux.json"]) {
    fs.rmSync(path.join(app.getPath("userData"), fichier), { force: true });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connexion à l'Espace Admin", () => {
  it(`après ${ECHECS_ADMIN_AVANT_ATTENTE} échecs : attente imposée, sans même interroger le serveur`, async () => {
    const fetchMock = vi.fn().mockResolvedValue(reponse({ autorise: false }));
    vi.stubGlobal("fetch", fetchMock);

    for (let i = 1; i < ECHECS_ADMIN_AVANT_ATTENTE; i++) {
      await expect(connexionAdmin("abou", "faux")).rejects.toThrow(/Accès refusé : identifiant ou mot de passe incorrect/);
    }
    await expect(connexionAdmin("abou", "faux")).rejects.toThrow(/réessayez dans 30 s/);
    const appelsAvant = fetchMock.mock.calls.length;
    await expect(connexionAdmin("abou", "bon")).rejects.toThrow(/Trop d'essais/);
    expect(fetchMock.mock.calls.length).toBe(appelsAvant);

    const etat = await etatConnexionAdmin();
    expect(etat.echecs).toBe(ECHECS_ADMIN_AVANT_ATTENTE);
    expect(etat.attenteSecondes).toBeGreaterThan(25);
  });

  it("réussite : compteur remis à zéro, admin retenu pour entrer sans internet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reponse({ autorise: false })).mockResolvedValue(reponse({ autorise: true })));
    await expect(connexionAdmin("abou", "faux")).rejects.toThrow();
    expect(await connexionAdmin("abou", "AdminSolide123")).toEqual({ source: "serveur" });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const etat = await etatConnexionAdmin();
    expect(etat).toMatchObject({ serveurJoint: false, echecs: 0, adminsDuPoste: ["abou"] });
    expect(await connexionAdmin("abou", "AdminSolide123")).toEqual({ source: "poste" });
    await expect(connexionAdmin("abou", "faux")).rejects.toThrow(/vérifié sans internet/);
  });

  it("sans internet, un compte jamais vérifié ici : message clair", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(connexionAdmin("inconnu", "x")).rejects.toThrow(/jamais été vérifié en ligne sur cet ordinateur/);
  });
});

describe("connexion d'un compte de la boutique", () => {
  const SESSION = { username: "awa", boutiqueId: "b1", boutiqueNom: "Boutique Awa", accessToken: "", refreshToken: "" } as Session;

  it("mauvais mot de passe : message clair, puis attente ; une coupure d'internet ne compte pas", async () => {
    ouvrirSessionLocale("awa", "BonSecret-2026", SESSION);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    // Coupure d'internet + compte inconnu : pas compté comme un essai raté.
    await expect(connexion("inconnu", "x")).rejects.toThrow(/aucune connexion hors-ligne/);

    for (let i = 1; i < ECHECS_ADMIN_AVANT_ATTENTE; i++) {
      await expect(connexion("awa", "faux")).rejects.toThrow(/Mot de passe incorrect \(vérifié sans internet\)/);
    }
    await expect(connexion("awa", "faux")).rejects.toThrow(/réessayez dans 30 s/);
    await expect(connexion("awa", "BonSecret-2026")).rejects.toThrow(/Trop d'essais/);
  });

  it("en ligne, identifiants refusés par le serveur : « Identifiant ou mot de passe incorrect »", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(reponse({ detail: "Aucun compte actif n'a été trouvé avec les identifiants fournis" }, 401)),
    );
    await expect(connexion("awa", "faux")).rejects.toThrow(/^Identifiant ou mot de passe incorrect\./);
  });
});
