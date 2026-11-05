import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";

import { URL_BASE_API } from "../config";
import { colonnesDeLaTable, executer, tousLesResultats, unResultat } from "../db/helpers";
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
 *
 * Le même moteur sert deux cibles (docs/plan_reseau_local.md, §4.1) : le
 * serveur en ligne et le poste principal de la boutique (réseau local), même
 * contrat /sync/push/ + /sync/pull/. Seuls changent l'adresse, la colonne qui
 * marque une ligne comme envoyée et ce qu'on transmet (voir CibleSynchro).
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
  "synchro_reseau",
  "seq_reseau",
]);

/**
 * Vers le poste principal, la ligne part entière (id, date de création,
 * suppression comprises) : il la recopie telle quelle, alors que le serveur
 * Django les gère lui-même. Seul le suivi propre à chaque poste reste.
 */
const META_EXCLUES_VERS_RESEAU = new Set(["synchronise", "date_synchronisation", "synchro_reseau", "seq_reseau"]);

/** Canal d'une synchronisation : vers le serveur en ligne ou vers le poste principal (réseau de la boutique). */
export type CanalSynchro = "en_ligne" | "reseau";

/** Où vont les changements, et comment on les y envoie. */
export interface CibleSynchro {
  canal: CanalSynchro;
  /** Ex. URL_BASE_API, ou « http://192.168.1.10:47800 » pour le poste principal. */
  urlBase: string;
  /** En-têtes d'authentification (jeton de session ou jeton d'appareil). */
  enTetes: Record<string, string>;
}

/** Colonne qui marque une ligne comme envoyée à cette cible. */
export function colonneEnvoi(canal: CanalSynchro): "synchronise" | "synchro_reseau" {
  return canal === "en_ligne" ? "synchronise" : "synchro_reseau";
}

export function cibleEnLigne(session: Session): CibleSynchro {
  return { canal: "en_ligne", urlBase: URL_BASE_API, enTetes: { Authorization: `Bearer ${session.accessToken}` } };
}

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

