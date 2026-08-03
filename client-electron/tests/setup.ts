import initSqlJs from "sql.js";

import { SCHEMA_SQL } from "../electron/db/schema";
import { definirBaseDeDonneesPourLesTests } from "../electron/db/index";

/** Base sql.js en mémoire, réinitialisée pour chaque test (pas de fichier, pas d'Electron). */
export async function creerBaseDeTest(): Promise<void> {
  const SQL = await initSqlJs({
    // sql.js n'expose pas "./package.json" dans son champ "exports" (Node le
    // refuserait) ; "./dist/*" y est en revanche explicitement autorisé.
    locateFile: (fichier) => require.resolve(`sql.js/dist/${fichier}`),
  });
  const db = new SQL.Database();
  db.run(SCHEMA_SQL);
  definirBaseDeDonneesPourLesTests(db);
}
