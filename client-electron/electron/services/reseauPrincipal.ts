import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import dgram from "node:dgram";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

import { unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";
import { exporterComptesLocaux } from "./auth";
import { compterEnAttente, etatSynchro, extraireDepuis, recevoirChangements, type Changement } from "./sync";
import { droitsOptionsBoutique } from "./abonnement";

/**
 * Poste principal de la boutique (docs/plan_reseau_local.md, lot 2) : un petit
 * serveur HTTP dans l'appli, qui sert aux caisses du réseau de la boutique le
 * même contrat que le serveur en ligne (/sync/push/, /sync/pull/), plus
 * l'appairage par code à 6 chiffres et l'état du stock.
 *
 * Sécurité : réponses seulement aux adresses du réseau privé ; toute route de
 * données exige le jeton d'appareil remis à l'appairage (on n'en garde que
 * l'empreinte) ; un appareil débranché perd son jeton.
 */

export const PORT_RESEAU = 47800;
/** Postes au maximum, poste principal compris. */
export const POSTES_MAX = 15;
const DUREE_CODE_MS = 10 * 60 * 1000;
const INTERVALLE_ANNONCE_MS = 2000;
const TAILLE_MAX_CORPS = 50 * 1024 * 1024;
/** Un appareil vu il y a moins de ce délai est « relié » (il synchronise toutes les 4 s). */
export const DELAI_RELIE_MS = 15000;

export interface AppareilBranche {
  id: string;
  nom: string;
  /** Empreinte SHA-256 du jeton (le jeton lui-même n'est gardé que par l'appareil). */
  empreinteJeton: string;
  dateBranchement: string;
  derniereConnexion: string | null;
}

interface ConfigPrincipal {
  role: "principal";
  boutiqueId: string;
  boutiqueNom: string;
  nomPoste: string;
  appareils: AppareilBranche[];
}

/** Caisse branchée à un poste principal (lot 3, voir reseauCaisse.ts). */
export interface ConfigCaisse {
  role: "caisse";
  boutiqueId: string;
  boutiqueNom: string;
  nomPostePrincipal: string;
  /** « 192.168.1.10:47800 » */
  adresse: string;
  jeton: string;
  appareilId: string;
  /** Curseur du dernier pull (numéro d'écriture du poste principal). */
  curseur: string | null;
}

export type ConfigReseau = { role: "seul" } | ConfigPrincipal | ConfigCaisse;

let cheminConfigTests: string | null = null;
let serveur: http.Server | null = null;
let portEcoute: number | null = null;
let annonce: { socket: dgram.Socket; minuteur: NodeJS.Timeout } | null = null;
let codeAppairage: { valeur: string; expire: number } | null = null;
/**
 * Serveur mis en pause à la main : les caisses restent branchées (leurs jetons
 * sont gardés) mais vendent seules jusqu'à la reprise. En mémoire seulement :
 * la pause s'arrête d'elle-même au redémarrage de l'appli.
 */
let enPause = false;
/** Depuis quand le serveur écoute, et combien de requêtes de caisses il a reçues depuis (rubrique Serveur). */
let demarreLe: string | null = null;
let requetesRecues = 0;
let autorisationPourLesTests: boolean | null = null;

export const MESSAGE_RESEAU_NON_ACTIVE =
  "Le réseau de la boutique n'est pas activé : demandez-le à votre administrateur (Réseau de la boutique → Demander l'activation).";

/** Les tests activent le réseau sans boutique en base (null : on relit la base). */
export function definirAutorisationReseauPourLesTests(valeur: boolean | null): void {
  autorisationPourLesTests = valeur;
}

/**
 * Droit au réseau de la boutique : formule Pro (essai compris), option Réseau payée
 * ou liée à l'abonnement, ou exception de l'administrateur (reseau_autorise) —
 * services/abonnement.ts::droitOption, valable hors ligne. Un poste = une boutique.
 */
export function reseauAutorise(): boolean {
  if (autorisationPourLesTests !== null) return autorisationPourLesTests;
  try {
    return droitsOptionsBoutique().reseau;
  } catch {
    return false;
  }
}
let erreurDemarrage: string | null = null;
/** Dernière requête de chaque appareil (en mémoire : inutile de réécrire le fichier toutes les 4 s). */
const derniereRequete = new Map<string, string>();

/** Tests : fichier de configuration hors du dossier de l'appli. */
export function definirCheminConfigReseauPourLesTests(chemin: string | null): void {
  cheminConfigTests = chemin;
}

function cheminConfig(): string {
  return cheminConfigTests ?? path.join(app.getPath("userData"), "reseau.json");
}

export function lireConfigReseau(): ConfigReseau {
  try {
    const config = JSON.parse(fs.readFileSync(cheminConfig(), "utf-8"));
    if (config?.role === "principal" && config.boutiqueId) return config as ConfigPrincipal;
    if (config?.role === "caisse" && config.boutiqueId && config.jeton) return config as ConfigCaisse;
  } catch {
    // pas de fichier (ou illisible) : poste seul
  }
  return { role: "seul" };
}

export function ecrireConfigReseau(config: ConfigReseau): void {
  fs.writeFileSync(cheminConfig(), JSON.stringify(config, null, 2));
}

function empreinte(jeton: string): string {
  return createHash("sha256").update(jeton).digest("hex");
}

/** Adresses IPv4 de cet ordinateur sur le réseau de la boutique (à afficher aux caisses). */
export function adressesLocales(): string[] {
  const adresses: string[] = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const i of interfaces ?? []) {
      if (i.family === "IPv4" && !i.internal) adresses.push(i.address);
    }
  }
  return adresses;
}

