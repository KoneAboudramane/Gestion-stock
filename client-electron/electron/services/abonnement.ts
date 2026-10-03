import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { executer, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";

/**
 * Vérification de l'abonnement de la boutique, en lecture seule si expiré
 * (la vente est refusée, tout le reste de l'app reste consultable). La date
 * de fin d'abonnement (`boutiques.date_expiration_abonnement`) est fixée côté
 * serveur par l'administrateur (comptes/services.py::approuver_inscription) et
 * redescend automatiquement via la synchro habituelle — la vérification ici
 * reste donc valable hors-ligne.
 *
 * Anti-triche horloge : une "date plafond" persistée localement ne peut
 * qu'avancer. Si l'horloge système recule, on continue d'utiliser cette date
 * plafond pour la vérification au lieu de faire confiance à l'horloge —
 * reculer l'horloge ne sert donc à rien pour prolonger artificiellement un
 * abonnement expiré. Elle se recale sur la vraie date dès qu'un lancement a
 * lieu avec une horloge qui a normalement avancé (et plus généralement à
 * chaque synchro en ligne, qui rafraîchit aussi la date d'expiration elle-même).
 */

export class ErreurAbonnement extends Error {}

// --- Fonctions pures (testées directement) ---

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

// --- Wrappers fichier (non testés unitairement, même principe que sync.ts::cheminEtat) ---

function cheminEtatAbonnement(): string {
  return path.join(app.getPath("userData"), "abonnement-etat.json");
}

function lireDatePlafond(): string | null {
  const chemin = cheminEtatAbonnement();
  if (!fs.existsSync(chemin)) return null;
  try {
    return (JSON.parse(fs.readFileSync(chemin, "utf-8")).datePlafond as string) ?? null;
  } catch {
    return null;
  }
}

function ecrireDatePlafond(datePlafond: string): void {
  fs.writeFileSync(cheminEtatAbonnement(), JSON.stringify({ datePlafond }, null, 2));
}

/** À appeler une fois par lancement de l'app (voir electron/main.ts). */
export function rafraichirDatePlafond(): string {
  const plafondStocke = lireDatePlafond();
  const nouveauPlafond = calculerDatePlafond(plafondStocke, new Date().toISOString());
  if (nouveauPlafond !== plafondStocke) ecrireDatePlafond(nouveauPlafond);
  return nouveauPlafond;
}

/** Lève ErreurAbonnement si l'abonnement de cette boutique est expiré. */
export function verifierAbonnementActif(boutiqueId: string): void {
  const boutique = unResultat<{ date_expiration_abonnement: string | null }>(
    "SELECT date_expiration_abonnement FROM boutiques WHERE id = ?",
    [boutiqueId],
  );
  // Boutique pas encore synchronisée localement : on ne bloque jamais faute de donnée.
  if (!boutique) return;

  const etat = etatAbonnement(boutique.date_expiration_abonnement, rafraichirDatePlafond());
  if (etat.niveau === "bloque") throw new ErreurAbonnement(messageBlocage(etat));
}

/** État de l'abonnement pour le bandeau de l'appli (voir components/BandeauAbonnement.tsx). */
export function obtenirEtatAbonnement(boutiqueId: string): EtatAbonnement {
  const boutique = unResultat<{ date_expiration_abonnement: string | null }>(
    "SELECT date_expiration_abonnement FROM boutiques WHERE id = ?",
    [boutiqueId],
  );
  return etatAbonnement(boutique?.date_expiration_abonnement, rafraichirDatePlafond());
}

/** Boutique telle que renvoyée par /auth/moi/ (comptes.BoutiqueSerializer). */
export interface BoutiqueServeur {
  id: string;
  nom: string;
  devise?: string;
  formule: string;
  date_expiration_abonnement: string | null;
  synchro_autorisee: boolean;
}

/**
 * Formule et échéance lues sur le serveur (à chaque /auth/moi/, voir
 * auth.ts::rafraichirPermissions) et écrites sur le poste : sans ça, une
 * boutique sans synchro ne recevrait jamais sa date de fin (ni bandeau, ni
 * blocage, essai sans limite). Crée la ligne de la boutique si elle manque.
 */
export function memoriserAbonnementBoutique(boutique: BoutiqueServeur): void {
  const maintenant = new Date().toISOString();
  executer(
    `INSERT OR IGNORE INTO boutiques
       (id, nom, adresse, telephone, email, devise, actif, date_expiration_abonnement, formule,
        synchro_autorisee, date_creation, date_modification, synchronise, supprime)
     VALUES (?, ?, '', '', '', ?, 1, ?, ?, ?, ?, ?, 1, 0)`,
    [
      boutique.id,
      boutique.nom,
      boutique.devise || "FCFA",
      boutique.date_expiration_abonnement,
      boutique.formule,
      boutique.synchro_autorisee ? 1 : 0,
      maintenant,
      maintenant,
    ],
  );
  executer("UPDATE boutiques SET formule = ?, date_expiration_abonnement = ?, synchro_autorisee = ? WHERE id = ?", [
    boutique.formule,
    boutique.date_expiration_abonnement,
    boutique.synchro_autorisee ? 1 : 0,
    boutique.id,
  ]);
  sauvegarder();
}
