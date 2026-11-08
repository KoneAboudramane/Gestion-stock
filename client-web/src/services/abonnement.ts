import { ecrireLigne, obtenirLigne } from "../db/helpers";
import type { BoutiqueLocale } from "../db/schema";
import { appliquerCodeActivation, dateExpirationParCode, type CodeActivationLu } from "./activation";

/**
 * Port navigateur de client-electron/electron/services/abonnement.ts :
 * vérification de l'abonnement de la boutique, en lecture seule si expiré (la
 * vente est refusée, tout le reste de l'app reste consultable). La date de fin
 * d'abonnement (`boutiques.date_expiration_abonnement`) est fixée côté serveur
 * par l'administrateur et redescend automatiquement via la synchro habituelle
 * — la vérification ici reste donc valable hors-ligne.
 *
 * Anti-triche horloge : une "date plafond" persistée localement (localStorage,
 * équivalent web du fichier userData/abonnement-etat.json d'Electron) ne peut
 * qu'avancer. Si l'horloge système recule, on continue d'utiliser cette date
 * plafond pour la vérification au lieu de faire confiance à l'horloge —
 * reculer l'horloge ne sert donc à rien pour prolonger artificiellement un
 * abonnement expiré. Elle se recale sur la vraie date dès qu'un lancement a
 * lieu avec une horloge qui a normalement avancé (et plus généralement à
 * chaque synchro en ligne, qui rafraîchit aussi la date d'expiration elle-même).
 */

export class ErreurAbonnement extends Error {}

const CLE_DATE_PLAFOND = "gestion-stock:abonnement-plafond";

// --- Fonctions pures (mêmes signatures que côté Electron, mêmes tests possibles) ---

/** Ne peut qu'avancer : si l'horloge a reculé, on garde la date plafond mémorisée. */
export function calculerDatePlafond(plafondStocke: string | null, maintenant: string): string {
  if (!plafondStocke || maintenant > plafondStocke) return maintenant;
  return plafondStocke;
}

/** Après l'expiration, la vente reste permise ce nombre de jours (bandeau rouge), puis elle est bloquée. */
export const DELAI_GRACE_JOURS = 3;
/** Le bandeau « bientôt » apparaît ce nombre de jours avant l'expiration. */
export const PREAVIS_JOURS = 7;

const UN_JOUR = 86_400_000;

export interface EtatAbonnement {
  /** ok : rien à signaler ; bientot : expire dans PREAVIS_JOURS jours au plus ; grace : expiré, vente encore permise ; bloque : vente refusée. */
  niveau: "ok" | "bientot" | "grace" | "bloque";
  dateExpiration: string | null;
  finGrace: string | null;
  /** Jours entiers restants avant l'expiration (0 le dernier jour, négatif une fois expiré). */
  joursRestants: number | null;
  /** Essai gratuit en cours (donné par l'administrateur, à part de l'abonnement payé), sinon null. */
  essai?: EssaiEnCours | null;
}

export interface EssaiEnCours {
  formule: string;
  fin: string;
  /** Ce qui reprend à la fin de l'essai : la formule et la date payées (null = sans limite). */
  formuleApres: string;
  finApres: string | null;
}

/**
 * Essai gratuit (comptes.Boutique.essai_fin côté serveur, même calcul) : gardé à
 * part de l'abonnement payé. Pendant l'essai, sa formule s'applique ; ensuite la
 * boutique retrouve d'elle-même sa formule et sa date payées — aucune écriture,
 * donc valable hors ligne.
 */
export function essaiEnCours(essaiFin: string | null | undefined, dateEffective: string): boolean {
  return !!essaiFin && new Date(essaiFin).getTime() > new Date(dateEffective).getTime();
}

export function formuleEffective(
  ligne: { formule?: string | null; essai_formule?: string | null; essai_fin?: string | null } | undefined,
  dateEffective: string,
): string {
  if (ligne?.essai_formule && essaiEnCours(ligne.essai_fin, dateEffective)) return ligne.essai_formule;
  return ligne?.formule || "essentiel";
}

