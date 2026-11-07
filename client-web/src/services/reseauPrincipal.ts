import type { PluginListenerHandle } from "@capacitor/core";

import { exporterComptesLocaux } from "../api/authHorsLigne";
import { ouvrirBaseDeDonnees } from "../db";
import { estAppliMobile } from "../lib/appliAndroid";
import { compterEnAttente, etatSynchro, extraireDepuis, recevoirChangements, type Changement } from "../sync";
import {
  MESSAGE_RESEAU_NON_ACTIVE,
  PORT_RESEAU,
  POSTES_MAX,
  ReseauBoutique,
  ecrireConfigReseau,
  estAdressePrivee,
  hmacSha256Hex,
  lireConfigReseau,
  nomAppareil,
  reseauAutorise,
  sha256Hex,
  type AppareilBrancheConfig,
  type ConfigPrincipal,
  type EtatReseau,
  type RequeteRecue,
} from "./reseauConfig";

/**
 * Cet appareil (téléphone, tablette) en POSTE PRINCIPAL de la boutique
 * (docs/plan_mobile_complet.md, lot 3). Port de
 * client-electron/electron/services/reseauPrincipal.ts, au même contrat — un
 * ordinateur peut donc être caisse d'un téléphone, et inversement :
 * appairage par code à 6 chiffres → jeton d'appareil (on n'en garde que
 * l'empreinte), /sync/push/ + /sync/pull/ (curseur seq_reseau), comptes des
 * vendeurs, état du stock, annonce sur le réseau, 15 postes au maximum.
 *
 * Le module natif ne fait que le transport (serveur HTTP, annonce UDP) et garde
 * l'appli éveillée par un service de premier plan (notification permanente) :
 * chaque requête d'une caisse arrive ici par l'évènement « requete », la
 * réponse repart par `repondre`.
 */

const DUREE_CODE_MS = 10 * 60 * 1000;
/** Un appareil vu il y a moins de ce délai est « relié » (il synchronise toutes les 4 s). */
const DELAI_RELIE_MS = 15000;
const TAILLE_MAX_CORPS = 50 * 1024 * 1024;

let enMarche = false;
let portEcoute: number | null = null;
let annonceActive = false;
let codeAppairage: { valeur: string; expire: number } | null = null;
/** Serveur arrêté à la main : les caisses gardent leur jeton. En mémoire seulement (comme le bureau). */
let enPause = false;
let demarreLe: string | null = null;
let requetesRecues = 0;
let erreurDemarrage: string | null = null;
let ecoute: PluginListenerHandle | null = null;
/** Dernière requête de chaque appareil (en mémoire : inutile de réécrire la configuration toutes les 4 s). */
const derniereRequete = new Map<string, string>();
/** Tests : appareils (« Navigateur » hors appli) dont on simule le serveur. */
let serveurSimule = false;

export function simulerServeurPourLesTests(actif: boolean): void {
  serveurSimule = actif;
}

function lirePrincipal(): ConfigPrincipal | null {
  const config = lireConfigReseau();
  return config.role === "principal" ? config : null;
}

// --- Code à 6 chiffres ---

export function nouveauCodeAppairage(): { valeur: string; expire: string } {
  const valeur = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  codeAppairage = { valeur, expire: Date.now() + DUREE_CODE_MS };
  return { valeur, expire: new Date(codeAppairage.expire).toISOString() };
}

/** Arrête le code en cours : plus aucune caisse ne peut se brancher avec (les caisses déjà branchées restent reliées). */
export function annulerCodeAppairage(): void {
  codeAppairage = null;
}

// --- Traitement d'une requête de caisse ---

export interface ReponseServeur {
  statut: number;
  corps: unknown;
}

async function appareilAuthentifie(requete: RequeteRecue, config: ConfigPrincipal): Promise<AppareilBrancheConfig | null> {
  const entete = requete.entetes.authorization ?? "";
  if (!entete.startsWith("Bearer ")) return null;
  const recue = await sha256Hex(entete.slice(7));
  const appareil = config.appareils.find((a) => a.empreinteJeton === recue);
  if (!appareil) return null;
  derniereRequete.set(appareil.id, new Date().toISOString());
  return appareil;
}