/** Seules les adresses du réseau privé (et la machine elle-même) sont servies. */
export function estAdressePrivee(adresse: string | undefined): boolean {
  if (!adresse) return false;
  const ip = adresse.startsWith("::ffff:") ? adresse.slice(7) : adresse;
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** Arrête le code en cours : plus aucune caisse ne peut se brancher avec (les caisses déjà branchées restent reliées). */
export function annulerCodeAppairage(): void {
  codeAppairage = null;
}

export function nouveauCodeAppairage(): { valeur: string; expire: string } {
  codeAppairage = { valeur: String(randomInt(0, 1_000_000)).padStart(6, "0"), expire: Date.now() + DUREE_CODE_MS };
  return { valeur: codeAppairage.valeur, expire: new Date(codeAppairage.expire).toISOString() };
}

// --- Réponses HTTP ---

function repondre(reponse: http.ServerResponse, statut: number, corps: unknown): void {
  const json = JSON.stringify(corps);
  reponse.writeHead(statut, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(json) });
  reponse.end(json);
}

function lireCorps(requete: http.IncomingMessage): Promise<unknown> {
  return new Promise((resoudre, rejeter) => {
    const morceaux: Buffer[] = [];
    let taille = 0;
    requete.on("data", (morceau: Buffer) => {
      taille += morceau.length;
      if (taille > TAILLE_MAX_CORPS) {
        rejeter(new Error("Envoi trop volumineux."));
        requete.destroy();
        return;
      }
      morceaux.push(morceau);
    });
    requete.on("end", () => {
      try {
        resoudre(morceaux.length ? JSON.parse(Buffer.concat(morceaux).toString("utf-8")) : {});
      } catch {
        rejeter(new Error("Corps JSON invalide."));
      }
    });
    requete.on("error", rejeter);
  });
}

/** Appareil correspondant au jeton de la requête (et note sa dernière connexion), sinon null. */
function appareilAuthentifie(requete: http.IncomingMessage, config: ConfigPrincipal): AppareilBranche | null {
  const entete = requete.headers.authorization ?? "";
  if (!entete.startsWith("Bearer ")) return null;
  const recue = Buffer.from(empreinte(entete.slice(7)), "hex");
  const appareil = config.appareils.find((a) => {
    const attendue = Buffer.from(a.empreinteJeton, "hex");
    return attendue.length === recue.length && timingSafeEqual(attendue, recue);
  });
  if (!appareil) return null;
  derniereRequete.set(appareil.id, new Date().toISOString());
  return appareil;
}

