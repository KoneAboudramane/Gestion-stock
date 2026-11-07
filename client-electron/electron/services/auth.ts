import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { URL_BASE_API } from "../config";
import { ErreurAccesBloque, fetchAvecRepliNavigateur } from "./httpClient";
import { memoriserAbonnementBoutique, obtenirEtatAbonnement } from "./abonnement";
// Imports circulaires (abonnementAdmin et reseauCaisse importent auth) : sans risque,
// ces fonctions ne sont appelées qu'à l'exécution, jamais au chargement du module.
import { obtenirBoutiqueLocale } from "./abonnementAdmin";
import { etatReseauComplet } from "./reseauCaisse";
import { appelerAvecDelai } from "./sync";

/**
 * Connexion/inscription : appelle le VRAI backend Django (déjà construit et
 * testé à l'Étape 1), rien de simulé. Le JWT renvoyé est déjà enrichi de
 * boutique_id/boutique_nom/role/permissions (comptes/serializers.py::ConnexionSerializer),
 * décodé ici et persisté localement (session.json) pour tout le reste de l'appli.
 *
 * La boutique n'a pas toujours internet : seule la première connexion d'un
 * utilisateur sur cet appareil exige le serveur. On garde alors un hash
 * (scrypt, salé) du mot de passe et la session obtenue dans identifiants-locaux.json,
 * ce qui permet aux connexions suivantes de fonctionner hors-ligne. Le serveur
 * reste la référence dès qu'il est joignable (mot de passe/permissions à jour).
 */

export interface Session {
  accessToken: string;
  refreshToken: string;
  utilisateurId: string;
  username: string;
  boutiqueId: string;
  boutiqueNom: string;
  role: string;
  permissions: Record<string, boolean>;
  depotId: string | null;
  depotNom: string | null;
  // Synchro serveur activée par l'administrateur pour cette boutique (voir
  // comptes.Boutique.synchro_autorisee) — certains commerçants refusent que
  // leurs données quittent leur poste. false par défaut, ne se met à jour
  // qu'à la connexion ou via rafraichirPermissions (pas de rafraîchissement
  // automatique en tâche de fond, voir BarreSynchro "Vérifier l'activation").
  synchroAutorisee: boolean;
  // Abréviation de l'utilisateur dans les numéros de ses documents
  // (VTE-20261002-AKO-0001, voir numerotation.ts). Absente des sessions
  // enregistrées avant son introduction.
  codeVendeur?: string;
  /** Mot de passe provisoire (Espace Admin) : l'utilisateur doit choisir le sien avant d'entrer. */
  doitChangerMotDePasse?: boolean;
}

/**
 * Méthode de protection du mot de passe : « scrypt » (bureau, valeur par défaut
 * quand absente) ou « pbkdf2 » (compte reçu d'un poste principal téléphone /
 * tablette — docs/plan_mobile_complet.md §4.4).
 */
type AlgoMotDePasse = "scrypt" | "pbkdf2";

interface IdentifiantLocal {
  sel: string;
  hash: string;
  algo?: AlgoMotDePasse;
  session: Session;
  /** Compte supprimé par le patron : refusé ici, et retiré des caisses du réseau de la boutique. */
  desactive?: boolean;
}

function cheminSession(): string {
  return path.join(app.getPath("userData"), "session.json");
}

function cheminIdentifiantsLocaux(): string {
  return path.join(app.getPath("userData"), "identifiants-locaux.json");
}

function cheminIdentifiantsAdminLocaux(): string {
  return path.join(app.getPath("userData"), "identifiants-admin-locaux.json");
}

function chargerIdentifiantsLocaux(): Record<string, IdentifiantLocal> {
  const chemin = cheminIdentifiantsLocaux();
  if (!fs.existsSync(chemin)) return {};
  try {
    return JSON.parse(fs.readFileSync(chemin, "utf-8"));
  } catch {
    return {};
  }
}

function hacherMotDePasse(motDePasse: string, sel: string, algo: AlgoMotDePasse = "scrypt"): string {
  if (algo === "pbkdf2") {
    // Mêmes réglages que client-web/src/api/authHorsLigne.ts (sel en hexadécimal décodé).
    return crypto.pbkdf2Sync(motDePasse, Buffer.from(sel, "hex"), 100_000, 64, "sha256").toString("hex");
  }
  return crypto.scryptSync(motDePasse, sel, 64).toString("hex");
}

function enregistrerIdentifiantLocal(username: string, motDePasse: string, session: Session): void {
  const identifiants = chargerIdentifiantsLocaux();
  const sel = crypto.randomBytes(16).toString("hex");
  identifiants[username] = { sel, hash: hacherMotDePasse(motDePasse, sel), session };
  fs.writeFileSync(cheminIdentifiantsLocaux(), JSON.stringify(identifiants, null, 2));
}

/** Compte transmis du poste principal aux caisses (réseau de la boutique) : jamais de jeton de session. */
export interface CompteDiffuse {
  username: string;
  sel: string;
  hash: string;
  /** Absent : scrypt (bureau). */
  algo?: AlgoMotDePasse;
  session: Session;
  desactive?: boolean;
}

