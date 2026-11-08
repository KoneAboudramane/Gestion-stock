import { ed25519 } from "@noble/curves/ed25519";

import { enregistrerIdentifiantAdminLocal, supprimerIdentifiantAdminLocal } from "../api/authHorsLigne";
import { BASE_URL } from "../api/transport";
import { listerTout } from "../db/helpers";
import { CLE_PUBLIQUE_ACTIVATION } from "./activation";
import { dateDuJourSure } from "./abonnement";
import { nomAppareil } from "./reseauConfig";

/**
 * Laissez-passer admin (docs/plan_laissez_passer_admin.md, lot C) : ouvrir
 * l'Espace Admin d'un appareil qui n'a JAMAIS vu internet. Le code est
 * fabriqué par le serveur (administration/laissez_passer.py), signé Ed25519
 * avec la même clé que les codes d'activation (préfixe distinct) : l'appli n'a
 * que la clé publique. Il porte l'empreinte du mot de passe de l'admin
 * (PBKDF2-SHA256, 100 000 tours) : il faut AUSSI le mot de passe.
 *
 * Accepté : l'identifiant admin est mémorisé sur l'appareil comme après une
 * connexion en ligne (les fois suivantes, identifiant + mot de passe
 * suffisent) ; l'utilisation est notée pour être signalée au serveur au retour
 * d'internet, qui dit si le laissez-passer vaut encore (révoqué, mot de passe
 * changé, compte désactivé) — sinon l'accès mémorisé est effacé.
 */

const PREFIXE_SIGNATURE = new TextEncoder().encode("gestion-stock/laissez-passer/v1");
const VERSION = 1;
const ORIGINE_DATES = Date.UTC(2020, 0, 1);
const ILLIMITE = 0xffff;
const ITERATIONS = 100_000;
const CLE_UTILISATIONS = "gestion-stock:laissez-passer-utilises";

export class ErreurLaissezPasser extends Error {}

let clePubliqueTests: string | null = null;

export function definirClePubliqueLaissezPasserPourLesTests(cle: string | null): void {
  clePubliqueTests = cle;
}

