import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import dgram from "node:dgram";
import os from "node:os";

import { tousLesResultats, unResultat } from "../db/helpers";
import { exporterComptesLocaux, importerComptesDiffuses, type CompteDiffuse } from "./auth";
import {
  MESSAGE_RESEAU_NON_ACTIVE,
  PORT_RESEAU,
  ecrireConfigReseau,
  etatReseau,
  lireConfigReseau,
  reseauAutorise,
  type ConfigCaisse,
  type EtatReseau,
} from "./reseauPrincipal";
import { compterEnAttente, synchroniserVers, type CibleSynchro } from "./sync";

/**
 * Caisse branchée au poste principal (docs/plan_reseau_local.md, lot 3) :
 * trouver le poste principal sur le réseau de la boutique, s'y brancher avec
 * le code à 6 chiffres, puis échanger toutes les 4 secondes (envoyer ses
 * ventes, recevoir celles des autres), recevoir les comptes des vendeurs et
 * vérifier le stock avant de vendre un article presque en rupture.
 */

export const INTERVALLE_SYNCHRO_RESEAU_MS = 4000;
/** Les comptes changent rarement : on les redemande tous les 15 cycles (≈ 1 min). */
const CYCLES_ENTRE_COMPTES = 15;
const DELAI_VERIFICATION_STOCK_MS = 1500;
const DELAI_PRESENTATION_MS = 3000;
/** Poste principal perdu : on le recherche sur le réseau après 2 échecs de suite, au plus toutes les 20 s. */
const ECHECS_AVANT_RECHERCHE = 2;
const INTERVALLE_RECHERCHE_MS = 20_000;
const DUREE_RECHERCHE_MS = 2500;

let boucle: NodeJS.Timeout | null = null;
let cycleEnCours: Promise<void> | null = null;
let relance: Promise<void> | null = null;
let cycles = 0;
let relie = false;
let derniereSynchro: string | null = null;
let derniereErreur: string | null = null;
let internetPrincipal: { derniereSynchro: string | null; enAttente: number } | null = null;
let echecsConsecutifs = 0;
let derniereRecherche = 0;
let rechercheAuto: (dureeMs: number) => Promise<PostePrincipalTrouve[]> = (dureeMs) => rechercherPostesPrincipaux(dureeMs);

/** Les tests remplacent l'écoute UDP par une liste de postes « trouvés ». */
export function definirRecherchePourLesTests(recherche: ((dureeMs: number) => Promise<PostePrincipalTrouve[]>) | null): void {
  rechercheAuto = recherche ?? ((dureeMs) => rechercherPostesPrincipaux(dureeMs));
}

function cible(config: ConfigCaisse): CibleSynchro {
  return { canal: "reseau", urlBase: `http://${config.adresse}`, enTetes: { Authorization: `Bearer ${config.jeton}` } };
}

async function appelerAvecDelaiCourt(url: string, delaiMs: number, options: RequestInit = {}): Promise<Response> {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), delaiMs);
  try {
    return await fetch(url, { ...options, signal: controleur.signal });
  } finally {
    clearTimeout(minuteur);
  }
}

/** « 192.168.1.10 » → « 192.168.1.10:47800 » ; garde le port s'il est donné. */
export function normaliserAdresse(saisie: string): string {
  const propre = saisie.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return /:\d+$/.test(propre) ? propre : `${propre}:${PORT_RESEAU}`;
}

// --- Trouver le poste principal ---

export interface PostePrincipalTrouve {
  boutiqueId: string;
  boutiqueNom: string;
  nomPoste: string;
  adresse: string;
}

/** Écoute pendant `dureeMs` les annonces des postes principaux du réseau de la boutique. */
export function rechercherPostesPrincipaux(dureeMs = 3000): Promise<PostePrincipalTrouve[]> {
  return new Promise((resoudre) => {
    const trouves = new Map<string, PostePrincipalTrouve>();
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const terminer = () => {
      try {
        socket.close();
      } catch {
        // déjà fermé
      }
      resoudre([...trouves.values()]);
    };
    socket.on("error", terminer);
    socket.on("message", (message, info) => {
      try {
        const annonce = JSON.parse(message.toString("utf-8"));
        if (annonce?.application !== "gestion-stock" || annonce.type !== "poste-principal") return;
        const adresse = `${info.address}:${annonce.port}`;
        trouves.set(adresse, {
          boutiqueId: annonce.boutiqueId,
          boutiqueNom: annonce.boutiqueNom,
          nomPoste: annonce.nomPoste,
          adresse,
        });
      } catch {
        // message d'une autre application : ignoré
      }
    });
    socket.bind(PORT_RESEAU, () => setTimeout(terminer, dureeMs));
  });
}

// --- Se brancher / se débrancher ---

/**
 * Branche cette caisse au poste principal : vérifie qu'il appartient bien à
 * la boutique de la session, échange le code contre un jeton, puis lance la
 * première synchronisation (tout ce que le poste principal a).
 */
