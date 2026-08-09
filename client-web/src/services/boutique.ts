import { ouvrirBaseDeDonnees } from "../db";
import { ecrireLigne, maintenant, obtenirLigne } from "../db/helpers";
import type { BoutiqueLocale } from "../db/schema";

/**
 * Port navigateur de client-electron/electron/services/reglages.ts (profil
 * boutique uniquement — comptes.Boutique est un ModeleBase déjà synchronisé,
 * traitement 100% local comme le reste du client). Le logo (ImageField,
 * upload multipart, local uniquement côté Electron) n'est pas géré ici,
 * comme documenté dans Reglages.tsx : hors périmètre.
 */

export class ErreurBoutique extends Error {}

/** Lecture locale (IndexedDB) brute des infos boutique — utilisé par FactureVente.tsx. */
export async function obtenirBoutiqueLocale(boutiqueId: string): Promise<BoutiqueLocale | undefined> {
  const db = await ouvrirBaseDeDonnees();
  return db.get("boutiques", boutiqueId);
}

export interface BoutiqueDetail {
  id: string;
  nom: string;
  adresse: string;
  telephone: string;
  email: string;
  devise: string;
}

export async function obtenirBoutique(boutiqueId: string): Promise<BoutiqueDetail | undefined> {
  const boutique = await obtenirLigne("boutiques", boutiqueId);
  if (!boutique) return undefined;
  return { id: boutique.id, nom: boutique.nom, adresse: boutique.adresse, telephone: boutique.telephone, email: boutique.email, devise: boutique.devise };
}

export async function modifierBoutique(
  id: string,
  champs: Partial<{ nom: string; adresse: string; telephone: string; email: string; devise: string }>,
): Promise<void> {
  const boutique = await obtenirLigne("boutiques", id);
  if (!boutique) throw new ErreurBoutique("Boutique introuvable.");
  await ecrireLigne("boutiques", {
    ...boutique,
    nom: champs.nom ?? boutique.nom,
    adresse: champs.adresse ?? boutique.adresse,
    telephone: champs.telephone ?? boutique.telephone,
    email: champs.email ?? boutique.email,
    devise: champs.devise ?? boutique.devise,
    date_modification: maintenant(),
    synchronise: 0,
  });
}
