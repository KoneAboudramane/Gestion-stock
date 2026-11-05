import { createPublicKey, randomUUID, verify } from "node:crypto";

import { executer, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";

/**
 * Codes d'activation de l'abonnement (docs/plan_reseau_local.md, lot 6) :
 * vérifiés SANS internet. Le code (généré par comptes/activation.py dans
 * l'espace admin) porte la boutique, la date de fin et la formule, signés en
 * Ed25519 par la clé privée du serveur ; l'appli n'a que la clé publique, elle
 * peut vérifier mais pas fabriquer.
 *
 * Le code accepté est gardé comme réglage de la boutique (parametres,
 * cle « code_activation ») : il passe aux caisses par le réseau de la boutique,
 * et une date du serveur plus ancienne ne l'efface pas — l'abonnement retient
 * la date la plus lointaine des deux (voir abonnement.ts::dateExpirationEffective).
 */

/** Clé publique des codes (comptes/management/commands/generer_cle_activation.py). */
export const CLE_PUBLIQUE_ACTIVATION = "vc7DwM1ugXrjp2wqKnXHtKmZdqx32lZWmHwS3Af3CBY=";
export const CLE_PARAMETRE_CODE_ACTIVATION = "code_activation";

const PREFIXE_SIGNATURE = Buffer.from("gestion-stock/activation/v1");
const VERSION = 1;
const ORIGINE_DATES = Date.UTC(2020, 0, 1);
const FORMULES = ["essentiel", "pro"] as const;
/** En-tête DER d'une clé publique Ed25519 brute (SubjectPublicKeyInfo). */
const ENTETE_SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

export class ErreurActivation extends Error {}

let clePubliqueTests: string | null = null;

/** Tests : vérifier avec une autre clé publique (base64) que celle de l'appli. */
export function definirClePubliqueActivationPourLesTests(cle: string | null): void {
  clePubliqueTests = cle;
}

function decoderBase32(texte: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let valeur = 0;
  const octets: number[] = [];
  for (const caractere of texte) {
    const index = alphabet.indexOf(caractere);
    if (index < 0) throw new ErreurActivation("Code d'activation invalide (caractère inconnu).");
    valeur = (valeur << 5) | index;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(octets);
}

function uuidDepuisOctets(octets: Buffer): string {
  const hex = octets.toString("hex");
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
  // Séparateurs retirés d'abord (collé avec des espaces, sans tirets…), puis le préfixe :
  // le contenu commence toujours par « A » (version 1), jamais par « GS ».
  const brut = code.toUpperCase().replace(/[\s-]/g, "").replace(/^GS/, "");
  if (!brut) throw new ErreurActivation("Collez le code d'activation reçu.");
  const octets = decoderBase32(brut);
  const contenu = octets.subarray(0, 24);
  const signature = octets.subarray(24);
  const clePublique = createPublicKey({
    key: Buffer.concat([ENTETE_SPKI_ED25519, Buffer.from(clePubliqueTests ?? CLE_PUBLIQUE_ACTIVATION, "base64")]),
    format: "der",
    type: "spki",
  });
  const valide =
    contenu.length === 24 &&
    signature.length === 64 &&
    contenu[0] === VERSION &&
    verify(null, Buffer.concat([PREFIXE_SIGNATURE, contenu]), clePublique, signature);
  if (!valide) throw new ErreurActivation("Code d'activation invalide : vérifiez qu'il a été copié en entier, sans modification.");
  const jours = contenu.readUInt16BE(17);
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
export function dateExpirationParCode(boutiqueId: string): string | null {
  const parametre = unResultat<{ valeur: string }>(
    "SELECT valeur FROM parametres WHERE boutique_id = ? AND cle = ? AND supprime = 0",
    [boutiqueId, CLE_PARAMETRE_CODE_ACTIVATION],
  );
  if (!parametre?.valeur) return null;
  try {
    const lu = lireCodeActivation(parametre.valeur);
    return lu.boutiqueId === boutiqueId ? finDeJournee(lu.dateFin) : null;
  } catch {
    return null;
  }
}

/**
 * Saisie du code sur le poste (en principe le poste principal) : vérifié sans
 * internet, refusé s'il est pour une autre boutique ou s'il ne prolonge rien,
 * puis gardé comme réglage de la boutique (transmis aux caisses).
 */
export function appliquerCodeActivation(code: string, boutiqueId: string, dateActuelle: string | null): CodeActivationLu {
  const lu = lireCodeActivation(code);
  if (lu.boutiqueId !== boutiqueId) throw new ErreurActivation("Ce code d'activation est destiné à une autre boutique.");
  if (dateActuelle && finDeJournee(lu.dateFin) <= dateActuelle) {
    throw new ErreurActivation(
      `Ce code (jusqu'au ${lu.dateFin.split("-").reverse().join("/")}) ne prolonge pas l'abonnement actuel.`,
    );
  }
  const maintenant = new Date().toISOString();
  const existant = unResultat<{ id: string }>("SELECT id FROM parametres WHERE boutique_id = ? AND cle = ?", [
    boutiqueId,
    CLE_PARAMETRE_CODE_ACTIVATION,
  ]);
  if (existant) {
    executer("UPDATE parametres SET valeur = ?, supprime = 0, synchronise = 0, date_modification = ? WHERE id = ?", [
      code.trim(),
      maintenant,
      existant.id,
    ]);
  } else {
    executer(
      `INSERT INTO parametres (id, boutique_id, cle, valeur, date_creation, date_modification, synchronise, supprime)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
      [randomUUID(), boutiqueId, CLE_PARAMETRE_CODE_ACTIVATION, code.trim(), maintenant, maintenant],
    );
  }
  sauvegarder();
  return lu;
}