export async function seBrancher(params: {
  adresse: string;
  code: string;
  /** Boutique de la session ; absente pour un ordinateur neuf, avant toute connexion (voir rejoindreAvantConnexion). */
  boutiqueId?: string;
  nomAppareil?: string;
}): Promise<EtatReseau> {
  const actuelle = lireConfigReseau();
  if (actuelle.role === "principal") {
    throw new Error("Cet ordinateur est le poste principal : il ne peut pas se brancher sur un autre.");
  }
  if (params.boutiqueId && !reseauAutorise()) throw new Error(MESSAGE_RESEAU_NON_ACTIVE);
  // Sans session (écran de connexion) : un ordinateur neuf adopte la boutique du poste
  // principal ; un ordinateur qui a déjà une boutique ne peut rejoindre que la SIENNE.
  // L'activation du réseau est garantie par le poste principal (il ne sert de caisses que si
  // l'administrateur l'a activée) et le code à 6 chiffres prouve l'autorisation.
  const boutiqueLocale = params.boutiqueId
    ? null
    : (unResultat<{ id: string; nom: string }>("SELECT id, nom FROM boutiques LIMIT 1") ?? null);
  const adresse = normaliserAdresse(params.adresse);
  let presentation: { application?: string; boutiqueId?: string; boutiqueNom?: string; nomPoste?: string };
  try {
    presentation = await (await appelerAvecDelaiCourt(`http://${adresse}/reseau/etat/`, DELAI_PRESENTATION_MS)).json();
  } catch {
    throw new Error(
      `Poste principal introuvable à l'adresse ${adresse}. Vérifiez que cet ordinateur est connecté au même Wi-Fi (ou au même téléphone) que le poste principal, et que celui-ci est allumé.`,
    );
  }
  if (presentation.application !== "gestion-stock") throw new Error(`L'adresse ${adresse} n'est pas un poste principal.`);
  if (boutiqueLocale && presentation.boutiqueId !== boutiqueLocale.id) {
    throw new Error(
      `Ce poste principal appartient à une autre boutique (« ${presentation.boutiqueNom ?? "?"} ») : cet ordinateur est celui de « ${boutiqueLocale.nom} ».`,
    );
  }
  if (params.boutiqueId && presentation.boutiqueId !== params.boutiqueId) {
    throw new Error(`Ce poste principal appartient à une autre boutique (« ${presentation.boutiqueNom ?? "?"} »).`);
  }

  const reponse = await appelerAvecDelaiCourt(`http://${adresse}/reseau/appairer/`, DELAI_PRESENTATION_MS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: params.code.replace(/\s/g, ""), nomAppareil: params.nomAppareil || os.hostname() }),
  });
  const corps = (await reponse.json()) as { detail?: string; jeton?: string; appareilId?: string };
  if (!reponse.ok || !corps.jeton || !corps.appareilId) throw new Error(corps.detail ?? "Branchement refusé.");

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
 * Écran de connexion d'un ordinateur neuf (aucune boutique, aucun compte) : il se
 * branche au poste principal avec le code à 6 chiffres et reçoit tout — boutique,
 * données et comptes des vendeurs — pour qu'on puisse ensuite s'y connecter sans internet.
 */
export async function rejoindreAvantConnexion(params: {
  adresse: string;
  code: string;
  /** Nom vu par le poste principal dans sa liste d'appareils (sinon le nom Windows). */
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

/** Cette caisse redevient un poste seul (ses données restent sur l'ordinateur). */
export function seDebrancher(): EtatReseau {
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
    const defi = randomBytes(32).toString("hex");
    const reponse = await appelerAvecDelaiCourt(`http://${adresse}/reseau/prouver/`, DELAI_PRESENTATION_MS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appareilId: config.appareilId, defi }),
    });
    if (!reponse.ok) return false;
    const { preuve } = (await reponse.json()) as { preuve?: string };
    const empreinte = createHash("sha256").update(config.jeton).digest("hex");
    const attendue = Buffer.from(createHmac("sha256", empreinte).update(defi).digest("hex"), "hex");
    const recue = Buffer.from(String(preuve ?? ""), "hex");
    return recue.length === attendue.length && timingSafeEqual(recue, attendue);
  } catch {
    return false;
  }
}

/**
 * L'adresse du poste principal a pu changer (routeur redémarré, autre
 * téléphone en point d'accès…) : on écoute ses annonces et, si on retrouve le
 * nôtre ailleurs, on garde la nouvelle adresse — sans nouveau code.
 */
