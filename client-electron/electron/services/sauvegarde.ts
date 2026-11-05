import { constants, createCipheriv, createDecipheriv, createPublicKey, publicEncrypt, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";

import { URL_BASE_API } from "../config";
import { cheminBaseDeDonnees, obtenirBaseDeDonnees } from "../db/index";
import { sessionActuelle } from "./auth";

/**
 * Sauvegarde de la boutique (docs/plan_reseau_local.md, lot 7) : chaque jour, à
 * l'heure choisie pour la boutique, la base entière est chiffrée et déposée
 * dans un dossier — en pratique le dossier « Google Drive pour ordinateur »
 * connecté au compte Google DE LA BOUTIQUE (option A) : Google l'envoie dès
 * qu'internet est là. Paramétrée par l'admin dans l'Espace Admin ; le patron
 * tape lui-même le mot de passe, que personne d'autre ne connaît.
 *
 * Chiffrement : AES-256-GCM, clé tirée du mot de passe par scrypt (sel dans le
 * fichier). La clé est gardée sur ce poste (protégée par Windows quand c'est
 * possible) pour les sauvegardes automatiques ; le mot de passe n'est redemandé
 * que pour RESTAURER. Sans lui, une sauvegarde est illisible — y compris pour
 * Google et pour l'admin.
 *
 * Fichier `.gsbak` (version 2) : « GSBAK2 » (6 o) + sel (16 o) + longueur de la
 * clé de secours (2 o) + clé de secours (0 ou 384 o) + IV (12 o) + étiquette GCM
 * (16 o) + base chiffrée ; l'en-tête est authentifié (AAD). Version 1 (lue
 * seulement) : « GSBAK1 » + sel + IV + étiquette + base chiffrée.
 *
 * Clé de secours (option, avec l'accord du patron) : la clé de la sauvegarde
 * (avec l'identifiant de la boutique) est aussi chiffrée par la clé PUBLIQUE de
 * l'administrateur (RSA-OAEP SHA-256) ; seule la clé privée du serveur
 * l'ouvre (comptes/secours.py) — si le patron perd son mot de passe.
 */

const MAGIQUE = Buffer.from("GSBAK1");
const MAGIQUE_V2 = Buffer.from("GSBAK2");
/** Clé publique de la clé de secours (manage.py generer_cle_secours) ; la clé privée reste sur le serveur. */
export const CLE_PUBLIQUE_SECOURS = { kty: "RSA", n: "0rrhNzhZO-t8JP85S5BPnz4sirn0iNq2M0f77-bCHCVZz1uPw030AGBUuGrBmIQ4CY8Q7Rqn_u828HjZaG34H5ZgaQZUXYPZvZPYOKOiOkthSyJfpmMLoh4liONpBo0YPaVRuUN5DRV72snEfBulN94J6QnmdGHKNZzFqJTxlSc9CfmZ5EebEExYegCdu7gA6ipHDtwAf-IdSg7FWNRv_uU-j7CcYNBaTuh6W5NmvaVURtpnt5p7KK9gz4x2_0Oa1EMRB23iJz0tnNnMSIMYyuUhK5jtr-X_4CbYYi_aW4QodMBf2-rWn2DFsXIwHMhMfmcpk_XYAwmrZzR_AiUoSM02bMhILaa4yDhsZdi8imy79wQCp5ti1jzxLXusc5eeU7v5TFWtno07P5mumw6R8wSX3hLCxSzCrl4OCQmtVyk5zyTZfQby-NsMYpxdH5XIwHPSrF6zBYfFb14qzkIKkITdQXtoWPeWPa8QqfBvwEZPnHkdNg-LblrIcMSBaqgL", e: "AQAB" };
let clePubliqueSecoursTests: { kty: string; n: string; e: string } | null = null;
let fetchSecoursTests: typeof fetch | null = null;

/** Tests : autre clé publique de secours, et faux serveur pour la restauration. */
export function definirSecoursPourLesTests(
  cle: { kty: string; n: string; e: string } | null,
  appel: typeof fetch | null = null,
): void {
  clePubliqueSecoursTests = cle;
  fetchSecoursTests = appel;
}
const EXTENSION = ".gsbak";
const ENTETE_SQLITE = Buffer.from("SQLite format 3\0");
/** Échecs consécutifs (ou jours sans sauvegarde) à partir desquels le patron est alerté. */
export const SEUIL_ALERTE_JOURS = 3;

export class ErreurSauvegarde extends Error {}

/**
 * « progressive » (par défaut) : chaque jour pendant 30 jours, puis une par
 * semaine jusqu'à 6 mois, puis une par mois pour toujours — on peut revenir à
 * n'importe quel mois sans remplir le Drive. « illimitee » : rien n'est supprimé.
 */
export type Conservation = "progressive" | "illimitee";
const JOURS_QUOTIDIENNES = 30;
const JOURS_HEBDOMADAIRES = 183;

interface ConfigSauvegarde {
  boutiqueId: string;
  boutiqueNom: string;
  dossier: string;
  /** « HH:MM » */
  heure: string;
  /** Absente des configurations d'avant ce réglage : progressive. */
  conservation?: Conservation;
  /** Clé de secours chez l'administrateur (accord du patron) : clé de la sauvegarde chiffrée pour lui (base64). */
  secours?: boolean;
  cleSecours?: string;
  /** Sel scrypt (hex), le même dans chaque fichier tant que le mot de passe ne change pas. */
  sel: string;
  /** Clé AES : « dpapi:… » (protégée par Windows) ou « clair:… » (repli). */
  cle: string;
  derniereSauvegarde: string | null;
  dernierFichier: string | null;
  derniereErreur: string | null;
  echecsConsecutifs: number;
}

let cheminConfigTests: string | null = null;

/** Tests : configuration hors du dossier de l'appli. */
export function definirCheminConfigSauvegardePourLesTests(chemin: string | null): void {
  cheminConfigTests = chemin;
}

function cheminConfig(): string {
  return cheminConfigTests ?? path.join(app.getPath("userData"), "sauvegarde.json");
}

function lireConfig(): ConfigSauvegarde | null {
  try {
    const config = JSON.parse(fs.readFileSync(cheminConfig(), "utf-8"));
    return config?.dossier && config.cle ? (config as ConfigSauvegarde) : null;
  } catch {
    return null;
  }
}

function ecrireConfig(config: ConfigSauvegarde | null): void {
  if (config === null) fs.rmSync(cheminConfig(), { force: true });
  else fs.writeFileSync(cheminConfig(), JSON.stringify(config, null, 2));
}

// --- Clé et chiffrement ---

export function deriverCle(motDePasse: string, sel: Buffer): Buffer {
  return scryptSync(motDePasse, sel, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function protegerCle(cle: Buffer): string {
  try {
    if (safeStorage?.isEncryptionAvailable()) return `dpapi:${safeStorage.encryptString(cle.toString("base64")).toString("base64")}`;
  } catch {
    // tests ou système sans coffre : repli ci-dessous
  }
  return `clair:${cle.toString("base64")}`;
}

function libererCle(protegee: string): Buffer {
  if (protegee.startsWith("dpapi:")) {
    return Buffer.from(safeStorage.decryptString(Buffer.from(protegee.slice(6), "base64")), "base64");
  }
  return Buffer.from(protegee.replace(/^clair:/, ""), "base64");
}

/** Clé de la sauvegarde (+ identifiant de la boutique) chiffrée pour l'administrateur. */
export function envelopperCleSecours(boutiqueId: string, cle: Buffer): Buffer {
  const jwk = clePubliqueSecoursTests ?? CLE_PUBLIQUE_SECOURS;
  return publicEncrypt(
    { key: createPublicKey({ key: jwk, format: "jwk" }), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.concat([Buffer.from(boutiqueId.replace(/-/g, ""), "hex"), cle]),
  );
}

export function chiffrer(donnees: Uint8Array, cle: Buffer, sel: Buffer, cleSecours: Buffer | null = null): Buffer {
  const longueur = Buffer.alloc(2);
  longueur.writeUInt16BE(cleSecours?.length ?? 0);
  const entete = Buffer.concat([MAGIQUE_V2, sel, longueur, cleSecours ?? Buffer.alloc(0)]);
  const iv = randomBytes(12);
  const chiffreur = createCipheriv("aes-256-gcm", cle, iv);
  chiffreur.setAAD(entete);
  const chiffre = Buffer.concat([chiffreur.update(donnees), chiffreur.final()]);
  return Buffer.concat([entete, iv, chiffreur.getAuthTag(), chiffre]);
}

interface EnteteSauvegarde {
  sel: Buffer;
  cleSecours: Buffer | null;
  iv: Buffer;
  etiquette: Buffer;
  corps: Buffer;
  aad: Buffer | null;
}

function lireEntete(fichier: Buffer): EnteteSauvegarde {
  const magique = fichier.subarray(0, 6);
  if (magique.equals(MAGIQUE) && fichier.length >= 50) {
    return {
      sel: fichier.subarray(6, 22),
      cleSecours: null,
      iv: fichier.subarray(22, 34),
      etiquette: fichier.subarray(34, 50),
      corps: fichier.subarray(50),
      aad: null,
    };
  }
  if (magique.equals(MAGIQUE_V2) && fichier.length >= 52) {
    const longueur = fichier.readUInt16BE(22);
    const fin = 24 + longueur;
    if (fichier.length >= fin + 28) {
      return {
        sel: fichier.subarray(6, 22),
        cleSecours: longueur > 0 ? fichier.subarray(24, fin) : null,
        iv: fichier.subarray(fin, fin + 12),
        etiquette: fichier.subarray(fin + 12, fin + 28),
        corps: fichier.subarray(fin + 28),
        aad: fichier.subarray(0, fin),
      };
    }
  }
  throw new ErreurSauvegarde("Ce fichier n'est pas une sauvegarde de l'application.");
}

function dechiffrerAvecCle(fichier: Buffer, cle: Buffer, messageErreur: string): Buffer {
  const entete = lireEntete(fichier);
  try {
    const dechiffreur = createDecipheriv("aes-256-gcm", cle, entete.iv);
    if (entete.aad) dechiffreur.setAAD(entete.aad);
    dechiffreur.setAuthTag(entete.etiquette);
    return Buffer.concat([dechiffreur.update(entete.corps), dechiffreur.final()]);
  } catch {
    throw new ErreurSauvegarde(messageErreur);
  }
}

/** Déchiffre un fichier .gsbak avec le mot de passe du patron. */
export function dechiffrer(fichier: Buffer, motDePasse: string): Buffer {
  const { sel } = lireEntete(fichier);
  return dechiffrerAvecCle(fichier, deriverCle(motDePasse, sel), "Mot de passe incorrect, ou fichier de sauvegarde abîmé.");
}

/** La copie a-t-elle une clé de secours (option cochée quand elle a été faite) ? */
export function aUneCleSecours(fichier: string): boolean {
  try {
    return lireEntete(fs.readFileSync(fichier)).cleSecours !== null;
  } catch {
    return false;
  }
}

// --- Noms, conservation, planification ---

function nomPropre(texte: string): string {
  return (
    texte
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "boutique"
  );
}

function deuxChiffres(n: number): string {
  return String(n).padStart(2, "0");
}

/** « gestion-stock_Ma-Boutique_2026-10-31_2100.gsbak » (heure locale). */
export function nomFichierSauvegarde(boutiqueNom: string, date: Date): string {
  const jour = `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
  return `gestion-stock_${nomPropre(boutiqueNom)}_${jour}_${deuxChiffres(date.getHours())}${deuxChiffres(date.getMinutes())}${EXTENSION}`;
}

/** Date d'une sauvegarde, lue dans son nom (le Drive peut changer la date du fichier), sinon celle du fichier. */
function dateSauvegarde(dossier: string, nom: string): Date {
  const m = /_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})\.gsbak$/.exec(nom);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return new Date(fs.statSync(path.join(dossier, nom)).mtimeMs);
}

/** Lundi de la semaine (« 2026-10-26 »), pour garder une sauvegarde par semaine. */
function cleSemaine(date: Date): string {
  const lundi = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  return `${lundi.getFullYear()}-${deuxChiffres(lundi.getMonth() + 1)}-${deuxChiffres(lundi.getDate())}`;
}

/**
 * Conservation progressive (voir Conservation) : supprime les sauvegardes en
 * trop, jamais la plus récente, et seulement les fichiers de l'application.
 * Dans chaque semaine / chaque mois, c'est la plus récente qui est gardée.
 */
export function faireTournerSauvegardes(dossier: string, conservation: Conservation, maintenant: Date): string[] {
  if (conservation === "illimitee") return [];
  const sauvegardes = fs
    .readdirSync(dossier)
    .filter((nom) => nom.startsWith("gestion-stock_") && nom.endsWith(EXTENSION))
    .map((nom) => ({ nom, date: dateSauvegarde(dossier, nom) }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const semainesGardees = new Set<string>();
  const moisGardes = new Set<string>();
  const supprimes: string[] = [];
  sauvegardes.forEach(({ nom, date }, index) => {
    const ageJours = (maintenant.getTime() - date.getTime()) / 86400000;
    let garder: boolean;
    if (index === 0 || ageJours <= JOURS_QUOTIDIENNES) {
      garder = true;
    } else if (ageJours <= JOURS_HEBDOMADAIRES) {
      const cle = cleSemaine(date);
      garder = !semainesGardees.has(cle);
      semainesGardees.add(cle);
    } else {
      const cle = `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}`;
      garder = !moisGardes.has(cle);
      moisGardes.add(cle);
    }
    if (!garder) {
      fs.rmSync(path.join(dossier, nom), { force: true });
      supprimes.push(nom);
    }
  });
  return supprimes;
}

/**
 * Faut-il sauvegarder maintenant ? Oui si aucune sauvegarde n'a eu lieu depuis
 * le dernier créneau passé — celui d'aujourd'hui s'il est passé, sinon celui
 * d'hier : un ordinateur éteint à l'heure prévue rattrape au démarrage suivant.
 */
export function doitSauvegarder(heure: string, derniereSauvegarde: string | null, maintenant: Date): boolean {
  const [h, m] = heure.split(":").map(Number);
  const creneau = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate(), h || 0, m || 0);
  if (maintenant < creneau) creneau.setDate(creneau.getDate() - 1);
  return !derniereSauvegarde || new Date(derniereSauvegarde) < creneau;
}

/** Prochain créneau de sauvegarde : aujourd'hui à l'heure choisie si elle n'est pas passée, sinon demain. */
export function prochaineSauvegarde(heure: string, maintenant: Date): Date {
  const [h, m] = heure.split(":").map(Number);
  const creneau = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate(), h || 0, m || 0);
  if (creneau <= maintenant) creneau.setDate(creneau.getDate() + 1);
  return creneau;
}

export interface CopieSauvegarde {
  nom: string;
  chemin: string;
  date: string;
  taille: number;
  /** Pourquoi elle est gardée (conservation progressive) : copie du jour, de la semaine ou du mois. */
  categorie: "jour" | "semaine" | "mois";
}

/**
 * Copies présentes dans le dossier (celui de la configuration, ou un autre
 * choisi pour restaurer sur un nouvel ordinateur), de la plus récente à la plus
 * ancienne. Seulement les fichiers de l'application.
 */
export function listerSauvegardes(
  dossierChoisi?: string | null,
  maintenant = new Date(),
): { dossier: string | null; accessible: boolean; copies: CopieSauvegarde[]; tailleTotale: number } {
  const dossier = dossierChoisi || lireConfig()?.dossier || null;
  if (!dossier || !fs.existsSync(dossier)) return { dossier, accessible: false, copies: [], tailleTotale: 0 };
  const copies = fs
    .readdirSync(dossier)
    .filter((nom) => nom.startsWith("gestion-stock_") && nom.endsWith(EXTENSION))
    .map((nom): CopieSauvegarde => {
      const date = dateSauvegarde(dossier, nom);
      const ageJours = (maintenant.getTime() - date.getTime()) / 86400000;
      return {
        nom,
        chemin: path.join(dossier, nom),
        date: date.toISOString(),
        taille: fs.statSync(path.join(dossier, nom)).size,
        categorie: ageJours <= JOURS_QUOTIDIENNES ? "jour" : ageJours <= JOURS_HEBDOMADAIRES ? "semaine" : "mois",
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return { dossier, accessible: true, copies, tailleTotale: copies.reduce((t, c) => t + c.taille, 0) };
}

// --- Opérations ---

export interface EtatSauvegarde {
  configuree: boolean;
  dossier: string | null;
  heure: string | null;
  conservation: Conservation | null;
  /** Prochaine sauvegarde prévue (heure locale du poste). */
  prochaine: string | null;
  /** Clé de secours chez l'administrateur (accord du patron). */
  secours: boolean;
  derniereSauvegarde: string | null;
  dernierFichier: string | null;
  derniereErreur: string | null;
  echecsConsecutifs: number;
  /** « echecs » : plusieurs échecs de suite ; « ancienne » : pas de sauvegarde depuis SEUIL_ALERTE_JOURS jours. */
  alerte: "aucune" | "echecs" | "ancienne";
}

export function etatSauvegarde(maintenant = new Date()): EtatSauvegarde {
  const config = lireConfig();
  if (!config) {
    return {
      configuree: false,
      dossier: null,
      heure: null,
      conservation: null,
      prochaine: null,
      secours: false,
      derniereSauvegarde: null,
      dernierFichier: null,
      derniereErreur: null,
      echecsConsecutifs: 0,
      alerte: "aucune",
    };
  }
  const ancienne =
    !config.derniereSauvegarde ||
    maintenant.getTime() - new Date(config.derniereSauvegarde).getTime() > SEUIL_ALERTE_JOURS * 86400000;
  return {
    configuree: true,
    dossier: config.dossier,
    heure: config.heure,
    conservation: config.conservation ?? "progressive",
    prochaine: prochaineSauvegarde(config.heure, maintenant).toISOString(),
    secours: !!(config.secours && config.cleSecours),
    derniereSauvegarde: config.derniereSauvegarde,
    dernierFichier: config.dernierFichier,
    derniereErreur: config.derniereErreur,
    echecsConsecutifs: config.echecsConsecutifs,
    alerte: config.echecsConsecutifs >= SEUIL_ALERTE_JOURS ? "echecs" : ancienne ? "ancienne" : "aucune",
  };
}

function verifierReglages(dossier: string, heure: string, conservation: Conservation): void {
  if (!dossier || !fs.existsSync(dossier) || !fs.statSync(dossier).isDirectory()) {
    throw new ErreurSauvegarde("Dossier de sauvegarde introuvable.");
  }
  if (!/^\d{2}:\d{2}$/.test(heure)) throw new ErreurSauvegarde("Heure invalide (format HH:MM).");
  if (conservation !== "progressive" && conservation !== "illimitee") {
    throw new ErreurSauvegarde("Choix de conservation invalide.");
  }
}

function verifierMotDePasse(motDePasse: string): void {
  if (motDePasse.length < 8) throw new ErreurSauvegarde("Le mot de passe doit faire au moins 8 caractères.");
}

/** Paramétrage par l'admin (mot de passe tapé par le patron), puis première sauvegarde. */
export function configurerSauvegarde(params: {
  boutiqueId: string;
  boutiqueNom: string;
  dossier: string;
  heure: string;
  conservation: Conservation;
  motDePasse: string;
  /** Clé de secours chez l'administrateur, avec l'accord du patron. */
  secours?: boolean;
}): EtatSauvegarde {
  verifierReglages(params.dossier, params.heure, params.conservation);
  verifierMotDePasse(params.motDePasse);
  const sel = randomBytes(16);
  const cle = deriverCle(params.motDePasse, sel);
  ecrireConfig({
    boutiqueId: params.boutiqueId,
    boutiqueNom: params.boutiqueNom,
    dossier: params.dossier,
    heure: params.heure,
    conservation: params.conservation,
    secours: !!params.secours,
    cleSecours: params.secours ? envelopperCleSecours(params.boutiqueId, cle).toString("base64") : undefined,
    sel: sel.toString("hex"),
    cle: protegerCle(cle),
    derniereSauvegarde: null,
    dernierFichier: null,
    derniereErreur: null,
    echecsConsecutifs: 0,
  });
  sauvegarderMaintenant();
  return etatSauvegarde();
}

/** Dossier, heure, conservation (sans toucher au mot de passe). */
export function modifierReglagesSauvegarde(params: {
  dossier: string;
  heure: string;
  conservation: Conservation;
  secours?: boolean;
}): EtatSauvegarde {
  const config = lireConfig();
  if (!config) throw new ErreurSauvegarde("La sauvegarde n'est pas encore paramétrée.");
  verifierReglages(params.dossier, params.heure, params.conservation);
  const secours = params.secours ?? !!config.secours;
  ecrireConfig({
    ...config,
    dossier: params.dossier,
    heure: params.heure,
    conservation: params.conservation,
    secours,
    // Les copies suivantes seulement : les anciennes gardent ce qu'elles avaient.
    cleSecours: secours
      ? (config.cleSecours ?? envelopperCleSecours(config.boutiqueId, libererCle(config.cle)).toString("base64"))
      : undefined,
  });
  return etatSauvegarde();
}

/** Nouveau mot de passe (tapé par le patron) : les sauvegardes suivantes l'utilisent ; les anciennes gardent l'ancien. */
export function changerMotDePasseSauvegarde(motDePasse: string): EtatSauvegarde {
  const config = lireConfig();
  if (!config) throw new ErreurSauvegarde("La sauvegarde n'est pas encore paramétrée.");
  verifierMotDePasse(motDePasse);
  const sel = randomBytes(16);
  const cle = deriverCle(motDePasse, sel);
  ecrireConfig({
    ...config,
    sel: sel.toString("hex"),
    cle: protegerCle(cle),
    cleSecours: config.secours ? envelopperCleSecours(config.boutiqueId, cle).toString("base64") : undefined,
  });
  sauvegarderMaintenant();
  return etatSauvegarde();
}

export function desactiverSauvegarde(): EtatSauvegarde {
  ecrireConfig(null);
  return etatSauvegarde();
}

/** Indique au serveur la date de la dernière sauvegarde (jamais le contenu). Silencieux sans internet. */
async function signalerAuServeur(date: string): Promise<void> {
  try {
    const session = sessionActuelle();
    if (!session?.accessToken) return;
    await fetch(`${URL_BASE_API}/boutique/sauvegarde/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ date_derniere_sauvegarde: date }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // pas d'internet : la prochaine sauvegarde réessaiera
  }
}

/** Sauvegarde immédiate : base chiffrée déposée dans le dossier, anciennes supprimées. */
export function sauvegarderMaintenant(maintenant = new Date()): EtatSauvegarde {
  const config = lireConfig();
  if (!config) throw new ErreurSauvegarde("La sauvegarde n'est pas encore paramétrée.");
  try {
    if (!fs.existsSync(config.dossier)) {
      throw new ErreurSauvegarde(`Dossier introuvable : ${config.dossier} (clé USB débranchée ? Google Drive déconnecté ?).`);
    }
    const contenu = chiffrer(
      obtenirBaseDeDonnees().export(),
      libererCle(config.cle),
      Buffer.from(config.sel, "hex"),
      config.secours && config.cleSecours ? Buffer.from(config.cleSecours, "base64") : null,
    );
    const nom = nomFichierSauvegarde(config.boutiqueNom, maintenant);
    const chemin = path.join(config.dossier, nom);
    // Écrit à côté puis renommé : jamais de fichier à moitié écrit dans le dossier.
    fs.writeFileSync(`${chemin}.tmp`, contenu);
    fs.renameSync(`${chemin}.tmp`, chemin);
    faireTournerSauvegardes(config.dossier, config.conservation ?? "progressive", maintenant);
    const date = maintenant.toISOString();
    ecrireConfig({ ...config, derniereSauvegarde: date, dernierFichier: nom, derniereErreur: null, echecsConsecutifs: 0 });
    void signalerAuServeur(date);
  } catch (erreur) {
    ecrireConfig({
      ...config,
      derniereErreur: erreur instanceof Error ? erreur.message : "Échec de la sauvegarde.",
      echecsConsecutifs: config.echecsConsecutifs + 1,
    });
    throw erreur instanceof ErreurSauvegarde ? erreur : new ErreurSauvegarde("Échec de la sauvegarde.");
  }
  return etatSauvegarde();
}

/** Toutes les 5 minutes (main.ts) : sauvegarde du jour si l'heure est passée. */
export function verifierSauvegardePlanifiee(maintenant = new Date()): void {
  const config = lireConfig();
  if (!config || !doitSauvegarder(config.heure, config.derniereSauvegarde, maintenant)) return;
  // Une tentative par créneau de 5 min ; l'échec est noté pour l'alerte.
  try {
    sauvegarderMaintenant(maintenant);
  } catch {
    // noté dans la configuration (derniereErreur, echecsConsecutifs)
  }
}

/** À la fermeture de l'appli : sauvegarde si la dernière date de plus de 24 h. */
export function sauvegarderALaFermeture(maintenant = new Date()): void {
  const config = lireConfig();
  if (!config) return;
  if (config.derniereSauvegarde && maintenant.getTime() - new Date(config.derniereSauvegarde).getTime() < 86400000) return;
  try {
    sauvegarderMaintenant(maintenant);
  } catch {
    // noté dans la configuration
  }
}

/**
 * Restauration (Espace Admin) : le fichier est déchiffré avec le mot de passe
 * du patron et vérifié AVANT de toucher à quoi que ce soit ; la base actuelle
 * est mise de côté (« … .avant-restauration-<date> »), puis remplacée. L'appli
 * doit redémarrer juste après (voir le canal IPC).
 */
export function restaurerSauvegarde(fichier: string, motDePasse: string, cheminBase = cheminBaseDeDonnees()): void {
  remplacerBase(dechiffrer(fs.readFileSync(fichier), motDePasse), cheminBase);
}

/**
 * Le patron a perdu son mot de passe : la clé de secours de la copie est
 * envoyée au serveur (jamais les données) avec les identifiants admin, qui
 * renvoie la clé de la sauvegarde. Internet nécessaire.
 */
export async function restaurerAvecSecours(
  fichier: string,
  username: string,
  password: string,
  cheminBase = cheminBaseDeDonnees(),
): Promise<{ boutiqueNom: string }> {
  const contenu = fs.readFileSync(fichier);
  const { cleSecours } = lireEntete(contenu);
  if (!cleSecours) {
    throw new ErreurSauvegarde(
      "Cette copie n'a pas de clé de secours (l'option n'était pas cochée quand elle a été faite) : seul le mot de passe du patron peut l'ouvrir.",
    );
  }
  let reponse: Response;
  try {
    reponse = await (fetchSecoursTests ?? fetch)(`${URL_BASE_API}/auth/secours-sauvegarde/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, cle_chiffree: cleSecours.toString("base64") }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ErreurSauvegarde("Internet est nécessaire pour utiliser la clé de secours.");
  }
  const corps = (await reponse.json().catch(() => ({}))) as { detail?: string; cle?: string; boutique_nom?: string };
  if (!reponse.ok || !corps.cle) {
    throw new ErreurSauvegarde(reponse.status === 403 ? "Identifiants administrateur refusés." : (corps.detail ?? "Clé de secours refusée."));
  }
  remplacerBase(
    dechiffrerAvecCle(contenu, Buffer.from(corps.cle, "base64"), "La clé de secours ne correspond pas à cette copie."),
    cheminBase,
  );
  return { boutiqueNom: corps.boutique_nom ?? "" };
}

function remplacerBase(base: Buffer, cheminBase: string): void {
  if (!base.subarray(0, ENTETE_SQLITE.length).equals(ENTETE_SQLITE)) {
    throw new ErreurSauvegarde("Le contenu déchiffré n'est pas une base de l'application.");
  }
  if (fs.existsSync(cheminBase)) {
    const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(cheminBase, `${cheminBase}.avant-restauration-${horodatage}`);
  }
  fs.writeFileSync(cheminBase, base);
}
