import { describe, expect, it } from "vitest";

import { calculerDatePlafond, etatAbonnement, venteAutorisee } from "../../electron/services/abonnement";

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

describe("abonnement.etatAbonnement (préavis de 7 jours, délai de grâce de 3 jours)", () => {
  const expiration = "2026-10-10T12:00:00.000Z";

  it("ok plus de 7 jours avant, « bientôt » dans les 7 derniers jours", () => {
    expect(etatAbonnement(expiration, "2026-10-01T12:00:00.000Z").niveau).toBe("ok");
    const bientot = etatAbonnement(expiration, "2026-10-05T12:00:00.000Z");
    expect(bientot.niveau).toBe("bientot");
    expect(bientot.joursRestants).toBe(5);
    expect(etatAbonnement(expiration, "2026-10-10T11:00:00.000Z").niveau).toBe("bientot");
  });

  it("délai de grâce : vente encore permise pendant 3 jours après l'expiration", () => {
    const grace = etatAbonnement(expiration, "2026-10-12T12:00:00.000Z");
    expect(grace.niveau).toBe("grace");
    expect(grace.finGrace).toBe("2026-10-13T12:00:00.000Z");
    expect(venteAutorisee(expiration, "2026-10-13T12:00:00.000Z")).toBe(true);
  });

  it("vente bloquée une fois le délai de grâce passé", () => {
    expect(etatAbonnement(expiration, "2026-10-13T12:00:01.000Z").niveau).toBe("bloque");
    expect(venteAutorisee(expiration, "2026-10-14T00:00:00.000Z")).toBe(false);
  });

  it("sans date d'expiration : jamais d'alerte ni de blocage", () => {
    expect(etatAbonnement(null, "2026-10-14T00:00:00.000Z")).toEqual({
      niveau: "ok",
      dateExpiration: null,
      finGrace: null,
      joursRestants: null,
    });
  });
});
