import { BrowserWindow } from "electron";

/**
 * Contournement du WAF "Tiger Protect" d'O2switch (voir mémoire projet
 * "déploiement_o2switch") : il bloque tout POST envoyé par un fetch() Node
 * (curl/fetch nu, sans empreinte de vrai navigateur) et renvoie une page
 * HTML de "vérification de sécurité" (503) au lieu de traiter la requête —
 * qu'un vrai navigateur résout silencieusement, mais qu'un client HTTP nu ne
 * peut pas. `fetchAvecRepliNavigateur` a la même signature qu'un fetch()
 * minimal : elle tente d'abord le fetch() Node normal (rapide, et le seul
 * chemin utilisé en local où ce WAF n'existe pas), et ne bascule sur une
 * fenêtre Electron cachée — donc un vrai moteur Chromium — que si la réponse
 * ressemble à ce défi.
 *
 * Solution de repli seulement : le correctif propre et durable reste une
 * exception Tiger Protect (cPanel) ou un ticket support O2switch pour exempter
 * /api/ — voir la mémoire projet. Ce contournement est fragile par nature
 * (dépend du mécanisme de défi actuel du WAF, pas garanti de rester valable
 * si O2switch le fait évoluer) et plus lent (charge une vraie page avant de
 * pouvoir requêter). Jamais déclenché contre un serveur local.
 */

interface OptionsRequete {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

let fenetreCachee: BrowserWindow | null = null;
let origineChargee: string | null = null;

function obtenirFenetreCachee(): BrowserWindow {
  if (fenetreCachee && !fenetreCachee.isDestroyed()) return fenetreCachee;
  fenetreCachee = new BrowserWindow({ show: false });
  fenetreCachee.on("closed", () => {
    fenetreCachee = null;
    origineChargee = null;
  });
  return fenetreCachee;
}

async function assurerOrigineChargee(origine: string, forcerRechargement: boolean): Promise<void> {
  const fenetre = obtenirFenetreCachee();
  if (!forcerRechargement && origineChargee === origine) return;
  // Une vraie page du domaine (le formulaire de connexion admin, léger et
  // sans service worker) : nécessaire pour que fetch() depuis cette fenêtre
  // soit "même origine" pour le navigateur (sinon le CORS le bloquerait
  // lui-même avant d'atteindre le serveur), et pour laisser le défi JS du
  // WAF s'exécuter et poser son cookie si le serveur en envoie un ici.
  await fenetre.webContents.loadURL(`${origine}/admin/login/`);
  origineChargee = origine;
}

export function ressembleAUnDefiWaf(reponse: Response): boolean {
  return reponse.status === 503 && !(reponse.headers.get("content-type") || "").includes("json");
}

/**
 * Levée quand même la fenêtre cachée n'a pas réussi à passer le défi du WAF —
 * sans ça, l'appelant recevait une Response avec un corps HTML (pas JSON),
 * et le message d'erreur construit à partir de son .json() (résolu en objet
 * vide) finissait vide côté utilisateur au lieu d'expliquer ce qui se passe.
 * Traitée comme une erreur réseau par estErreurReseau() (auth.ts) : bascule
 * sur la connexion locale hors-ligne quand c'est possible, comme pour une
 * vraie coupure réseau.
 */
export class ErreurAccesBloque extends Error {}

/** Bascule complète sur la fenêtre cachée, avec un réessai après rechargement
 * si le premier essai retombe encore sur le défi (cookie périmé). À utiliser
 * une fois qu'un fetch() normal a déjà montré la signature du défi. */
export async function repliNavigateur(url: string, options: OptionsRequete): Promise<Response> {
  const premierEssai = await fetchViaNavigateurCache(url, options, false);
  if (!ressembleAUnDefiWaf(premierEssai)) return premierEssai;
  const deuxiemeEssai = await fetchViaNavigateurCache(url, options, true);
  if (!ressembleAUnDefiWaf(deuxiemeEssai)) return deuxiemeEssai;
  throw new ErreurAccesBloque(
    "Le serveur a refusé la requête (protection de sécurité de l'hébergeur). Réessayez dans un instant ou contactez l'administrateur si ça persiste.",
  );
}

async function fetchViaNavigateurCache(
  url: string,
  options: OptionsRequete,
  forcerRechargement: boolean,
): Promise<Response> {
  const origine = new URL(url).origin;
  await assurerOrigineChargee(origine, forcerRechargement);
  const fenetre = obtenirFenetreCachee();

  const resultat: { status: number; corpsTexte: string; entetes: Record<string, string> } =
    await fenetre.webContents.executeJavaScript(`
      (async () => {
        const reponse = await fetch(${JSON.stringify(url)}, ${JSON.stringify(options)});
        const corpsTexte = await reponse.text();
        const entetes = {};
        reponse.headers.forEach((v, k) => { entetes[k] = v; });
        return { status: reponse.status, corpsTexte, entetes };
      })();
    `);

  return new Response(resultat.corpsTexte, { status: resultat.status, headers: resultat.entetes });
}

export async function fetchAvecRepliNavigateur(url: string, options: OptionsRequete = {}): Promise<Response> {
  const reponse = await fetch(url, options);
  if (!ressembleAUnDefiWaf(reponse)) return reponse;
  return repliNavigateur(url, options);
}
