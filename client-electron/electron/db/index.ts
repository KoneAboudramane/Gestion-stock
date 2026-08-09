import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import initSqlJs, { type Database } from "sql.js";

import { SCHEMA_SQL } from "./schema";

let db: Database | null = null;
let cheminFichier: string;

export async function ouvrirBaseDeDonnees(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs({
    // sql.js n'expose pas "./package.json" dans son champ "exports" (Node le
    // refuserait) ; "./dist/*" y est en revanche explicitement autorisé.
    locateFile: (fichier) => require.resolve(`sql.js/dist/${fichier}`),
  });

  const dossierUserData = app.getPath("userData");
  if (!fs.existsSync(dossierUserData)) fs.mkdirSync(dossierUserData, { recursive: true });
  cheminFichier = path.join(dossierUserData, "gestion_stock.sqlite");

  const donneesExistantes = fs.existsSync(cheminFichier) ? fs.readFileSync(cheminFichier) : undefined;
  db = new SQL.Database(donneesExistantes);

  db.run(SCHEMA_SQL);
  migrerColonnesManquantes(db);

  return db;
}

/**
 * `CREATE TABLE IF NOT EXISTS` n'ajoute aucune colonne à une table déjà créée
 * sur un poste existant : on complète ici les colonnes ajoutées après coup au
 * schéma, sans jamais toucher aux données déjà présentes.
 */
function migrerColonnesManquantes(base: Database): void {
  const colonnesAAjouter: { table: string; colonne: string; definition: string }[] = [
    { table: "inventaires", colonne: "date_validation", definition: "TEXT" },
    { table: "lignes_inventaire", colonne: "prix_achat_fige", definition: "REAL DEFAULT 0" },
    { table: "boutiques", colonne: "date_expiration_abonnement", definition: "TEXT" },
    { table: "notifications", colonne: "depot_id", definition: "TEXT" },
    { table: "notifications", colonne: "utilisateur_id", definition: "TEXT" },
    { table: "paiements", colonne: "operateur", definition: "TEXT DEFAULT ''" },
    { table: "clients", colonne: "est_permanent", definition: "INTEGER DEFAULT 1" },
  ];

  for (const { table, colonne, definition } of colonnesAAjouter) {
    const infos = base.exec(`PRAGMA table_info(${table})`);
    const colonnesExistantes = infos[0]?.values.map((ligne) => ligne[1]) ?? [];
    if (!colonnesExistantes.includes(colonne)) {
      base.run(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
    }
  }
}

/** Réécrit le fichier .sqlite sur disque — appelé après chaque écriture pour limiter le risque de perte de données. */
export function sauvegarder(): void {
  // Pas de fichier associé quand la base est injectée pour les tests
  // (definirBaseDeDonneesPourLesTests) : rien à écrire, ce n'est pas une erreur.
  if (!db || !cheminFichier) return;
  const donnees = db.export();
  fs.writeFileSync(cheminFichier, Buffer.from(donnees));
}

export function obtenirBaseDeDonnees(): Database {
  if (!db) throw new Error("Base de données locale non initialisée : appeler ouvrirBaseDeDonnees() au démarrage.");
  return db;
}

/** Point d'injection utilisé par les tests (Vitest) : évite de dépendre du
 * module "electron" (app.getPath), indisponible hors du runtime Electron. */
export function definirBaseDeDonneesPourLesTests(instance: Database): void {
  db = instance;
}