/** Traitement d'une requête de caisse (exporté pour les tests). */
export async function traiterRequete(requete: http.IncomingMessage, reponse: http.ServerResponse): Promise<void> {
  if (!estAdressePrivee(requete.socket.remoteAddress)) return repondre(reponse, 403, { detail: "Réseau non autorisé." });
  requetesRecues++;
  const config = lireConfigReseau();
  if (config.role !== "principal") return repondre(reponse, 503, { detail: "Cet ordinateur n'est plus le poste principal." });
  const url = new URL(requete.url ?? "/", "http://poste-principal");

  try {
    // Sans jeton : présentation (vérifier qu'on parle au bon poste) et appairage.
    if (requete.method === "GET" && url.pathname === "/reseau/etat/") {
      return repondre(reponse, 200, {
        application: "gestion-stock",
        boutiqueId: config.boutiqueId,
        boutiqueNom: config.boutiqueNom,
        nomPoste: config.nomPoste,
        // Pour la 2e ligne de l'indicateur des caisses : internet vu du poste principal.
        internet: etatInternet(config.boutiqueId),
      });
    }
    // Une caisse qui a perdu le poste principal (son adresse a changé) vérifie
    // qu'elle a retrouvé le BON avant de lui confier son jeton : seul lui connaît
    // l'empreinte de ce jeton et peut répondre au défi (HMAC).
    if (requete.method === "POST" && url.pathname === "/reseau/prouver/") {
      const corps = (await lireCorps(requete)) as { appareilId?: string; defi?: string };
      const appareil = config.appareils.find((a) => a.id === corps.appareilId);
      if (!appareil || typeof corps.defi !== "string" || corps.defi.length < 32 || corps.defi.length > 128) {
        return repondre(reponse, 404, { detail: "Appareil inconnu de ce poste principal." });
      }
      return repondre(reponse, 200, { preuve: createHmac("sha256", appareil.empreinteJeton).update(corps.defi).digest("hex") });
    }
    if (requete.method === "POST" && url.pathname === "/reseau/appairer/") {
      const corps = (await lireCorps(requete)) as { code?: string; nomAppareil?: string };
      if (!codeAppairage || Date.now() > codeAppairage.expire || String(corps.code ?? "").trim() !== codeAppairage.valeur) {
        return repondre(reponse, 400, { detail: "Code incorrect ou expiré. Demandez un nouveau code sur le poste principal." });
      }
      if (config.appareils.length + 1 >= POSTES_MAX) {
        return repondre(reponse, 409, {
          detail: `${POSTES_MAX} postes au maximum (poste principal compris) : débranchez d'abord un appareil.`,
        });
      }
      const jeton = randomBytes(32).toString("hex");
      const appareil: AppareilBranche = {
        id: randomUUID(),
        nom: String(corps.nomAppareil ?? "").trim().slice(0, 60) || "Caisse",
        empreinteJeton: empreinte(jeton),
        dateBranchement: new Date().toISOString(),
        derniereConnexion: new Date().toISOString(),
      };
      ecrireConfigReseau({ ...config, appareils: [...config.appareils, appareil] });
      codeAppairage = null; // un code ne sert qu'une fois
      return repondre(reponse, 200, {
        jeton,
        appareilId: appareil.id,
        boutiqueId: config.boutiqueId,
        boutiqueNom: config.boutiqueNom,
        nomPoste: config.nomPoste,
      });
    }

    // Avec jeton : les données de la boutique.
    const appareil = appareilAuthentifie(requete, config);
    if (!appareil) return repondre(reponse, 401, { detail: "Appareil non branché à ce poste principal." });

    if (requete.method === "POST" && url.pathname === "/sync/push/") {
      const corps = (await lireCorps(requete)) as { changements?: Changement[] };
      const resultats = recevoirChangements(corps.changements ?? []);
      sauvegarder();
      return repondre(reponse, 200, { resultats });
    }
    if (requete.method === "GET" && url.pathname === "/sync/pull/") {
      return repondre(reponse, 200, extraireDepuis(config.boutiqueId, url.searchParams.get("depuis")));
    }
    if (requete.method === "GET" && url.pathname === "/reseau/comptes/") {
      // Comptes déjà connus de ce poste (mots de passe protégés, sans jetons de session) :
      // un vendeur peut ainsi se connecter sur n'importe quelle caisse branchée.
      let comptes: ReturnType<typeof exporterComptesLocaux> = [];
      try {
        comptes = exporterComptesLocaux(config.boutiqueId);
      } catch {
        // cache des comptes illisible : aucune
      }
      return repondre(reponse, 200, { comptes });
    }
    if (requete.method === "GET" && url.pathname === "/reseau/stock/") {
      const ligne = unResultat<{ quantite: number }>("SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?", [
        url.searchParams.get("variante") ?? "",
        url.searchParams.get("depot") ?? "",
      ]);
      return repondre(reponse, 200, { quantite: Number(ligne?.quantite ?? 0) });
    }
    return repondre(reponse, 404, { detail: "Route inconnue." });
  } catch (erreur) {
    return repondre(reponse, 400, { detail: erreur instanceof Error ? erreur.message : "Requête invalide." });
  }
}