/** Comptes de cette boutique connus de ce poste, sans jetons, pour les caisses branchées. */
export function exporterComptesLocaux(boutiqueId: string): CompteDiffuse[] {
  return Object.entries(chargerIdentifiantsLocaux())
    .filter(([, entree]) => entree.session?.boutiqueId === boutiqueId)
    .map(([username, entree]) => ({
      username,
      sel: entree.sel,
      hash: entree.hash,
      algo: entree.algo ?? "scrypt",
      session: { ...entree.session, accessToken: "", refreshToken: "" },
      desactive: entree.desactive,
    }));
}

/**
 * Compte créé ou modifié par le patron depuis l'appli : mémorisé tout de suite
 * dans le cache de ce poste (mot de passe protégé), pour que le vendeur puisse
 * se connecter sans internet — et, sur le poste principal, sur toutes les
 * caisses branchées — sans avoir à se connecter une première fois en ligne.
 * Sans mot de passe (modification du rôle, du dépôt…), on ne met à jour que
 * les droits d'un compte déjà connu.
 */
export function memoriserCompteVendeur(
  username: string,
  motDePasse: string | null,
  session: Omit<Session, "accessToken" | "refreshToken">,
): void {
  const identifiants = chargerIdentifiantsLocaux();
  const actuel = identifiants[username];
  const complete: Session = {
    ...session,
    accessToken: actuel?.session.accessToken ?? "",
    refreshToken: actuel?.session.refreshToken ?? "",
  };
  if (motDePasse) {
    const sel = crypto.randomBytes(16).toString("hex");
    identifiants[username] = { sel, hash: hacherMotDePasse(motDePasse, sel), session: complete };
  } else if (actuel) {
    identifiants[username] = { ...actuel, session: complete, desactive: false };
  } else {
    return;
  }
  fs.writeFileSync(cheminIdentifiantsLocaux(), JSON.stringify(identifiants, null, 2));
}

/** Compte supprimé ou désactivé : refusé sur ce poste, et retiré des caisses à leur prochain échange. */
export function desactiverCompteLocal(username: string): void {
  const identifiants = chargerIdentifiantsLocaux();
  if (!identifiants[username]) return;
  identifiants[username] = { ...identifiants[username], desactive: true };
  fs.writeFileSync(cheminIdentifiantsLocaux(), JSON.stringify(identifiants, null, 2));
}

/**
 * Caisse : ajoute ou met à jour les comptes reçus du poste principal, pour
 * qu'un vendeur puisse se connecter ici sans internet. Un compte déjà connu
 * avec un jeton de session (connexion en ligne sur cette caisse) garde son jeton.
 */
export function importerComptesDiffuses(comptes: CompteDiffuse[]): void {
  if (comptes.length === 0) return;
  const identifiants = chargerIdentifiantsLocaux();
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
  fs.writeFileSync(cheminIdentifiantsLocaux(), JSON.stringify(identifiants, null, 2));
}

/** Vérifie les identifiants saisis contre le cache local (utilisé quand le serveur est injoignable). */
function verifierIdentifiantLocal(
  username: string,
  motDePasse: string,
): { statut: "ok"; session: Session } | { statut: "absent" } | { statut: "motDePasseInvalide" } {
  const entree = chargerIdentifiantsLocaux()[username];
  if (!entree || entree.desactive) return { statut: "absent" };
  const hashAttendu = Buffer.from(entree.hash, "hex");
  const hashObtenu = Buffer.from(hacherMotDePasse(motDePasse, entree.sel, entree.algo), "hex");
  const correspond = hashAttendu.length === hashObtenu.length && crypto.timingSafeEqual(hashAttendu, hashObtenu);
  return correspond ? { statut: "ok", session: entree.session } : { statut: "motDePasseInvalide" };
}

/** Écrit session.json + identifiants-locaux.json — même effet qu'une connexion en ligne réussie
 * (voir connexion() plus bas), réutilisé pour ouvrir une session sur une boutique créée
 * localement (voir inscriptionLocale.ts) sans jamais contacter le serveur. */
export function ouvrirSessionLocale(username: string, motDePasse: string, session: Session): void {
  fs.writeFileSync(cheminSession(), JSON.stringify(session, null, 2));
  enregistrerIdentifiantLocal(username, motDePasse, session);
}

function cheminBoutiqueLocaleEnAttente(): string {
  return path.join(app.getPath("userData"), "boutique-locale-en-attente.json");
}

/**
 * Une boutique créée hors-ligne (voir inscriptionLocale.ts::creerBoutiqueLocale)
 * n'existe pas encore côté serveur tant qu'elle n'a pas été "activée en ligne"
 * (Réglages > Synchronisation) : tant que ce marqueur existe, la connexion de
 * son Patron doit passer directement par le cache local, sans même essayer le
 * serveur — un essai en ligne échouerait de toute façon (compte inconnu du
 * serveur), mais avec le même message générique qu'un mauvais mot de passe,
 * ce qui empêcherait à tort le repli local ci-dessous.
 */
function boutiqueLocaleEnAttenteConcerne(username: string): boolean {
  const chemin = cheminBoutiqueLocaleEnAttente();
  if (!fs.existsSync(chemin)) return false;
  try {
    const entree = JSON.parse(fs.readFileSync(chemin, "utf-8"));
    return entree?.patronUsername === username;
  } catch {
    return false;
  }
}