function lireCorps(requete: RequeteRecue): Record<string, unknown> {
  if (requete.corps.length > TAILLE_MAX_CORPS) throw new Error("Envoi trop volumineux.");
  try {
    return requete.corps ? (JSON.parse(requete.corps) as Record<string, unknown>) : {};
  } catch {
    throw new Error("Corps JSON invalide.");
  }
}

/** Traitement d'une requête de caisse (exporté pour les tests). Même réponses que le bureau. */
export async function traiterRequete(requete: RequeteRecue): Promise<ReponseServeur> {
  if (!estAdressePrivee(requete.adresse)) return { statut: 403, corps: { detail: "Réseau non autorisé." } };
  requetesRecues++;
  const config = lirePrincipal();
  if (!config) return { statut: 503, corps: { detail: "Cet appareil n'est plus le poste principal." } };
  const url = new URL(requete.chemin, "http://poste-principal");
  const methode = requete.methode.toUpperCase();

  try {
    // Sans jeton : présentation (vérifier qu'on parle au bon poste) et appairage.
    if (methode === "GET" && url.pathname === "/reseau/etat/") {
      return {
        statut: 200,
        corps: {
          application: "gestion-stock",
          boutiqueId: config.boutiqueId,
          boutiqueNom: config.boutiqueNom,
          nomPoste: config.nomPoste,
          internet: await etatInternet(),
        },
      };
    }
    // Une caisse qui a perdu le poste principal vérifie qu'elle a retrouvé le BON
    // avant de lui confier son jeton : seul lui connaît l'empreinte (défi HMAC).
    if (methode === "POST" && url.pathname === "/reseau/prouver/") {
      const corps = lireCorps(requete) as { appareilId?: string; defi?: string };
      const appareil = config.appareils.find((a) => a.id === corps.appareilId);
      if (!appareil || typeof corps.defi !== "string" || corps.defi.length < 32 || corps.defi.length > 128) {
        return { statut: 404, corps: { detail: "Appareil inconnu de ce poste principal." } };
      }
      return { statut: 200, corps: { preuve: await hmacSha256Hex(appareil.empreinteJeton, corps.defi) } };
    }
    if (methode === "POST" && url.pathname === "/reseau/appairer/") {
      const corps = lireCorps(requete) as { code?: string; nomAppareil?: string };
      if (!codeAppairage || Date.now() > codeAppairage.expire || String(corps.code ?? "").trim() !== codeAppairage.valeur) {
        return { statut: 400, corps: { detail: "Code incorrect ou expiré. Demandez un nouveau code sur le poste principal." } };
      }
      if (config.appareils.length + 1 >= POSTES_MAX) {
        return { statut: 409, corps: { detail: `${POSTES_MAX} postes au maximum (poste principal compris) : débranchez d'abord un appareil.` } };
      }
      const octets = crypto.getRandomValues(new Uint8Array(32));
      const jeton = Array.from(octets, (o) => o.toString(16).padStart(2, "0")).join("");
      const maintenant = new Date().toISOString();
      const appareil: AppareilBrancheConfig = {
        id: crypto.randomUUID(),
        nom: String(corps.nomAppareil ?? "").trim().slice(0, 60) || "Caisse",
        empreinteJeton: await sha256Hex(jeton),
        dateBranchement: maintenant,
        derniereConnexion: maintenant,
      };
      ecrireConfigReseau({ ...config, appareils: [...config.appareils, appareil] });
      codeAppairage = null; // un code ne sert qu'une fois
      void mettreAJourNotification();
      return {
        statut: 200,
        corps: { jeton, appareilId: appareil.id, boutiqueId: config.boutiqueId, boutiqueNom: config.boutiqueNom, nomPoste: config.nomPoste },
      };
    }

    // Avec jeton : les données de la boutique.
    const appareil = await appareilAuthentifie(requete, config);
    if (!appareil) return { statut: 401, corps: { detail: "Appareil non branché à ce poste principal." } };

    if (methode === "POST" && url.pathname === "/sync/push/") {
      const corps = lireCorps(requete) as { changements?: Changement[] };
      const resultats = await recevoirChangements(corps.changements ?? []);
      if (resultats.length > 0) prevenir();
      return { statut: 200, corps: { resultats } };
    }
    if (methode === "GET" && url.pathname === "/sync/pull/") {
      return { statut: 200, corps: await extraireDepuis(url.searchParams.get("depuis")) };
    }
    if (methode === "GET" && url.pathname === "/reseau/comptes/") {
      // Comptes déjà connus de cet appareil (mots de passe protégés, sans jetons de session) :
      // un vendeur peut ainsi se connecter sur n'importe quelle caisse branchée.
      let comptes: ReturnType<typeof exporterComptesLocaux> = [];
      try {
        comptes = exporterComptesLocaux(config.boutiqueId);
      } catch {
        // cache des comptes illisible : aucun
      }
      return { statut: 200, corps: { comptes } };
    }
    if (methode === "GET" && url.pathname === "/reseau/stock/") {
      const db = await ouvrirBaseDeDonnees();
      const ligne = await db.getFromIndex("stocks", "variante_depot", [
        url.searchParams.get("variante") ?? "",
        url.searchParams.get("depot") ?? "",
      ]);
      return { statut: 200, corps: { quantite: Number(ligne?.quantite ?? 0) } };
    }
    return { statut: 404, corps: { detail: "Route inconnue." } };
  } catch (erreur) {
    return { statut: 400, corps: { detail: erreur instanceof Error ? erreur.message : "Requête invalide." } };
  }
}

