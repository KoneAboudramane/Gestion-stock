import { scryptAsync } from "@noble/hashes/scrypt";

import type { Session } from "./auth";

/**
 * Cache local des identifiants, port navigateur de
 * client-electron/electron/services/auth.ts (identifiants-locaux.json + scrypt) :
 * après une première connexion en ligne réussie, on garde un hash salé du mot
 * de passe (Web Crypto PBKDF2 — scrypt n'existe pas en SubtleCrypto) et la
 * session obtenue, dans localStorage, pour permettre les connexions
 * suivantes hors-ligne. Le serveur reste la référence dès qu'il est joignable.
 *
 * Réseau de la boutique (docs/plan_mobile_complet.md §4.4) : un compte reçu
 * d'un poste principal ordinateur est protégé en scrypt (`algo`) — vérifié ici
 * avec @noble/hashes, mêmes réglages que Node (N=16384, r=8, p=1, 64 octets,
 * sel = texte hexadécimal tel quel).
 */

const CLE_IDENTIFIANTS = "gestion-stock:identifiants-locaux";
const ITERATIONS_PBKDF2 = 100_000;

export type AlgoMotDePasse = "scrypt" | "pbkdf2";

interface IdentifiantLocal {
  sel: string; // hex
  hash: string; // hex
  /** Absent : pbkdf2 (protégé sur cet appareil). */
  algo?: AlgoMotDePasse;
  session: Session;
  /** Compte supprimé par le patron (réseau de la boutique) : refusé ici. */
  desactive?: boolean;
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

async function hacherMotDePasse(motDePasse: string, selHex: string, algo: AlgoMotDePasse = "pbkdf2"): Promise<string> {
  if (algo === "scrypt") {
    const encodeur = new TextEncoder();
    const octets = await scryptAsync(encodeur.encode(motDePasse), encodeur.encode(selHex), { N: 16384, r: 8, p: 1, dkLen: 64 });
    return octetsVersHex(octets);
  }
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

/** Nouveau mot de passe dans le cache de cet appareil (connexion sans internet), si le compte y est connu. */
export async function reinitialiserIdentifiantLocal(username: string, motDePasse: string, doitChanger: boolean): Promise<boolean> {
  const identifiants = chargerIdentifiants();
  const actuel = identifiants[username];
  if (!actuel) return false;
  const sel = genererSel();
  identifiants[username] = {
    sel,
    hash: await hacherMotDePasse(motDePasse, sel),
    session: { ...actuel.session, doitChangerMotDePasse: doitChanger || undefined },
  };
  localStorage.setItem(CLE_IDENTIFIANTS, JSON.stringify(identifiants));
  return true;
}

/** Comptes connus de cet appareil (Espace Admin sans internet). */
export function listerIdentifiantsLocaux(): { username: string; session: Session }[] {
  return Object.entries(chargerIdentifiants()).map(([username, entree]) => ({ username, session: entree.session }));
}

export type ResultatVerificationLocale =
  | { statut: "ok"; session: Session }
  | { statut: "absent" }
  | { statut: "motDePasseInvalide" };

/** Vérifie les identifiants saisis contre le cache local (utilisé quand le serveur est injoignable). */
export async function verifierIdentifiantLocal(username: string, motDePasse: string): Promise<ResultatVerificationLocale> {
  const entree = chargerIdentifiants()[username];
  if (!entree || entree.desactive) return { statut: "absent" };
  const hashObtenu = await hacherMotDePasse(motDePasse, entree.sel, entree.algo);
  return hashObtenu === entree.hash ? { statut: "ok", session: entree.session } : { statut: "motDePasseInvalide" };
}

// --- Réseau de la boutique : comptes transmis par le poste principal ---

/** Même forme que CompteDiffuse du bureau (electron/services/auth.ts) : jamais de jeton de session. */
export interface CompteDiffuse {
  username: string;
  sel: string;
  hash: string;
  /** Absent : scrypt (compte venu d'un ordinateur). */
  algo?: AlgoMotDePasse;
  session: Session;
  desactive?: boolean;
}

/** Comptes de cette boutique connus de cet appareil, sans jetons (poste principal → caisses). */
export function exporterComptesLocaux(boutiqueId: string): CompteDiffuse[] {
  return Object.entries(chargerIdentifiants())
    .filter(([, entree]) => entree.session?.boutiqueId === boutiqueId)
    .map(([username, entree]) => ({
      username,
      sel: entree.sel,
      hash: entree.hash,
      algo: entree.algo ?? "pbkdf2",
      session: { ...entree.session, accessToken: "", refreshToken: "" },
      desactive: entree.desactive,
    }));
}

/**
 * Caisse : ajoute ou met à jour les comptes reçus du poste principal, pour
 * qu'un vendeur puisse se connecter ici sans internet. Un compte déjà connu
 * avec un jeton de session (connexion en ligne sur cet appareil) garde son jeton.
 */
export function importerComptesDiffuses(comptes: CompteDiffuse[]): void {
  if (comptes.length === 0) return;
  const identifiants = chargerIdentifiants();
  for (const compte of comptes) {
    if (compte.desactive) {
      delete identifiants[compte.username];
      continue;
    }
    const actuel = identifiants[compte.username];
    identifiants[compte.username] = {
      sel: compte.sel,
      hash: compte.hash,
      algo: compte.algo ?? "scrypt",
      session: {
        ...compte.session,
        accessToken: actuel?.session.accessToken ?? "",
        refreshToken: actuel?.session.refreshToken ?? "",
      },
    };
  }
  localStorage.setItem(CLE_IDENTIFIANTS, JSON.stringify(identifiants));
}

/**
 * Compte créé ou modifié par le patron depuis l'appli : mémorisé tout de suite
 * sur cet appareil (mot de passe protégé), pour que le vendeur puisse se
 * connecter sans internet — et, sur le poste principal, sur toutes les caisses
 * branchées. Sans mot de passe (rôle, dépôt…), on ne met à jour que les droits
 * d'un compte déjà connu. Port de memoriserCompteVendeur du bureau.
 */
export async function memoriserCompteVendeur(
  username: string,
  motDePasse: string | null,
  session: Omit<Session, "accessToken" | "refreshToken">,
): Promise<void> {
  const identifiants = chargerIdentifiants();
  const actuel = identifiants[username];
  const complete: Session = {
    ...session,
    accessToken: actuel?.session.accessToken ?? "",
    refreshToken: actuel?.session.refreshToken ?? "",
  };
  if (motDePasse) {
    const sel = genererSel();
    identifiants[username] = { sel, hash: await hacherMotDePasse(motDePasse, sel), session: complete };
  } else if (actuel) {
    identifiants[username] = { ...actuel, session: complete, desactive: false };
  } else {
    return;
  }
  localStorage.setItem(CLE_IDENTIFIANTS, JSON.stringify(identifiants));
}

/** Compte supprimé ou désactivé : refusé sur cet appareil, et retiré des caisses à leur prochain échange. */
export function desactiverCompteLocal(username: string): void {
  const identifiants = chargerIdentifiants();
  if (!identifiants[username]) return;
  identifiants[username] = { ...identifiants[username], desactive: true };
  localStorage.setItem(CLE_IDENTIFIANTS, JSON.stringify(identifiants));
}

/** fetch() lève un TypeError générique (pas de statut HTTP) quand le réseau est indisponible. */
export function estErreurReseau(erreur: unknown): boolean {
  return erreur instanceof TypeError;
}

// --- Identifiants admin (Espace Admin, voir AccesCreationBoutique.tsx) ---
// Cache séparé de celui des comptes normaux : un compte admin (is_staff) n'a
// pas de session boutique à mémoriser, juste de quoi reconnaître localement
// "ce sont bien les identifiants déjà validés en ligne" — nécessaire pour que
// "Gérer abonnement" fonctionne hors-ligne (voir services/abonnementAdmin.ts).

const CLE_IDENTIFIANTS_ADMIN = "gestion-stock:identifiants-admin-locaux";

export interface IdentifiantAdminLocal {
  sel: string;
  hash: string;
  // Obtenus best-effort à la dernière vérification en ligne réussie, jamais
  // indispensables (l'accès hors-ligne marche sans) — servent uniquement à
  // détecter une révocation d'accès dès qu'une connexion revient, voir
  // verifierRevocationAdmin dans api/auth.ts.
  jetons?: { accessToken: string; refreshToken: string };
}

export function chargerIdentifiantsAdmin(): Record<string, IdentifiantAdminLocal> {
  try {
    const brut = localStorage.getItem(CLE_IDENTIFIANTS_ADMIN);
    return brut ? (JSON.parse(brut) as Record<string, IdentifiantAdminLocal>) : {};
  } catch {
    return {};
  }
}

export async function enregistrerIdentifiantAdminLocal(username: string, motDePasse: string): Promise<void> {
  const identifiants = chargerIdentifiantsAdmin();
  const sel = genererSel();
  identifiants[username] = { sel, hash: await hacherMotDePasse(motDePasse, sel) };
  localStorage.setItem(CLE_IDENTIFIANTS_ADMIN, JSON.stringify(identifiants));
}

export async function verifierIdentifiantAdminLocal(username: string, motDePasse: string): Promise<boolean> {
  const entree = chargerIdentifiantsAdmin()[username];
  if (!entree) return false;
  const hashObtenu = await hacherMotDePasse(motDePasse, entree.sel);
  return hashObtenu === entree.hash;
}

export function enregistrerJetonsAdmin(username: string, jetons: { accessToken: string; refreshToken: string }): void {
  const identifiants = chargerIdentifiantsAdmin();
  const entree = identifiants[username];
  if (!entree) return; // pas de mot de passe en cache pour ce username : rien à compléter
  entree.jetons = jetons;
  localStorage.setItem(CLE_IDENTIFIANTS_ADMIN, JSON.stringify(identifiants));
}

export function supprimerIdentifiantAdminLocal(username: string): void {
  const identifiants = chargerIdentifiantsAdmin();
  if (!(username in identifiants)) return;
  delete identifiants[username];
  localStorage.setItem(CLE_IDENTIFIANTS_ADMIN, JSON.stringify(identifiants));
}
