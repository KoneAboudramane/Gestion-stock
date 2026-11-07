import { registerPlugin } from "@capacitor/core";
import { scryptAsync } from "@noble/hashes/scrypt";

import { exporterComptesLocaux, importerComptesDiffuses, type CompteDiffuse } from "../api/authHorsLigne";
import { BASE_URL, apiFetch } from "../api/transport";
import { ouvrirBaseDeDonnees } from "../db";
import { listerTout } from "../db/helpers";
import { VERSION_BASE } from "../db/schema";
import { ecritureDeSuivi } from "../db/suiviReseau";
import { estAppliMobile } from "../lib/appliAndroid";

/**
 * Sauvegarde de la boutique sur téléphone / tablette (docs/plan_mobile_complet.md,
 * lot 4, §4.6). Port de client-electron/electron/services/sauvegarde.ts, au MÊME
 * format de fichier .gsbak (v2) : « GSBAK2 » + sel (16 o) + longueur de la clé de
 * secours (2 o) + clé de secours (0 ou 384 o) + IV (12 o) + étiquette GCM (16 o)
 * + contenu chiffré ; en-tête authentifié (AAD). AES-256-GCM, clé tirée du mot de
 * passe du patron par scrypt (N = 2^15) — mêmes réglages que le bureau ; clé de
 * secours RSA-OAEP SHA-256 pour l'administrateur (comptes/secours.py).
 *
 * Seul le CONTENU diffère : au bureau la base SQLite, ici toutes les données de
 * l'appareil (IndexedDB) en JSON compressé, plus les comptes connus de l'appareil
 * (mots de passe protégés, sans jetons) — pour se connecter après une restauration
 * sur un appareil neuf, sans internet. Restaurer une copie d'ordinateur sur un
 * téléphone (et l'inverse) : plus tard (lot 6).
 *
 * Le dossier est choisi avec le sélecteur d'Android (module natif Sauvegarde) ; la
 * clé des sauvegardes automatiques est gardée dans le coffre d'Android (Keystore).
 */

export class ErreurSauvegarde extends Error {}

const MAGIQUE_V1 = new TextEncoder().encode("GSBAK1");
const MAGIQUE_V2 = new TextEncoder().encode("GSBAK2");
const ENTETE_SQLITE = new TextEncoder().encode("SQLite format 3\0");
const FORMAT_CONTENU = "gestion-stock/donnees-mobile";
const EXTENSION = ".gsbak";
export const SEUIL_ALERTE_JOURS = 3;
const JOURS_QUOTIDIENNES = 30;
const JOURS_HEBDOMADAIRES = 183;
const CLE_CONFIG = "gestion-stock:sauvegarde";

/** Même clé publique que le bureau (electron/services/sauvegarde.ts). */
export const CLE_PUBLIQUE_SECOURS = {
  kty: "RSA",
  n: "0rrhNzhZO-t8JP85S5BPnz4sirn0iNq2M0f77-bCHCVZz1uPw030AGBUuGrBmIQ4CY8Q7Rqn_u828HjZaG34H5ZgaQZUXYPZvZPYOKOiOkthSyJfpmMLoh4liONpBo0YPaVRuUN5DRV72snEfBulN94J6QnmdGHKNZzFqJTxlSc9CfmZ5EebEExYegCdu7gA6ipHDtwAf-IdSg7FWNRv_uU-j7CcYNBaTuh6W5NmvaVURtpnt5p7KK9gz4x2_0Oa1EMRB23iJz0tnNnMSIMYyuUhK5jtr-X_4CbYYi_aW4QodMBf2-rWn2DFsXIwHMhMfmcpk_XYAwmrZzR_AiUoSM02bMhILaa4yDhsZdi8imy79wQCp5ti1jzxLXusc5eeU7v5TFWtno07P5mumw6R8wSX3hLCxSzCrl4OCQmtVyk5zyTZfQby-NsMYpxdH5XIwHPSrF6zBYfFb14qzkIKkITdQXtoWPeWPa8QqfBvwEZPnHkdNg-LblrIcMSBaqgL",
  e: "AQAB",
};

export type Conservation = "progressive" | "illimitee";