async function retrouverPostePrincipal(config: ConfigCaisse): Promise<boolean> {
  const candidats = (await rechercheAuto(DUREE_RECHERCHE_MS)).filter(
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

async function cycle(peutRechercher = true): Promise<void> {
  const config = lireConfigReseau();
  if (config.role !== "caisse") return;
  const c = cible(config);
  try {
    const { curseur } = await synchroniserVers(c, config.boutiqueId, config.appareilId, config.curseur);
    // Relu : un débranchement a pu avoir lieu pendant l'échange.
    const apres = lireConfigReseau();
    if (apres.role === "caisse") ecrireConfigReseau({ ...apres, curseur });

    if (cycles % CYCLES_ENTRE_COMPTES === 0) {
      try {
        const { comptes } = (await (await fetch(`${c.urlBase}/reseau/comptes/`, { headers: c.enTetes })).json()) as {
          comptes: CompteDiffuse[];
        };
        importerComptesDiffuses(comptes ?? []);
      } catch {
        // Les comptes ne sont qu'une commodité : on réessaiera au prochain tour.
      }
    }
    try {
      const presentation = await (await appelerAvecDelaiCourt(`${c.urlBase}/reseau/etat/`, DELAI_PRESENTATION_MS)).json();
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
      : "Poste principal injoignable (éteint, ou cet ordinateur n'est plus sur le même réseau).";
    if (debranchee || !peutRechercher) return;
    echecsConsecutifs++;
    if (echecsConsecutifs >= ECHECS_AVANT_RECHERCHE && Date.now() - derniereRecherche >= INTERVALLE_RECHERCHE_MS) {
      derniereRecherche = Date.now();
      // Retrouvé à une nouvelle adresse : on échange tout de suite.
      if (await retrouverPostePrincipal(config)) await cycle(false);
    }
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

/** Au lancement de l'appli (si cet ordinateur est une caisse) et après le branchement. */
export function demarrerBoucleCaisse(): void {
  if (boucle || lireConfigReseau().role !== "caisse") return;
  void synchroniserAvecPrincipal();
  boucle = setInterval(() => void synchroniserAvecPrincipal(), INTERVALLE_SYNCHRO_RESEAU_MS);
}

export function arreterBoucleCaisse(): void {
  if (boucle) clearInterval(boucle);
  boucle = null;
}

// --- Vérification avant de vendre un article presque en rupture ---

/**
 * Avant de valider une vente sur une caisse reliée : pour chaque article dont
 * le stock local passerait sous son seuil d'alerte (ou sous 0), on demande au
 * poste principal ce qu'il reste vraiment (ventes des autres caisses
 * comprises). Délai de 1,5 s : sans réponse, la vente passe (on ne bloque
 * jamais la caisse) ; s'il n'en reste pas assez, elle est refusée.
 */
export async function verifierStockAvantVente(params: {
  depotId: string;
  lignes: { varianteId: string; quantite: number }[];
}): Promise<void> {
  const config = lireConfigReseau();
  if (config.role !== "caisse" || !relie) return;
  const c = cible(config);
  const quantites = new Map<string, number>();
  for (const l of params.lignes) quantites.set(l.varianteId, (quantites.get(l.varianteId) ?? 0) + l.quantite);

  const aVerifier = [...quantites].filter(([varianteId, quantite]) => {
    const local = unResultat<{ quantite: number; seuil: number }>(
      `SELECT COALESCE(s.quantite, 0) as quantite, COALESCE(v.seuil_alerte, 0) as seuil
       FROM variantes v LEFT JOIN stocks s ON s.variante_id = v.id AND s.depot_id = ?
       WHERE v.id = ?`,
      [params.depotId, varianteId],
    );
    return !local || Number(local.quantite) - quantite < Math.max(Number(local.seuil), 0);
  });

  const manques: string[] = [];
  await Promise.all(
    aVerifier.map(async ([varianteId, quantite]) => {
      try {
        const reponse = await appelerAvecDelaiCourt(
          `${c.urlBase}/reseau/stock/?variante=${encodeURIComponent(varianteId)}&depot=${encodeURIComponent(params.depotId)}`,
          DELAI_VERIFICATION_STOCK_MS,
          { headers: c.enTetes },
        );
        if (!reponse.ok) return;
        const { quantite: restant } = (await reponse.json()) as { quantite: number };
        if (restant < quantite) {
          const nom =
            tousLesResultats<{ nom: string }>(
              "SELECT p.nom FROM variantes v JOIN produits p ON p.id = v.produit_id WHERE v.id = ?",
              [varianteId],
            )[0]?.nom ?? "Article";
          manques.push(`« ${nom} » : il en reste ${Math.max(restant, 0)}`);
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

// --- État pour l'écran et l'indicateur ---

export function etatReseauComplet(): EtatReseau {
  const etat = etatReseau();
  const config = lireConfigReseau();
  if (config.role !== "caisse") return etat;
  return {
    ...etat,
    caisse: {
      nomPostePrincipal: config.nomPostePrincipal,
      adresse: config.adresse,
      relie,
      derniereSynchro,
      erreur: derniereErreur,
      enAttente: compterEnAttente(config.boutiqueId, "reseau").reduce((t, e) => t + e.nombre, 0),
      internetPrincipal,
    },
  };
}