interface IdentifiantAdminLocal {
  sel: string;
  hash: string;
  // Obtenus best-effort à la dernière vérification en ligne réussie, jamais
  // indispensables (l'accès hors-ligne marche sans) — servent uniquement à
  // détecter une révocation d'accès dès qu'une connexion revient, voir
  // verifierRevocationAdmin ci-dessous.
  jetons?: { accessToken: string; refreshToken: string };
}

/**
 * Cache séparé de celui des comptes normaux (identifiants-locaux.json) :
 * un compte admin (is_staff) n'a pas de session boutique à mémoriser, juste
 * de quoi reconnaître localement "ce sont bien les identifiants déjà validés
 * en ligne", pour que le verrou de l'Espace Admin (voir Connexion.tsx) reste
 * franchissable hors-ligne — nécessaire pour "Gérer abonnement" (voir
 * abonnementAdmin.ts), pensé justement pour le cas sans internet.
 */
function chargerIdentifiantsAdmin(): Record<string, IdentifiantAdminLocal> {
  const chemin = cheminIdentifiantsAdminLocaux();
  if (!fs.existsSync(chemin)) return {};
  try {
    return JSON.parse(fs.readFileSync(chemin, "utf-8"));
  } catch {
    return {};
  }
}

function enregistrerIdentifiantAdminLocal(username: string, motDePasse: string): void {
  const identifiants = chargerIdentifiantsAdmin();
  const sel = crypto.randomBytes(16).toString("hex");
  identifiants[username] = { sel, hash: hacherMotDePasse(motDePasse, sel) };
  fs.writeFileSync(cheminIdentifiantsAdminLocaux(), JSON.stringify(identifiants, null, 2));
}

function verifierIdentifiantAdminLocal(username: string, motDePasse: string): boolean {
  const entree = chargerIdentifiantsAdmin()[username];
  if (!entree) return false;
  const hashAttendu = Buffer.from(entree.hash, "hex");
  const hashObtenu = Buffer.from(hacherMotDePasse(motDePasse, entree.sel), "hex");
  return hashAttendu.length === hashObtenu.length && crypto.timingSafeEqual(hashAttendu, hashObtenu);
}

function enregistrerJetonsAdmin(username: string, jetons: { accessToken: string; refreshToken: string }): void {
  const identifiants = chargerIdentifiantsAdmin();
  const entree = identifiants[username];
  if (!entree) return; // pas de mot de passe en cache pour ce username : rien à compléter
  entree.jetons = jetons;
  fs.writeFileSync(cheminIdentifiantsAdminLocaux(), JSON.stringify(identifiants, null, 2));
}

function supprimerIdentifiantAdminLocal(username: string): void {
  const identifiants = chargerIdentifiantsAdmin();
  if (!(username in identifiants)) return;
  delete identifiants[username];
  fs.writeFileSync(cheminIdentifiantsAdminLocaux(), JSON.stringify(identifiants, null, 2));
}

export function estErreurReseau(erreur: unknown): boolean {
  // Serveur bloqué par le WAF (voir httpClient.ts) traité comme une coupure
  // réseau : bascule sur la connexion locale hors-ligne, comme pour une vraie
  // panne, plutôt que de bloquer l'utilisateur sur une erreur sans recours.
  if (erreur instanceof ErreurAccesBloque) return true;
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message);
}

function decoderPayloadJWT(token: string): Record<string, any> {
  const partiePayload = token.split(".")[1];
  const base64 = partiePayload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const json = Buffer.from(base64 + padding, "base64").toString("utf-8");
  return JSON.parse(json);
}

