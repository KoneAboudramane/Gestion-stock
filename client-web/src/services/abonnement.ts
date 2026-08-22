import { obtenirLigne } from "../db/helpers";

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

/** `dateExpirationAbonnement` nulle/vide = illimité (fail-open, jamais bloquant faute de donnée). */
export function venteAutorisee(dateExpirationAbonnement: string | null | undefined, dateEffective: string): boolean {
  if (!dateExpirationAbonnement) return true;
  return dateEffective <= dateExpirationAbonnement;
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

/** Lève ErreurAbonnement si l'abonnement de cette boutique est expiré. */
export async function verifierAbonnementActif(boutiqueId: string): Promise<void> {
  const boutique = await obtenirLigne("boutiques", boutiqueId);
  // Boutique pas encore synchronisée localement : on ne bloque jamais faute de donnée.
  if (!boutique) return;

  const dateEffective = rafraichirDatePlafond();
  if (!venteAutorisee(boutique.date_expiration_abonnement, dateEffective)) {
    throw new ErreurAbonnement(
      "Abonnement expiré. Contactez votre fournisseur pour le renouveler — vous pouvez toujours consulter vos données.",
    );
  }
}