// --- Écrans à prévenir (nouvelles ventes d'une caisse, appareils reliés) ---

const abonnes = new Set<() => void>();

export function surChangementPrincipal(rappel: () => void): () => void {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
}

function prevenir(): void {
  for (const rappel of abonnes) rappel();
}

// --- Démarrage / arrêt ---

async function texteNotification(): Promise<{ titre: string; texte: string }> {
  const config = lirePrincipal();
  const maintenant = Date.now();
  const reliees = (config?.appareils ?? []).filter((a) => {
    const derniere = derniereRequete.get(a.id) ?? a.derniereConnexion;
    return !!derniere && maintenant - new Date(derniere).getTime() < DELAI_RELIE_MS;
  }).length;
  return {
    titre: "🟢 Serveur de la boutique actif",
    texte: `${config?.nomPoste ?? "Poste principal"} · ${reliees} caisse${reliees > 1 ? "s" : ""} reliée${reliees > 1 ? "s" : ""} — gardez l'appli ouverte et l'appareil sur chargeur`,
  };
}

async function mettreAJourNotification(): Promise<void> {
  if (!enMarche || !estAppliMobile) return;
  try {
    await ReseauBoutique.mettreAJourService(await texteNotification());
  } catch {
    // notification indisponible : le serveur continue
  }
}

async function brancherEcoute(): Promise<void> {
  if (ecoute || !estAppliMobile) return;
  ecoute = await ReseauBoutique.addListener("requete", (requete) => {
    void (async () => {
      const reponse = await traiterRequete(requete).catch(
        (e: unknown): ReponseServeur => ({ statut: 500, corps: { detail: e instanceof Error ? e.message : "Erreur du poste principal." } }),
      );
      await ReseauBoutique.repondre({ id: requete.id, statut: reponse.statut, corps: JSON.stringify(reponse.corps) }).catch(() => {});
    })();
  });
}

/**
 * Démarre le serveur si cet appareil est le poste principal (au lancement de
 * l'appli, ou juste après « Faire de cet appareil le poste principal »).
 * Port 47800, repli sur les suivants s'il est pris.
 */
