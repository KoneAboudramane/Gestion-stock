/**
 * Accès à l'API du site d'administration (/api/admin/…).
 *
 * Les jetons vivent dans sessionStorage (pas localStorage) : fermer l'onglet
 * ou le navigateur ferme la session — c'est un outil d'administrateur. Le
 * serveur borne de toute façon la session à 12 h.
 */
export const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api";

const CLE_SESSION = "gestion-stock-admin.session";

export interface Jetons {
  access: string;
  refresh: string;
}

export interface DroitCatalogue {
  cle: string;
  libelle: string;
}

export interface Moi {
  id: number;
  username: string;
  nom: string;
  email: string;
  superuser: boolean;
  droits: string[];
  catalogue_droits: DroitCatalogue[];
  double_verification_exigee: boolean;
  double_verification_active: boolean;
  doit_changer_mot_de_passe: boolean;
}

export type ReponseConnexion =
  | ({ etape: "terminee" } & Jetons)
  | { etape: "code"; jeton_etape: string }
  | { etape: "configuration"; jeton_etape: string; secret: string; uri: string };

export class ErreurApi extends Error {
  /** Erreurs par champ renvoyées par le serveur (formulaires), ex. { username: "Déjà pris." }. */
  public champs: Record<string, string> = {};

  constructor(message: string, public statut: number, corps?: unknown) {
    super(message);
    if (corps && typeof corps === "object") {
      for (const [cle, valeur] of Object.entries(corps as Record<string, unknown>)) {
        const texte = Array.isArray(valeur) ? valeur[0] : valeur;
        if (typeof texte === "string" && cle !== "detail") this.champs[cle] = texte;
      }
    }
  }
}

let jetons: Jetons | null = lireJetons();
let surSessionTerminee: ((message: string) => void) | null = null;

function lireJetons(): Jetons | null {
  try {
    const brut = sessionStorage.getItem(CLE_SESSION);
    return brut ? (JSON.parse(brut) as Jetons) : null;
  } catch {
    return null;
  }
}

export function definirJetons(nouveaux: Jetons | null): void {
  jetons = nouveaux;
  if (nouveaux) sessionStorage.setItem(CLE_SESSION, JSON.stringify(nouveaux));
  else sessionStorage.removeItem(CLE_SESSION);
}

export function aDesJetons(): boolean {
  return jetons !== null;
}

/** Appelé quand le serveur met fin à la session (expirée, droits retirés, double vérification exigée…). */
export function quandSessionTerminee(gestionnaire: (message: string) => void): void {
  surSessionTerminee = gestionnaire;
}

async function messageErreur(reponse: Response): Promise<string> {
  try {
    const corps = (await reponse.json()) as Record<string, unknown>;
    const valeur = corps.detail ?? Object.values(corps)[0];
    const message = Array.isArray(valeur) ? valeur[0] : valeur;
    if (typeof message === "string") return message;
  } catch {
    // corps vide ou non JSON
  }
  if (reponse.status === 429) return "Trop de tentatives : patientez une minute.";
  return `Erreur du serveur (${reponse.status}).`;
}

async function envoyer(chemin: string, options: RequestInit = {}, avecJeton = true): Promise<Response> {
  const entetes = new Headers(options.headers);
  if (options.body !== undefined) entetes.set("Content-Type", "application/json");
  if (avecJeton && jetons) entetes.set("Authorization", `Bearer ${jetons.access}`);
  try {
    return await fetch(`${BASE_URL}${chemin}`, { ...options, headers: entetes });
  } catch {
    throw new ErreurApi("Serveur injoignable : vérifiez la connexion internet.", 0);
  }
}

let rafraichissement: Promise<boolean> | null = null;

async function rafraichir(): Promise<boolean> {
  if (!jetons) return false;
  rafraichissement ??= (async () => {
    try {
      const reponse = await envoyer(
        "/admin/rafraichir/",
        { method: "POST", body: JSON.stringify({ refresh: jetons!.refresh }) },
        false,
      );
      if (!reponse.ok) return false;
      const corps = (await reponse.json()) as { access: string; refresh?: string };
      definirJetons({ access: corps.access, refresh: corps.refresh ?? jetons!.refresh });
      return true;
    } finally {
      rafraichissement = null;
    }
  })();
  return rafraichissement;
}

function terminerSession(message: string): never {
  definirJetons(null);
  surSessionTerminee?.(message);
  throw new ErreurApi(message, 401);
}

/** Appel authentifié : rafraîchit le jeton une fois si besoin, sinon termine la session. */
export async function api<T>(chemin: string, options: RequestInit = {}): Promise<T> {
  let reponse = await envoyer(chemin, options);
  if (reponse.status === 401) {
    const message = await messageErreur(reponse.clone());
    // Fin de session décidée par le serveur : inutile de rafraîchir.
    const definitif = /reconnectez-vous/i.test(message);
    if (definitif || !(await rafraichir())) {
      terminerSession(definitif ? message : "Session terminée : reconnectez-vous.");
    }
    reponse = await envoyer(chemin, options);
    if (reponse.status === 401) terminerSession(await messageErreur(reponse));
  }
  if (reponse.status === 403 && chemin === "/admin/moi/") {
    terminerSession("Ce compte n'a plus accès à l'administration.");
  }
  if (!reponse.ok) {
    const corps = await reponse.clone().json().catch(() => null);
    throw new ErreurApi(await messageErreur(reponse), reponse.status, corps);
  }
  if (reponse.status === 204) return undefined as T;
  return (await reponse.json()) as T;
}

// --- Connexion ----------------------------------------------------------------

async function appelConnexion(chemin: string, corps: object): Promise<ReponseConnexion> {
  const reponse = await envoyer(chemin, { method: "POST", body: JSON.stringify(corps) }, false);
  if (!reponse.ok) throw new ErreurApi(await messageErreur(reponse), reponse.status);
  return (await reponse.json()) as ReponseConnexion;
}

export function connexion(username: string, password: string): Promise<ReponseConnexion> {
  return appelConnexion("/admin/connexion/", { username, password });
}

export function validerCode(jetonEtape: string, code: string): Promise<ReponseConnexion> {
  return appelConnexion("/admin/connexion/code/", { jeton_etape: jetonEtape, code });
}

export function chargerMoi(): Promise<Moi> {
  return api<Moi>("/admin/moi/");
}

export async function deconnexion(): Promise<void> {
  try {
    await api<void>("/admin/deconnexion/", { method: "POST" });
  } catch {
    // la session locale est fermée quoi qu'il arrive
  }
  definirJetons(null);
}
