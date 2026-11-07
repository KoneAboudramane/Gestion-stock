import { exporterComptesLocaux, importerComptesDiffuses, type CompteDiffuse } from "../api/authHorsLigne";
import { ouvrirBaseDeDonnees } from "../db";
import { listerTout } from "../db/helpers";
import { REGISTRE_CLIENT } from "../db/registre";
import { ecritureDeSuivi } from "../db/suiviReseau";
import { estAppliMobile } from "../lib/appliAndroid";
import { compterEnAttente, synchroniserVers, type CibleSynchro } from "../sync";
import { etatPrincipal } from "./reseauPrincipal";
import {
  MESSAGE_RESEAU_NON_ACTIVE,
  PORT_RESEAU,
  POSTES_MAX,
  ReseauBoutique,
  ecrireConfigReseau,
  hmacSha256Hex,
  lireConfigReseau,
  nomAppareil,
  reseauAutorise,
  sha256Hex,
  versHex,
  type ConfigCaisse,
  type EtatReseau,
  type PostePrincipalTrouve,
} from "./reseauConfig";

export {
  MESSAGE_RESEAU_NON_ACTIVE,
  PORT_RESEAU,
  POSTES_MAX,
  lireConfigReseau,
  nomAppareil,
  reseauAutorise,
};
export type { AppareilBranche, ConfigCaisse, ConfigReseau, EtatCaisse, EtatReseau, PostePrincipalTrouve } from "./reseauConfig";

/**
 * Réseau de la boutique — cet appareil en CAISSE branchée sur un poste principal
 * (docs/plan_mobile_complet.md, lot 2). Port de
 * client-electron/electron/services/reseauCaisse.ts, au même contrat : trouver
 * le poste principal (annonces UDP ou adresse tapée), s'y brancher avec le code
 * à 6 chiffres, échanger toutes les 4 secondes (envoyer ses ventes, recevoir
 * celles des autres), recevoir les comptes des vendeurs, vérifier le stock
 * avant de vendre un article presque en rupture. Le poste principal peut être
 * un ordinateur ou (lot 3) un téléphone / une tablette.
 *
 * Le transport passe par le module natif ReseauBoutique (android/…/ReseauBoutiquePlugin.java) :
 * la vue web ne sait ni écouter l'UDP ni appeler du http:// local.
 */

export const INTERVALLE_SYNCHRO_RESEAU_MS = 4000;
/** Les comptes changent rarement : on les redemande tous les 15 cycles (≈ 1 min). */
const CYCLES_ENTRE_COMPTES = 15;
const DELAI_VERIFICATION_STOCK_MS = 1500;
const DELAI_PRESENTATION_MS = 3000;
const DELAI_SYNCHRO_MS = 8000;
/** Poste principal perdu : on le recherche après 2 échecs de suite, au plus toutes les 20 s. */
const ECHECS_AVANT_RECHERCHE = 2;
const INTERVALLE_RECHERCHE_MS = 20_000;
const DUREE_RECHERCHE_MS = 2500;

/** Requête vers le poste principal, rendue comme un fetch (Response). */
async function appelerPoste(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; delaiMs?: number } = {},
): Promise<Response> {
  const delaiMs = options.delaiMs ?? DELAI_SYNCHRO_MS;
  if (estAppliMobile) {
    const { statut, corps } = await ReseauBoutique.requete({
      url,
      methode: options.method ?? "GET",
      entetes: options.headers ?? {},
      corps: options.body,
      delaiMs,
    });
    return new Response(corps, { status: statut, headers: { "Content-Type": "application/json" } });
  }
  // Navigateur (développement sur le PC) : fetch direct, possible seulement depuis une page http://.
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), delaiMs);
  try {
    return await fetch(url, { method: options.method, headers: options.headers, body: options.body, signal: controleur.signal });
  } finally {
    clearTimeout(minuteur);
  }
}