export async function demarrerPostePrincipal(): Promise<number | null> {
  const config = lirePrincipal();
  if (!config || enPause) return null;
  if (enMarche && portEcoute !== null) return portEcoute;
  if (!(await reseauAutorise())) {
    erreurDemarrage = MESSAGE_RESEAU_NON_ACTIVE;
    return null;
  }
  erreurDemarrage = null;
  if (!estAppliMobile) {
    if (!serveurSimule) {
      erreurDemarrage = "Le poste principal n'est possible que dans l'appli mobile ou sur ordinateur.";
      return null;
    }
    enMarche = true;
    portEcoute = PORT_RESEAU;
    demarreLe = new Date().toISOString();
    if (!codeAppairage) nouveauCodeAppairage();
    return portEcoute;
  }
  await brancherEcoute();
  for (let i = 0; i < 10; i++) {
    try {
      const { port } = await ReseauBoutique.demarrerServeur({ port: PORT_RESEAU + i });
      portEcoute = port;
      enMarche = true;
      demarreLe = new Date().toISOString();
      requetesRecues = 0;
      try {
        await ReseauBoutique.demarrerAnnonce({
          message: JSON.stringify({
            application: "gestion-stock",
            type: "poste-principal",
            boutiqueId: config.boutiqueId,
            boutiqueNom: config.boutiqueNom,
            nomPoste: config.nomPoste,
            port,
          }),
        });
        annonceActive = true;
      } catch {
        // L'annonce n'est qu'une commodité : la caisse peut toujours taper l'adresse.
      }
      try {
        await ReseauBoutique.demarrerService(await texteNotification());
      } catch {
        // sans notification, Android peut couper le serveur en arrière-plan : signalé dans l'aide
      }
      if (!codeAppairage) nouveauCodeAppairage();
      return port;
    } catch {
      // port occupé : on essaie le suivant
    }
  }
  erreurDemarrage = `Impossible d'ouvrir le serveur du poste principal (ports ${PORT_RESEAU} à ${PORT_RESEAU + 9} occupés).`;
  return null;
}

export async function arreterPostePrincipal(): Promise<void> {
  enMarche = false;
  portEcoute = null;
  demarreLe = null;
  annonceActive = false;
  if (!estAppliMobile) return;
  await ReseauBoutique.arreterAnnonce().catch(() => {});
  await ReseauBoutique.arreterServeur().catch(() => {});
  await ReseauBoutique.arreterService().catch(() => {});
}

/**
 * Toutes les minutes : le réseau a été désactivé par l'administrateur → le
 * serveur s'arrête (les caisses continuent seules) ; réactivé → il redémarre
 * (sauf arrêt à la main). La configuration et les caisses branchées sont gardées.
 */
export async function verifierAutorisationReseau(): Promise<void> {
  if (!lirePrincipal()) return;
  if (!(await reseauAutorise())) {
    if (enMarche) await arreterPostePrincipal();
    erreurDemarrage = MESSAGE_RESEAU_NON_ACTIVE;
    return;
  }
  if (erreurDemarrage === MESSAGE_RESEAU_NON_ACTIVE) erreurDemarrage = null;
  if (!enMarche && !enPause) await demarrerPostePrincipal();
  else void mettreAJourNotification();
}

/** Pause : serveur et annonce arrêtés, code coupé ; les caisses gardent leur branchement. */
export async function mettreEnPausePostePrincipal(): Promise<EtatReseau> {
  if (!lirePrincipal()) throw new Error("Cet appareil n'est pas le poste principal.");
  enPause = true;
  codeAppairage = null;
  await arreterPostePrincipal();
  return etatPrincipal();
}

/** Reprise : le serveur redémarre, les caisses se reconnectent seules (sans nouveau code). */
export async function reprendrePostePrincipal(): Promise<EtatReseau> {
  if (!(await reseauAutorise())) throw new Error(MESSAGE_RESEAU_NON_ACTIVE);
  enPause = false;
  await demarrerPostePrincipal();
  return etatPrincipal();
}

/** Redémarrage (serveur bloqué, réseau changé…) : arrêt puis démarrage ; les caisses gardent leur branchement. */
export async function redemarrerPostePrincipal(): Promise<EtatReseau> {
  if (!lirePrincipal()) throw new Error("Cet appareil n'est pas le poste principal.");
  if (!(await reseauAutorise())) throw new Error(MESSAGE_RESEAU_NON_ACTIVE);
  enPause = false;
  await arreterPostePrincipal();
  await demarrerPostePrincipal();
  if (!enMarche) throw new Error(erreurDemarrage ?? "Le serveur n'a pas pu redémarrer.");
  return etatPrincipal();
}

