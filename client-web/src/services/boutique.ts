import { ouvrirBaseDeDonnees } from "../db";
import type { BoutiqueLocale } from "../db/schema";

/** Lecture locale (IndexedDB) des infos boutique — contrairement à api/boutique.ts::obtenirBoutique, fonctionne hors-ligne. */
export async function obtenirBoutiqueLocale(boutiqueId: string): Promise<BoutiqueLocale | undefined> {
  const db = await ouvrirBaseDeDonnees();
  return db.get("boutiques", boutiqueId);
}
