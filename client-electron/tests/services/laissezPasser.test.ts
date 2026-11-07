import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ErreurLaissezPasser,
  definirLaissezPasserPourLesTests,
  lireLaissezPasser,
  noterUtilisation,
  verifierLaissezPasser,
} from "../../electron/services/laissezPasser";

// Laissez-passer admin (docs/plan_laissez_passer_admin.md) : codes signés par le
// serveur (administration/laissez_passer.py) avec la clé de test de la RFC 8032,
// pour « aboudramane » / « Secret-123 ». Node doit les lire tels quels.
const CLE_PUBLIQUE_TEST = "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=";
const JANVIER_2027 =
  "LP-AEAAC-AQDAQ-CQMBY-KDMAA-CAQDA-QCQMB-YIBEF-AWDAN-BYHZZ-I7KOS-5QFM3-BTKMS-JHMVG-G7NMR-SXVGQ-2EUQE-JPOTA-N2R3S-3D7MQ-LMFRG-65LEO-JQW2Y-LOMUJ-ROC67-Z733P-M6D7Z-WRMNM-DBNR5-5HIR2-4K6FG-X7IOY-L23WH-HHCAU-GO77G-A3VYL-5JUVD-IUBK6-2RO2N-P24N7-CQPIO-SNZIH-YFDI4-GUG4A-B";
const ILLIMITE =
  "LP-AEEAS-CQLBQ-GQ4D7-774IB-CEQTC-QKRMF-YYDEN-BWHA5-DYP7X-WAHDU-RNLS4-JTNFP-KXABF-MQ2QO-BEBKA-NLQ4D-EHE4U-FMIOU-5P5GI-LMFRG-65LEO-JQW2Y-LOMXX-AX76W-IK46J-ZJOCZ-ZJIQ5-WN5FM-QRHKB-QUBLZ-ISF4Q-O2MYM-LD3FZ-5F55O-HE2UU-SIQLV-E2SIM-JEIPN-IXNUB-5PYWD-ZCJL2-YHO5N-T6DTA-M";
const EXPIRE =
  "LP-AEIBC-EQTCQ-KRMFY-HEMQC-CIRDE-QSSMJ-ZIFEV-CWLBN-FYX4U-Q6SKN-4UEPM-VKD2U-SFHXH-2RITY-F5SPR-YCUDG-M5RAA-GDLRV-ESV5Y-LMFRG-65LEO-JQW2Y-LOMXV-BVTY6-53XNG-3ZMT4-3GSHP-XMVUT-Y6VBC-RFPXM-3XDVZ-6B6QF-CMSAP-ELRFA-RJJ5A-76ZB2-UJAHC-4AIAS-VDLDR-TYIZS-B72KG-R7YYJ-YG5SQ-C";

let dossier: string;

beforeEach(() => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), "laissez-passer-"));
  definirLaissezPasserPourLesTests(CLE_PUBLIQUE_TEST, path.join(dossier, "utilisations.json"));
});

afterEach(() => {
  definirLaissezPasserPourLesTests(null);
  fs.rmSync(dossier, { recursive: true, force: true });
});

describe("laissez-passer admin (sans internet)", () => {
  it("un code signé par le serveur est lu : numéro, admin, date de fin ou illimité", () => {
    expect(lireLaissezPasser(JANVIER_2027)).toMatchObject({ numero: "0001020304050607", identifiant: "aboudramane", dateFin: "2027-01-31" });
    expect(lireLaissezPasser(` ${ILLIMITE.toLowerCase().replace(/-/g, " ")} `).dateFin).toBeNull();
  });

  it("accepté seulement avec le bon admin, le bon mot de passe, et avant la date de fin", () => {
    expect(verifierLaissezPasser(JANVIER_2027, "aboudramane", "Secret-123").numero).toBe("0001020304050607");
    expect(verifierLaissezPasser(ILLIMITE, "aboudramane", "Secret-123").dateFin).toBeNull();
    expect(() => verifierLaissezPasser(JANVIER_2027, "aboudramane", "Secret-124")).toThrow(/Mot de passe incorrect/);
    expect(() => verifierLaissezPasser(JANVIER_2027, "autre", "Secret-123")).toThrow(/autre administrateur/);
    expect(() => verifierLaissezPasser(EXPIRE, "aboudramane", "Secret-123")).toThrow(/expiré le 01\/01\/2025/);
  });

  it("un code modifié, tronqué ou signé par une autre clé est refusé", () => {
    expect(() => lireLaissezPasser(JANVIER_2027.slice(0, -2) + "AA")).toThrow(ErreurLaissezPasser);
    expect(() => lireLaissezPasser(JANVIER_2027.slice(0, 80))).toThrow(ErreurLaissezPasser);
    definirLaissezPasserPourLesTests(null, path.join(dossier, "utilisations.json")); // la vraie clé de l'appli
    expect(() => lireLaissezPasser(JANVIER_2027)).toThrow(ErreurLaissezPasser);
  });

  it("l'utilisation est notée pour être signalée au serveur au retour d'internet", () => {
    const lu = verifierLaissezPasser(JANVIER_2027, "aboudramane", "Secret-123");
    noterUtilisation(lu);
    noterUtilisation(lu);
    const notees = JSON.parse(fs.readFileSync(path.join(dossier, "utilisations.json"), "utf-8"));
    expect(notees).toHaveLength(1);
    expect(notees[0]).toMatchObject({ numero: "0001020304050607", identifiant: "aboudramane" });
    expect(notees[0].aSignaler).toHaveLength(2);
  });
});