// --- Démarrage / arrêt ---

function ecouter(port: number): Promise<number> {
  return new Promise((resoudre, rejeter) => {
    const s = http.createServer((requete, reponse) => void traiterRequete(requete, reponse));
    s.once("error", rejeter);
    s.listen(port, "0.0.0.0", () => {
      serveur = s;
      resoudre((s.address() as { port: number }).port);
    });
  });
}

function demarrerAnnonce(config: ConfigPrincipal, port: number): void {
  try {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    socket.on("error", () => {}); // pas de réseau : on réessaiera au prochain démarrage
    socket.bind(() => {
      socket.setBroadcast(true);
      const message = Buffer.from(
        JSON.stringify({
          application: "gestion-stock",
          type: "poste-principal",
          boutiqueId: config.boutiqueId,
          boutiqueNom: config.boutiqueNom,
          nomPoste: config.nomPoste,
          port,
        }),
      );
      const minuteur = setInterval(() => socket.send(message, PORT_RESEAU, "255.255.255.255", () => {}), INTERVALLE_ANNONCE_MS);
      annonce = { socket, minuteur };
    });
  } catch {
    // L'annonce n'est qu'une commodité : la caisse peut toujours taper l'adresse.
  }
}

/**
 * Démarre le serveur si cet ordinateur est le poste principal (au lancement de
 * l'appli, ou juste après « Faire de cet ordinateur le poste principal »).
 * Port 47800, repli sur les suivants s'il est pris. `options.port` (0 = au hasard)
 * et `options.annonce` servent aux tests.
 */
export async function demarrerPostePrincipal(options: { port?: number; annonce?: boolean } = {}): Promise<number | null> {
  const config = lireConfigReseau();
  if (config.role !== "principal" || enPause) return null;
  if (serveur && portEcoute !== null) return portEcoute;
  if (!reseauAutorise()) {
    erreurDemarrage = MESSAGE_RESEAU_NON_ACTIVE;
    return null;
  }
  erreurDemarrage = null;
  const premier = options.port ?? PORT_RESEAU;
  const essais = premier === 0 ? [0] : Array.from({ length: 10 }, (_, i) => premier + i);
  for (const port of essais) {
    try {
      portEcoute = await ecouter(port);
      demarreLe = new Date().toISOString();
      requetesRecues = 0;
      if (options.annonce !== false) demarrerAnnonce(config, portEcoute);
      if (!codeAppairage) nouveauCodeAppairage();
      return portEcoute;
    } catch {
      // port occupé : on essaie le suivant
    }
  }
  erreurDemarrage = `Impossible d'ouvrir le serveur du poste principal (ports ${essais[0]} à ${essais[essais.length - 1]} occupés).`;
  return null;
}

export async function arreterPostePrincipal(): Promise<void> {
  if (annonce) {
    clearInterval(annonce.minuteur);
    try {
      annonce.socket.close();
    } catch {
      // déjà fermé
    }
    annonce = null;
  }
  const s = serveur;
  serveur = null;
  portEcoute = null;
  demarreLe = null;
  if (s) await new Promise<void>((resoudre) => s.close(() => resoudre()));
}

