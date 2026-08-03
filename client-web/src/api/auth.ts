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
  const reponse = await apiFetch("/auth/connexion/", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
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
  return session;
}

export function connexion(username: string, password: string): Promise<ResultatEcriture<Session>> {
  return executerEnSecurite(() => connexionBrute(username, password));
}

/** Vérifie qu'une session restaurée depuis localStorage est toujours valide côté serveur. */
export async function sessionValide(): Promise<boolean> {
  const reponse = await apiFetch("/auth/moi/");
  return reponse.ok;
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