/** « 192.168.1.10 » → « 192.168.1.10:47800 » ; garde le port s'il est donné. */
export function normaliserAdresse(saisie: string): string {
  const propre = saisie.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return /:\d+$/.test(propre) ? propre : `${propre}:${PORT_RESEAU}`;
}

function cible(config: ConfigCaisse): CibleSynchro {
  return {
    canal: "reseau",
    appeler: (chemin, options) =>
      appelerPoste(`http://${config.adresse}${chemin}`, {
        method: options?.method,
        body: options?.body,
        headers: { Authorization: `Bearer ${config.jeton}`, ...(options?.body ? { "Content-Type": "application/json" } : {}) },
      }),
  };
}

// --- Trouver le poste principal ---

/** Écoute pendant `dureeMs` les annonces des postes principaux du réseau de la boutique. */
export async function rechercherPostesPrincipaux(dureeMs = 3000): Promise<PostePrincipalTrouve[]> {
  if (!estAppliMobile) return [];
  try {
    return (await ReseauBoutique.rechercherPostes({ dureeMs })).postes ?? [];
  } catch {
    return [];
  }
}

// --- Se brancher / se débrancher ---

/**
 * Lignes déjà présentes sur cet appareil avant le branchement : à envoyer au
 * poste principal (au bureau, la colonne ajoutée vaut 0 pour toutes les lignes).
 */
async function marquerToutAEnvoyer(): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  for (const entree of REGISTRE_CLIENT) {
    const lignes = (await db.getAll(entree.store as never)) as Record<string, unknown>[];
    for (const ligne of lignes) {
      if (ligne.synchro_reseau === 1 || ligne.synchro_reseau === 0) continue;
      await db.put(entree.store as never, ecritureDeSuivi({ ...ligne, synchro_reseau: 0 }) as never);
    }
  }
}

/**
 * Branche cette caisse au poste principal : vérifie qu'il appartient bien à la
 * boutique de la session, échange le code contre un jeton, puis lance la
 * première synchronisation (tout ce que le poste principal a).
 */