/**
 * Toutes les minutes (main.ts) : le réseau a été désactivé par l'administrateur →
 * le serveur s'arrête (les caisses continuent seules) ; réactivé → il redémarre
 * (sauf arrêt à la main). La configuration et les caisses branchées sont gardées.
 */
export async function verifierAutorisationReseau(): Promise<void> {
  if (lireConfigReseau().role !== "principal") return;
  if (!reseauAutorise()) {
    if (serveur) await arreterPostePrincipal();
    erreurDemarrage = MESSAGE_RESEAU_NON_ACTIVE;
    return;
  }
  if (erreurDemarrage === MESSAGE_RESEAU_NON_ACTIVE) erreurDemarrage = null;
  if (!serveur && !enPause) await demarrerPostePrincipal();
}

/** Pause : serveur et annonce arrêtés, code coupé ; les caisses gardent leur branchement. */
export async function mettreEnPausePostePrincipal(): Promise<EtatReseau> {
  if (lireConfigReseau().role !== "principal") throw new Error("Cet ordinateur n'est pas le poste principal.");
  enPause = true;
  codeAppairage = null;
  await arreterPostePrincipal();
  return etatReseau();
}

/** Reprise : le serveur redémarre, les caisses se reconnectent seules (sans nouveau code). */
export async function reprendrePostePrincipal(options: { port?: number; annonce?: boolean } = {}): Promise<EtatReseau> {
  if (!reseauAutorise()) throw new Error(MESSAGE_RESEAU_NON_ACTIVE);
  enPause = false;
  await demarrerPostePrincipal(options);
  return etatReseau();
}

/** Redémarrage (serveur bloqué, réseau changé…) : arrêt puis démarrage ; les caisses gardent leur branchement. */
export async function redemarrerPostePrincipal(options: { port?: number; annonce?: boolean } = {}): Promise<EtatReseau> {
  if (lireConfigReseau().role !== "principal") throw new Error("Cet ordinateur n'est pas le poste principal.");
  if (!reseauAutorise()) throw new Error(MESSAGE_RESEAU_NON_ACTIVE);
  enPause = false;
  await arreterPostePrincipal();
  await demarrerPostePrincipal(options);
  if (!serveur) throw new Error(erreurDemarrage ?? "Le serveur n'a pas pu redémarrer.");
  return etatReseau();
}

export async function devenirPostePrincipal(params: {
  boutiqueId: string;
  boutiqueNom: string;
  nomPoste?: string;
}): Promise<EtatReseau> {
  const actuelle = lireConfigReseau();
  if (actuelle.role === "caisse") {
    throw new Error("Cet ordinateur est branché comme caisse : débranchez-le d'abord du poste principal.");
  }
  if (!reseauAutorise()) throw new Error(MESSAGE_RESEAU_NON_ACTIVE);
  ecrireConfigReseau({
    role: "principal",
    boutiqueId: params.boutiqueId,
    boutiqueNom: params.boutiqueNom,
    nomPoste: (params.nomPoste ?? "").trim() || os.hostname() || "Poste principal",
    // Redevenir poste principal pour la même boutique garde les caisses déjà branchées.
    appareils: actuelle.role === "principal" && actuelle.boutiqueId === params.boutiqueId ? actuelle.appareils : [],
  });
  enPause = false;
  nouveauCodeAppairage();
  await demarrerPostePrincipal();
  return etatReseau();
}

/** Cet ordinateur redevient un poste seul : serveur arrêté, caisses débranchées. */
export async function quitterPostePrincipal(): Promise<EtatReseau> {
  await arreterPostePrincipal();
  codeAppairage = null;
  enPause = false;
  ecrireConfigReseau({ role: "seul" });
  return etatReseau();
}

export function debrancherAppareil(appareilId: string): EtatReseau {
  const config = lireConfigReseau();
  if (config.role === "principal") {
    ecrireConfigReseau({ ...config, appareils: config.appareils.filter((a) => a.id !== appareilId) });
  }
  return etatReseau();
}

