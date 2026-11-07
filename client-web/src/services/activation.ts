import { ed25519 } from "@noble/curves/ed25519";

import { listerParametres, definirParametre } from "./configuration";

/**
 * Port de client-electron/electron/services/activation.ts (codes d'activation de
 * l'abonnement, vérifiés SANS internet — docs/plan_reseau_local.md lot 6,
 * docs/plan_mobile_complet.md lot 1).
 *
 * Le code (généré par comptes/activation.py dans l'espace admin) porte la
 * boutique, la date de fin et la formule, signés en Ed25519 par la clé privée
 * du serveur ; l'appli n'a que la clé publique. Vérification par @noble/curves
 * (JavaScript pur) : marche dans toutes les vues web Android, même anciennes.
 *
 * Le code accepté est gardé comme réglage de la boutique (cle « code_activation »),
 * synchronisé comme les autres : la date la plus lointaine entre le serveur et
 * le code l'emporte (voir abonnement.ts::dateExpirationEffective).
 */

/** Même clé publique que le bureau (comptes/management/commands/generer_cle_activation.py). */
export const CLE_PUBLIQUE_ACTIVATION = "vc7DwM1ugXrjp2wqKnXHtKmZdqx32lZWmHwS3Af3CBY=";
export const CLE_PARAMETRE_CODE_ACTIVATION = "code_activation";

const PREFIXE_SIGNATURE = new TextEncoder().encode("gestion-stock/activation/v1");
const VERSION = 1;
const ORIGINE_DATES = Date.UTC(2020, 0, 1);
const FORMULES = ["essentiel", "pro"] as const;

export class ErreurActivation extends Error {}

let clePubliqueTests: string | null = null;

/** Tests : vérifier avec une autre clé publique (base64) que celle de l'appli. */
export function definirClePubliqueActivationPourLesTests(cle: string | null): void {
  clePubliqueTests = cle;
}

function decoderBase32(texte: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let valeur = 0;
  const octets: number[] = [];
  for (const caractere of texte) {
    const index = alphabet.indexOf(caractere);
    if (index < 0) throw new ErreurActivation("Code d'activation invalide (caractère inconnu).");
    valeur = ((valeur << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(octets);
}

function base64VersOctets(texte: string): Uint8Array {
  return Uint8Array.from(atob(texte), (c) => c.charCodeAt(0));
}

function uuidDepuisOctets(octets: Uint8Array): string {
  const hex = Array.from(octets, (o) => o.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface CodeActivationLu {
  boutiqueId: string;
  /** « AAAA-MM-JJ » */
  dateFin: string;
  formule: (typeof FORMULES)[number];
}

/** Vérifie la signature et lit le contenu d'un code, ou lève ErreurActivation. */
export function lireCodeActivation(code: string): CodeActivationLu {
  // Séparateurs retirés d'abord, puis le préfixe : le contenu commence toujours
  // par « A » (version 1), jamais par « GS ».
  const brut = code.toUpperCase().replace(/[\s-]/g, "").replace(/^GS/, "");
  if (!brut) throw new ErreurActivation("Collez le code d'activation reçu.");
  const octets = decoderBase32(brut);
  const contenu = octets.subarray(0, 24);
  const signature = octets.subarray(24);
  let valide = false;
  if (contenu.length === 24 && signature.length === 64 && contenu[0] === VERSION) {
    const message = new Uint8Array(PREFIXE_SIGNATURE.length + contenu.length);
    message.set(PREFIXE_SIGNATURE);
    message.set(contenu, PREFIXE_SIGNATURE.length);
    try {
      valide = ed25519.verify(signature, message, base64VersOctets(clePubliqueTests ?? CLE_PUBLIQUE_ACTIVATION));
    } catch {
      valide = false;
    }
  }
  if (!valide) throw new ErreurActivation("Code d'activation invalide : vérifiez qu'il a été copié en entier, sans modification.");
  const jours = (contenu[17] << 8) | contenu[18];
  return {
    boutiqueId: uuidDepuisOctets(contenu.subarray(1, 17)),
    dateFin: new Date(ORIGINE_DATES + jours * 86400000).toISOString().slice(0, 10),
    formule: FORMULES[contenu[19]] ?? "essentiel",
  };
}

/** Fin de la journée de fin du code (le serveur compte en date du jour). */
function finDeJournee(dateFin: string): string {
  return `${dateFin}T23:59:59.000Z`;
}

/** Date de fin apportée par le code d'activation gardé pour cette boutique, ou null. */
export async function dateExpirationParCode(boutiqueId: string): Promise<string | null> {
  const parametre = (await listerParametres(boutiqueId)).find((p) => p.cle === CLE_PARAMETRE_CODE_ACTIVATION);
  if (!parametre?.valeur) return null;
  try {
    const lu = lireCodeActivation(parametre.valeur);
    return lu.boutiqueId === boutiqueId ? finDeJournee(lu.dateFin) : null;
  } catch {
    return null;
  }
}

/**
 * Saisie du code : vérifié sans internet, refusé s'il est pour une autre
 * boutique ou s'il ne prolonge rien, puis gardé comme réglage de la boutique.
 */
export async function appliquerCodeActivation(
  code: string,
  boutiqueId: string,
  dateActuelle: string | null,
): Promise<CodeActivationLu> {
  const lu = lireCodeActivation(code);
  if (lu.boutiqueId !== boutiqueId) throw new ErreurActivation("Ce code d'activation est destiné à une autre boutique.");
  if (dateActuelle && finDeJournee(lu.dateFin) <= dateActuelle) {
    throw new ErreurActivation(
      `Ce code (jusqu'au ${lu.dateFin.split("-").reverse().join("/")}) ne prolonge pas l'abonnement actuel.`,
    );
  }
  await definirParametre(boutiqueId, CLE_PARAMETRE_CODE_ACTIVATION, code.trim());
  return lu;
}
