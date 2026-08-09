import { ouvrirBaseDeDonnees } from "../db";
import { ecrireLigne, listerParIndex, maintenant, suiviSyncNeuf } from "../db/helpers";
import type { ParametreLocal } from "../db/schema";

/**
 * Port navigateur de client-electron/electron/services/reglages.ts (section
 * Paramètres — configuration.Parametre, ModeleBase déjà synchronisé).
 */

export class ErreurConfiguration extends Error {}

export interface ParametreResume {
  id: string;
  cle: string;
  valeur: string;
}

export async function listerParametres(boutiqueId: string): Promise<ParametreResume[]> {
  const parametres = (await listerParIndex("parametres", "boutique_id", boutiqueId)).filter((p) => !p.supprime);
  return parametres.map((p) => ({ id: p.id, cle: p.cle, valeur: p.valeur })).sort((a, b) => a.cle.localeCompare(b.cle));
}

/** Upsert respectant unique_together(boutique, cle) côté serveur (configuration.Parametre). */
export async function definirParametre(boutiqueId: string, cle: string, valeur: string): Promise<void> {
  if (!cle.trim()) throw new ErreurConfiguration("La clé du paramètre est obligatoire.");
  const db = await ouvrirBaseDeDonnees();
  const cleNormalisee = cle.trim();
  const existant = (await db.getAllFromIndex("parametres", "boutique_id", boutiqueId)).find(
    (p) => !p.supprime && p.cle === cleNormalisee,
  );

  if (existant) {
    await ecrireLigne("parametres", { ...existant, valeur, date_modification: maintenant(), synchronise: 0 });
  } else {
    const parametre: ParametreLocal = {
      id: crypto.randomUUID(),
      boutique_id: boutiqueId,
      cle: cleNormalisee,
      valeur,
      ...suiviSyncNeuf(),
    };
    await ecrireLigne("parametres", parametre);
  }
}

export async function supprimerParametre(id: string): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const parametre = await db.get("parametres", id);
  if (!parametre) return;
  await ecrireLigne("parametres", { ...parametre, supprime: 1, synchronise: 0, date_modification: maintenant() });
}
