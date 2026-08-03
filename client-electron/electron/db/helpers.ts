import type { SqlValue } from "sql.js";

import { obtenirBaseDeDonnees } from "./index";

/** Petits alias pour éviter de répéter prepare/bind/step/free dans chaque service. */

export function tousLesResultats<T = Record<string, SqlValue>>(
  sql: string,
  parametres: SqlValue[] = [],
): T[] {
  const stmt = obtenirBaseDeDonnees().prepare(sql);
  stmt.bind(parametres);
  const resultats: T[] = [];
  while (stmt.step()) {
    resultats.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return resultats;
}

export function unResultat<T = Record<string, SqlValue>>(
  sql: string,
  parametres: SqlValue[] = [],
): T | undefined {
  return tousLesResultats<T>(sql, parametres)[0];
}

export function executer(sql: string, parametres: SqlValue[] = []): void {
  obtenirBaseDeDonnees().run(sql, parametres);
}

/** Équivalent de @transaction.atomic (Django) : annule tout si une erreur est levée à l'intérieur. */
export function dansUneTransaction<T>(operation: () => T): T {
  const db = obtenirBaseDeDonnees();
  db.run("BEGIN TRANSACTION");
  try {
    const resultat = operation();
    db.run("COMMIT");
    return resultat;
  } catch (erreur) {
    db.run("ROLLBACK");
    throw erreur;
  }
}

const _cacheColonnes = new Map<string, string[]>();

/**
 * Colonnes réelles d'une table locale (via PRAGMA, non paramétrable — `table`
 * vient toujours de notre propre registre, jamais d'une entrée utilisateur).
 * Sert à filtrer les clés d'un enregistrement reçu du serveur (pull) avant un
 * INSERT dynamique : un champ Django absent du schéma local (ex. "photo",
 * non synchronisé dans ce passage) est silencieusement ignoré plutôt que de
 * provoquer une erreur SQL "no such column".
 */
export function colonnesDeLaTable(table: string): string[] {
  const dejaEnCache = _cacheColonnes.get(table);
  if (dejaEnCache) return dejaEnCache;
  const colonnes = tousLesResultats<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);
  _cacheColonnes.set(table, colonnes);
  return colonnes;
}
