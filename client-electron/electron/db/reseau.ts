import type { Database } from "sql.js";

import { REGISTRE_CLIENT } from "./registre";

/**
 * Suivi des changements pour le réseau de la boutique (docs/plan_reseau_local.md, §4.4-4.5).
 *
 * Sur chaque table synchronisée :
 * - `synchro_reseau` : la ligne a été envoyée au poste principal (comme `synchronise`
 *   pour le serveur en ligne) ;
 * - `seq_reseau` : numéro d'écriture, tiré d'un compteur local — le poste principal
 *   sert « tout ce qui a un numéro plus grand que N », sans se fier aux horloges des
 *   postes, qui diffèrent.
 *
 * Tenus à jour par des déclencheurs SQLite, pour ne toucher à aucune des écritures
 * existantes des services : toute insertion prend un nouveau numéro ; toute
 * modification d'une colonne métier prend un nouveau numéro ET repasse
 * `synchro_reseau` à 0. Marquer une ligne comme envoyée (synchronise,
 * date_synchronisation, synchro_reseau) ne compte pas comme une modification.
 */

/** Colonnes de suivi : jamais considérées comme des changements métier. */
export const COLONNES_SUIVI = new Set(["id", "synchronise", "date_synchronisation", "synchro_reseau", "seq_reseau"]);

function colonnes(base: Database, table: string): string[] {
  return (base.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((ligne) => String(ligne[1]));
}

/** À appeler à chaque ouverture de la base (et par les tests) : idempotent. */
export function installerSuiviReseau(base: Database): void {
  base.run(`CREATE TABLE IF NOT EXISTS compteur_reseau (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    valeur INTEGER NOT NULL
  )`);
  base.run("INSERT OR IGNORE INTO compteur_reseau (id, valeur) VALUES (1, 0)");

  for (const { tableLocale: table } of REGISTRE_CLIENT) {
    const existantes = colonnes(base, table);
    if (!existantes.includes("synchro_reseau")) {
      base.run(`ALTER TABLE ${table} ADD COLUMN synchro_reseau INTEGER DEFAULT 0`);
    }
    if (!existantes.includes("seq_reseau")) base.run(`ALTER TABLE ${table} ADD COLUMN seq_reseau INTEGER`);

    // Recréés à chaque ouverture : la liste des colonnes métier suit le schéma
    // (colonnes ajoutées par une migration).
    const metier = colonnes(base, table).filter((c) => !COLONNES_SUIVI.has(c));
    base.run(`DROP TRIGGER IF EXISTS reseau_insertion_${table}`);
    base.run(`DROP TRIGGER IF EXISTS reseau_modification_${table}`);
    base.run(`CREATE TRIGGER reseau_insertion_${table} AFTER INSERT ON ${table}
      BEGIN
        UPDATE compteur_reseau SET valeur = valeur + 1 WHERE id = 1;
        UPDATE ${table} SET seq_reseau = (SELECT valeur FROM compteur_reseau WHERE id = 1) WHERE id = NEW.id;
      END`);
    base.run(`CREATE TRIGGER reseau_modification_${table} AFTER UPDATE OF ${metier.join(", ")} ON ${table}
      BEGIN
        UPDATE compteur_reseau SET valeur = valeur + 1 WHERE id = 1;
        UPDATE ${table}
          SET seq_reseau = (SELECT valeur FROM compteur_reseau WHERE id = 1), synchro_reseau = 0
          WHERE id = NEW.id;
      END`);
  }
}