// --- Module natif (android/…/SauvegardePlugin.java) ---

export interface FichierDossier {
  nom: string;
  uri: string;
  taille: number;
  /** Date de modification (ms), 0 si inconnue. */
  date: number;
}

export interface ModuleSauvegarde {
  choisirDossier(): Promise<{ uri?: string; nom?: string }>;
  choisirFichier(): Promise<{ uri?: string; nom?: string }>;
  listerDossier(options: { dossier: string }): Promise<{ accessible: boolean; fichiers: FichierDossier[] }>;
  ecrireFichier(options: { dossier: string; nom: string; donnees: string }): Promise<{ uri: string }>;
  lireFichier(options: { uri: string }): Promise<{ donnees: string }>;
  supprimerFichier(options: { uri: string }): Promise<void>;
  protegerCle(options: { cle: string }): Promise<{ protegee: string }>;
  libererCle(options: { protegee: string }): Promise<{ cle: string }>;
}

let moduleNatif: ModuleSauvegarde = registerPlugin<ModuleSauvegarde>("Sauvegarde");
let cleSecoursTests: JsonWebKey | null = null;

/** Tests : dossier et coffre simulés, clé de secours de test. */
export function definirModuleSauvegardePourLesTests(module: ModuleSauvegarde | null, cleSecours: JsonWebKey | null = null): void {
  if (module) moduleNatif = module;
  cleSecoursTests = cleSecours;
}

/** La sauvegarde a besoin d'un dossier de l'appareil : dans l'appli (ou un test), pas dans un navigateur. */
export function sauvegardePossible(): boolean {
  return estAppliMobile || cleSecoursTests !== null || moduleNatif !== registreParDefaut;
}
const registreParDefaut = moduleNatif;

// --- Configuration ---

interface ConfigSauvegarde {
  boutiqueId: string;
  boutiqueNom: string;
  /** Adresse du dossier choisi (content://…). */
  dossier: string;
  /** Nom lisible du dossier. */
  nomDossier: string;
  heure: string;
  conservation: Conservation;
  secours?: boolean;
  cleSecours?: string;
  sel: string;
  /** « coffre:… » (Keystore d'Android) ou « clair:… » (repli). */
  cle: string;
  derniereSauvegarde: string | null;
  dernierFichier: string | null;
  derniereErreur: string | null;
  echecsConsecutifs: number;
}

function lireConfig(): ConfigSauvegarde | null {
  try {
    const config = JSON.parse(localStorage.getItem(CLE_CONFIG) ?? "null");
    return config?.dossier && config.cle ? (config as ConfigSauvegarde) : null;
  } catch {
    return null;
  }
}

function ecrireConfig(config: ConfigSauvegarde | null): void {
  if (config === null) localStorage.removeItem(CLE_CONFIG);
  else localStorage.setItem(CLE_CONFIG, JSON.stringify(config));
}

/** Noms lisibles des dossiers choisis (l'adresse content://… ne dit rien à l'écran). */
const CLE_NOMS_DOSSIERS = "gestion-stock:noms-dossiers-sauvegarde";

function retenirNomDossier(uri: string, nom: string): void {
  try {
    const noms = JSON.parse(localStorage.getItem(CLE_NOMS_DOSSIERS) ?? "{}") as Record<string, string>;
    noms[uri] = nom;
    localStorage.setItem(CLE_NOMS_DOSSIERS, JSON.stringify(noms));
  } catch {
    // affichage seulement
  }
}

/** « Sauvegardes boutique » plutôt que « content://com.google.android… ». */
export function libelleDossier(dossier: string | null | undefined): string {
  if (!dossier) return "";
  try {
    const noms = JSON.parse(localStorage.getItem(CLE_NOMS_DOSSIERS) ?? "{}") as Record<string, string>;
    if (noms[dossier]) return noms[dossier];
  } catch {
    // repli ci-dessous
  }
  const fin = decodeURIComponent(dossier.split("/").pop() ?? dossier);
  return fin.replace(/^primary:/, "Téléphone/") || dossier;
}

// --- Octets ---

