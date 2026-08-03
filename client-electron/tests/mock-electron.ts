import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { vi } from "vitest";

// electron/services/abonnement.ts appelle app.getPath("userData") — inexistant
// hors du process principal Electron. On fournit un dossier temporaire réel
// (les fonctions testées écrivent vraiment un petit fichier JSON).
const dossierTest = fs.mkdtempSync(path.join(os.tmpdir(), "gestion-stock-test-"));

vi.mock("electron", () => ({
  app: { getPath: () => dossierTest },
}));