export async function appelerApi(chemin: string, corps: Record<string, unknown>): Promise<any> {
  const reponse = await fetchAvecRepliNavigateur(`${URL_BASE_API}${chemin}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const message =
      donnees?.detail ??
      Object.values(donnees ?? {})
        .flat()
        .join(" ") ??
      "Erreur inconnue.";
    throw new Error(String(message));
  }
  return donnees;
}

function connexionLocale(username: string, password: string): Session {
  const resultatLocal = verifierIdentifiantLocal(username, password);
  if (resultatLocal.statut === "ok") {
    fs.writeFileSync(cheminSession(), JSON.stringify(resultatLocal.session, null, 2));
    return resultatLocal.session;
  }
  if (resultatLocal.statut === "motDePasseInvalide") {
    throw new Error("Mot de passe incorrect.");
  }
  throw new Error(
    "Impossible de joindre le serveur, et aucune connexion hors-ligne n'est enregistrée pour cet utilisateur sur cet appareil. Connectez-vous une première fois avec internet.",
  );
}

/** Mauvais identifiants (serveur ou cache du poste) — pas une coupure d'internet. */
function estErreurIdentifiants(erreur: unknown): boolean {
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  return /incorrect|no active account|aucun compte actif|identifiants fournis/i.test(message);
}

/**
 * Connexion d'un compte de la boutique, avec protection anti-essais (5 échecs,
 * puis attente qui double) et messages clairs. Une coupure d'internet ne compte
 * pas comme un échec.
 */
export async function connexion(username: string, password: string): Promise<Session> {
  const attente = attenteRestante("connexion");
  if (attente > 0) throw new Error(`Trop d'essais : réessayez dans ${attente} s.`);
  try {
    const session = await connexionSansProtection(username, password);
    ecrireEssais("connexion", { echecs: 0, bloqueJusqua: 0 });
    return session;
  } catch (erreur) {
    if (!estErreurIdentifiants(erreur)) throw erreur;
    const horsLigne = erreur instanceof Error && /^Mot de passe incorrect\.$/.test(erreur.message);
    throw new Error(
      `${horsLigne ? "Mot de passe incorrect (vérifié sans internet)." : "Identifiant ou mot de passe incorrect."}` +
        suiteEchec("connexion", noterEchec("connexion")),
    );
  }
}

async function connexionSansProtection(username: string, password: string): Promise<Session> {
  // Boutique créée hors-ligne et pas encore "activée en ligne" : le serveur ne
  // connaît pas encore ce compte, inutile (et trompeur) d'essayer en ligne.
  if (boutiqueLocaleEnAttenteConcerne(username)) return connexionLocale(username, password);

  let donnees: any;
  try {
    donnees = await appelerApi("/auth/connexion/", { username, password });
  } catch (erreur) {
    if (!estErreurReseau(erreur)) throw erreur;
    // Serveur injoignable : on retombe sur les identifiants de la dernière connexion réussie.
    return connexionLocale(username, password);
  }

  const payload = decoderPayloadJWT(donnees.access);
  const session: Session = {
    accessToken: donnees.access,
    refreshToken: donnees.refresh,
    utilisateurId: String(payload.user_id),
    username,
    boutiqueId: payload.boutique_id,
    boutiqueNom: payload.boutique_nom,
    role: payload.role,
    permissions: payload.permissions ?? {},
    depotId: payload.depot_id ?? null,
    depotNom: payload.depot_nom ?? null,
    synchroAutorisee: payload.synchro_autorisee ?? false,
    codeVendeur: payload.code_vendeur || undefined,
    doitChangerMotDePasse: payload.doit_changer_mot_de_passe || undefined,
  };
  ouvrirSessionLocale(username, password, session);
  return session;
}

/**
 * N'ouvre plus de session directement : l'inscription crée désormais une
 * demande en attente de validation par l'administrateur (comptes/services.py::
 * demander_inscription) — il n'y a rien à connecter tant que ce n'est pas
 * approuvé.
 */
export async function inscription(params: {
  boutiqueNom: string;
  username: string;
  password: string;
  email: string;
}): Promise<void> {
  await appelerApi("/auth/inscription/", {
    boutique_nom: params.boutiqueNom,
    username: params.username,
    password: params.password,
    email: params.email,
  });
}

/**
 * Verrou devant l'Espace Admin (voir Connexion.tsx) : vérifie que les
 * identifiants saisis appartiennent à un compte administrateur (is_staff côté
 * Django), sans ouvrir de session — n'affecte jamais la session déjà active
 * sur cet appareil. En ligne, revérifie toujours contre le serveur et
 * rafraîchit le cache local au passage. Hors-ligne (serveur injoignable ou
 * bloqué par le WAF), retombe sur ce cache — indispensable pour "Gérer
 * abonnement" (voir abonnementAdmin.ts), pensé pour fonctionner sans internet.
 */
export async function verifierAccesAdmin(username: string, password: string): Promise<boolean> {
  try {
    const donnees = await appelerApi("/auth/verifier-acces-admin/", { username, password });
    const autorise = Boolean(donnees?.autorise);
    if (autorise) {
      enregistrerIdentifiantAdminLocal(username, password);
      // Best-effort : sert uniquement à détecter une révocation plus tard
      // (voir verifierRevocationAdmin) — un échec ici ne doit jamais faire
      // échouer une vérification d'accès qui vient de réussir.
      try {
        const jetons = await appelerApi("/auth/connexion/", { username, password });
        enregistrerJetonsAdmin(username, { accessToken: jetons.access, refreshToken: jetons.refresh });
      } catch {
        // Ignoré volontairement.
      }
    }
    return autorise;
  } catch (erreur) {
    if (!estErreurReseau(erreur)) throw erreur;
    return verifierIdentifiantAdminLocal(username, password);
  }
}

// --- Connexion à l'Espace Admin : état, anti-essais, messages clairs ---

/** Au-delà de 5 échecs : attente de 30 s, puis doublée à chaque nouvel échec (15 min au plus). */
export const ECHECS_ADMIN_AVANT_ATTENTE = 5;
const ATTENTE_ADMIN_MIN_S = 30;
const ATTENTE_ADMIN_MAX_S = 15 * 60;

interface EssaisConnexion {
  echecs: number;
  /** Date (ms) avant laquelle aucun essai n'est accepté. */
  bloqueJusqua: number;
}

/** Échecs de connexion notés sur ce poste : « espace-admin » ou « connexion » (comptes de la boutique). */
type CompteurEssais = "espace-admin" | "connexion";

function cheminEssais(compteur: CompteurEssais): string {
  return path.join(app.getPath("userData"), `essais-${compteur}.json`);
}

function lireEssais(compteur: CompteurEssais): EssaisConnexion {
  try {
    return { echecs: 0, bloqueJusqua: 0, ...JSON.parse(fs.readFileSync(cheminEssais(compteur), "utf-8")) };
  } catch {
    return { echecs: 0, bloqueJusqua: 0 };
  }
}

function ecrireEssais(compteur: CompteurEssais, essais: EssaisConnexion): void {
  fs.writeFileSync(cheminEssais(compteur), JSON.stringify(essais));
}

function attenteRestante(compteur: CompteurEssais, maintenant = Date.now()): number {
  return Math.max(0, Math.ceil((lireEssais(compteur).bloqueJusqua - maintenant) / 1000));
}

function noterEchec(compteur: CompteurEssais, maintenant = Date.now()): number {
  const echecs = lireEssais(compteur).echecs + 1;
  const attente =
    echecs >= ECHECS_ADMIN_AVANT_ATTENTE
      ? Math.min(ATTENTE_ADMIN_MAX_S, ATTENTE_ADMIN_MIN_S * 2 ** (echecs - ECHECS_ADMIN_AVANT_ATTENTE))
      : 0;
  ecrireEssais(compteur, { echecs, bloqueJusqua: attente ? maintenant + attente * 1000 : 0 });
  return attente;
}

/** Fin de message après un échec : attente imposée, ou essais restants avant elle. */
function suiteEchec(compteur: CompteurEssais, attente: number): string {
  if (attente) return ` Trop d'essais : réessayez dans ${attente} s.`;
  const restants = ECHECS_ADMIN_AVANT_ATTENTE - lireEssais(compteur).echecs;
  return restants <= 2 ? ` Encore ${restants} essai${restants > 1 ? "s" : ""} avant une attente.` : "";
}

export interface EtatConnexionAdmin {
  serveurJoint: boolean;
  /** Admins déjà vérifiés en ligne sur ce poste (seuls admis sans internet). */
  adminsDuPoste: string[];
  echecs: number;
  attenteSecondes: number;
}

/** Écran de connexion de l'Espace Admin : serveur joignable ? qui peut entrer sans internet ? attente en cours ? */
export async function etatConnexionAdmin(): Promise<EtatConnexionAdmin> {
  let serveurJoint = false;
  try {
    // N'importe quelle réponse HTTP (même 405) prouve que le serveur répond.
    await appelerAvecDelai(`${URL_BASE_API}/auth/verifier-acces-admin/`, { method: "GET" });
    serveurJoint = true;
  } catch {
    serveurJoint = false;
  }
  return {
    serveurJoint,
    adminsDuPoste: Object.keys(chargerIdentifiantsAdmin()),
    echecs: lireEssais("espace-admin").echecs,
    attenteSecondes: attenteRestante("espace-admin"),
  };
}

/**
 * Connexion à l'Espace Admin avec protection anti-essais (appliquée ici, pas
 * seulement à l'écran) et messages clairs — sans jamais dire si c'est le mot
 * de passe ou le compte qui ne va pas (le serveur ne le dit pas non plus).
 */
/**
 * Espace Admin sur un ordinateur qui n'a jamais vu internet : laissez-passer +
 * identifiant + mot de passe (docs/plan_laissez_passer_admin.md). Accepté,
 * l'accès est mémorisé comme après une vérification en ligne. Même protection
 * contre les essais répétés que la connexion admin.
 */
export async function connexionAdminParLaissezPasser(code: string, username: string, password: string): Promise<void> {
  const attente = attenteRestante("espace-admin");
  if (attente > 0) throw new Error(`Trop d'essais : réessayez dans ${attente} s.`);
  const { noterUtilisation, verifierLaissezPasser } = await import("./laissezPasser");
  let lu;
  try {
    lu = verifierLaissezPasser(code, username, password);
  } catch (erreur) {
    const nouvelleAttente = noterEchec("espace-admin");
    throw new Error((erreur instanceof Error ? erreur.message : "Laissez-passer refusé.") + suiteEchec("espace-admin", nouvelleAttente));
  }
  ecrireEssais("espace-admin", { echecs: 0, bloqueJusqua: 0 });
  enregistrerIdentifiantAdminLocal(lu.identifiant, password);
  noterUtilisation(lu);
}

/** Retour d'internet : laissez-passer signalés ; ceux qui ne valent plus perdent leur accès mémorisé. */
export async function signalerLaissezPasser(): Promise<void> {
  const { signalerLaissezPasser: signaler } = await import("./laissezPasser");
  for (const identifiant of await signaler()) supprimerIdentifiantAdminLocal(identifiant);
}

export async function connexionAdmin(username: string, password: string): Promise<{ source: "serveur" | "poste" }> {
  const attente = attenteRestante("espace-admin");
  if (attente > 0) throw new Error(`Trop d'essais : réessayez dans ${attente} s.`);
  let source: "serveur" | "poste" = "serveur";
  let autorise: boolean;
  try {
    const donnees = await appelerApi("/auth/verifier-acces-admin/", { username, password });
    autorise = Boolean(donnees?.autorise);
  } catch (erreur) {
    if (!estErreurReseau(erreur)) throw erreur;
    source = "poste";
    if (!chargerIdentifiantsAdmin()[username]) {
      throw new Error(
        "Pas d'internet, et ce compte n'a jamais été vérifié en ligne sur cet ordinateur : connectez-vous une première fois avec internet.",
      );
    }
    autorise = verifierIdentifiantAdminLocal(username, password);
  }
  if (!autorise) {
    const nouvelleAttente = noterEchec("espace-admin");
    throw new Error(
      `Accès refusé : identifiant ou mot de passe incorrect, ou compte non administrateur${source === "poste" ? " (vérifié sans internet)" : ""}.` +
        suiteEchec("espace-admin", nouvelleAttente),
    );
  }
  ecrireEssais("espace-admin", { echecs: 0, bloqueJusqua: 0 });
  if (source === "serveur") {
    enregistrerIdentifiantAdminLocal(username, password);
    try {
      const jetons = await appelerApi("/auth/connexion/", { username, password });
      enregistrerJetonsAdmin(username, { accessToken: jetons.access, refreshToken: jetons.refresh });
    } catch {
      // Ignoré : ne sert qu'à détecter une révocation plus tard.
    }
  }
  return { source };
}

/**
 * Détecte une révocation d'accès admin (compte désactivé/retiré du staff)
 * pendant que ce poste était hors-ligne : dès qu'il y a une connexion (voir
 * AccesCreationBoutique.tsx, appelée à l'ouverture d'Espace Admin), rafraîchit
 * silencieusement le jeton mis de côté à la dernière vérification en ligne
 * réussie et confirme que le compte est toujours actif — si ce n'est plus le
 * cas, le cache local est effacé : l'accès hors-ligne ne sera plus possible
 * tant qu'une nouvelle vérification en ligne n'aura pas eu lieu. Ne détecte
 * pas un simple changement de mot de passe (impossible sans le mot de passe
 * en clair, jamais conservé) — seulement une révocation de compte.
 * Best-effort, silencieux : ne doit jamais perturber l'écran qui l'appelle.
 */
export async function verifierRevocationAdmin(): Promise<void> {
  const identifiants = chargerIdentifiantsAdmin();
  for (const [username, entree] of Object.entries(identifiants)) {
    if (!entree.jetons) continue;
    try {
      const rafraichi = await appelerApi("/auth/rafraichir/", { refresh: entree.jetons.refreshToken });
      const reponse = await fetchAvecRepliNavigateur(`${URL_BASE_API}/auth/verifier-session-admin/`, {
        headers: { Authorization: `Bearer ${rafraichi.access}` },
      });
      const donnees = await reponse.json().catch(() => ({}));
      if (!reponse.ok || !donnees?.autorise) {
        supprimerIdentifiantAdminLocal(username);
        continue;
      }
      enregistrerJetonsAdmin(username, { accessToken: rafraichi.access, refreshToken: entree.jetons.refreshToken });
    } catch (erreur) {
      if (estErreurReseau(erreur)) return; // pas de réseau : on retentera à la prochaine occasion
      supprimerIdentifiantAdminLocal(username);
    }
  }
}

/**
 * Carte "Réinitialiser mot de passe" de l'Espace Admin : réinitialise
 * directement le mot de passe d'un Patron, sans code ni email — l'identité de
 * l'exploitant est déjà prouvée par le verrou admin (identifiants réutilisés,
 * jamais redemandés). Action serveur uniquement (le compte Utilisateur n'est
 * pas répliqué en local, voir CLAUDE.md — AUTH_USER_MODEL en AutoField, pas
 * de UUID) : pas de repli hors-ligne possible ici.
 */
// --- Espace Admin → Réinitialiser mot de passe ---

function cheminReinitialisationsARefaire(): string {
  return path.join(app.getPath("userData"), "reinitialisations-a-refaire.json");
}

/** Comptes réinitialisés sur ce poste sans internet : à refaire en ligne (jamais le mot de passe gardé en clair). */
export function lireReinitialisationsARefaire(): string[] {
  try {
    return JSON.parse(fs.readFileSync(cheminReinitialisationsARefaire(), "utf-8"));
  } catch {
    return [];
  }
}

function ecrireReinitialisationsARefaire(liste: string[]): void {
  if (liste.length === 0) fs.rmSync(cheminReinitialisationsARefaire(), { force: true });
  else fs.writeFileSync(cheminReinitialisationsARefaire(), JSON.stringify(liste, null, 2));
}

/** Nouveau mot de passe dans le cache de ce poste (connexion sans internet), si le compte y est connu. */
function reinitialiserCompteLocal(username: string, motDePasse: string, doitChanger: boolean): boolean {
  const identifiants = chargerIdentifiantsLocaux();
  const actuel = identifiants[username];
  if (!actuel) return false;
  const sel = crypto.randomBytes(16).toString("hex");
  identifiants[username] = {
    ...actuel,
    sel,
    hash: hacherMotDePasse(motDePasse, sel),
    session: { ...actuel.session, doitChangerMotDePasse: doitChanger || undefined },
  };
  fs.writeFileSync(cheminIdentifiantsLocaux(), JSON.stringify(identifiants, null, 2));
  return true;
}

/**
 * Réinitialise le mot de passe d'un compte de boutique : sur le serveur (identifiants
 * admin revérifiés), et dans le cache de ce poste s'il y est connu. Sans internet :
 * sur ce poste seulement (le serveur garde l'ancien) — le compte est noté « à refaire
 * en ligne ».
 */
export async function reinitialiserMotDePasseAdmin(
  usernameAdmin: string,
  passwordAdmin: string,
  usernameCible: string,
  nouveauMotDePasse: string,
  doitChanger = false,
): Promise<{ statut: "enLigne" | "local" }> {
  try {
    await appelerApi("/auth/reinitialiser-mot-de-passe-admin/", {
      username: usernameAdmin,
      password: passwordAdmin,
      username_cible: usernameCible,
      nouveau_mot_de_passe: nouveauMotDePasse,
      doit_changer: doitChanger,
    });
  } catch (erreur) {
    if (!estErreurReseau(erreur)) throw erreur;
    // L'accès admin a déjà été vérifié (en ligne, ou par le cache admin de ce poste).
    if (!verifierIdentifiantAdminLocal(usernameAdmin, passwordAdmin)) throw new Error("Accès refusé.");
    if (!reinitialiserCompteLocal(usernameCible, nouveauMotDePasse, doitChanger)) {
      throw new Error("Sans internet, seuls les comptes déjà connus de cet ordinateur peuvent être réinitialisés.");
    }
    ecrireReinitialisationsARefaire([...new Set([...lireReinitialisationsARefaire(), usernameCible])]);
    return { statut: "local" };
  }
  reinitialiserCompteLocal(usernameCible, nouveauMotDePasse, doitChanger);
  ecrireReinitialisationsARefaire(lireReinitialisationsARefaire().filter((u) => u !== usernameCible));
  return { statut: "enLigne" };
}

export interface CompteAdmin {
  username: string;
  nom: string;
  boutiqueNom: string;
  role: string;
  telephone: string;
  actif: boolean;
  derniereConnexion: string | null;
  doitChangerMotDePasse: boolean;
}

/** Tous les comptes de toutes les boutiques (serveur) ; sans internet, ceux connus de ce poste. */
export async function listerComptesAdmin(
  usernameAdmin: string,
  passwordAdmin: string,
): Promise<{ source: "serveur" | "poste"; comptes: CompteAdmin[] }> {
  try {
    const donnees = await appelerApi("/auth/lister-comptes/", { username: usernameAdmin, password: passwordAdmin });
    return {
      source: "serveur",
      comptes: (Array.isArray(donnees) ? donnees : []).map((c: any) => ({
        username: String(c.username),
        nom: String(c.nom ?? ""),
        boutiqueNom: String(c.boutique_nom ?? ""),
        role: String(c.role ?? ""),
        telephone: String(c.telephone ?? ""),
        actif: Boolean(c.actif),
        derniereConnexion: c.derniere_connexion ?? null,
        doitChangerMotDePasse: Boolean(c.doit_changer_mot_de_passe),
      })),
    };
  } catch (erreur) {
    if (!estErreurReseau(erreur)) throw erreur;
    return {
      source: "poste",
      comptes: Object.entries(chargerIdentifiantsLocaux()).map(([username, entree]) => ({
        username,
        nom: "",
        boutiqueNom: entree.session?.boutiqueNom ?? "",
        role: entree.session?.role ?? "",
        telephone: "",
        actif: !entree.desactive,
        derniereConnexion: null,
        doitChangerMotDePasse: Boolean(entree.session?.doitChangerMotDePasse),
      })),
    };
  }
}

/**
 * L'utilisateur choisit son mot de passe (obligatoire après un mot de passe
 * provisoire : l'ancien n'est alors pas redemandé). Internet nécessaire ; le
 * cache de ce poste et la session sont mis à jour.
 */
export async function changerMotDePasse(session: Session, nouveauMotDePasse: string, ancienMotDePasse = ""): Promise<Session> {
  let reponse: Response;
  try {
    reponse = await appelerAvecDelai(`${URL_BASE_API}/auth/changer-mot-de-passe/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ nouveau_mot_de_passe: nouveauMotDePasse, ancien_mot_de_passe: ancienMotDePasse }),
    });
  } catch {
    throw new Error("Connexion au serveur nécessaire pour choisir votre mot de passe.");
  }
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(String(donnees?.detail ?? "Mot de passe refusé."));
  const sessionMiseAJour: Session = { ...session, doitChangerMotDePasse: undefined };
  ouvrirSessionLocale(session.username, nouveauMotDePasse, sessionMiseAJour);
  ecrireReinitialisationsARefaire(lireReinitialisationsARefaire().filter((u) => u !== session.username));
  return sessionMiseAJour;
}

export interface PatronResume {
  username: string;
  boutiqueNom: string;
}

/**
 * "Réinitialiser mot de passe" (voir ReinitialiserMotDePasseAdmin.tsx) :
 * l'admin choisit toujours dans ce menu, jamais de pré-sélection devinée —
 * un admin gère potentiellement plusieurs boutiques, jamais évident de savoir
 * laquelle il vise sans lui demander. Renvoie [] en cas d'échec (réseau,
 * accès refusé) — l'appelant retombe alors sur la saisie manuelle.
 */
export async function listerPatrons(usernameAdmin: string, passwordAdmin: string): Promise<PatronResume[]> {
  try {
    const donnees = await appelerApi("/auth/lister-patrons/", { username: usernameAdmin, password: passwordAdmin });
    if (!Array.isArray(donnees)) return [];
    return donnees.map((p: any) => ({ username: String(p.username), boutiqueNom: String(p.boutique_nom ?? "") }));
  } catch {
    return [];
  }
}

/**
 * Récupération du mot de passe du Patron par email (Étape 2) : réservée à ce
 * rôle côté serveur (comptes/services.py) — un caissier oublié se voit
 * réinitialisé en personne par le Patron (bouton "Réinitialiser" dans
 * Réglages > Utilisateurs), pas par email.
 */
export async function demanderReinitialisationMotDePasse(email: string): Promise<void> {
  await appelerApi("/auth/mot-de-passe-oublie/", { email });
}

export async function reinitialiserMotDePasse(
  email: string,
  code: string,
  nouveauMotDePasse: string,
): Promise<void> {
  await appelerApi("/auth/reinitialiser-mot-de-passe/", {
    email,
    code,
    nouveau_mot_de_passe: nouveauMotDePasse,
  });
}

export function sessionActuelle(): Session | null {
  const chemin = cheminSession();
  if (!fs.existsSync(chemin)) return null;
  try {
    return JSON.parse(fs.readFileSync(chemin, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Rôle/permissions/dépôt sont figés dans le JWT au moment de la connexion
 * (voir ConnexionSerializer.get_token) : un changement de permission côté
 * serveur (migration, modification du rôle...) ne s'appliquait donc qu'à la
 * prochaine connexion manuelle. Appelée au démarrage de l'appli (App.tsx),
 * cette fonction relit /auth/moi/ pour rafraîchir la session en cache sans
 * exiger de déconnexion — best-effort : hors-ligne ou en cas d'erreur, la
 * session actuelle est renvoyée inchangée.
 */
export async function rafraichirPermissions(session: Session): Promise<Session> {
  try {
    const reponse = await appelerAvecDelai(`${URL_BASE_API}/auth/moi/`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!reponse.ok) return session;
    const donnees = await reponse.json();
    const sessionMiseAJour: Session = {
      ...session,
      role: donnees.role?.nom ?? null,
      permissions: donnees.role?.permissions ?? {},
      depotId: donnees.depot_id ?? null,
      depotNom: donnees.depot_nom ?? null,
      synchroAutorisee: donnees.boutique?.synchro_autorisee ?? false,
      codeVendeur: donnees.code_vendeur || session.codeVendeur,
    };
    if (donnees.boutique) {
      try {
        memoriserAbonnementBoutique(donnees.boutique);
      } catch {
        // Base locale pas encore ouverte : l'échéance arrivera au prochain rafraîchissement.
      }
    }

    fs.writeFileSync(cheminSession(), JSON.stringify(sessionMiseAJour, null, 2));
    const identifiants = chargerIdentifiantsLocaux();
    if (identifiants[session.username]) {
      identifiants[session.username].session = sessionMiseAJour;
      fs.writeFileSync(cheminIdentifiantsLocaux(), JSON.stringify(identifiants, null, 2));
    }
    return sessionMiseAJour;
  } catch {
    return session;
  }
}

export function deconnexion(): void {
  const chemin = cheminSession();
  if (fs.existsSync(chemin)) fs.unlinkSync(chemin);
}

// --- Page de connexion : ce que sait ce poste avant toute connexion ---

export interface EtatPosteConnexion {
  serveurJoint: boolean;
  boutique: { nom: string; synchroAutorisee: boolean } | null;
  abonnement: { niveau: "ok" | "bientot" | "grace" | "bloque"; joursRestants: number | null; finGrace: string | null } | null;
  /** Rôle dans le réseau de la boutique (caisse : nom du poste principal et liaison). */
  reseau: { role: "seul" | "principal" | "caisse"; nomPostePrincipal: string | null; relie: boolean } | null;
  /** Comptes utilisables ici sans internet. */
  comptesDuPoste: number;
  echecs: number;
  attenteSecondes: number;
}

export async function etatPosteConnexion(): Promise<EtatPosteConnexion> {
  let serveurJoint = false;
  try {
    await appelerAvecDelai(`${URL_BASE_API}/auth/verifier-acces-admin/`, { method: "GET" });
    serveurJoint = true;
  } catch {
    serveurJoint = false;
  }
  let boutique: EtatPosteConnexion["boutique"] = null;
  let abonnement: EtatPosteConnexion["abonnement"] = null;
  let reseau: EtatPosteConnexion["reseau"] = null;
  try {
    const b = obtenirBoutiqueLocale();
    if (b) {
      boutique = { nom: b.boutiqueNom, synchroAutorisee: b.synchroAutorisee };
      const e = obtenirEtatAbonnement(b.boutiqueId);
      abonnement = { niveau: e.niveau, joursRestants: e.joursRestants, finGrace: e.finGrace };
    }
    const r = etatReseauComplet();
    reseau = { role: r.role, nomPostePrincipal: r.caisse?.nomPostePrincipal ?? null, relie: !!r.caisse?.relie };
  } catch {
    // base pas encore ouverte : rien à montrer
  }
  const identifiants = chargerIdentifiantsLocaux();
  return {
    serveurJoint,
    boutique,
    abonnement,
    reseau,
    comptesDuPoste: Object.values(identifiants).filter((i) => !i.desactive).length,
    echecs: lireEssais("connexion").echecs,
    attenteSecondes: attenteRestante("connexion"),
  };
}