/** Internet vu du poste principal : dernière synchro en ligne et envois en attente. */
export function etatInternet(boutiqueId: string): { derniereSynchro: string | null; enAttente: number } {
  let derniereSynchro: string | null = null;
  try {
    derniereSynchro = etatSynchro().derniereSynchro;
  } catch {
    // dossier de l'appli indisponible (tests)
  }
  return { derniereSynchro, enAttente: compterEnAttente(boutiqueId).reduce((t, e) => t + e.nombre, 0) };
}

export interface EtatCaisse {
  nomPostePrincipal: string;
  adresse: string;
  /** Le poste principal a répondu au dernier cycle. */
  relie: boolean;
  derniereSynchro: string | null;
  erreur: string | null;
  /** Lignes pas encore envoyées au poste principal. */
  enAttente: number;
  /** Internet vu du poste principal (dernier cycle réussi). */
  internetPrincipal: { derniereSynchro: string | null; enAttente: number } | null;
}

export interface EtatReseau {
  role: "seul" | "principal" | "caisse";
  /** Rôle caisse : liaison avec le poste principal. */
  caisse?: EtatCaisse;
  nomPoste: string | null;
  enMarche: boolean;
  /** Serveur mis en pause à la main (les caisses restent branchées). */
  enPause: boolean;
  port: number | null;
  adresses: string[];
  code: { valeur: string; expire: string } | null;
  appareils: (Omit<AppareilBranche, "empreinteJeton"> & { relie: boolean })[];
  postesMax: number;
  erreur: string | null;
  /** Nom Windows de l'ordinateur (nom proposé pour le poste principal). */
  nomOrdinateur: string;
  /** Rubrique Serveur du poste principal. */
  demarreLe: string | null;
  requetesRecues: number;
  /** Le poste principal s'annonce sur le réseau (les caisses le trouvent par « Rechercher »). */
  annonceActive: boolean;
  /** Envoi en ligne vu du poste principal. */
  internet: { derniereSynchro: string | null; enAttente: number } | null;
  /** Réseau de la boutique activé par l'administrateur. */
  reseauAutorise: boolean;
}

export function etatReseau(): EtatReseau {
  const config = lireConfigReseau();
  if (config.role === "caisse") {
    return { role: "caisse", nomPoste: null, enMarche: false, enPause: false, port: null, adresses: adressesLocales(), code: null, appareils: [], postesMax: POSTES_MAX, erreur: null, nomOrdinateur: os.hostname(), demarreLe: null, requetesRecues: 0, annonceActive: false, internet: null, reseauAutorise: reseauAutorise() };
  }
  if (config.role !== "principal") {
    return { role: "seul", nomPoste: null, enMarche: false, enPause: false, port: null, adresses: adressesLocales(), code: null, appareils: [], postesMax: POSTES_MAX, erreur: null, nomOrdinateur: os.hostname(), demarreLe: null, requetesRecues: 0, annonceActive: false, internet: null, reseauAutorise: reseauAutorise() };
  }
  if (codeAppairage && Date.now() > codeAppairage.expire) codeAppairage = null;
  const maintenant = Date.now();
  return {
    role: "principal",
    nomPoste: config.nomPoste,
    enMarche: serveur !== null,
    enPause,
    port: portEcoute,
    adresses: adressesLocales(),
    code: codeAppairage ? { valeur: codeAppairage.valeur, expire: new Date(codeAppairage.expire).toISOString() } : null,
    appareils: config.appareils.map(({ empreinteJeton: _empreinte, ...a }) => {
      const derniere = derniereRequete.get(a.id) ?? a.derniereConnexion;
      return {
        ...a,
        derniereConnexion: derniere,
        relie: !!derniere && maintenant - new Date(derniere).getTime() < DELAI_RELIE_MS,
      };
    }),
    postesMax: POSTES_MAX,
    erreur: erreurDemarrage,
    nomOrdinateur: os.hostname(),
    demarreLe,
    requetesRecues,
    annonceActive: annonce !== null,
    internet: etatInternet(config.boutiqueId),
    reseauAutorise: reseauAutorise(),
  };
}
