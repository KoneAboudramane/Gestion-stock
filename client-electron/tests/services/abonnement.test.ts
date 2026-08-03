import { describe, expect, it } from "vitest";

import { calculerDatePlafond, venteAutorisee } from "../../electron/services/abonnement";

describe("abonnement.calculerDatePlafond", () => {
  it("adopte la nouvelle date quand il n'y a pas encore de plafond mémorisé", () => {
    expect(calculerDatePlafond(null, "2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("avance le plafond quand l'horloge a normalement progressé", () => {
    expect(calculerDatePlafond("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z")).toBe(
      "2026-01-02T00:00:00.000Z",
    );
  });

  it("garde le plafond mémorisé quand l'horloge système a reculé", () => {
    expect(calculerDatePlafond("2026-01-05T00:00:00.000Z", "2020-01-01T00:00:00.000Z")).toBe(
      "2026-01-05T00:00:00.000Z",
    );
  });
});

describe("abonnement.venteAutorisee", () => {
  it("autorise quand la boutique n'a pas de date d'expiration (illimité)", () => {
    expect(venteAutorisee(null, "2026-01-01T00:00:00.000Z")).toBe(true);
    expect(venteAutorisee(undefined, "2026-01-01T00:00:00.000Z")).toBe(true);
  });

  it("refuse quand la date effective dépasse la date d'expiration", () => {
    expect(venteAutorisee("2020-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(false);
  });

  it("autorise quand la date d'expiration est encore dans le futur", () => {
    expect(venteAutorisee("2999-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(true);
  });
});
