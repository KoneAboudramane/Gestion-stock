import {
  chargerIdentifiantsAdmin,
  enregistrerIdentifiantAdminLocal,
  enregistrerIdentifiantLocal,
  enregistrerJetonsAdmin,
  estErreurReseau,
  listerIdentifiantsLocaux,
  reinitialiserIdentifiantLocal,
  supprimerIdentifiantAdminLocal,
  verifierIdentifiantAdminLocal,
  verifierIdentifiantLocal,
} from "./authHorsLigne";
import {
  BASE_URL,
  ErreurApi,
  apiFetch,
  definirJetons,
  executerEnSecurite,
  extraireMessageErreur,
  type ResultatEcriture,
} from "./transport";
import { memoriserAbonnementBoutique } from "../services/abonnement";

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
  // comptes.Boutique.synchro_autorisee côté backend) — certains commerçants
  // ne veulent pas que leurs données quittent leur poste.
  synchroAutorisee: boolean;
  /** Abréviation dans les numéros de ses documents (VTE-20261002-AKO-0001, voir services/numerotation.ts). */
  codeVendeur?: string;
  /** Mot de passe provisoire (Espace Admin) : l'utilisateur doit choisir le sien avant d'entrer. */
  doitChangerMotDePasse?: boolean;
}

function decoderPayloadJWT(token: string): Record<string, any> {
  const partiePayload = token.split(".")[1];
  const base64 = partiePayload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(base64 + padding));
}

/** Écrit jetons + identifiants-locaux — même effet qu'une connexion en ligne réussie
 * (voir connexionBrute ci-dessous), réutilisé pour ouvrir une session sur une boutique
 * créée localement (voir services/inscriptionLocale.ts) sans jamais contacter le serveur. */
export async function ouvrirSessionLocale(username: string, password: string, session: Session): Promise<void> {
  definirJetons({ accessToken: session.accessToken, refreshToken: session.refreshToken });
  await enregistrerIdentifiantLocal(username, password, session);
}

// Doit rester identique à la constante dupliquée dans services/inscriptionLocale.ts
// (import circulaire sinon : ce module doit pouvoir être importé sans dépendre
// des services locaux, et inversement).
const CLE_BOUTIQUE_LOCALE_EN_ATTENTE = "gestion-stock:boutique-locale-en-attente";

/**
 * Une boutique créée hors-ligne n'existe pas encore côté serveur tant qu'elle
 * n'a pas été "activée en ligne" (Réglages > Synchronisation) : tant que ce
 * marqueur existe, la connexion de son Patron doit passer directement par le
 * cache local, sans même essayer le serveur — un essai en ligne échouerait de
 * toute façon (compte inconnu du serveur), mais avec le même message
 * générique qu'un mauvais mot de passe, ce qui empêcherait à tort le repli
 * local ci-dessous.
 */
function boutiqueLocaleEnAttenteConcerne(username: string): boolean {
  try {
    const brut = localStorage.getItem(CLE_BOUTIQUE_LOCALE_EN_ATTENTE);
    if (!brut) return false;
    const entree = JSON.parse(brut);
    return entree?.patronUsername === username;
  } catch {
    return false;
  }
}