export async function seBrancher(params: {
  adresse: string;
  code: string;
  /** Boutique de la session ; absente pour un appareil neuf, avant toute connexion. */
  boutiqueId?: string;
  nomAppareil?: string;
}): Promise<EtatReseau> {
  if (lireConfigReseau().role === "principal") {
    throw new Error("Cet appareil est le poste principal : il ne peut pas se brancher sur un autre.");
  }
  if (params.boutiqueId && !(await reseauAutorise())) throw new Error(MESSAGE_RESEAU_NON_ACTIVE);
  // Sans session (écran de connexion) : un appareil neuf adopte la boutique du poste
  // principal ; un appareil qui a déjà une boutique ne peut rejoindre que la SIENNE.
  const boutiqueLocale = params.boutiqueId ? null : ((await listerTout("boutiques"))[0] ?? null);
  const adresse = normaliserAdresse(params.adresse);
  let presentation: { application?: string; boutiqueId?: string; boutiqueNom?: string; nomPoste?: string };
  try {
    presentation = await (await appelerPoste(`http://${adresse}/reseau/etat/`, { delaiMs: DELAI_PRESENTATION_MS })).json();
  } catch {
    throw new Error(
      `Poste principal introuvable à l'adresse ${adresse}. Vérifiez que cet appareil est connecté au même Wi-Fi (ou au même téléphone) que le poste principal, et que celui-ci est allumé.`,
    );
  }
  if (presentation.application !== "gestion-stock") throw new Error(`L'adresse ${adresse} n'est pas un poste principal.`);
  if (boutiqueLocale && presentation.boutiqueId !== boutiqueLocale.id) {
    throw new Error(
      `Ce poste principal appartient à une autre boutique (« ${presentation.boutiqueNom ?? "?"} ») : cet appareil est celui de « ${boutiqueLocale.nom} ».`,
    );
  }
  if (params.boutiqueId && presentation.boutiqueId !== params.boutiqueId) {
    throw new Error(`Ce poste principal appartient à une autre boutique (« ${presentation.boutiqueNom ?? "?"} »).`);
  }

  let reponse: Response;
  try {
    reponse = await appelerPoste(`http://${adresse}/reseau/appairer/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: params.code.replace(/\s/g, ""), nomAppareil: params.nomAppareil || (await nomAppareil()) }),
      delaiMs: DELAI_PRESENTATION_MS,
    });
  } catch {
    throw new Error("Le poste principal ne répond plus : réessayez.");
  }
  const corps = (await reponse.json()) as { detail?: string; jeton?: string; appareilId?: string };
  if (!reponse.ok || !corps.jeton || !corps.appareilId) throw new Error(corps.detail ?? "Branchement refusé.");

  await marquerToutAEnvoyer();
  ecrireConfigReseau({
    role: "caisse",
    boutiqueId: params.boutiqueId ?? String(presentation.boutiqueId ?? ""),
    boutiqueNom: presentation.boutiqueNom ?? "",
    nomPostePrincipal: presentation.nomPoste ?? "Poste principal",
    adresse,
    jeton: corps.jeton,
    appareilId: corps.appareilId,
    curseur: null,
  });
  cycles = 0;
  echecsConsecutifs = 0;
  derniereRecherche = 0;
  await synchroniserAvecPrincipal();
  demarrerBoucleCaisse();
  return etatReseauComplet();
}

/**
 * Écran de connexion d'un appareil neuf (aucune boutique, aucun compte) : il se
 * branche au poste principal avec le code à 6 chiffres et reçoit tout —
 * boutique, données et comptes des vendeurs — pour qu'on puisse ensuite s'y
 * connecter sans internet.
 */
export async function rejoindreAvantConnexion(params: {
  adresse: string;
  code: string;
  nomAppareil?: string;
}): Promise<{ boutiqueNom: string; nomPostePrincipal: string; relie: boolean; comptes: number }> {
  const etat = await seBrancher({ adresse: params.adresse, code: params.code, nomAppareil: params.nomAppareil?.trim() || undefined });
  const config = lireConfigReseau();
  if (config.role !== "caisse") throw new Error("Branchement interrompu.");
  return {
    boutiqueNom: config.boutiqueNom,
    nomPostePrincipal: config.nomPostePrincipal,
    relie: !!etat.caisse?.relie,
    comptes: exporterComptesLocaux(config.boutiqueId).filter((c) => !c.desactive).length,
  };
}

/** Cette caisse redevient un appareil seul (ses données restent dessus). */
export async function seDebrancher(): Promise<EtatReseau> {
  arreterBoucleCaisse();
  ecrireConfigReseau({ role: "seul" });
  relie = false;
  derniereErreur = null;
  internetPrincipal = null;
  return etatReseauComplet();
}

// --- Poste principal perdu : le retrouver à sa nouvelle adresse ---

/** Vrai si le poste à cette adresse connaît le jeton de cette caisse (défi HMAC), sans jamais lui envoyer le jeton. */
async function estNotrePostePrincipal(config: ConfigCaisse, adresse: string): Promise<boolean> {
  try {
    const defi = versHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
    const reponse = await appelerPoste(`http://${adresse}/reseau/prouver/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appareilId: config.appareilId, defi }),
      delaiMs: DELAI_PRESENTATION_MS,
    });
    if (!reponse.ok) return false;
    const { preuve } = (await reponse.json()) as { preuve?: string };
    const attendue = await hmacSha256Hex(await sha256Hex(config.jeton), defi);
    return typeof preuve === "string" && preuve.toLowerCase() === attendue;
  } catch {
    return false;
  }
}

async function retrouverPostePrincipal(config: ConfigCaisse): Promise<boolean> {
  const candidats = (await rechercherPostesPrincipaux(DUREE_RECHERCHE_MS)).filter(
    (p) => p.boutiqueId === config.boutiqueId && p.adresse !== config.adresse,
  );
  for (const candidat of candidats) {
    if (!(await estNotrePostePrincipal(config, candidat.adresse))) continue;
    const actuelle = lireConfigReseau();
    if (actuelle.role !== "caisse") return false;
    ecrireConfigReseau({ ...actuelle, adresse: candidat.adresse, nomPostePrincipal: candidat.nomPoste || actuelle.nomPostePrincipal });
    return true;
  }
  return false;
}