function concat(...morceaux: Uint8Array[]): Uint8Array {
  const total = new Uint8Array(morceaux.reduce((t, m) => t + m.length, 0));
  let i = 0;
  for (const m of morceaux) {
    total.set(m, i);
    i += m.length;
  }
  return total;
}

function egaux(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function versHex(octets: Uint8Array): string {
  return Array.from(octets, (o) => o.toString(16).padStart(2, "0")).join("");
}

function depuisHex(hex: string): Uint8Array {
  return Uint8Array.from((hex.match(/.{2}/g) ?? []).map((o) => parseInt(o, 16)));
}

export function versBase64(octets: Uint8Array): string {
  let binaire = "";
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}

export function depuisBase64(texte: string): Uint8Array {
  const binaire = atob(texte);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

function aleatoire(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

// --- Clé et chiffrement (mêmes réglages que le bureau) ---

export function deriverCle(motDePasse: string, sel: Uint8Array): Promise<Uint8Array> {
  return scryptAsync(new TextEncoder().encode(motDePasse), sel, { N: 2 ** 15, r: 8, p: 1, dkLen: 32, maxmem: 128 * 1024 * 1024 });
}

async function protegerCle(cle: Uint8Array): Promise<string> {
  try {
    return `coffre:${(await moduleNatif.protegerCle({ cle: versBase64(cle) })).protegee}`;
  } catch {
    return `clair:${versBase64(cle)}`;
  }
}

async function libererCle(protegee: string): Promise<Uint8Array> {
  if (protegee.startsWith("coffre:")) return depuisBase64((await moduleNatif.libererCle({ protegee: protegee.slice(7) })).cle);
  return depuisBase64(protegee.replace(/^clair:/, ""));
}

/** Clé de la sauvegarde (+ identifiant de la boutique) chiffrée pour l'administrateur. */
export async function envelopperCleSecours(boutiqueId: string, cle: Uint8Array): Promise<Uint8Array> {
  const clePublique = await crypto.subtle.importKey(
    "jwk",
    { ...(cleSecoursTests ?? CLE_PUBLIQUE_SECOURS), alg: "RSA-OAEP-256", ext: true },
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const contenu = concat(depuisHex(boutiqueId.replace(/-/g, "")), cle);
  return new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, clePublique, contenu as BufferSource));
}

async function cleAes(cle: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", cle as BufferSource, "AES-GCM", false, [usage]);
}

export async function chiffrer(donnees: Uint8Array, cle: Uint8Array, sel: Uint8Array, cleSecours: Uint8Array | null = null): Promise<Uint8Array> {
  const longueur = new Uint8Array([((cleSecours?.length ?? 0) >> 8) & 0xff, (cleSecours?.length ?? 0) & 0xff]);
  const entete = concat(MAGIQUE_V2, sel, longueur, cleSecours ?? new Uint8Array(0));
  const iv = aleatoire(12);
  // WebCrypto renvoie « chiffré + étiquette » : le fichier range l'étiquette avant le chiffré (comme Node).
  const sortie = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: entete as BufferSource, tagLength: 128 },
      await cleAes(cle, "encrypt"),
      donnees as BufferSource,
    ),
  );
  const chiffre = sortie.subarray(0, sortie.length - 16);
  const etiquette = sortie.subarray(sortie.length - 16);
  return concat(entete, iv, etiquette, chiffre);
}

interface EnteteSauvegarde {
  sel: Uint8Array;
  cleSecours: Uint8Array | null;
  iv: Uint8Array;
  etiquette: Uint8Array;
  corps: Uint8Array;
  aad: Uint8Array | null;
}

function lireEntete(fichier: Uint8Array): EnteteSauvegarde {
  const magique = fichier.subarray(0, 6);
  if (egaux(magique, MAGIQUE_V1) && fichier.length >= 50) {
    return { sel: fichier.subarray(6, 22), cleSecours: null, iv: fichier.subarray(22, 34), etiquette: fichier.subarray(34, 50), corps: fichier.subarray(50), aad: null };
  }
  if (egaux(magique, MAGIQUE_V2) && fichier.length >= 52) {
    const longueur = (fichier[22] << 8) | fichier[23];
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

async function dechiffrerAvecCle(fichier: Uint8Array, cle: Uint8Array, messageErreur: string): Promise<Uint8Array> {
  const entete = lireEntete(fichier);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: entete.iv as BufferSource,
          tagLength: 128,
          ...(entete.aad ? { additionalData: entete.aad as BufferSource } : {}),
        },
        await cleAes(cle, "decrypt"),
        concat(entete.corps, entete.etiquette) as BufferSource,
      ),
    );
  } catch {
    throw new ErreurSauvegarde(messageErreur);
  }
}

