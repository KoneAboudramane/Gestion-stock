import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ErreurComptes,
  creerUtilisateur,
  listerRoles,
  listerUtilisateurs,
  modifierRole,
  supprimerUtilisateur,
} from "../../electron/services/comptes";
import type { Session } from "../../electron/services/auth";

const SESSION_TEST = { accessToken: "jeton-test", boutiqueId: "b1" } as Session;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("comptes.listerRoles / listerUtilisateurs", () => {
  it("appelle la bonne URL avec le bearer token et renvoie le JSON tel quel", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "r1", nom: "Patron", permissions: { vendre: true } }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const roles = await listerRoles(SESSION_TEST);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/roles/");
    expect((options as RequestInit).headers).toMatchObject({ Authorization: "Bearer jeton-test" });
    expect(roles).toEqual([{ id: "r1", nom: "Patron", permissions: { vendre: true } }]);
  });

  it("listerUtilisateurs appelle /utilisateurs/", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    await listerUtilisateurs(SESSION_TEST);

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/utilisateurs/");
  });
});

describe("comptes.creerUtilisateur", () => {
  it("poste le bon corps", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 3, username: "caissier1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await creerUtilisateur(SESSION_TEST, {
      username: "caissier1",
      password: "MotDePasse123",
      firstName: "Awa",
      roleId: "r2",
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/utilisateurs/");
    expect((options as RequestInit).method).toBe("POST");
    const corps = JSON.parse((options as RequestInit).body as string);
    expect(corps).toMatchObject({
      username: "caissier1",
      password: "MotDePasse123",
      first_name: "Awa",
      role: "r2",
    });
  });

  it("propage un message d'erreur lisible si la réponse n'est pas ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ username: ["Ce nom d'utilisateur existe déjà."] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      creerUtilisateur(SESSION_TEST, { username: "aboudramane", password: "MotDePasse123" }),
    ).rejects.toThrow(ErreurComptes);
    await expect(
      creerUtilisateur(SESSION_TEST, { username: "aboudramane", password: "MotDePasse123" }),
    ).rejects.toThrow("Ce nom d'utilisateur existe déjà.");
  });
});

describe("comptes.supprimerUtilisateur", () => {
  it("envoie un DELETE sur /utilisateurs/{id}/", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await supprimerUtilisateur(SESSION_TEST, 7);

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/utilisateurs/7/");
    expect((options as RequestInit).method).toBe("DELETE");
  });

  it("propage un message d'erreur lisible si la réponse n'est pas ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: "Le compte Patron ne peut pas être supprimé." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(supprimerUtilisateur(SESSION_TEST, 1)).rejects.toThrow(ErreurComptes);
    await expect(supprimerUtilisateur(SESSION_TEST, 1)).rejects.toThrow(
      "Le compte Patron ne peut pas être supprimé.",
    );
  });
});

describe("comptes.modifierRole", () => {
  it("envoie un PATCH avec les permissions mises à jour", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "r3", nom: "Caissier", permissions: { annuler_vente: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await modifierRole(SESSION_TEST, "r3", { annuler_vente: true });

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/roles/r3/");
    expect((options as RequestInit).method).toBe("PATCH");
    const corps = JSON.parse((options as RequestInit).body as string);
    expect(corps).toEqual({ permissions: { annuler_vente: true } });
  });
});
