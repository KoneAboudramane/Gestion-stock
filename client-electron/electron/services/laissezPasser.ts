import { createPublicKey, pbkdf2Sync, timingSafeEqual, verify } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

import { URL_BASE_API } from "../config";
import { unResultat } from "../db/helpers";
import { rafraichirDatePlafond } from "./abonnement";
import { CLE_PUBLIQUE_ACTIVATION } from "./activation";

/**
 * Laissez-passer admin (docs/plan_laissez_passer_admin.md, lot C) : ouvrir
 * l'Espace Admin d'un ordinateur qui n'a JAMAIS vu internet. Même format et même
 * comportement que l'appli mobile (client-web/src/services/laissezPasser.ts) ;
 * code fabriqué par le serveur (administration/laissez_passer.py), signé
 * Ed25519 avec la clé des codes d'activation (préfixe distinct), portant
 * l'empreinte du mot de passe de l'admin (PBKDF2-SHA256, 100 000 tours).
 */

const PREFIXE_SIGNATURE = Buffer.from("gestion-stock/laissez-passer/v1");
const VERSION = 1;
const ORIGINE_DATES = Date.UTC(2020, 0, 1);
const ILLIMITE = 0xffff;
const ITERATIONS = 100_000;
const ENTETE_SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

export class ErreurLaissezPasser extends Error {}

let clePubliqueTests: string | null = null;
let cheminTests: string | null = null;

/** Tests : autre clé publique (base64), fichier des utilisations hors du dossier de l'appli. */
export function definirLaissezPasserPourLesTests(cle: string | null, chemin: string | null = null): void {
  clePubliqueTests = cle;
  cheminTests = chemin;
}

function decoderBase32(texte: string): Buffer {
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
  return Buffer.from(octets);
}

export interface LaissezPasserLu {
  numero: string;
  identifiant: string;
  /** « AAAA-MM-JJ », ou null : illimité. */
  dateFin: string | null;
  sel: Buffer;
  empreinte: Buffer;
}

export function lireLaissezPasser(code: string): LaissezPasserLu {
  const brut = code.toUpperCase().replace(/[\s-]/g, "").replace(/^LP/, "");
  if (!brut) throw new ErreurLaissezPasser("Collez le laissez-passer reçu.");
  const octets = decoderBase32(brut);
  const invalide = new ErreurLaissezPasser("Laissez-passer invalide : vérifiez qu'il a été copié en entier, sans modification.");
  if (octets.length < 60 + 1 + 64) throw invalide;
  const finContenu = 60 + octets[59];
  const contenu = octets.subarray(0, finContenu);
  const signature = octets.subarray(finContenu);
  const clePublique = createPublicKey({
    key: Buffer.concat([ENTETE_SPKI_ED25519, Buffer.from(clePubliqueTests ?? CLE_PUBLIQUE_ACTIVATION, "base64")]),
    format: "der",
    type: "spki",
  });
  const valide =
    contenu[0] === VERSION && signature.length === 64 && verify(null, Buffer.concat([PREFIXE_SIGNATURE, contenu]), clePublique, signature);
  if (!valide) throw invalide;
  const jours = contenu.readUInt16BE(9);
  return {
    numero: contenu.subarray(1, 9).toString("hex"),
    dateFin: jours === ILLIMITE ? null : new Date(ORIGINE_DATES + jours * 86400000).toISOString().slice(0, 10),
    sel: Buffer.from(contenu.subarray(11, 27)),
    empreinte: Buffer.from(contenu.subarray(27, 59)),
    identifiant: contenu.subarray(60, finContenu).toString("utf-8"),
  };
}

// --- Utilisations à signaler au serveur ---

interface UtilisationNotee {
  numero: string;
  identifiant: string;
  aSignaler: { date: string; appareil: string; boutique: string }[];
}

function cheminUtilisations(): string {
  return cheminTests ?? path.join(app.getPath("userData"), "laissez-passer-utilises.json");
}

function lireUtilisations(): UtilisationNotee[] {
  try {
    return JSON.parse(fs.readFileSync(cheminUtilisations(), "utf-8")) as UtilisationNotee[];
  } catch {
    return [];
  }
}

