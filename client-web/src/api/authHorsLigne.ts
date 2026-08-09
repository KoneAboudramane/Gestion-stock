import type { Session } from "./auth";

/**
 * Cache local des identifiants, port navigateur de
 * client-electron/electron/services/auth.ts (identifiants-locaux.json + scrypt) :
 * après une première connexion en ligne réussie, on garde un hash salé du mot
 * de passe (Web Crypto PBKDF2 — scrypt n'existe pas en SubtleCrypto) et la
 * session obtenue, dans localStorage, pour permettre les connexions
 * suivantes hors-ligne. Le serveur reste la référence dès qu'il est joignable.
 */

const CLE_IDENTIFIANTS = "gestion-stock:identifiants-locaux";
const ITERATIONS_PBKDF2 = 100_000;

interface IdentifiantLocal {
  sel: string; // hex
  hash: string; // hex
  session: Session;
}

function octetsVersHex(octets: Uint8Array): string {
  return Array.from(octets)
    .map((o) => o.toString(16).padStart(2, "0"))
    .join("");
}

function hexVersOctets(hex: string): Uint8Array {
  const paires = hex.match(/.{1,2}/g) ?? [];
  return Uint8Array.from(paires.map((o) => parseInt(o, 16)));
}

function genererSel(): string {
  return octetsVersHex(crypto.getRandomValues(new Uint8Array(16)));
}

async function hacherMotDePasse(motDePasse: string, selHex: string): Promise<string> {
  const cleBase = await crypto.subtle.importKey("raw", new TextEncoder().encode(motDePasse), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexVersOctets(selHex) as BufferSource, iterations: ITERATIONS_PBKDF2, hash: "SHA-256" },
    cleBase,
    512,
  );
  return octetsVersHex(new Uint8Array(bits));
}

function chargerIdentifiants(): Record<string, IdentifiantLocal> {
  try {
    const brut = localStorage.getItem(CLE_IDENTIFIANTS);
    return brut ? (JSON.parse(brut) as Record<string, IdentifiantLocal>) : {};
  } catch {
    return {};
  }
}

export async function enregistrerIdentifiantLocal(username: string, motDePasse: string, session: Session): Promise<void> {
  const identifiants = chargerIdentifiants();
  const sel = genererSel();
  identifiants[username] = { sel, hash: await hacherMotDePasse(motDePasse, sel), session };
  localStorage.setItem(CLE_IDENTIFIANTS, JSON.stringify(identifiants));
}

export type ResultatVerificationLocale =
  | { statut: "ok"; session: Session }
  | { statut: "absent" }
  | { statut: "motDePasseInvalide" };

/** Vérifie les identifiants saisis contre le cache local (utilisé quand le serveur est injoignable). */
export async function verifierIdentifiantLocal(username: string, motDePasse: string): Promise<ResultatVerificationLocale> {
  const entree = chargerIdentifiants()[username];
  if (!entree) return { statut: "absent" };
  const hashObtenu = await hacherMotDePasse(motDePasse, entree.sel);
  return hashObtenu === entree.hash ? { statut: "ok", session: entree.session } : { statut: "motDePasseInvalide" };
}

/** fetch() lève un TypeError générique (pas de statut HTTP) quand le réseau est indisponible. */
export function estErreurReseau(erreur: unknown): boolean {
  return erreur instanceof TypeError;
}