export async function devenirPostePrincipal(params: { boutiqueId: string; boutiqueNom: string; nomPoste?: string }): Promise<EtatReseau> {
  const actuelle = lireConfigReseau();
  if (actuelle.role === "caisse") {
    throw new Error("Cet appareil est branché comme caisse : débranchez-le d'abord du poste principal.");
  }
  if (!(await reseauAutorise())) throw new Error(MESSAGE_RESEAU_NON_ACTIVE);
  ecrireConfigReseau({
    role: "principal",
    boutiqueId: params.boutiqueId,
    boutiqueNom: params.boutiqueNom,
    nomPoste: (params.nomPoste ?? "").trim() || (await nomAppareil()) || "Poste principal",
    // Redevenir poste principal pour la même boutique garde les caisses déjà branchées.
    appareils: actuelle.role === "principal" && actuelle.boutiqueId === params.boutiqueId ? actuelle.appareils : [],
  });
  enPause = false;
  nouveauCodeAppairage();
  await demarrerPostePrincipal();
  return etatPrincipal();
}

/** Cet appareil redevient un appareil seul : serveur arrêté, caisses débranchées. */
export async function quitterPostePrincipal(): Promise<EtatReseau> {
  await arreterPostePrincipal();
  codeAppairage = null;
  enPause = false;
  ecrireConfigReseau({ role: "seul" });
  return etatPrincipal();
}

export async function debrancherAppareil(appareilId: string): Promise<EtatReseau> {
  const config = lirePrincipal();
  if (config) ecrireConfigReseau({ ...config, appareils: config.appareils.filter((a) => a.id !== appareilId) });
  void mettreAJourNotification();
  return etatPrincipal();
}

/** Internet vu du poste principal : dernière synchro en ligne et envois en attente. */
export async function etatInternet(): Promise<{ derniereSynchro: string | null; enAttente: number }> {
  return {
    derniereSynchro: etatSynchro().derniereSynchro,
    enAttente: (await compterEnAttente("en_ligne")).reduce((t, e) => t + e.nombre, 0),
  };
}

/** État pour l'écran et l'indicateur (même forme que le bureau). Appareil seul : rien à montrer ici. */
export async function etatPrincipal(): Promise<EtatReseau> {
  const config = lirePrincipal();
  const adresses = estAppliMobile ? await ReseauBoutique.adressesLocales().then((r) => r.adresses).catch(() => []) : [];
  const base: EtatReseau = {
    role: config ? "principal" : "seul",
    nomPoste: config?.nomPoste ?? null,
    enMarche: false,
    enPause: false,
    port: null,
    adresses,
    code: null,
    appareils: [],
    postesMax: POSTES_MAX,
    erreur: null,
    nomOrdinateur: await nomAppareil(),
    demarreLe: null,
    requetesRecues: 0,
    annonceActive: false,
    internet: null,
    reseauAutorise: await reseauAutorise(),
  };
  if (!config) return base;
  if (codeAppairage && Date.now() > codeAppairage.expire) codeAppairage = null;
  const maintenant = Date.now();
  return {
    ...base,
    enMarche,
    enPause,
    port: portEcoute,
    code: codeAppairage ? { valeur: codeAppairage.valeur, expire: new Date(codeAppairage.expire).toISOString() } : null,
    appareils: config.appareils.map(({ empreinteJeton: _empreinte, ...a }) => {
      const derniere = derniereRequete.get(a.id) ?? a.derniereConnexion;
      return { ...a, derniereConnexion: derniere, relie: !!derniere && maintenant - new Date(derniere).getTime() < DELAI_RELIE_MS };
    }),
    erreur: erreurDemarrage,
    demarreLe,
    requetesRecues,
    annonceActive,
    internet: await etatInternet(),
  };
}

/** Au lancement de l'appli : le poste principal rouvre son serveur ; toutes les minutes, l'activation est revérifiée. */
export function lancerPostePrincipal(): void {
  void demarrerPostePrincipal();
  // Sans effet sur une caisse ou un appareil seul (voir verifierAutorisationReseau).
  setInterval(() => void verifierAutorisationReseau(), 60_000);
}
