import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { URL_BASE_API } from "../config";
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

function estErreurReseau(erreur: unknown): boolean {
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

async function appelerApi(chemin: string, corps: Record<string, unknown>): Promise<any> {
  const reponse = await fetch(`${URL_BASE_API}${chemin}`, {
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

export async function connexion(username: string, password: string): Promise<Session> {
  let donnees: any;
  try {
    donnees = await appelerApi("/auth/connexion/", { username, password });
  } catch (erreur) {
    if (!estErreurReseau(erreur)) throw erreur;

    // Serveur injoignable : on retombe sur les identifiants de la dernière connexion réussie.
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
  };
  fs.writeFileSync(cheminSession(), JSON.stringify(session, null, 2));
  enregistrerIdentifiantLocal(username, password, session);
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