// --- Échanges toutes les 4 secondes ---

let boucle: ReturnType<typeof setInterval> | null = null;
let cycleEnCours: Promise<void> | null = null;
let relance: Promise<void> | null = null;
let cycles = 0;
let relie = false;
let derniereSynchro: string | null = null;
let derniereErreur: string | null = null;
let internetPrincipal: { derniereSynchro: string | null; enAttente: number } | null = null;
let echecsConsecutifs = 0;
let derniereRecherche = 0;
/** Écrans à prévenir après un échange (nouvelles ventes, stock…) : indicateur, modale. */
const abonnes = new Set<() => void>();

export function surChangementReseau(rappel: () => void): () => void {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
}

function prevenir(): void {
  for (const rappel of abonnes) rappel();
}

async function cycle(peutRechercher = true): Promise<void> {
  const config = lireConfigReseau();
  if (config.role !== "caisse") return;
  const c = cible(config);
  try {
    const { curseur } = await synchroniserVers(c, config.appareilId, config.curseur);
    // Relu : un débranchement a pu avoir lieu pendant l'échange.
    const apres = lireConfigReseau();
    if (apres.role === "caisse") ecrireConfigReseau({ ...apres, curseur });

    if (cycles % CYCLES_ENTRE_COMPTES === 0) {
      try {
        const { comptes } = (await (await c.appeler("/reseau/comptes/")).json()) as { comptes: CompteDiffuse[] };
        importerComptesDiffuses(comptes ?? []);
      } catch {
        // Les comptes ne sont qu'une commodité : on réessaiera au prochain tour.
      }
    }
    try {
      const presentation = await (await appelerPoste(`http://${config.adresse}/reseau/etat/`, { delaiMs: DELAI_PRESENTATION_MS })).json();
      internetPrincipal = presentation.internet ?? null;
    } catch {
      // sans gravité
    }
    cycles++;
    relie = true;
    echecsConsecutifs = 0;
    derniereErreur = null;
    derniereSynchro = new Date().toISOString();
  } catch (erreur) {
    relie = false;
    const debranchee = erreur instanceof Error && /HTTP 401/.test(erreur.message);
    derniereErreur = debranchee
      ? "Cette caisse a été débranchée du poste principal : rebranchez-la avec un nouveau code."
      : "Poste principal injoignable (éteint, ou cet appareil n'est plus sur le même réseau).";
    if (debranchee || !peutRechercher) return;
    echecsConsecutifs++;
    if (echecsConsecutifs >= ECHECS_AVANT_RECHERCHE && Date.now() - derniereRecherche >= INTERVALLE_RECHERCHE_MS) {
      derniereRecherche = Date.now();
      if (await retrouverPostePrincipal(config)) await cycle(false);
    }
  } finally {
    prevenir();
  }
}

/**
 * Un échange avec le poste principal. Si un échange est déjà en cours, il a
 * commencé AVANT ce qu'on veut envoyer (ex. la vente qu'on vient de valider) :
 * on en enchaîne un autre juste après — un seul, même si plusieurs demandes arrivent.
 */
export function synchroniserAvecPrincipal(): Promise<void> {
  if (!cycleEnCours) {
    cycleEnCours = cycle().finally(() => (cycleEnCours = null));
    return cycleEnCours;
  }
  if (!relance) {
    relance = cycleEnCours.then(() => {
      relance = null;
      return synchroniserAvecPrincipal();
    });
  }
  return relance;
}

/** Au lancement de l'appli (si cet appareil est une caisse) et après le branchement. */
export function demarrerBoucleCaisse(): void {
  if (boucle || lireConfigReseau().role !== "caisse") return;
  void synchroniserAvecPrincipal();
  boucle = setInterval(() => void synchroniserAvecPrincipal(), INTERVALLE_SYNCHRO_RESEAU_MS);
}

