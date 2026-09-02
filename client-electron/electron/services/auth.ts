import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { URL_BASE_API } from "../config";
import { ErreurAccesBloque, fetchAvecRepliNavigateur } from "./httpClient";
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
}

interface IdentifiantLocal {
  sel: string;
  hash: string;
  session: Session;
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

function hacherMotDePasse(motDePasse: string, sel: string): string {
  return crypto.scryptSync(motDePasse, sel, 64).toString("hex");
}

function enregistrerIdentifiantLocal(username: string, motDePasse: string, session: Session): void {
  const identifiants = chargerIdentifiantsLocaux();
  const sel = crypto.randomBytes(16).toString("hex");
  identifiants[username] = { sel, hash: hacherMotDePasse(motDePasse, sel), session };
  fs.writeFileSync(cheminIdentifiantsLocaux(), JSON.stringify(identifiants, null, 2));
}

/** Vérifie les identifiants saisis contre le cache local (utilisé quand le serveur est injoignable). */
function verifierIdentifiantLocal(
  username: string,
  motDePasse: string,
): { statut: "ok"; session: Session } | { statut: "absent" } | { statut: "motDePasseInvalide" } {
  const entree = chargerIdentifiantsLocaux()[username];
  if (!entree) return { statut: "absent" };
  const hashAttendu = Buffer.from(entree.hash, "hex");
  const hashObtenu = Buffer.from(hacherMotDePasse(motDePasse, entree.sel), "hex");
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

export async function connexion(username: string, password: string): Promise<Session> {
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
export async function reinitialiserMotDePasseAdmin(
  usernameAdmin: string,
  passwordAdmin: string,
  usernameCible: string,
  nouveauMotDePasse: string,
): Promise<void> {
  await appelerApi("/auth/reinitialiser-mot-de-passe-admin/", {
    username: usernameAdmin,
    password: passwordAdmin,
    username_cible: usernameCible,
    nouveau_mot_de_passe: nouveauMotDePasse,
  });
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
    };

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