/** La plus lointaine entre la fin payée et la fin de l'essai (null = sans limite). */
export function finAvecEssai(finPayee: string | null | undefined, essaiFin: string | null | undefined): string | null {
  if (!finPayee) return finPayee ?? null;
  if (!essaiFin) return finPayee;
  return new Date(essaiFin).getTime() > new Date(finPayee).getTime() ? essaiFin : finPayee;
}

/** `dateExpirationAbonnement` nulle/vide = illimité (fail-open, jamais bloquant faute de donnée). */
export function etatAbonnement(dateExpirationAbonnement: string | null | undefined, dateEffective: string): EtatAbonnement {
  if (!dateExpirationAbonnement) return { niveau: "ok", dateExpiration: null, finGrace: null, joursRestants: null };
  const expiration = new Date(dateExpirationAbonnement).getTime();
  const maintenant = new Date(dateEffective).getTime();
  const finGrace = new Date(expiration + DELAI_GRACE_JOURS * UN_JOUR).toISOString();
  // En jours du calendrier (expire le 08 alors qu'on est le 03 : « dans 5 jours », quelle que soit l'heure).
  const minuit = (t: number) => new Date(new Date(t).toDateString()).getTime();
  const joursRestants = Math.round((minuit(expiration) - minuit(maintenant)) / UN_JOUR);
  const niveau =
    maintenant <= expiration
      ? joursRestants <= PREAVIS_JOURS
        ? "bientot"
        : "ok"
      : maintenant <= expiration + DELAI_GRACE_JOURS * UN_JOUR
        ? "grace"
        : "bloque";
  return { niveau, dateExpiration: dateExpirationAbonnement, finGrace, joursRestants };
}

export function venteAutorisee(dateExpirationAbonnement: string | null | undefined, dateEffective: string): boolean {
  return etatAbonnement(dateExpirationAbonnement, dateEffective).niveau !== "bloque";
}

function messageBlocage(etat: EtatAbonnement): string {
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");
  return (
    `Abonnement expiré le ${date(etat.dateExpiration)} (délai de grâce terminé le ${date(etat.finGrace)}) : ` +
    "la vente est bloquée. Renouvelez l'abonnement — vous pouvez toujours consulter vos données."
  );
}

// --- Wrappers localStorage ---

function lireDatePlafond(): string | null {
  return localStorage.getItem(CLE_DATE_PLAFOND);
}

function ecrireDatePlafond(datePlafond: string): void {
  localStorage.setItem(CLE_DATE_PLAFOND, datePlafond);
}

/** À appeler à chaque vérification (pas besoin d'un appel séparé au lancement comme côté Electron, un onglet web peut rester ouvert des jours). */
function rafraichirDatePlafond(): string {
  const plafondStocke = lireDatePlafond();
  const nouveauPlafond = calculerDatePlafond(plafondStocke, new Date().toISOString());
  if (nouveauPlafond !== plafondStocke) ecrireDatePlafond(nouveauPlafond);
  return nouveauPlafond;
}

/**
 * Date de fin retenue : la plus lointaine entre celle du serveur et celle d'un
 * code d'activation saisi (activation.ts). Sans date du serveur (null = sans
 * limite), rien ne la restreint.
 */
export async function dateExpirationEffective(boutiqueId: string, dateServeur: string | null | undefined): Promise<string | null> {
  if (!dateServeur) return dateServeur ?? null;
  const parCode = await dateExpirationParCode(boutiqueId);
  return parCode && new Date(parCode).getTime() > new Date(dateServeur).getTime() ? parCode : dateServeur;
}

/** Saisie d'un code d'activation (sans internet) ; renvoie le nouvel état de l'abonnement. */
export async function activerParCode(boutiqueId: string, code: string): Promise<{ code: CodeActivationLu; etat: EtatAbonnement }> {
  const boutique = await obtenirLigne("boutiques", boutiqueId);
  const lu = await appliquerCodeActivation(
    code,
    boutiqueId,
    await dateExpirationEffective(boutiqueId, boutique?.date_expiration_abonnement),
  );
  return { code: lu, etat: await obtenirEtatAbonnement(boutiqueId) };
}

/**
 * Date du jour « sûre » (ISO) : l'horloge de l'appareil, sauf si elle a reculé
 * (date plafond) — sert aussi aux laissez-passer admin (services/laissezPasser.ts).
 */
