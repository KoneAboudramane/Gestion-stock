import { ouvrirBaseDeDonnees } from "./index";
import type { GestionStockDB, SuiviSync } from "./schema";

/** Horodatage ISO courant, pour date_creation/date_modification. */
export function maintenant(): string {
  return new Date().toISOString();
}

/** Champs de suivi de synchro pour une ligne fraîchement créée localement (pas encore poussée). */
export function suiviSyncNeuf(): SuiviSync {
  const date = maintenant();
  return { date_creation: date, date_modification: date, synchronise: 0, supprime: 0, date_synchronisation: null };
}

type NomStore = keyof GestionStockDB & string;

// idb typage strictement les noms de store contre l'union GestionStockDB ; un
// paramètre générique T ne se réduit pas automatiquement à cette union du
// point de vue de idb (limite connue de TS sur les génériques + unions), d'où
// le cast ciblé ci-dessous — la signature publique, elle, reste précise.

export async function obtenirLigne<T extends NomStore>(
  store: T,
  id: string,
): Promise<GestionStockDB[T]["value"] | undefined> {
  const db = await ouvrirBaseDeDonnees();
  return db.get(store as never, id);
}

export async function ecrireLigne<T extends NomStore>(store: T, ligne: GestionStockDB[T]["value"]): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  await db.put(store as never, ligne as never);
}

export async function listerParIndex<T extends NomStore>(
  store: T,
  index: string,
  valeur: IDBValidKey,
): Promise<GestionStockDB[T]["value"][]> {
  const db = await ouvrirBaseDeDonnees();
  return db.getAllFromIndex(store as never, index as never, valeur as never);
}

export async function listerTout<T extends NomStore>(store: T): Promise<GestionStockDB[T]["value"][]> {
  const db = await ouvrirBaseDeDonnees();
  return db.getAll(store as never);
}

/**
 * Recalcule stocks.quantite pour une (variante, dépôt) à partir de l'historique
 * de mouvements_stock — miroir de client-electron/electron/services/stock.ts::recalculerStock.
 * "stocks" n'est jamais synchronisé ni marqué non-synchronisé : c'est une vue dérivée, locale.
 * L'id est un vrai UUID aléatoire (généré une fois, réutilisé aux mises à jour),
 * comme côté Electron (SQLite) — jamais la paire variante/dépôt elle-même : ce
 * champ finit parfois en `reference_id` d'une Notification poussée au serveur
 * (UUIDField Django), qui rejetterait un identifiant qui n'a pas cette forme.
 */
export async function recalculerStock(varianteId: string, depotId: string): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const mouvements = await db.getAllFromIndex("mouvements_stock", "variante_depot", [varianteId, depotId]);
  const total = mouvements
    .filter((m) => !m.supprime)
    .reduce((somme, m) => {
      if (m.type === "entree") return somme + m.quantite;
      if (m.type === "sortie") return somme - m.quantite;
      return somme + m.quantite; // ajustement : delta signé fourni tel quel
    }, 0);

  const existant = await db.getFromIndex("stocks", "variante_depot", [varianteId, depotId]);
  const id = existant?.id ?? crypto.randomUUID();
  await db.put("stocks", { id, variante_id: varianteId, depot_id: depotId, quantite: total });
}

export async function obtenirQuantiteStock(varianteId: string, depotId: string): Promise<number> {
  const db = await ouvrirBaseDeDonnees();
  const ligne = await db.getFromIndex("stocks", "variante_depot", [varianteId, depotId]);
  return ligne?.quantite ?? 0;
}
