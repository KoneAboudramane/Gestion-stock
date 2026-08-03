import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { unResultat } from "../db/helpers";

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

/** `dateExpirationAbonnement` nulle/vide = illimité (fail-open, jamais bloquant faute de donnée). */
export function venteAutorisee(dateExpirationAbonnement: string | null | undefined, dateEffective: string): boolean {
  if (!dateExpirationAbonnement) return true;
  return dateEffective <= dateExpirationAbonnement;
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

  const dateEffective = rafraichirDatePlafond();
  if (!venteAutorisee(boutique.date_expiration_abonnement, dateEffective)) {
    throw new ErreurAbonnement(
      "Abonnement expiré. Contactez votre fournisseur pour le renouveler — vous pouvez toujours consulter vos données.",
    );
  }
}