function ecrireUtilisations(liste: UtilisationNotee[]): void {
  fs.writeFileSync(cheminUtilisations(), JSON.stringify(liste, null, 2));
}

/**
 * Sur place, sans internet : vérifie le laissez-passer (signature, date,
 * identifiant, mot de passe). L'appelant (auth.ts) mémorise ensuite l'accès admin.
 */
export function verifierLaissezPasser(code: string, identifiant: string, motDePasse: string): LaissezPasserLu {
  const lu = lireLaissezPasser(code);
  if (lu.identifiant !== identifiant.trim()) {
    throw new ErreurLaissezPasser("Ce laissez-passer a été généré pour un autre administrateur.");
  }
  // Date sûre : l'horloge reculée ne prolonge pas un laissez-passer (même protection que l'abonnement).
  if (lu.dateFin && rafraichirDatePlafond().slice(0, 10) > lu.dateFin) {
    throw new ErreurLaissezPasser(`Laissez-passer expiré le ${lu.dateFin.split("-").reverse().join("/")} : demandez-en un nouveau.`);
  }
  const obtenue = pbkdf2Sync(motDePasse, lu.sel, ITERATIONS, 32, "sha256");
  if (obtenue.length !== lu.empreinte.length || !timingSafeEqual(obtenue, lu.empreinte)) {
    throw new ErreurLaissezPasser("Mot de passe incorrect (vérifié avec le laissez-passer).");
  }
  return lu;
}

/** Note l'utilisation, pour la signaler au serveur au retour d'internet. */
export function noterUtilisation(lu: LaissezPasserLu): void {
  let boutique = "";
  try {
    boutique = unResultat<{ nom: string }>("SELECT nom FROM boutiques LIMIT 1")?.nom ?? "";
  } catch {
    // base pas encore ouverte : ordinateur neuf
  }
  const liste = lireUtilisations();
  const utilisation = { date: new Date().toISOString(), appareil: os.hostname(), boutique };
  const existante = liste.find((u) => u.numero === lu.numero);
  if (existante) existante.aSignaler.push(utilisation);
  else liste.push({ numero: lu.numero, identifiant: lu.identifiant, aSignaler: [utilisation] });
  ecrireUtilisations(liste);
}

/**
 * Au retour d'internet (ouverture de l'Espace Admin) : signale les utilisations ;
 * renvoie les identifiants dont le laissez-passer ne vaut plus (l'appelant
 * efface leur accès mémorisé). Silencieux sans internet.
 */
export async function signalerLaissezPasser(): Promise<string[]> {
  const liste = lireUtilisations();
  const aRetirer: string[] = [];
  const restants: UtilisationNotee[] = [];
  for (const u of liste) {
    try {
      const reponse = await fetch(`${URL_BASE_API}/admin/laissez-passer/utilisation/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero: u.numero, identifiant: u.identifiant, utilisations: u.aSignaler }),
        signal: AbortSignal.timeout(8000),
      });
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      const { valide } = (await reponse.json()) as { valide: boolean };
      if (!valide) {
        aRetirer.push(u.identifiant);
        continue;
      }
      restants.push({ ...u, aSignaler: [] });
    } catch {
      restants.push(u);
    }
  }
  if (liste.length > 0) ecrireUtilisations(restants);
  return aRetirer;
}

// --- Générer depuis l'Espace Admin de l'appli (avec internet) ---

export interface LaissezPasserGenere {
  code: string;
  numero: string;
  /** « AAAA-MM-JJ », ou null : illimité. */
  date_fin: string | null;
  illimite: boolean;
}

/** Le serveur fabrique et signe le laissez-passer (aucune clé dans l'appli). `dureeJours` null : illimité. */
export async function genererLaissezPasser(username: string, password: string, dureeJours: number | null): Promise<LaissezPasserGenere> {
  let reponse: Response;
  try {
    reponse = await fetch(`${URL_BASE_API}/admin/laissez-passer/depuis-appli/`, {
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
