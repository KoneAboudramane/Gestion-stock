import { enregistrerIdentifiantLocal, estErreurReseau, verifierIdentifiantLocal } from "./authHorsLigne";
import {
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
}

function decoderPayloadJWT(token: string): Record<string, any> {
  const partiePayload = token.split(".")[1];
  const base64 = partiePayload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(base64 + padding));
}

async function connexionBrute(username: string, password: string): Promise<Session> {
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