export function arreterBoucleCaisse(): void {
  if (boucle) clearInterval(boucle);
  boucle = null;
}

export function estCaisseBranchee(): boolean {
  return lireConfigReseau().role === "caisse";
}

// --- Vérification avant de vendre un article presque en rupture ---

/**
 * Avant de valider une vente sur une caisse reliée : pour chaque article dont le
 * stock local passerait sous son seuil d'alerte (ou sous 0), on demande au poste
 * principal ce qu'il reste vraiment. Délai de 1,5 s : sans réponse, la vente
 * passe (on ne bloque jamais la caisse) ; s'il n'en reste pas assez, elle est refusée.
 */
export async function verifierStockAvantVente(params: {
  depotId: string;
  lignes: { varianteId: string; quantite: number }[];
}): Promise<void> {
  const config = lireConfigReseau();
  if (config.role !== "caisse" || !relie) return;
  const db = await ouvrirBaseDeDonnees();
  const quantites = new Map<string, number>();
  for (const l of params.lignes) quantites.set(l.varianteId, (quantites.get(l.varianteId) ?? 0) + l.quantite);

  const aVerifier: [string, number][] = [];
  for (const [varianteId, quantite] of quantites) {
    const variante = await db.get("variantes", varianteId);
    const stock = await db.getFromIndex("stocks", "variante_depot", [varianteId, params.depotId]);
    if (!variante || Number(stock?.quantite ?? 0) - quantite < Math.max(Number(variante.seuil_alerte ?? 0), 0)) {
      aVerifier.push([varianteId, quantite]);
    }
  }

  const manques: string[] = [];
  await Promise.all(
    aVerifier.map(async ([varianteId, quantite]) => {
      try {
        const reponse = await appelerPoste(
          `http://${config.adresse}/reseau/stock/?variante=${encodeURIComponent(varianteId)}&depot=${encodeURIComponent(params.depotId)}`,
          { headers: { Authorization: `Bearer ${config.jeton}` }, delaiMs: DELAI_VERIFICATION_STOCK_MS },
        );
        if (!reponse.ok) return;
        const { quantite: restant } = (await reponse.json()) as { quantite: number };
        if (restant < quantite) {
          const variante = await db.get("variantes", varianteId);
          const produit = variante ? await db.get("produits", variante.produit_id) : undefined;
          manques.push(`« ${produit?.nom ?? "Article"} » : il en reste ${Math.max(restant, 0)}`);
        }
      } catch {
        // poste principal lent ou injoignable : on laisse vendre
      }
    }),
  );
  if (manques.length > 0) {
    throw new Error(`Plus assez de stock (vendu sur un autre poste) — ${manques.join(" ; ")}.`);
  }
}

// --- État pour l'écran et l'indicateur (même forme que le bureau) ---

export async function etatReseauComplet(): Promise<EtatReseau> {
  const config = lireConfigReseau();
  if (config.role === "principal") return etatPrincipal();
  const base: EtatReseau = {
    role: config.role,
    nomPoste: null,
    enMarche: false,
    enPause: false,
    port: null,
    adresses: [],
    code: null,
    appareils: [],
    postesMax: POSTES_MAX,
    erreur: null,
    nomOrdinateur: await nomAppareil(),
    demarreLe: null,
    requetesRecues: 0,
    annonceActive: false,
    internet: null,
    reseauAutorise: await reseauAutorise(),
  };
  if (config.role !== "caisse") return base;
  return {
    ...base,
    caisse: {
      nomPostePrincipal: config.nomPostePrincipal,
      adresse: config.adresse,
      relie,
      derniereSynchro,
      erreur: derniereErreur,
      enAttente: (await compterEnAttente("reseau")).reduce((t, e) => t + e.nombre, 0),
      internetPrincipal,
    },
  };
}