export function dateDuJourSure(): string {
  return rafraichirDatePlafond();
}

async function etatAvecEssai(boutiqueId: string, boutique: BoutiqueLocale | undefined): Promise<EtatAbonnement> {
  const dateEffective = rafraichirDatePlafond();
  const finPayee = await dateExpirationEffective(boutiqueId, boutique?.date_expiration_abonnement);
  const etat = etatAbonnement(finAvecEssai(finPayee, boutique?.essai_fin), dateEffective);
  const essai =
    boutique?.essai_fin && boutique.essai_formule && essaiEnCours(boutique.essai_fin, dateEffective)
      ? { formule: boutique.essai_formule, fin: boutique.essai_fin, formuleApres: boutique.formule || "essentiel", finApres: finPayee }
      : null;
  return { ...etat, essai };
}

/** Lève ErreurAbonnement si l'abonnement de cette boutique est expiré. */
export async function verifierAbonnementActif(boutiqueId: string): Promise<void> {
  const boutique = await obtenirLigne("boutiques", boutiqueId);
  // Boutique pas encore synchronisée localement : on ne bloque jamais faute de donnée.
  if (!boutique) return;

  const etat = await etatAvecEssai(boutiqueId, boutique);
  if (etat.niveau === "bloque") throw new ErreurAbonnement(messageBlocage(etat));
}

/** État de l'abonnement pour le bandeau de l'appli (voir components/BandeauAbonnement.tsx). */
export async function obtenirEtatAbonnement(boutiqueId: string): Promise<EtatAbonnement> {
  return etatAvecEssai(boutiqueId, await obtenirLigne("boutiques", boutiqueId));
}

/** Formule qui s'applique maintenant sur cet appareil (celle de l'essai pendant un essai). */
export async function formuleEffectiveBoutique(boutiqueId: string): Promise<string | null> {
  const boutique = await obtenirLigne("boutiques", boutiqueId);
  return boutique ? formuleEffective(boutique, rafraichirDatePlafond()) : null;
}

/** Boutique telle que renvoyée par /auth/moi/ (comptes.BoutiqueSerializer). */
export interface BoutiqueServeur {
  id: string;
  nom: string;
  devise?: string;
  formule: string;
  date_expiration_abonnement: string | null;
  synchro_autorisee: boolean;
  reseau_autorise?: boolean;
  appli_mobile_autorisee?: boolean;
  /** Essai gratuit (absent d'un serveur pas encore à jour : l'essai de l'appareil est gardé). */
  essai_formule?: string;
  essai_fin?: string | null;
}

/**
 * Port de client-electron/electron/services/abonnement.ts::memoriserAbonnementBoutique :
 * formule et échéance lues sur le serveur, écrites sur le poste même sans synchro.
 */
export async function memoriserAbonnementBoutique(boutique: BoutiqueServeur): Promise<void> {
  const existante = await obtenirLigne("boutiques", boutique.id);
  const maintenantIso = new Date().toISOString();
  await ecrireLigne("boutiques", {
    ...(existante ?? {
      id: boutique.id,
      nom: boutique.nom,
      adresse: "",
      telephone: "",
      email: "",
      devise: boutique.devise || "FCFA",
      actif: 1 as const,
      date_creation: maintenantIso,
      date_modification: maintenantIso,
      synchronise: 1,
      supprime: 0,
      date_synchronisation: null,
    }),
    formule: boutique.formule,
    date_expiration_abonnement: boutique.date_expiration_abonnement,
    synchro_autorisee: boutique.synchro_autorisee ? 1 : 0,
    ...(boutique.reseau_autorise !== undefined ? { reseau_autorise: boutique.reseau_autorise ? (1 as const) : (0 as const) } : {}),
    ...(boutique.appli_mobile_autorisee !== undefined
      ? { appli_mobile_autorisee: boutique.appli_mobile_autorisee ? (1 as const) : (0 as const) }
      : {}),
    ...(boutique.essai_fin !== undefined
      ? { essai_fin: boutique.essai_fin, essai_formule: boutique.essai_fin ? boutique.essai_formule || "" : "" }
      : {}),
  });
}
