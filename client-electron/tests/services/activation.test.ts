import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import { dateExpirationEffective } from "../../electron/services/abonnement";
import {
  CLE_PARAMETRE_CODE_ACTIVATION,
  ErreurActivation,
  appliquerCodeActivation,
  dateExpirationParCode,
  definirClePubliqueActivationPourLesTests,
  lireCodeActivation,
} from "../../electron/services/activation";
import { creerBaseDeTest } from "../setup";

// Lot 6 du plan réseau local : codes d'activation. Les deux codes ci-dessous ont
// été signés par le serveur (comptes/activation.py, Ed25519 en Python pur) avec
// la clé de test officielle de la RFC 8032 : Node doit les accepter tels quels.

const CLE_PUBLIQUE_TEST = "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=";
const BOUTIQUE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
/** Jusqu'au 31/01/2027, formule Pro. */
const CODE_JANVIER_2027 =
  "GS-AE7SK-BHAJ6-EUDU4-2BQBQ-L2BMG-MAQUG-YBUCP-UBTJG-PQSDL-Y2QLQ-WGGH7-VGQ7R-CD275-KXGNO-652MB-TARZR-PRNWD-EINMQ-MHXPE-O4NBX-L2AEA-2S7KU-WGZE4-5AKZ7-SG26L-TNSTU-OIY3J-5EKFQ-K";
/** Jusqu'au 31/12/2026, formule Essentiel. */
const CODE_DECEMBRE_2026 =
  "GS-AE7SK-BHAJ6-EUDU4-2BQBQ-L2BMG-MAQT7-AANMB-NPFBT-IEBCX-AOY4O-KD5SE-EXPFC-OZQB2-HEA34-A6IPD-UDN2G-KSGZQ-TCLWN-DIDBD-HUQ2T-S5CK6-CAAX2-WGV5G-44TY6-U43BK-ZCVT6-IITYK-OFUJA-Q";

/** Jusqu'au 31/12/2026, formule Essentiel avec les options Réseau et Mobile. */
const CODE_OPTIONS_DECEMBRE_2026 =
  "GS-AE7SK-BHAJ6-EUDU4-2BQBQ-L2BMG-MAQT7-AMRAW-DMFOT-XP7FG-X34SQ-KVT2Q-SHYDW-652XZ-L22IU-3HHYZ-GHMQQ-6DUXH-P5HZP-4WHXK-5UBVH-BLVIF-HMAOP-W7LOG-UXYAR-7UWGB-APF2V-ZIVM2-O57NA-A";

beforeEach(async () => {
  await creerBaseDeTest();
  definirClePubliqueActivationPourLesTests(CLE_PUBLIQUE_TEST);
});

afterEach(() => definirClePubliqueActivationPourLesTests(null));

describe("lecture d'un code d'activation (sans internet)", () => {
  it("un code signé par le serveur est accepté et lu", () => {
    expect(lireCodeActivation(CODE_JANVIER_2027)).toEqual({
      boutiqueId: BOUTIQUE,
      dateFin: "2027-01-31",
      formule: "pro",
      options: [],
    });
    // Collé sans tirets, en minuscules, avec des espaces : accepté aussi.
    expect(lireCodeActivation(` ${CODE_DECEMBRE_2026.toLowerCase().replace(/-/g, " ")} `)).toEqual({
      boutiqueId: BOUTIQUE,
      dateFin: "2026-12-31",
      formule: "essentiel",
      options: [],
    });
  });

  it("un code Essentiel peut emporter des options payantes (bits de l'octet de formule)", () => {
    expect(lireCodeActivation(CODE_OPTIONS_DECEMBRE_2026)).toEqual({
      boutiqueId: BOUTIQUE,
      dateFin: "2026-12-31",
      formule: "essentiel",
      options: ["reseau", "mobile"],
    });
  });

  it("un code modifié, tronqué ou signé par une autre clé est refusé", () => {
    const dernier = CODE_JANVIER_2027.slice(-1);
    expect(() => lireCodeActivation(CODE_JANVIER_2027.slice(0, -1) + (dernier === "A" ? "B" : "A"))).toThrow(ErreurActivation);
    expect(() => lireCodeActivation(CODE_JANVIER_2027.slice(0, 60))).toThrow(ErreurActivation);
    expect(() => lireCodeActivation("GS-12345")).toThrow(ErreurActivation);
    definirClePubliqueActivationPourLesTests(null); // la vraie clé de l'appli
    expect(() => lireCodeActivation(CODE_JANVIER_2027)).toThrow(ErreurActivation);
  });
});

describe("saisie du code sur le poste", () => {
  it("prolonge l'abonnement : la date la plus lointaine l'emporte, le code est gardé (transmis aux caisses)", () => {
    expect(appliquerCodeActivation(CODE_JANVIER_2027, BOUTIQUE, "2026-11-30T00:00:00.000Z").dateFin).toBe("2027-01-31");
    expect(dateExpirationParCode(BOUTIQUE)).toBe("2027-01-31T23:59:59.000Z");
    const parametre = unResultat<{ valeur: string; synchro_reseau: number }>(
      "SELECT valeur, synchro_reseau FROM parametres WHERE boutique_id = ? AND cle = ?",
      [BOUTIQUE, CLE_PARAMETRE_CODE_ACTIVATION],
    );
    expect(parametre).toMatchObject({ valeur: CODE_JANVIER_2027, synchro_reseau: 0 });

    // Une date du serveur plus ancienne n'efface pas le code ; une plus lointaine l'emporte.
    expect(dateExpirationEffective(BOUTIQUE, "2026-11-30T00:00:00Z")).toBe("2027-01-31T23:59:59.000Z");
    expect(dateExpirationEffective(BOUTIQUE, "2027-06-30T00:00:00Z")).toBe("2027-06-30T00:00:00Z");
    // Sans date du serveur (sans limite) : le code ne restreint rien.
    expect(dateExpirationEffective(BOUTIQUE, null)).toBeNull();
  });

  it("refuse un code d'une autre boutique, ou qui ne prolonge pas l'abonnement actuel", () => {
    expect(() =>
      appliquerCodeActivation(CODE_JANVIER_2027, "00000000-0000-0000-0000-000000000000", null),
    ).toThrow(/autre boutique/);
    expect(() => appliquerCodeActivation(CODE_DECEMBRE_2026, BOUTIQUE, "2027-01-31T23:59:59.000Z")).toThrow(
      /ne prolonge pas/,
    );
    expect(dateExpirationParCode(BOUTIQUE)).toBeNull();
  });

  it("un nouveau code remplace l'ancien (un seul réglage par boutique)", () => {
    appliquerCodeActivation(CODE_DECEMBRE_2026, BOUTIQUE, null);
    appliquerCodeActivation(CODE_JANVIER_2027, BOUTIQUE, "2026-12-31T23:59:59.000Z");
    const nombre = unResultat<{ n: number }>("SELECT COUNT(*) as n FROM parametres WHERE cle = ?", [CLE_PARAMETRE_CODE_ACTIVATION]);
    expect(Number(nombre?.n)).toBe(1);
    expect(dateExpirationParCode(BOUTIQUE)).toBe("2027-01-31T23:59:59.000Z");
    executer("DELETE FROM parametres");
  });
});