/** Déchiffre un fichier .gsbak avec le mot de passe du patron. */
export async function dechiffrer(fichier: Uint8Array, motDePasse: string): Promise<Uint8Array> {
  const { sel } = lireEntete(fichier);
  return dechiffrerAvecCle(fichier, await deriverCle(motDePasse, sel), "Mot de passe incorrect, ou fichier de sauvegarde abîmé.");
}

// --- Contenu : les données de l'appareil ---

async function compresser(octets: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return octets;
  const flux = new Blob([octets as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

async function decompresser(octets: Uint8Array): Promise<Uint8Array> {
  if (octets[0] !== 0x1f || octets[1] !== 0x8b) return octets;
  const flux = new Blob([octets as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

interface ContenuSauvegarde {
  format: typeof FORMAT_CONTENU;
  version: 1;
  base: number;
  boutiqueId: string;
  boutiqueNom: string;
  date: string;
  magasins: Record<string, unknown[]>;
  comptes: CompteDiffuse[];
}

/** Toutes les données de l'appareil (chaque magasin IndexedDB) + les comptes connus, en JSON compressé. */
export async function exporterDonnees(boutiqueId: string, boutiqueNom: string): Promise<Uint8Array> {
  const db = await ouvrirBaseDeDonnees();
  const magasins: Record<string, unknown[]> = {};
  for (const nom of Array.from(db.objectStoreNames)) magasins[nom] = await db.getAll(nom as never);
  const contenu: ContenuSauvegarde = {
    format: FORMAT_CONTENU,
    version: 1,
    base: VERSION_BASE,
    boutiqueId,
    boutiqueNom,
    date: new Date().toISOString(),
    magasins,
    comptes: exporterComptesLocaux(boutiqueId),
  };
  return compresser(new TextEncoder().encode(JSON.stringify(contenu)));
}

/** Contenu déchiffré → données lues et vérifiées, AVANT de toucher à quoi que ce soit. */
async function lireContenu(octets: Uint8Array): Promise<ContenuSauvegarde> {
  if (egaux(octets.subarray(0, ENTETE_SQLITE.length), ENTETE_SQLITE)) {
    throw new ErreurSauvegarde(
      "Cette copie a été faite sur un ordinateur : restaurez-la sur un ordinateur (Espace Admin → Sauvegarde). Sur téléphone, ce sera possible dans une prochaine mise à jour.",
    );
  }
  let contenu: ContenuSauvegarde;
  try {
    contenu = JSON.parse(new TextDecoder().decode(await decompresser(octets))) as ContenuSauvegarde;
  } catch {
    throw new ErreurSauvegarde("Le contenu déchiffré n'est pas une sauvegarde de l'application.");
  }
  if (contenu?.format !== FORMAT_CONTENU || typeof contenu.magasins !== "object") {
    throw new ErreurSauvegarde("Le contenu déchiffré n'est pas une sauvegarde de l'application.");
  }
  if (contenu.base > VERSION_BASE) {
    throw new ErreurSauvegarde("Cette copie vient d'une version plus récente de l'application : mettez d'abord l'appli à jour.");
  }
  return contenu;
}

/** Remplace toutes les données de l'appareil par celles de la copie (tout ou rien). */
async function remplacerDonnees(contenu: ContenuSauvegarde): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const noms = Array.from(db.objectStoreNames);
  const transaction = db.transaction(noms as never, "readwrite");
  for (const nom of noms) {
    const magasin = transaction.objectStore(nom as never);
    await magasin.clear();
    // Recopiées telles quelles (marques de synchro comprises) : écritures de suivi.
    for (const ligne of contenu.magasins[nom] ?? []) await magasin.put(ecritureDeSuivi(ligne as object) as never);
  }
  await transaction.done;
  importerComptesDiffuses(contenu.comptes ?? []);
}

// --- Noms, conservation, planification (comme le bureau) ---

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

function dateCopie(fichier: FichierDossier): Date {
  const m = /_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})\.gsbak$/.exec(fichier.nom);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return new Date(fichier.date || 0);
}

function cleSemaine(date: Date): string {
  const lundi = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  return `${lundi.getFullYear()}-${deuxChiffres(lundi.getMonth() + 1)}-${deuxChiffres(lundi.getDate())}`;
}

function copiesDeLAppli(fichiers: FichierDossier[]): FichierDossier[] {
  return fichiers.filter((f) => f.nom.startsWith("gestion-stock_") && f.nom.endsWith(EXTENSION));
}

/** Conservation progressive : supprime les copies en trop, jamais la plus récente, seulement celles de l'appli. */
export async function faireTournerSauvegardes(dossier: string, conservation: Conservation, maintenant: Date): Promise<string[]> {
  if (conservation === "illimitee") return [];
  const { fichiers } = await moduleNatif.listerDossier({ dossier });
  const copies = copiesDeLAppli(fichiers)
    .map((f) => ({ f, date: dateCopie(f) }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const semaines = new Set<string>();
  const mois = new Set<string>();
  const supprimes: string[] = [];
  for (const [index, { f, date }] of copies.entries()) {
    const ageJours = (maintenant.getTime() - date.getTime()) / 86400000;
    let garder: boolean;
    if (index === 0 || ageJours <= JOURS_QUOTIDIENNES) {
      garder = true;
    } else if (ageJours <= JOURS_HEBDOMADAIRES) {
      const cle = cleSemaine(date);
      garder = !semaines.has(cle);
      semaines.add(cle);
    } else {
      const cle = `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}`;
      garder = !mois.has(cle);
      mois.add(cle);
    }
    if (!garder) {
      await moduleNatif.supprimerFichier({ uri: f.uri }).catch(() => {});
      supprimes.push(f.nom);
    }
  }
  return supprimes;
}

export function doitSauvegarder(heure: string, derniereSauvegarde: string | null, maintenant: Date): boolean {
  const [h, m] = heure.split(":").map(Number);
  const creneau = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate(), h || 0, m || 0);
  if (maintenant < creneau) creneau.setDate(creneau.getDate() - 1);
  return !derniereSauvegarde || new Date(derniereSauvegarde) < creneau;
}

export function prochaineSauvegarde(heure: string, maintenant: Date): Date {
  const [h, m] = heure.split(":").map(Number);
  const creneau = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate(), h || 0, m || 0);
  if (creneau <= maintenant) creneau.setDate(creneau.getDate() + 1);
  return creneau;
}

export interface CopieSauvegarde {
  nom: string;
  /** Adresse de la copie (content://…). */
  chemin: string;
  date: string;
  taille: number;
  categorie: "jour" | "semaine" | "mois";
}

export interface ListeSauvegardes {
  dossier: string | null;
  accessible: boolean;
  copies: CopieSauvegarde[];
  tailleTotale: number;
}

/** Copies du dossier (celui de la configuration, ou un autre choisi pour restaurer), de la plus récente à la plus ancienne. */
export async function listerSauvegardes(dossierChoisi?: string | null, maintenant = new Date()): Promise<ListeSauvegardes> {
  const dossier = dossierChoisi || lireConfig()?.dossier || null;
  if (!dossier) return { dossier, accessible: false, copies: [], tailleTotale: 0 };
  let resultat: { accessible: boolean; fichiers: FichierDossier[] };
  try {
    resultat = await moduleNatif.listerDossier({ dossier });
  } catch {
    return { dossier, accessible: false, copies: [], tailleTotale: 0 };
  }
  if (!resultat.accessible) return { dossier, accessible: false, copies: [], tailleTotale: 0 };
  const copies = copiesDeLAppli(resultat.fichiers)
    .map((f): CopieSauvegarde => {
      const date = dateCopie(f);
      const ageJours = (maintenant.getTime() - date.getTime()) / 86400000;
      return {
        nom: f.nom,
        chemin: f.uri,
        date: date.toISOString(),
        taille: f.taille,
        categorie: ageJours <= JOURS_QUOTIDIENNES ? "jour" : ageJours <= JOURS_HEBDOMADAIRES ? "semaine" : "mois",
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return { dossier, accessible: true, copies, tailleTotale: copies.reduce((t, c) => t + c.taille, 0) };
}

// --- État ---

export interface EtatSauvegarde {
  configuree: boolean;
  dossier: string | null;
  heure: string | null;
  conservation: Conservation | null;
  prochaine: string | null;
  secours: boolean;
  derniereSauvegarde: string | null;
  dernierFichier: string | null;
  derniereErreur: string | null;
  echecsConsecutifs: number;
  alerte: "aucune" | "echecs" | "ancienne";
}

export async function etatSauvegarde(maintenant = new Date()): Promise<EtatSauvegarde> {
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
    !config.derniereSauvegarde || maintenant.getTime() - new Date(config.derniereSauvegarde).getTime() > SEUIL_ALERTE_JOURS * 86400000;
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

// --- Opérations ---

function verifierReglages(dossier: string, heure: string, conservation: Conservation): void {
  if (!dossier) throw new ErreurSauvegarde("Choisissez le dossier des sauvegardes.");
  if (!/^\d{2}:\d{2}$/.test(heure)) throw new ErreurSauvegarde("Heure invalide (format HH:MM).");
  if (conservation !== "progressive" && conservation !== "illimitee") throw new ErreurSauvegarde("Choix de conservation invalide.");
}

function verifierMotDePasse(motDePasse: string): void {
  if (motDePasse.length < 8) throw new ErreurSauvegarde("Le mot de passe doit faire au moins 8 caractères.");
}

/** Choix du dossier avec le sélecteur d'Android ; null si annulé. */
export async function choisirDossier(): Promise<string | null> {
  const { uri, nom } = await moduleNatif.choisirDossier();
  if (!uri) return null;
  retenirNomDossier(uri, nom || libelleDossier(uri));
  return uri;
}

/** Choix d'une copie ailleurs (restauration) ; null si annulé. */
export async function choisirFichier(): Promise<string | null> {
  const { uri } = await moduleNatif.choisirFichier();
  return uri || null;
}

/** Paramétrage (mot de passe tapé par le patron), puis première sauvegarde. */
export async function configurerSauvegarde(params: {
  boutiqueId: string;
  boutiqueNom: string;
  dossier: string;
  heure: string;
  conservation: Conservation;
  motDePasse: string;
  secours?: boolean;
}): Promise<EtatSauvegarde> {
  verifierReglages(params.dossier, params.heure, params.conservation);
  verifierMotDePasse(params.motDePasse);
  const sel = aleatoire(16);
  const cle = await deriverCle(params.motDePasse, sel);
  ecrireConfig({
    boutiqueId: params.boutiqueId,
    boutiqueNom: params.boutiqueNom,
    dossier: params.dossier,
    nomDossier: libelleDossier(params.dossier),
    heure: params.heure,
    conservation: params.conservation,
    secours: !!params.secours,
    cleSecours: params.secours ? versBase64(await envelopperCleSecours(params.boutiqueId, cle)) : undefined,
    sel: versHex(sel),
    cle: await protegerCle(cle),
    derniereSauvegarde: null,
    dernierFichier: null,
    derniereErreur: null,
    echecsConsecutifs: 0,
  });
  await sauvegarderMaintenant();
  return etatSauvegarde();
}

export async function modifierReglagesSauvegarde(params: {
  dossier: string;
  heure: string;
  conservation: Conservation;
  secours?: boolean;
}): Promise<EtatSauvegarde> {
  const config = lireConfig();
  if (!config) throw new ErreurSauvegarde("La sauvegarde n'est pas encore paramétrée.");
  verifierReglages(params.dossier, params.heure, params.conservation);
  const secours = params.secours ?? !!config.secours;
  ecrireConfig({
    ...config,
    dossier: params.dossier,
    nomDossier: libelleDossier(params.dossier),
    heure: params.heure,
    conservation: params.conservation,
    secours,
    // Les copies suivantes seulement : les anciennes gardent ce qu'elles avaient.
    cleSecours: secours
      ? (config.cleSecours ?? versBase64(await envelopperCleSecours(config.boutiqueId, await libererCle(config.cle))))
      : undefined,
  });
  return etatSauvegarde();
}

export async function changerMotDePasseSauvegarde(motDePasse: string): Promise<EtatSauvegarde> {
  const config = lireConfig();
  if (!config) throw new ErreurSauvegarde("La sauvegarde n'est pas encore paramétrée.");
  verifierMotDePasse(motDePasse);
  const sel = aleatoire(16);
  const cle = await deriverCle(motDePasse, sel);
  ecrireConfig({
    ...config,
    sel: versHex(sel),
    cle: await protegerCle(cle),
    cleSecours: config.secours ? versBase64(await envelopperCleSecours(config.boutiqueId, cle)) : undefined,
  });
  await sauvegarderMaintenant();
  return etatSauvegarde();
}

export async function desactiverSauvegarde(): Promise<EtatSauvegarde> {
  ecrireConfig(null);
  return etatSauvegarde();
}

/** Indique au serveur la date de la dernière sauvegarde (jamais le contenu). Silencieux sans internet. */
async function signalerAuServeur(date: string): Promise<void> {
  try {
    await apiFetch("/boutique/sauvegarde/", { method: "POST", body: JSON.stringify({ date_derniere_sauvegarde: date }) });
  } catch {
    // pas d'internet ou pas de session : la prochaine sauvegarde réessaiera
  }
}

async function ecrireCopie(config: ConfigSauvegarde, nom: string): Promise<void> {
  const contenu = await chiffrer(
    await exporterDonnees(config.boutiqueId, config.boutiqueNom),
    await libererCle(config.cle),
    depuisHex(config.sel),
    config.secours && config.cleSecours ? depuisBase64(config.cleSecours) : null,
  );
  await moduleNatif.ecrireFichier({ dossier: config.dossier, nom, donnees: versBase64(contenu) });
}

let sauvegardeEnCours: Promise<EtatSauvegarde> | null = null;

/** Sauvegarde immédiate : données chiffrées déposées dans le dossier, anciennes supprimées. */
export function sauvegarderMaintenant(maintenant = new Date()): Promise<EtatSauvegarde> {
  if (sauvegardeEnCours) return sauvegardeEnCours;
  sauvegardeEnCours = (async () => {
    const config = lireConfig();
    if (!config) throw new ErreurSauvegarde("La sauvegarde n'est pas encore paramétrée.");
    try {
      const nom = nomFichierSauvegarde(config.boutiqueNom, maintenant);
      await ecrireCopie(config, nom);
      await faireTournerSauvegardes(config.dossier, config.conservation ?? "progressive", maintenant).catch(() => []);
      const date = maintenant.toISOString();
      ecrireConfig({ ...(lireConfig() ?? config), derniereSauvegarde: date, dernierFichier: nom, derniereErreur: null, echecsConsecutifs: 0 });
      void signalerAuServeur(date);
    } catch (erreur) {
      const actuelle = lireConfig() ?? config;
      ecrireConfig({
        ...actuelle,
        derniereErreur: erreur instanceof Error ? erreur.message : "Échec de la sauvegarde.",
        echecsConsecutifs: actuelle.echecsConsecutifs + 1,
      });
      throw erreur instanceof ErreurSauvegarde ? erreur : new ErreurSauvegarde(erreur instanceof Error ? erreur.message : "Échec de la sauvegarde.");
    }
    return etatSauvegarde();
  })().finally(() => (sauvegardeEnCours = null));
  return sauvegardeEnCours;
}

/** Toutes les 5 minutes : sauvegarde du jour si l'heure est passée (rattrapée à l'ouverture suivante sinon). */
export async function verifierSauvegardePlanifiee(maintenant = new Date()): Promise<void> {
  const config = lireConfig();
  if (!config || !doitSauvegarder(config.heure, config.derniereSauvegarde, maintenant)) return;
  try {
    await sauvegarderMaintenant(maintenant);
  } catch {
    // noté dans la configuration (derniereErreur, echecsConsecutifs)
  }
}

/** L'appli passe en arrière-plan : sauvegarde si la dernière date de plus de 24 h (équivalent de la fermeture au bureau). */
export async function sauvegarderEnQuittant(maintenant = new Date()): Promise<void> {
  const config = lireConfig();
  if (!config) return;
  if (config.derniereSauvegarde && maintenant.getTime() - new Date(config.derniereSauvegarde).getTime() < 86400000) return;
  try {
    await sauvegarderMaintenant(maintenant);
  } catch {
    // noté dans la configuration
  }
}

export async function aUneCleSecours(fichier: string): Promise<boolean> {
  try {
    return lireEntete(depuisBase64((await moduleNatif.lireFichier({ uri: fichier })).donnees)).cleSecours !== null;
  } catch {
    return false;
  }
}

/**
 * Avant de remplacer les données : une copie de l'état actuel est déposée dans
 * le dossier des sauvegardes (au bureau : la base est mise de côté à côté
 * d'elle). Rien à garder sur un appareil neuf.
 */
async function mettreDeCoteAvantRestauration(): Promise<void> {
  const config = lireConfig();
  const aDesDonnees = (await listerTout("boutiques")).length > 0;
  if (!config || !aDesDonnees) return;
  const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
  await ecrireCopie(config, `avant-restauration_${nomPropre(config.boutiqueNom)}_${horodatage}${EXTENSION}`);
}

/**
 * Restauration : la copie est déchiffrée avec le mot de passe du patron et
 * vérifiée AVANT de toucher à quoi que ce soit ; l'état actuel est mis de côté,
 * puis les données sont remplacées. L'appli se recharge juste après (écran).
 */
export async function restaurerSauvegarde(fichier: string, motDePasse: string): Promise<void> {
  const octets = depuisBase64((await moduleNatif.lireFichier({ uri: fichier })).donnees);
  const contenu = await lireContenu(await dechiffrer(octets, motDePasse));
  await mettreDeCoteAvantRestauration();
  await remplacerDonnees(contenu);
}

/**
 * Le patron a perdu son mot de passe : la clé de secours de la copie est envoyée
 * au serveur (jamais les données) avec les identifiants admin, qui renvoie la clé
 * de la sauvegarde. Internet nécessaire.
 */
export async function restaurerAvecSecours(fichier: string, username: string, password: string): Promise<{ boutiqueNom: string }> {
  const octets = depuisBase64((await moduleNatif.lireFichier({ uri: fichier })).donnees);
  const { cleSecours } = lireEntete(octets);
  if (!cleSecours) {
    throw new ErreurSauvegarde(
      "Cette copie n'a pas de clé de secours (l'option n'était pas cochée quand elle a été faite) : seul le mot de passe du patron peut l'ouvrir.",
    );
  }
  let reponse: Response;
  try {
    reponse = await fetch(`${BASE_URL}/auth/secours-sauvegarde/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, cle_chiffree: versBase64(cleSecours) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ErreurSauvegarde("Internet est nécessaire pour utiliser la clé de secours.");
  }
  const corps = (await reponse.json().catch(() => ({}))) as { detail?: string; cle?: string; boutique_nom?: string };
  if (!reponse.ok || !corps.cle) {
    throw new ErreurSauvegarde(reponse.status === 403 ? "Identifiants administrateur refusés." : (corps.detail ?? "Clé de secours refusée."));
  }
  const contenu = await lireContenu(
    await dechiffrerAvecCle(octets, depuisBase64(corps.cle), "La clé de secours ne correspond pas à cette copie."),
  );
  await mettreDeCoteAvantRestauration();
  await remplacerDonnees(contenu);
  return { boutiqueNom: corps.boutique_nom ?? "" };
}

/** Au lancement de l'appli : sauvegarde planifiée vérifiée toutes les 5 min, et en passant en arrière-plan. */
export function lancerSauvegardePlanifiee(): void {
  if (!estAppliMobile) return;
  void verifierSauvegardePlanifiee();
  setInterval(() => void verifierSauvegardePlanifiee(), 5 * 60 * 1000);
  void import("@capacitor/app").then(({ App }) =>
    App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) void sauvegarderEnQuittant();
    }),
  );
}