async function connexionBrute(username: string, password: string): Promise<Session> {
  if (boutiqueLocaleEnAttenteConcerne(username)) return connexionHorsLigne(username, password);

  let reponse: Response;
  try {
    reponse = await apiFetch("/auth/connexion/", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  } catch (erreur) {
    if (!estErreurReseau(erreur)) throw erreur;
    return connexionHorsLigne(username, password);
  }
  if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  const donnees = await reponse.json();
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
  definirJetons({ accessToken: session.accessToken, refreshToken: session.refreshToken });
  await enregistrerIdentifiantLocal(username, password, session);
  return session;
}

/** Serveur injoignable : on retombe sur les identifiants de la dernière connexion réussie sur cet appareil. */
async function connexionHorsLigne(username: string, password: string): Promise<Session> {
  const resultat = await verifierIdentifiantLocal(username, password);
  if (resultat.statut === "ok") {
    definirJetons({ accessToken: resultat.session.accessToken, refreshToken: resultat.session.refreshToken });
    return resultat.session;
  }
  if (resultat.statut === "motDePasseInvalide") {
    throw new ErreurApi("Mot de passe incorrect.");
  }
  throw new ErreurApi(
    "Impossible de joindre le serveur, et aucune connexion hors-ligne n'est enregistrée pour cet utilisateur sur cet appareil. Connectez-vous une première fois avec internet.",
  );
}

const CLE_ESSAIS_CONNEXION = "gestion-stock:essais-connexion";

function lireEssaisConnexion(): { echecs: number; bloqueJusqua: number } {
  try {
    return { echecs: 0, bloqueJusqua: 0, ...JSON.parse(localStorage.getItem(CLE_ESSAIS_CONNEXION) ?? "{}") };
  } catch {
    return { echecs: 0, bloqueJusqua: 0 };
  }
}

function ecrireEssaisConnexion(essais: { echecs: number; bloqueJusqua: number }): void {
  try {
    localStorage.setItem(CLE_ESSAIS_CONNEXION, JSON.stringify(essais));
  } catch {
    // stockage indisponible
  }
}

function attenteConnexion(): number {
  return Math.max(0, Math.ceil((lireEssaisConnexion().bloqueJusqua - Date.now()) / 1000));
}

/**
 * Connexion d'un compte de la boutique, avec protection anti-essais (port du
 * bureau : 5 échecs, puis attente qui double) et messages clairs. Une coupure
 * d'internet ne compte pas comme un échec.
 */
export function connexion(username: string, password: string): Promise<ResultatEcriture<Session>> {
  return executerEnSecurite(async () => {
    const attente = attenteConnexion();
    if (attente > 0) throw new ErreurApi(`Trop d'essais : réessayez dans ${attente} s.`);
    try {
      const session = await connexionBrute(username, password);
      ecrireEssaisConnexion({ echecs: 0, bloqueJusqua: 0 });
      return session;
    } catch (erreur) {
      const message = erreur instanceof Error ? erreur.message : String(erreur);
      if (!/incorrect|no active account|aucun compte actif|identifiants fournis/i.test(message)) throw erreur;
      const echecs = lireEssaisConnexion().echecs + 1;
      const nouvelle =
        echecs >= ECHECS_ADMIN_AVANT_ATTENTE ? Math.min(15 * 60, 30 * 2 ** (echecs - ECHECS_ADMIN_AVANT_ATTENTE)) : 0;
      ecrireEssaisConnexion({ echecs, bloqueJusqua: nouvelle ? Date.now() + nouvelle * 1000 : 0 });
      const restants = ECHECS_ADMIN_AVANT_ATTENTE - echecs;
      throw new ErreurApi(
        (/^Mot de passe incorrect\.?$/.test(message) ? "Mot de passe incorrect (vérifié sans internet)." : "Identifiant ou mot de passe incorrect.") +
          (nouvelle
            ? ` Trop d'essais : réessayez dans ${nouvelle} s.`
            : restants <= 2
              ? ` Encore ${restants} essai${restants > 1 ? "s" : ""} avant une attente.`
              : ""),
      );
    }
  });
}

/** Page de connexion : ce que sait cet appareil avant toute connexion. */
export async function etatPosteConnexion(): Promise<{
  serveurJoint: boolean;
  boutique: { nom: string; synchroAutorisee: boolean } | null;
  abonnement: { niveau: "ok" | "bientot" | "grace" | "bloque"; joursRestants: number | null; finGrace: string | null } | null;
  reseau: null;
  comptesDuPoste: number;
  echecs: number;
  attenteSecondes: number;
}> {
  const { obtenirBoutiqueInstallee } = await import("../services/abonnementAdmin");
  const { obtenirEtatAbonnement } = await import("../services/abonnement");
  let serveurJoint = false;
  try {
    await fetch(`${BASE_URL}/auth/verifier-acces-admin/`, { method: "GET", signal: AbortSignal.timeout(5000) });
    serveurJoint = true;
  } catch {
    serveurJoint = false;
  }
  const b = await obtenirBoutiqueInstallee().catch(() => null);
  const e = b ? await obtenirEtatAbonnement(b.boutiqueId).catch(() => null) : null;
  return {
    serveurJoint,
    boutique: b ? { nom: b.boutiqueNom, synchroAutorisee: b.synchroAutorisee } : null,
    abonnement: e ? { niveau: e.niveau, joursRestants: e.joursRestants, finGrace: e.finGrace } : null,
    reseau: null,
    comptesDuPoste: listerIdentifiantsLocaux().length,
    echecs: lireEssaisConnexion().echecs,
    attenteSecondes: attenteConnexion(),
  };
}

/**
 * Rôle/permissions/dépôt sont figés dans le JWT depuis la dernière connexion
 * (voir ConnexionSerializer.get_token côté Django) : un changement côté
 * serveur (migration, modification du rôle...) ne s'appliquait donc qu'à la
 * prochaine connexion manuelle. Appelée au démarrage (App.tsx) avec la
 * session restaurée depuis localStorage, elle relit /auth/moi/ pour la
 * rafraîchir sans exiger de déconnexion. Renvoie null si le token n'est plus
 * valide (à distinguer d'une erreur réseau, gérée par l'appelant).
 */
export async function rafraichirPermissions(session: Session): Promise<Session | null> {
  const reponse = await apiFetch("/auth/moi/");
  if (!reponse.ok) return null;
  const donnees = await reponse.json();
  if (donnees.boutique) {
    // Formule et échéance écrites sur le poste même sans synchro (voir services/abonnement.ts).
    await memoriserAbonnementBoutique(donnees.boutique).catch(() => {});
  }
  return {
    ...session,
    role: donnees.role?.nom ?? null,
    permissions: donnees.role?.permissions ?? {},
    depotId: donnees.depot_id ?? null,
    depotNom: donnees.depot_nom ?? null,
    synchroAutorisee: donnees.boutique?.synchro_autorisee ?? false,
    codeVendeur: donnees.code_vendeur || session.codeVendeur,
  };
}

export function inscription(donnees: {
  boutiqueNom: string;
  username: string;
  password: string;
  email: string;
}): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/auth/inscription/", {
      method: "POST",
      body: JSON.stringify({
        boutique_nom: donnees.boutiqueNom,
        username: donnees.username,
        password: donnees.password,
        email: donnees.email,
      }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

// --- Connexion à l'Espace Admin : état, anti-essais, messages clairs (port du bureau) ---

export const ECHECS_ADMIN_AVANT_ATTENTE = 5;
const ATTENTE_ADMIN_MIN_S = 30;
const ATTENTE_ADMIN_MAX_S = 15 * 60;
const CLE_ESSAIS_ADMIN = "gestion-stock:essais-espace-admin";

function lireEssaisAdmin(): { echecs: number; bloqueJusqua: number } {
  try {
    return { echecs: 0, bloqueJusqua: 0, ...JSON.parse(localStorage.getItem(CLE_ESSAIS_ADMIN) ?? "{}") };
  } catch {
    return { echecs: 0, bloqueJusqua: 0 };
  }
}

function ecrireEssaisAdmin(essais: { echecs: number; bloqueJusqua: number }): void {
  try {
    localStorage.setItem(CLE_ESSAIS_ADMIN, JSON.stringify(essais));
  } catch {
    // stockage indisponible
  }
}

function attenteRestanteAdmin(): number {
  return Math.max(0, Math.ceil((lireEssaisAdmin().bloqueJusqua - Date.now()) / 1000));
}

function noterEchecAdmin(): number {
  const echecs = lireEssaisAdmin().echecs + 1;
  const attente =
    echecs >= ECHECS_ADMIN_AVANT_ATTENTE
      ? Math.min(ATTENTE_ADMIN_MAX_S, ATTENTE_ADMIN_MIN_S * 2 ** (echecs - ECHECS_ADMIN_AVANT_ATTENTE))
      : 0;
  ecrireEssaisAdmin({ echecs, bloqueJusqua: attente ? Date.now() + attente * 1000 : 0 });
  return attente;
}

/** Écran de connexion de l'Espace Admin : serveur joignable ? qui peut entrer sans internet ? attente en cours ? */
export async function etatConnexionAdmin(): Promise<{ serveurJoint: boolean; adminsDuPoste: string[]; echecs: number; attenteSecondes: number }> {
  let serveurJoint = false;
  try {
    await fetch(`${BASE_URL}/auth/verifier-acces-admin/`, { method: "GET", signal: AbortSignal.timeout(5000) });
    serveurJoint = true;
  } catch {
    serveurJoint = false;
  }
  return {
    serveurJoint,
    adminsDuPoste: Object.keys(chargerIdentifiantsAdmin()),
    echecs: lireEssaisAdmin().echecs,
    attenteSecondes: attenteRestanteAdmin(),
  };
}

/** Connexion à l'Espace Admin avec protection anti-essais et messages clairs. */
export function connexionAdmin(username: string, password: string): Promise<ResultatEcriture<{ source: "serveur" | "poste" }>> {
  return executerEnSecurite(async () => {
    const attente = attenteRestanteAdmin();
    if (attente > 0) throw new ErreurApi(`Trop d'essais : réessayez dans ${attente} s.`);
    let source: "serveur" | "poste" = "serveur";
    let autorise: boolean;
    try {
      const reponse = await apiFetch("/auth/verifier-acces-admin/", { method: "POST", body: JSON.stringify({ username, password }) });
      if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
      autorise = Boolean((await reponse.json())?.autorise);
    } catch (erreur) {
      if (!estErreurReseau(erreur)) throw erreur;
      source = "poste";
      if (!chargerIdentifiantsAdmin()[username]) {
        throw new ErreurApi(
          "Pas d'internet, et ce compte n'a jamais été vérifié en ligne sur cet appareil : connectez-vous une première fois avec internet.",
        );
      }
      autorise = await verifierIdentifiantAdminLocal(username, password);
    }
    if (!autorise) {
      const nouvelleAttente = noterEchecAdmin();
      const restants = ECHECS_ADMIN_AVANT_ATTENTE - lireEssaisAdmin().echecs;
      throw new ErreurApi(
        `Accès refusé : identifiant ou mot de passe incorrect, ou compte non administrateur${source === "poste" ? " (vérifié sans internet)" : ""}.` +
          (nouvelleAttente
            ? ` Trop d'essais : réessayez dans ${nouvelleAttente} s.`
            : restants <= 2
              ? ` Encore ${restants} essai${restants > 1 ? "s" : ""} avant une attente.`
              : ""),
      );
    }
    ecrireEssaisAdmin({ echecs: 0, bloqueJusqua: 0 });
    if (source === "serveur") {
      await enregistrerIdentifiantAdminLocal(username, password);
      try {
        const jetonsReponse = await fetch(`${BASE_URL}/auth/connexion/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (jetonsReponse.ok) {
          const jetons = await jetonsReponse.json();
          enregistrerJetonsAdmin(username, { accessToken: jetons.access, refreshToken: jetons.refresh });
        }
      } catch {
        // Ignoré : ne sert qu'à détecter une révocation plus tard.
      }
    }
    return { source };
  });
}

/**
 * Verrou devant l'Espace Admin (voir Connexion.tsx) : vérifie que les
 * identifiants saisis appartiennent à un compte administrateur (is_staff côté
 * Django), sans ouvrir de session — ne touche jamais à la session déjà active
 * sur cet appareil. En ligne, revérifie toujours contre le serveur et
 * rafraîchit le cache local au passage. Hors-ligne, retombe sur ce cache —
 * indispensable pour "Gérer abonnement" (voir services/abonnementAdmin.ts),
 * pensé pour fonctionner sans internet.
 */
export function verifierAccesAdmin(username: string, password: string): Promise<ResultatEcriture<boolean>> {
  return executerEnSecurite(async () => {
    let reponse: Response;
    try {
      reponse = await apiFetch("/auth/verifier-acces-admin/", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
    } catch (erreur) {
      if (!estErreurReseau(erreur)) throw erreur;
      return verifierIdentifiantAdminLocal(username, password);
    }
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const donnees = await reponse.json();
    const autorise = Boolean(donnees?.autorise);
    if (autorise) {
      await enregistrerIdentifiantAdminLocal(username, password);
      // Best-effort : sert uniquement à détecter une révocation plus tard
      // (voir verifierRevocationAdmin) — un échec ici ne doit jamais faire
      // échouer une vérification d'accès qui vient de réussir. fetch() brut
      // (pas apiFetch) : n'a rien à voir avec la session active.
      try {
        const jetonsReponse = await fetch(`${BASE_URL}/auth/connexion/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (jetonsReponse.ok) {
          const jetons = await jetonsReponse.json();
          enregistrerJetonsAdmin(username, { accessToken: jetons.access, refreshToken: jetons.refresh });
        }
      } catch {
        // Ignoré volontairement.
      }
    }
    return autorise;
  });
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
  // fetch() brut partout ici (jamais apiFetch) : ces appels manipulent le
  // jeton d'un compte admin séparé, pas la session active de l'utilisateur
  // connecté — apiFetch attacherait/rafraîchirait le mauvais jeton et
  // pourrait déclencher à tort une déconnexion de la session en cours.
  const identifiants = chargerIdentifiantsAdmin();
  for (const [username, entree] of Object.entries(identifiants)) {
    if (!entree.jetons) continue;
    try {
      const rafraichiReponse = await fetch(`${BASE_URL}/auth/rafraichir/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: entree.jetons.refreshToken }),
      });
      if (!rafraichiReponse.ok) {
        supprimerIdentifiantAdminLocal(username);
        continue;
      }
      const rafraichi = await rafraichiReponse.json();

      const reponse = await fetch(`${BASE_URL}/auth/verifier-session-admin/`, {
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

export function demanderReinitialisationMotDePasse(email: string): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/auth/mot-de-passe-oublie/", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

export function reinitialiserMotDePasse(
  email: string,
  code: string,
  nouveauMotDePasse: string,
): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/auth/reinitialiser-mot-de-passe/", {
      method: "POST",
      body: JSON.stringify({ email, code, nouveau_mot_de_passe: nouveauMotDePasse }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

const CLE_A_REFAIRE = "gestion-stock:reinitialisations-a-refaire";

/** Comptes réinitialisés sur cet appareil sans internet : à refaire en ligne (jamais le mot de passe gardé). */
export function lireReinitialisationsARefaire(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CLE_A_REFAIRE) ?? "[]");
  } catch {
    return [];
  }
}

function ecrireReinitialisationsARefaire(liste: string[]): void {
  try {
    if (liste.length === 0) localStorage.removeItem(CLE_A_REFAIRE);
    else localStorage.setItem(CLE_A_REFAIRE, JSON.stringify(liste));
  } catch {
    // stockage indisponible : la liste est seulement un rappel
  }
}

/**
 * Port de client-electron/electron/services/auth.ts::reinitialiserMotDePasseAdmin :
 * tout compte de boutique (jamais un administrateur), sur le serveur et dans le
 * cache de cet appareil ; sans internet, sur cet appareil seulement (« à refaire en ligne »).
 */
export function reinitialiserMotDePasseAdmin(
  usernameAdmin: string,
  passwordAdmin: string,
  usernameCible: string,
  nouveauMotDePasse: string,
  doitChanger = false,
): Promise<ResultatEcriture<{ statut: "enLigne" | "local" }>> {
  return executerEnSecurite(async () => {
    try {
      const reponse = await apiFetch("/auth/reinitialiser-mot-de-passe-admin/", {
        method: "POST",
        body: JSON.stringify({
          username: usernameAdmin,
          password: passwordAdmin,
          username_cible: usernameCible,
          nouveau_mot_de_passe: nouveauMotDePasse,
          doit_changer: doitChanger,
        }),
      });
      if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    } catch (erreur) {
      if (!estErreurReseau(erreur)) throw erreur;
      if (!(await verifierIdentifiantAdminLocal(usernameAdmin, passwordAdmin))) throw new ErreurApi("Accès refusé.");
      if (!(await reinitialiserIdentifiantLocal(usernameCible, nouveauMotDePasse, doitChanger))) {
        throw new ErreurApi("Sans internet, seuls les comptes déjà connus de cet appareil peuvent être réinitialisés.");
      }
      ecrireReinitialisationsARefaire([...new Set([...lireReinitialisationsARefaire(), usernameCible])]);
      return { statut: "local" as const };
    }
    await reinitialiserIdentifiantLocal(usernameCible, nouveauMotDePasse, doitChanger);
    ecrireReinitialisationsARefaire(lireReinitialisationsARefaire().filter((u) => u !== usernameCible));
    return { statut: "enLigne" as const };
  });
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

/** Tous les comptes de toutes les boutiques (serveur) ; sans internet, ceux connus de cet appareil. */
export function listerComptesAdmin(
  usernameAdmin: string,
  passwordAdmin: string,
): Promise<ResultatEcriture<{ source: "serveur" | "poste"; comptes: CompteAdmin[] }>> {
  return executerEnSecurite(async () => {
    try {
      const reponse = await apiFetch("/auth/lister-comptes/", {
        method: "POST",
        body: JSON.stringify({ username: usernameAdmin, password: passwordAdmin }),
      });
      if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
      const donnees = await reponse.json();
      return {
        source: "serveur" as const,
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
        source: "poste" as const,
        comptes: listerIdentifiantsLocaux().map(({ username, session }) => ({
          username,
          nom: "",
          boutiqueNom: session?.boutiqueNom ?? "",
          role: session?.role ?? "",
          telephone: "",
          actif: true,
          derniereConnexion: null,
          doitChangerMotDePasse: Boolean(session?.doitChangerMotDePasse),
        })),
      };
    }
  });
}

/** L'utilisateur choisit son mot de passe (obligatoire après un provisoire). Internet nécessaire. */
export function changerMotDePasse(session: Session, nouveau: string, ancien = ""): Promise<ResultatEcriture<Session>> {
  return executerEnSecurite(async () => {
    let reponse: Response;
    try {
      reponse = await apiFetch("/auth/changer-mot-de-passe/", {
        method: "POST",
        body: JSON.stringify({ nouveau_mot_de_passe: nouveau, ancien_mot_de_passe: ancien }),
      });
    } catch {
      throw new ErreurApi("Connexion au serveur nécessaire pour choisir votre mot de passe.");
    }
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const sessionMiseAJour: Session = { ...session, doitChangerMotDePasse: undefined };
    await enregistrerIdentifiantLocal(session.username, nouveau, sessionMiseAJour);
    ecrireReinitialisationsARefaire(lireReinitialisationsARefaire().filter((u) => u !== session.username));
    return sessionMiseAJour;
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
    const reponse = await apiFetch("/auth/lister-patrons/", {
      method: "POST",
      body: JSON.stringify({ username: usernameAdmin, password: passwordAdmin }),
    });
    if (!reponse.ok) return [];
    const donnees = await reponse.json();
    if (!Array.isArray(donnees)) return [];
    return donnees.map((p: any) => ({ username: String(p.username), boutiqueNom: String(p.boutique_nom ?? "") }));
  } catch {
    return [];
  }
}