/** Ligne locale (colonnes `xxx_id`) → JSON attendu par le serveur ou le poste principal (clés `xxx`). */
export function versDonneesServeur(
  entree: EntreeRegistreClient,
  ligne: Record<string, unknown>,
  canal: CanalSynchro = "en_ligne",
): Record<string, unknown> {
  const exclues = canal === "en_ligne" ? META_EXCLUES_VERS_SERVEUR : META_EXCLUES_VERS_RESEAU;
  const donnees: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(ligne)) {
    if (exclues.has(cle)) continue;
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

/** Lignes pas encore envoyées à cette cible, au format du contrat /sync/push/. */
export function construireChangements(boutiqueId: string, canal: CanalSynchro = "en_ligne"): Changement[] {
  const colonne = colonneEnvoi(canal);
  const changements: Changement[] = [];
  for (const entree of REGISTRE_CLIENT) {
    const lignes = tousLesResultats(
      `SELECT * FROM ${entree.tableLocale} WHERE ${colonne} = 0 AND (${entree.clauseBoutique})`,
      [boutiqueId],
    );
    for (const ligne of lignes) {
      changements.push({
        table: entree.table,
        action: Number(ligne.supprime) ? "supprime" : "cree",
        enregistrement_id: String(ligne.id),
        donnees: versDonneesServeur(entree, ligne, canal),
      });
    }
  }
  return changements;
}

/** Marque comme envoyées à cette cible les lignes qu'elle a acceptées. */
export function marquerEnvoyes(canal: CanalSynchro, resultats: ResultatPush[]): void {
  const maintenant = new Date().toISOString();
  for (const resultat of resultats) {
    if (resultat.statut !== "synchronise") continue;
    const entree = REGISTRE_CLIENT.find((e) => e.table === resultat.table);
    if (!entree) continue;
    if (canal === "en_ligne") {
      executer(`UPDATE ${entree.tableLocale} SET synchronise = 1, date_synchronisation = ? WHERE id = ?`, [
        maintenant,
        resultat.enregistrement_id,
      ]);
    } else {
      executer(`UPDATE ${entree.tableLocale} SET synchro_reseau = 1 WHERE id = ?`, [resultat.enregistrement_id]);
    }
  }
}

export async function pousserVers(cible: CibleSynchro, boutiqueId: string, appareil: string): Promise<ResultatPush[]> {
  const changements = construireChangements(boutiqueId, cible.canal);
  if (changements.length === 0) return [];

  const reponse = await appelerAvecDelai(`${cible.urlBase}/sync/push/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cible.enTetes },
    body: JSON.stringify({ appareil, changements }),
  });
  if (!reponse.ok) throw new Error(`Échec du push (HTTP ${reponse.status}).`);
  const { resultats } = (await reponse.json()) as { resultats: ResultatPush[] };

  marquerEnvoyes(cible.canal, resultats);
  sauvegarder();
  return resultats;
}

export async function pousser(session: Session, appareil: string): Promise<ResultatPush[]> {
  return pousserVers(cibleEnLigne(session), session.boutiqueId, appareil);
}

/** Réponse du contrat /sync/pull/ : `maintenant` est le curseur à renvoyer au prochain pull. */
export interface ReponsePull {
  maintenant: string;
  tables: { table: string; enregistrements: Record<string, unknown>[] }[];
}

/**
 * Recopie localement ce qu'une cible a renvoyé (dans l'ordre du registre) puis
 * recalcule le stock touché. Ce qui vient du poste principal est marqué envoyé
 * des deux côtés : c'est lui qui le relaie au serveur en ligne.
 */
export function appliquerPull(corps: ReponsePull, canal: CanalSynchro = "en_ligne"): void {
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
      if (canal === "reseau") ligne.synchro_reseau = 1;

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
}

export async function tirerDe(cible: CibleSynchro, depuis: string | null): Promise<string> {
  const url = new URL(`${cible.urlBase}/sync/pull/`);
  if (depuis) url.searchParams.set("depuis", depuis);

  const reponse = await appelerAvecDelai(url.toString(), { headers: cible.enTetes });
  if (!reponse.ok) throw new Error(`Échec du pull (HTTP ${reponse.status}).`);
  const corps = (await reponse.json()) as ReponsePull;

  appliquerPull(corps, cible.canal);
  sauvegarder();
  return corps.maintenant;
}

export async function tirer(session: Session, depuis: string | null): Promise<string> {
  return tirerDe(cibleEnLigne(session), depuis);
}

// --- Côté poste principal (servi aux caisses par le serveur local, lot 2) ---

/** Donne un nouveau numéro d'écriture à une ligne, pour que les caisses la relisent. */
function renumeroter(tableLocale: string, id: string): void {
  executer("UPDATE compteur_reseau SET valeur = valeur + 1 WHERE id = 1");
  executer(`UPDATE ${tableLocale} SET seq_reseau = (SELECT valeur FROM compteur_reseau WHERE id = 1) WHERE id = ?`, [id]);
}

/**
 * Reçoit les changements d'une caisse : recopiés, laissés « à envoyer » au
 * serveur en ligne (le poste principal les relaie), stock recalculé. Même
 * règle et même forme de réponse que le serveur Django : la DERNIÈRE
 * modification gagne — une version plus ancienne que celle du poste principal
 * est refusée (« conflit ») et la version gagnante est renumérotée, pour que la
 * caisse la reçoive à son prochain pull (qui remplace la sienne).
 */
export function recevoirChangements(changements: Changement[]): ResultatPush[] {
  const resultats: ResultatPush[] = [];
  const pairesStock = new Set<string>();
  for (const changement of changements) {
    const entree = REGISTRE_CLIENT.find((e) => e.table === changement.table);
    if (!entree) {
      resultats.push({
        table: changement.table,
        enregistrement_id: changement.enregistrement_id,
        statut: "erreur",
        message: "Table inconnue.",
      });
      continue;
    }
    const colonnesValides = new Set(colonnesDeLaTable(entree.tableLocale));
    const existante = unResultat<{ date_modification: string | null }>(
      `SELECT date_modification FROM ${entree.tableLocale} WHERE id = ?`,
      [changement.enregistrement_id],
    );
    // Vraies dates (le serveur écrit « +00:00 » et des microsecondes, l'appli « Z ») ;
    // une date illisible ne bloque pas.
    const dateExistante = Date.parse(existante?.date_modification ?? "");
    const dateRecue = Date.parse(String(changement.donnees.date_modification ?? ""));
    if (dateExistante > dateRecue) {
      renumeroter(entree.tableLocale, changement.enregistrement_id);
      resultats.push({ table: changement.table, enregistrement_id: changement.enregistrement_id, statut: "conflit" });
      continue;
    }
    const ligne = versLigneLocale(entree, changement.donnees);
    ligne.id = changement.enregistrement_id;
    if (changement.action === "supprime") ligne.supprime = 1;
    ligne.synchronise = 0;
    ligne.synchro_reseau = 1;
    const colonnes = Object.keys(ligne).filter((c) => colonnesValides.has(c));
    executer(
      `INSERT OR REPLACE INTO ${entree.tableLocale} (${colonnes.join(", ")}) VALUES (${colonnes.map(() => "?").join(", ")})`,
      colonnes.map((c) => ligne[c] as never),
    );
    if (entree.table === "stock.MouvementStock") pairesStock.add(`${ligne.variante_id}::${ligne.depot_id}`);
    resultats.push({ table: changement.table, enregistrement_id: changement.enregistrement_id, statut: "synchronise" });
  }
  for (const paire of pairesStock) {
    const [varianteId, depotId] = paire.split("::");
    recalculerStock(varianteId, depotId);
  }
  return resultats;
}

/**
 * Ce qu'une caisse n'a pas encore : les lignes dont le numéro d'écriture
 * (seq_reseau) dépasse son curseur — tout, au premier passage (curseur nul).
 * Le curseur renvoyé est le plus grand numéro servi.
 */
export function extraireDepuis(boutiqueId: string, depuis: string | null): ReponsePull {
  const seuil = depuis === null ? null : Number(depuis);
  let curseur = seuil ?? 0;
  const tables: ReponsePull["tables"] = [];
  for (const entree of REGISTRE_CLIENT) {
    const lignes = tousLesResultats(
      `SELECT * FROM ${entree.tableLocale}
       WHERE (${entree.clauseBoutique})${seuil === null ? "" : " AND COALESCE(seq_reseau, 0) > ?"}
       ORDER BY seq_reseau`,
      seuil === null ? [boutiqueId] : [boutiqueId, seuil],
    );
    if (lignes.length === 0) continue;
    for (const ligne of lignes) curseur = Math.max(curseur, Number(ligne.seq_reseau ?? 0));
    tables.push({ table: entree.table, enregistrements: lignes.map((l) => versDonneesServeur(entree, l, "reseau")) });
  }
  return { maintenant: String(curseur), tables };
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

/**
 * Un échange complet avec une cible : envoyer, puis recevoir depuis le curseur.
 * Si la cible a refusé une ligne (« conflit » : elle a une version plus
 * récente, la dernière modification gagne), on recharge TOUT depuis elle :
 * c'est le seul moyen de récupérer sa version — elle peut être plus ancienne
 * que le curseur. Rare, et ça évite qu'une ligne refusée reste « en attente »
 * pour toujours (renvoyée à chaque synchronisation).
 */
export async function synchroniserVers(
  cible: CibleSynchro,
  boutiqueId: string,
  appareil: string,
  curseur: string | null,
): Promise<{ push: ResultatPush[]; curseur: string }> {
  const push = await pousserVers(cible, boutiqueId, appareil);
  const conflit = push.some((r) => r.statut === "conflit");
  return { push, curseur: await tirerDe(cible, conflit ? null : curseur) };
}

export async function synchroniser(session: Session): Promise<ResumeSynchro> {
  if (!session.synchroAutorisee) {
    throw new SynchroNonAutoriseeError(
      "La synchronisation n'est pas encore activée pour votre boutique. Contactez l'administrateur pour l'activer.",
    );
  }
  const etat = lireEtat();
  const { push, curseur } = await synchroniserVers(cibleEnLigne(session), session.boutiqueId, etat.appareilId, etat.dernierCurseur);
  const derniereSynchro = new Date().toISOString();
  ecrireEtat({ ...etat, dernierCurseur: curseur, derniereSynchro });
  return { push, derniereSynchro };
}

/** Changements locaux pas encore envoyés à cette cible, par type (ex. « ventes.Vente » → 3). */
export function compterEnAttente(
  boutiqueId: string,
  canal: CanalSynchro = "en_ligne",
): { table: string; nombre: number }[] {
  const resultat: { table: string; nombre: number }[] = [];
  for (const entree of REGISTRE_CLIENT) {
    const ligne = tousLesResultats<{ n: number }>(
      `SELECT COUNT(*) as n FROM ${entree.tableLocale} WHERE ${colonneEnvoi(canal)} = 0 AND (${entree.clauseBoutique})`,
      [boutiqueId],
    )[0];
    const nombre = Number(ligne?.n ?? 0);
    if (nombre > 0) resultat.push({ table: entree.table, nombre });
  }
  return resultat.sort((a, b) => b.nombre - a.nombre);
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
