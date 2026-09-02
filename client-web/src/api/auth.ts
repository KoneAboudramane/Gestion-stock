import {
  chargerIdentifiantsAdmin,
  enregistrerIdentifiantAdminLocal,
  enregistrerIdentifiantLocal,
  enregistrerJetonsAdmin,
  estErreurReseau,
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

export function connexion(username: string, password: string): Promise<ResultatEcriture<Session>> {
  return executerEnSecurite(() => connexionBrute(username, password));
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
  return {
    ...session,
    role: donnees.role?.nom ?? null,
    permissions: donnees.role?.permissions ?? {},
    depotId: donnees.depot_id ?? null,
    depotNom: donnees.depot_nom ?? null,
    synchroAutorisee: donnees.boutique?.synchro_autorisee ?? false,
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

/**
 * Carte "Réinitialiser mot de passe" de l'Espace Admin : réinitialise
 * directement le mot de passe d'un Patron, sans code ni email — l'identité de
 * l'exploitant est déjà prouvée par le verrou admin (identifiants réutilisés,
 * jamais redemandés). Action serveur uniquement (le compte Utilisateur n'est
 * pas répliqué en local, voir CLAUDE.md — AUTH_USER_MODEL en AutoField, pas
 * de UUID) : pas de repli hors-ligne possible ici.
 */
export function reinitialiserMotDePasseAdmin(
  usernameAdmin: string,
  passwordAdmin: string,
  usernameCible: string,
  nouveauMotDePasse: string,
): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/auth/reinitialiser-mot-de-passe-admin/", {
      method: "POST",
      body: JSON.stringify({
        username: usernameAdmin,
        password: passwordAdmin,
        username_cible: usernameCible,
        nouveau_mot_de_passe: nouveauMotDePasse,
      }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
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
