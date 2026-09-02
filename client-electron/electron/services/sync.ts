import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";

import { URL_BASE_API } from "../config";
import { colonnesDeLaTable, executer, tousLesResultats } from "../db/helpers";
import { sauvegarder } from "../db/index";
import { REGISTRE_CLIENT, type EntreeRegistreClient } from "../db/registre";
import { repliNavigateur, ressembleAUnDefiWaf } from "./httpClient";
import { recalculerStock } from "./stock";
import type { Session } from "./auth";

/**
 * Moteur générique de synchronisation, miroir de synchronisation/services.py
 * (Étape 8) : push = upsert des lignes locales non encore synchronisées ;
 * pull = upsert des enregistrements renvoyés par le serveur, dans l'ordre du
 * registre ; conflits déjà résolus côté serveur (dernier gagne) — le client
 * applique simplement le résultat.
 */

const DELAI_RESEAU_MS = 8000;

/**
 * fetch avec timeout : évite un blocage long (login, sync auto) si hors-ligne.
 * Bascule sur une fenêtre Electron cachée (voir httpClient.ts) si la réponse
 * ressemble au défi du WAF O2switch — jamais déclenché contre un serveur
 * local, qui ne renvoie pas cette signature.
 */
export async function appelerAvecDelai(url: string, options: RequestInit = {}): Promise<Response> {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), DELAI_RESEAU_MS);
  let reponse: Response;
  try {
    reponse = await fetch(url, { ...options, signal: controleur.signal });
  } finally {
    clearTimeout(minuteur);
  }
  if (!ressembleAUnDefiWaf(reponse)) return reponse;
  const { method, headers, body } = options as { method?: string; headers?: Record<string, string>; body?: string };
  return repliNavigateur(url, { method, headers, body });
}

const META_EXCLUES_VERS_SERVEUR = new Set([
  "id",
  "synchronise",
  "supprime",
  "date_synchronisation",
  "date_creation",
]);

export interface Changement {
  table: string;
  action: "cree" | "modifie" | "supprime";
  enregistrement_id: string;
  donnees: Record<string, unknown>;
}

export interface ResultatPush {
  table: string;
  enregistrement_id: string;
  statut: "synchronise" | "conflit" | "erreur";
  message?: string;
}

/** Ligne locale (colonnes `xxx_id`) → JSON attendu par le serveur (clés `xxx`). */
export function versDonneesServeur(
  entree: EntreeRegistreClient,
  ligne: Record<string, unknown>,
): Record<string, unknown> {
  const donnees: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(ligne)) {
    if (META_EXCLUES_VERS_SERVEUR.has(cle)) continue;
    const estFK = cle.endsWith("_id") && entree.champsFK.includes(cle.slice(0, -3));
    donnees[estFK ? cle.slice(0, -3) : cle] = valeur;
  }
  return donnees;
}

/** JSON du serveur (clés `xxx`) → ligne locale (colonnes `xxx_id`, booléens en 0/1). */
export function versLigneLocale(
  entree: EntreeRegistreClient,
  donnees: Record<string, unknown>,
): Record<string, unknown> {
  const ligne: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(donnees)) {
    const colonneLocale = entree.champsFK.includes(cle) ? `${cle}_id` : cle;
    ligne[colonneLocale] = typeof valeur === "boolean" ? (valeur ? 1 : 0) : valeur;
  }
  return ligne;
}

function construireChangements(boutiqueId: string): Changement[] {
  const changements: Changement[] = [];
  for (const entree of REGISTRE_CLIENT) {
    const lignes = tousLesResultats(
      `SELECT * FROM ${entree.tableLocale} WHERE synchronise = 0 AND (${entree.clauseBoutique})`,
      [boutiqueId],
    );
    for (const ligne of lignes) {
      changements.push({
        table: entree.table,
        action: Number(ligne.supprime) ? "supprime" : "cree",
        enregistrement_id: String(ligne.id),
        donnees: versDonneesServeur(entree, ligne),
      });
    }
  }
  return changements;
}

