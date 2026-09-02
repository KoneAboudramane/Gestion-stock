export const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api";

/**
 * Couche de transport : l'équivalent web de window.api (Electron IPC). Contrairement
 * au client Electron, ce client web doit gérer lui-même l'expiration du jeton d'accès
 * en cours de session (rafraîchissement automatique) puisqu'il n'y a pas de repli
 * hors-ligne possible ici.
 */

export interface Jetons {
  accessToken: string;
  refreshToken: string;
}

export type ResultatEcriture<T> = { succes: true; resultat: T } | { succes: false; message: string };

export class ErreurApi extends Error {}

let jetonsActuels: Jetons | null = null;
let gestionnaireDeconnexionForcee: (() => void) | null = null;
let gestionnaireRafraichissement: ((jetons: Jetons) => void) | null = null;

export function definirJetons(jetons: Jetons | null): void {
  jetonsActuels = jetons;
}

/** Appelé quand le jeton de rafraîchissement lui-même est invalide/expiré : la session doit se terminer. */
export function surDeconnexionForcee(gestionnaire: () => void): void {
  gestionnaireDeconnexionForcee = gestionnaire;
}

/** Appelé après un rafraîchissement réussi, pour que la session persistée (localStorage) reste à jour. */
export function surRafraichissementJetons(gestionnaire: (jetons: Jetons) => void): void {
  gestionnaireRafraichissement = gestionnaire;
}

export async function extraireMessageErreur(reponse: Response): Promise<string> {
  try {
    const corps = await reponse.json();
    const premiereValeur = Object.values(corps as Record<string, unknown>)[0];
    const message = Array.isArray(premiereValeur) ? premiereValeur[0] : premiereValeur;
    if (typeof message === "string") return message;
  } catch {
    // corps non-JSON ou vide : on retombe sur le message générique ci-dessous
  }
  return `HTTP ${reponse.status}`;
}

let rafraichissementEnCours: Promise<boolean> | null = null;

async function rafraichirJetons(): Promise<boolean> {
  if (!jetonsActuels) return false;
  if (!rafraichissementEnCours) {
    rafraichissementEnCours = (async () => {
      try {
        const reponse = await fetch(`${BASE_URL}/auth/rafraichir/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: jetonsActuels!.refreshToken }),
        });
        if (!reponse.ok) return false;
        const donnees = await reponse.json();
        jetonsActuels = {
          accessToken: donnees.access,
          refreshToken: donnees.refresh ?? jetonsActuels!.refreshToken,
        };
        gestionnaireRafraichissement?.(jetonsActuels);
        return true;
      } catch {
        return false;
      } finally {
        rafraichissementEnCours = null;
      }
    })();
  }
  return rafraichissementEnCours;
}

/** fetch() vers l'API Django, avec jeton Bearer et une tentative de rafraîchissement sur 401. */
export async function apiFetch(chemin: string, options: RequestInit = {}): Promise<Response> {
  const executer = () =>
    fetch(`${BASE_URL}${chemin}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(jetonsActuels ? { Authorization: `Bearer ${jetonsActuels.accessToken}` } : {}),
        ...options.headers,
      },
    });

  let reponse = await executer();
  if (reponse.status === 401 && jetonsActuels) {
    const succes = await rafraichirJetons();
    if (succes) {
      reponse = await executer();
    } else {
      jetonsActuels = null;
      gestionnaireDeconnexionForcee?.();
    }
  }
  return reponse;
}

/** Enveloppe un appel en {succes,resultat}/{succes,message}, avec traduction des erreurs réseau. */
export async function executerEnSecurite<T>(operation: () => Promise<T>): Promise<ResultatEcriture<T>> {
  try {
    return { succes: true, resultat: await operation() };
  } catch (erreur) {
    if (erreur instanceof TypeError) {
      // fetch() lève un TypeError générique quand le réseau est indisponible (pas de statut HTTP à lire).
      return { succes: false, message: "Impossible de joindre le serveur. Vérifiez votre connexion internet." };
    }
    return { succes: false, message: erreur instanceof Error ? erreur.message : String(erreur) };
  }
}