function decoderBase32(texte: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let valeur = 0;
  const octets: number[] = [];
  for (const caractere of texte) {
    const index = alphabet.indexOf(caractere);
    if (index < 0) throw new ErreurLaissezPasser("Laissez-passer invalide (caractère inconnu).");
    valeur = ((valeur << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(octets);
}

function versHex(octets: Uint8Array): string {
  return Array.from(octets, (o) => o.toString(16).padStart(2, "0")).join("");
}

export interface LaissezPasserLu {
  numero: string;
  identifiant: string;
  /** « AAAA-MM-JJ », ou null : illimité. */
  dateFin: string | null;
  sel: Uint8Array;
  empreinte: Uint8Array;
}

/** Vérifie la signature et lit le contenu, ou lève ErreurLaissezPasser. */
export function lireLaissezPasser(code: string): LaissezPasserLu {
  const brut = code.toUpperCase().replace(/[\s-]/g, "").replace(/^LP/, "");
  if (!brut) throw new ErreurLaissezPasser("Collez le laissez-passer reçu.");
  const octets = decoderBase32(brut);
  const invalide = new ErreurLaissezPasser("Laissez-passer invalide : vérifiez qu'il a été copié en entier, sans modification.");
  if (octets.length < 60 + 1 + 64) throw invalide;
  const finContenu = 60 + octets[59];
  const contenu = octets.subarray(0, finContenu);
  const signature = octets.subarray(finContenu);
  let valide = false;
  if (contenu[0] === VERSION && signature.length === 64) {
    const message = new Uint8Array(PREFIXE_SIGNATURE.length + contenu.length);
    message.set(PREFIXE_SIGNATURE);
    message.set(contenu, PREFIXE_SIGNATURE.length);
    try {
      const cle = Uint8Array.from(atob(clePubliqueTests ?? CLE_PUBLIQUE_ACTIVATION), (c) => c.charCodeAt(0));
      valide = ed25519.verify(signature, message, cle);
    } catch {
      valide = false;
    }
  }
  if (!valide) throw invalide;
  const jours = (contenu[9] << 8) | contenu[10];
  return {
    numero: versHex(contenu.subarray(1, 9)),
    dateFin: jours === ILLIMITE ? null : new Date(ORIGINE_DATES + jours * 86400000).toISOString().slice(0, 10),
    sel: contenu.slice(11, 27),
    empreinte: contenu.slice(27, 59),
    identifiant: new TextDecoder().decode(contenu.subarray(60, finContenu)),
  };
}

async function empreinteMotDePasse(motDePasse: string, sel: Uint8Array): Promise<Uint8Array> {
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(motDePasse), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: sel as BufferSource, iterations: ITERATIONS, hash: "SHA-256" }, cle, 256);
  return new Uint8Array(bits);
}

// --- Utilisations à signaler au serveur ---

interface UtilisationNotee {
  numero: string;
  identifiant: string;
  /** Utilisations pas encore signalées. */
  aSignaler: { date: string; appareil: string; boutique: string }[];
}

function lireUtilisations(): UtilisationNotee[] {
  try {
    return JSON.parse(localStorage.getItem(CLE_UTILISATIONS) ?? "[]") as UtilisationNotee[];
  } catch {
    return [];
  }
}

function ecrireUtilisations(liste: UtilisationNotee[]): void {
  localStorage.setItem(CLE_UTILISATIONS, JSON.stringify(liste));
}

/**
 * Sur place, sans internet : vérifie le laissez-passer (signature, date,
 * identifiant, mot de passe) puis mémorise l'accès admin sur l'appareil.
 */
export async function utiliserLaissezPasser(code: string, identifiant: string, motDePasse: string): Promise<LaissezPasserLu> {
  const lu = lireLaissezPasser(code);
  if (lu.identifiant !== identifiant.trim()) {
    throw new ErreurLaissezPasser("Ce laissez-passer a été généré pour un autre administrateur.");
  }
  // Date sûre : l'horloge reculée ne prolonge pas un laissez-passer (même protection que l'abonnement).
  if (lu.dateFin && dateDuJourSure().slice(0, 10) > lu.dateFin) {
    throw new ErreurLaissezPasser(`Laissez-passer expiré le ${lu.dateFin.split("-").reverse().join("/")} : demandez-en un nouveau.`);
  }
  const obtenue = await empreinteMotDePasse(motDePasse, lu.sel);
  if (obtenue.length !== lu.empreinte.length || obtenue.some((o, i) => o !== lu.empreinte[i])) {
    throw new ErreurLaissezPasser("Mot de passe incorrect (vérifié avec le laissez-passer).");
  }
  await enregistrerIdentifiantAdminLocal(lu.identifiant, motDePasse);
  const boutique = (await listerTout("boutiques").catch(() => []))[0]?.nom ?? "";
  const liste = lireUtilisations();
  const existante = liste.find((u) => u.numero === lu.numero);
  const utilisation = { date: new Date().toISOString(), appareil: await nomAppareil(), boutique };
  if (existante) existante.aSignaler.push(utilisation);
  else liste.push({ numero: lu.numero, identifiant: lu.identifiant, aSignaler: [utilisation] });
  ecrireUtilisations(liste);
  return lu;
}

/**
 * Au retour d'internet (à l'ouverture de l'Espace Admin) : signale les
 * utilisations et retire l'accès admin des laissez-passer qui ne valent plus.
 * Silencieux sans internet.
 */
export async function signalerLaissezPasser(): Promise<void> {
  const liste = lireUtilisations();
  if (liste.length === 0) return;
  const restants: UtilisationNotee[] = [];
  for (const u of liste) {
    try {
      const reponse = await fetch(`${BASE_URL}/admin/laissez-passer/utilisation/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero: u.numero, identifiant: u.identifiant, utilisations: u.aSignaler }),
        signal: AbortSignal.timeout(8000),
      });
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      const { valide } = (await reponse.json()) as { valide: boolean };
      if (!valide) {
        supprimerIdentifiantAdminLocal(u.identifiant);
        continue; // oublié : l'accès ne revient qu'avec une connexion en ligne ou un nouveau laissez-passer
      }
      restants.push({ ...u, aSignaler: [] });
    } catch {
      restants.push(u); // pas d'internet : on réessaiera
    }
  }
  ecrireUtilisations(restants);
}

// --- Générer depuis l'Espace Admin de l'appli (avec internet) ---

export interface LaissezPasserGenere {
  code: string;
  numero: string;
  /** « AAAA-MM-JJ », ou null : illimité. */
  date_fin: string | null;
  illimite: boolean;
}

/**
 * Le serveur fabrique et signe le laissez-passer (aucune clé dans l'appli) :
 * identifiants admin dans la requête, comme les autres actions de l'Espace Admin.
 * `dureeJours` null : illimité.
 */
export async function genererLaissezPasser(username: string, password: string, dureeJours: number | null): Promise<LaissezPasserGenere> {
  let reponse: Response;
  try {
    reponse = await fetch(`${BASE_URL}/admin/laissez-passer/depuis-appli/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, duree_jours: dureeJours === null ? "illimite" : dureeJours }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ErreurLaissezPasser("Pas d'internet : connectez-vous à internet pour générer un laissez-passer.");
  }
  const corps = (await reponse.json().catch(() => ({}))) as Partial<LaissezPasserGenere> & { detail?: string };
  if (!reponse.ok || !corps.code) {
    throw new ErreurLaissezPasser(corps.detail ?? `Génération refusée (HTTP ${reponse.status}).`);
  }
  return corps as LaissezPasserGenere;
}


// --- Liste et révocation depuis l'Espace Admin de l'appli (avec internet) ---

/** Un laissez-passer déjà généré, tel que le serveur le décrit (le code, lui, n'est gardé nulle part). */
export interface LaissezPasserResume {
  id: string;
  numero: string;
  admin: string;
  date_creation: string;
  /** « AAAA-MM-JJ », ou null : illimité. */
  date_fin: string | null;
  illimite: boolean;
  etat: "actif" | "expire" | "revoque" | "mot_de_passe_change" | "compte_desactive";
  etat_libelle: string;
  utilisations: number;
  derniere_utilisation: string | null;
}

async function actionLaissezPasser(
  username: string,
  password: string,
  corpsAction: Record<string, unknown>,
): Promise<LaissezPasserResume[]> {
  let reponse: Response;
  try {
    reponse = await fetch(`${BASE_URL}/admin/laissez-passer/depuis-appli/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, ...corpsAction }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ErreurLaissezPasser("Pas d'internet : la liste des laissez-passer se lit sur le serveur.");
  }
  const corps = (await reponse.json().catch(() => ({}))) as { laissez_passer?: LaissezPasserResume[]; detail?: string };
  if (!reponse.ok || !corps.laissez_passer) {
    throw new ErreurLaissezPasser(corps.detail ?? `Demande refusée (HTTP ${reponse.status}).`);
  }
  return corps.laissez_passer;
}

/** Ses laissez-passer (tous pour le superuser), les plus récents d'abord. */
export function listerLaissezPasser(username: string, password: string): Promise<LaissezPasserResume[]> {
  return actionLaissezPasser(username, password, { action: "lister" });
}

/** Révoque un laissez-passer : l'appareil qui l'utilise perd l'accès admin à son retour sur internet. */
export function revoquerLaissezPasser(username: string, password: string, id: string): Promise<LaissezPasserResume[]> {
  return actionLaissezPasser(username, password, { action: "revoquer", id });
}