export async function pousser(session: Session, appareil: string): Promise<ResultatPush[]> {
  const changements = construireChangements(session.boutiqueId);
  if (changements.length === 0) return [];

  const reponse = await appelerAvecDelai(`${URL_BASE_API}/sync/push/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ appareil, changements }),
  });
  if (!reponse.ok) throw new Error(`Échec du push (HTTP ${reponse.status}).`);
  const { resultats } = (await reponse.json()) as { resultats: ResultatPush[] };

  const maintenant = new Date().toISOString();
  for (const resultat of resultats) {
    if (resultat.statut !== "synchronise") continue;
    const entree = REGISTRE_CLIENT.find((e) => e.table === resultat.table);
    if (!entree) continue;
    executer(`UPDATE ${entree.tableLocale} SET synchronise = 1, date_synchronisation = ? WHERE id = ?`, [
      maintenant,
      resultat.enregistrement_id,
    ]);
  }

  sauvegarder();
  return resultats;
}

export async function tirer(session: Session, depuis: string | null): Promise<string> {
  const url = new URL(`${URL_BASE_API}/sync/pull/`);
  if (depuis) url.searchParams.set("depuis", depuis);

  const reponse = await appelerAvecDelai(url.toString(), {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (!reponse.ok) throw new Error(`Échec du pull (HTTP ${reponse.status}).`);
  const corps = (await reponse.json()) as {
    maintenant: string;
    tables: { table: string; enregistrements: Record<string, unknown>[] }[];
  };

  const maintenant = new Date().toISOString();
  const pairesStock = new Set<string>();

  for (const tableReponse of corps.tables) {
    const entree = REGISTRE_CLIENT.find((e) => e.table === tableReponse.table);
    if (!entree) continue;
    const colonnesValides = new Set(colonnesDeLaTable(entree.tableLocale));

    for (const enr of tableReponse.enregistrements) {
      const ligne = versLigneLocale(entree, enr);
      ligne.synchronise = 1;
      ligne.date_synchronisation = maintenant;

      const colonnes = Object.keys(ligne).filter((c) => colonnesValides.has(c));
      const placeholders = colonnes.map(() => "?").join(", ");
      executer(
        `INSERT OR REPLACE INTO ${entree.tableLocale} (${colonnes.join(", ")}) VALUES (${placeholders})`,
        colonnes.map((c) => ligne[c] as never),
      );

      if (entree.table === "stock.MouvementStock") {
        pairesStock.add(`${ligne.variante_id}::${ligne.depot_id}`);
      }
    }
  }

  for (const paire of pairesStock) {
    const [varianteId, depotId] = paire.split("::");
    recalculerStock(varianteId, depotId);
  }

  sauvegarder();
  return corps.maintenant;
}

// --- État de synchro persisté (appareil, curseur, dernière synchro) ---

interface EtatSync {
  appareilId: string;
  dernierCurseur: string | null;
  derniereSynchro: string | null;
}

function cheminEtat(): string {
  return path.join(app.getPath("userData"), "sync-etat.json");
}

function lireEtat(): EtatSync {
  const chemin = cheminEtat();
  if (fs.existsSync(chemin)) {
    try {
      return JSON.parse(fs.readFileSync(chemin, "utf-8"));
    } catch {
      // fichier corrompu : on repart d'un état neuf ci-dessous
    }
  }
  const nouveau: EtatSync = { appareilId: randomUUID(), dernierCurseur: null, derniereSynchro: null };
  fs.writeFileSync(chemin, JSON.stringify(nouveau, null, 2));
  return nouveau;
}

function ecrireEtat(etat: EtatSync): void {
  fs.writeFileSync(cheminEtat(), JSON.stringify(etat, null, 2));
}

export interface ResumeSynchro {
  push: ResultatPush[];
  derniereSynchro: string;
}

/**
 * Activée uniquement par l'administrateur pour la boutique (comptes.Boutique.
 * synchro_autorisee, voir comptes/models.py) — certains commerçants ne
 * veulent pas que leurs données quittent leur poste. Vérifié ici (avant tout
 * appel réseau) plutôt que de laisser échouer sur un 403 du serveur, qui
 * gate quand même push/pull en dernier ressort (voir core/permissions.py::
 * SynchroAutorisee) au cas où la session locale serait périmée.
 */
export class SynchroNonAutoriseeError extends Error {}

export async function synchroniser(session: Session): Promise<ResumeSynchro> {
  if (!session.synchroAutorisee) {
    throw new SynchroNonAutoriseeError(
      "La synchronisation n'est pas encore activée pour votre boutique. Contactez l'administrateur pour l'activer.",
    );
  }
  const etat = lireEtat();
  const resultatsPush = await pousser(session, etat.appareilId);
  const curseur = await tirer(session, etat.dernierCurseur);
  const derniereSynchro = new Date().toISOString();
  ecrireEtat({ ...etat, dernierCurseur: curseur, derniereSynchro });
  return { push: resultatsPush, derniereSynchro };
}

export function etatSynchro(): { derniereSynchro: string | null } {
  if (!fs.existsSync(cheminEtat())) return { derniereSynchro: null };
  const etat = lireEtat();
  return { derniereSynchro: etat.derniereSynchro };
}

export async function verifierEnLigne(): Promise<boolean> {
  try {
    const controleur = new AbortController();
    const delai = setTimeout(() => controleur.abort(), 3000);
    const reponse = await fetch(`${URL_BASE_API}/auth/moi/`, { signal: controleur.signal });
    clearTimeout(delai);
    return reponse.status < 500;
  } catch {
    return false;
  }
}
