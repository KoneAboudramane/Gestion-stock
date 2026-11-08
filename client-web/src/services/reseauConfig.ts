import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import { listerTout } from "../db/helpers";
import { estAppliMobile } from "../lib/appliAndroid";
import { droitsOptionsBoutique } from "./abonnement";

/**
 * Réseau de la boutique : ce que partagent la caisse (services/reseau.ts) et le
 * poste principal (services/reseauPrincipal.ts) — configuration de l'appareil,
 * module natif, types de l'état affiché (mêmes formes que le bureau,
 * client-electron/electron/services/reseauPrincipal.ts).
 */

export const PORT_RESEAU = 47800;
/** Postes au maximum, poste principal compris. */
export const POSTES_MAX = 15;

export const MESSAGE_RESEAU_NON_ACTIVE =
  "Le réseau de la boutique n'est pas activé : demandez-le à votre administrateur (Réseau de la boutique → Demander l'activation).";

// --- Module natif (android/…/ReseauBoutiquePlugin.java) ---

/** Requête d'une caisse reçue par le serveur du poste principal. */
export interface RequeteRecue {
  id: string;
  methode: string;
  /** Chemin et paramètres, ex. « /sync/pull/?depuis=12 ». */
  chemin: string;
  /** En-têtes, noms en minuscules. */
  entetes: Record<string, string>;
  corps: string;
  /** Adresse IP de la caisse. */
  adresse: string;
}

export interface ModuleReseauBoutique {
  // Caisse
  rechercherPostes(options: { dureeMs: number }): Promise<{ postes: PostePrincipalTrouve[] }>;
  requete(options: {
    url: string;
    methode?: string;
    entetes?: Record<string, string>;
    corps?: string;
    delaiMs?: number;
  }): Promise<{ statut: number; corps: string }>;
  nomAppareil(): Promise<{ nom: string }>;
  // Poste principal
  demarrerServeur(options: { port: number }): Promise<{ port: number }>;
  arreterServeur(): Promise<void>;
  repondre(options: { id: string; statut: number; corps: string }): Promise<void>;
  demarrerAnnonce(options: { message: string }): Promise<void>;
  arreterAnnonce(): Promise<void>;
  adressesLocales(): Promise<{ adresses: string[] }>;
  /** Service de premier plan : notification permanente, appareil et Wi-Fi gardés éveillés. */
  demarrerService(options: { titre: string; texte: string }): Promise<void>;
  mettreAJourService(options: { titre: string; texte: string }): Promise<void>;
  arreterService(): Promise<void>;
  addListener(evenement: "requete", rappel: (requete: RequeteRecue) => void): Promise<PluginListenerHandle>;
}

export const ReseauBoutique = registerPlugin<ModuleReseauBoutique>("ReseauBoutique");

// --- Configuration (équivalent de reseau.json du bureau) ---

export interface AppareilBrancheConfig {
  id: string;
  nom: string;
  /** Empreinte SHA-256 du jeton (le jeton lui-même n'est gardé que par l'appareil). */
  empreinteJeton: string;
  dateBranchement: string;
  derniereConnexion: string | null;
}

export interface ConfigPrincipal {
  role: "principal";
  boutiqueId: string;
  boutiqueNom: string;
  nomPoste: string;
  appareils: AppareilBrancheConfig[];
}

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

const CLE_CONFIG = "gestion-stock:reseau";

export function lireConfigReseau(): ConfigReseau {
  try {
    const config = JSON.parse(localStorage.getItem(CLE_CONFIG) ?? "null");
    if (config?.role === "principal" && config.boutiqueId) return config as ConfigPrincipal;
    if (config?.role === "caisse" && config.boutiqueId && config.jeton) return config as ConfigCaisse;
  } catch {
    // illisible : appareil seul
  }
  return { role: "seul" };
}

export function ecrireConfigReseau(config: ConfigReseau): void {
  localStorage.setItem(CLE_CONFIG, JSON.stringify(config));
}

/** Réseau de la boutique activé par l'administrateur (comptes.Boutique.reseau_autorise) ? Un appareil = une boutique. */
export async function reseauAutorise(): Promise<boolean> {
  // Droit à l'option Réseau : Pro (essai compris), payée, liée à l'abonnement ou exception de l'admin.
  try {
    return (await droitsOptionsBoutique()).reseau;
  } catch {
    return false;
  }
}

let nomAppareilCache: string | null = null;

/** Nom de cet appareil (vu dans la liste du poste principal ; nom proposé pour un poste principal). */
export async function nomAppareil(): Promise<string> {
  if (nomAppareilCache) return nomAppareilCache;
  try {
    nomAppareilCache = estAppliMobile ? (await ReseauBoutique.nomAppareil()).nom : "Navigateur";
  } catch {
    nomAppareilCache = "Téléphone";
  }
  return nomAppareilCache;
}

// --- Petits outils ---

export function versHex(octets: ArrayBuffer): string {
  return Array.from(new Uint8Array(octets), (o) => o.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(texte: string): Promise<string> {
  return versHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)));
}

export async function hmacSha256Hex(cle: string, message: string): Promise<string> {
  const encodeur = new TextEncoder();
  const cleImportee = await crypto.subtle.importKey("raw", encodeur.encode(cle), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return versHex(await crypto.subtle.sign("HMAC", cleImportee, encodeur.encode(message)));
}

/** Seules les adresses du réseau privé (et l'appareil lui-même) sont servies. */
export function estAdressePrivee(adresse: string | undefined): boolean {
  if (!adresse) return false;
  const ip = adresse.startsWith("::ffff:") ? adresse.slice(7) : adresse;
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

// --- État affiché (même forme que le bureau) ---

export interface PostePrincipalTrouve {
  boutiqueId: string;
  boutiqueNom: string;
  nomPoste: string;
  adresse: string;
}

export interface AppareilBranche {
  id: string;
  nom: string;
  dateBranchement: string;
  derniereConnexion: string | null;
  /** Vu il y a moins de 15 s (il synchronise toutes les 4 s). */
  relie: boolean;
}

export interface EtatCaisse {
  nomPostePrincipal: string;
  adresse: string;
  relie: boolean;
  derniereSynchro: string | null;
  erreur: string | null;
  /** Lignes pas encore envoyées au poste principal. */
  enAttente: number;
  /** Internet vu du poste principal (dernier échange réussi). */
  internetPrincipal: { derniereSynchro: string | null; enAttente: number } | null;
}

export interface EtatReseau {
  role: "seul" | "principal" | "caisse";
  caisse?: EtatCaisse;
  nomPoste: string | null;
  enMarche: boolean;
  /** Serveur mis en pause à la main (les caisses restent branchées). */
  enPause: boolean;
  port: number | null;
  adresses: string[];
  code: { valeur: string; expire: string } | null;
  appareils: AppareilBranche[];
  postesMax: number;
  erreur: string | null;
  /** Nom de cet appareil (nom proposé pour le poste principal). */
  nomOrdinateur: string;
  demarreLe: string | null;
  requetesRecues: number;
  annonceActive: boolean;
  /** Envoi en ligne vu du poste principal. */
  internet: { derniereSynchro: string | null; enAttente: number } | null;
  reseauAutorise: boolean;
}
