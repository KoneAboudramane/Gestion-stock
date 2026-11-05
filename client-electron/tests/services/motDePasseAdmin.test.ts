import { afterEach, describe, expect, it, vi } from "vitest";

import {
  connexion,
  lireReinitialisationsARefaire,
  listerComptesAdmin,
  ouvrirSessionLocale,
  reinitialiserMotDePasseAdmin,
  verifierAccesAdmin,
  type Session,
} from "../../electron/services/auth";
import { genererMotDePasse, soliditeMotDePasse } from "../../src/lib/motDePasse";

// Espace Admin → Réinitialiser mot de passe : en ligne, et sans internet (sur ce
// poste seulement, compte noté « à refaire en ligne », jamais de mot de passe gardé).

const SESSION_VENDEUR: Session = {
  accessToken: "a",
  refreshToken: "r",
  utilisateurId: "7",
  username: "awa",
  boutiqueId: "b1",
  boutiqueNom: "Boutique Awa",
  role: "Vendeur",
  permissions: {},
  depotId: null,
  depotNom: null,
  synchroAutorisee: false,
};

function reponse(statut: number, corps: unknown) {
  return { ok: statut < 400, status: statut, headers: new Headers(), json: async () => corps, text: async () => JSON.stringify(corps) };
}

const horsLigne = () => vi.fn().mockRejectedValue(new TypeError("fetch failed"));

afterEach(() => {
  vi.unstubAllGlobals();
});

async function preparerPoste() {
  // L'admin s'est déjà vérifié en ligne une fois sur ce poste ; le vendeur aussi s'y est connecté.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reponse(200, { autorise: true })).mockRejectedValue(new TypeError("fetch failed")));
  expect(await verifierAccesAdmin("admin", "AdminSolide123")).toBe(true);
  ouvrirSessionLocale("awa", "AncienSecret-2025", SESSION_VENDEUR);
}

describe("réinitialiser un mot de passe depuis l'Espace Admin", () => {
  it("sans internet : sur ce poste seulement, provisoire à changer, noté « à refaire en ligne »", async () => {
    await preparerPoste();
    vi.stubGlobal("fetch", horsLigne());

    expect(await reinitialiserMotDePasseAdmin("admin", "AdminSolide123", "awa", "Kalumo-Bitesa-4827", true)).toEqual({ statut: "local" });
    expect(lireReinitialisationsARefaire()).toContain("awa");

    const session = await connexion("awa", "Kalumo-Bitesa-4827");
    expect(session.doitChangerMotDePasse).toBe(true);
    await expect(connexion("awa", "AncienSecret-2025")).rejects.toThrow(/incorrect/);

    await expect(reinitialiserMotDePasseAdmin("admin", "AdminSolide123", "inconnu", "Kalumo-Bitesa-4827")).rejects.toThrow(
      /déjà connus de cet ordinateur/,
    );
    await expect(reinitialiserMotDePasseAdmin("admin", "MauvaisMotDePasse", "awa", "Kalumo-Bitesa-4827")).rejects.toThrow(/refusé/);

    const comptes = await listerComptesAdmin("admin", "AdminSolide123");
    expect(comptes.source).toBe("poste");
    expect(comptes.comptes.find((c) => c.username === "awa")).toMatchObject({ boutiqueNom: "Boutique Awa", doitChangerMotDePasse: true });
  });

  it("en ligne : envoyé au serveur (avec « doit changer ») et retiré de la liste à refaire", async () => {
    await preparerPoste();
    const fetchMock = vi.fn().mockResolvedValue(reponse(200, { detail: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await reinitialiserMotDePasseAdmin("admin", "AdminSolide123", "awa", "Nouveau-Secret-9", true)).toEqual({ statut: "enLigne" });
    const corps = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(corps).toMatchObject({ username_cible: "awa", nouveau_mot_de_passe: "Nouveau-Secret-9", doit_changer: true });
    expect(lireReinitialisationsARefaire()).not.toContain("awa");
  });
});

describe("mot de passe généré et solidité", () => {
  it("généré : lisible, solide, conforme aux règles du serveur", () => {
    const motDePasse = genererMotDePasse();
    expect(motDePasse).toMatch(/^[A-Z][a-z]{5}-[A-Z][a-z]{5}-\d{4}$/);
    expect(soliditeMotDePasse(motDePasse).manques).toEqual([]);
    expect(soliditeMotDePasse(motDePasse).score).toBeGreaterThanOrEqual(3);
  });

  it("règles : longueur, pas seulement des chiffres, pas l'identifiant", () => {
    expect(soliditeMotDePasse("abc").manques).toContain("8 caractères au moins");
    expect(soliditeMotDePasse("12345678").manques).toContain("pas seulement des chiffres");
    expect(soliditeMotDePasse("awa-secret-2026", "awa").manques).toContain("ne pas contenir l'identifiant");
  });
});
