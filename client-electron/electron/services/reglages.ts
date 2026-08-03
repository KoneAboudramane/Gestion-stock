import { randomUUID } from "node:crypto";

import { executer, unResultat, tousLesResultats } from "../db/helpers";
import { sauvegarder } from "../db/index";

/**
 * Profil boutique (comptes.Boutique) et paramètres (configuration.Parametre) :
 * tous deux ModeleBase déjà synchronisés — traitement 100% local comme le
 * reste du client, la synchro pousse ensuite sans code supplémentaire.
 */

export class ErreurReglages extends Error {}

// --- Profil boutique ---

export interface BoutiqueDetail {
  id: string;
  nom: string;
  adresse: string;
  telephone: string;
  email: string;
  devise: string;
}

export function obtenirBoutique(boutiqueId: string): BoutiqueDetail | undefined {
  return unResultat<BoutiqueDetail>(
    "SELECT id, nom, adresse, telephone, email, devise FROM boutiques WHERE id = ?",
    [boutiqueId],
  );
}

export function modifierBoutique(
  id: string,
  champs: Partial<{ nom: string; adresse: string; telephone: string; email: string; devise: string }>,
): void {
  const colonnes = Object.keys(champs);
  if (colonnes.length === 0) return;
  const maintenant = new Date().toISOString();
  const valeurs = colonnes.map((c) => (champs as Record<string, string>)[c]);
  executer(
    `UPDATE boutiques SET ${colonnes.map((c) => `${c} = ?`).join(", ")}, synchronise = 0, date_modification = ?
     WHERE id = ?`,
    [...valeurs, maintenant, id],
  );
  sauvegarder();
}

// --- Logo boutique (local uniquement, jamais synchronisé — cf. schema.ts) ---

export function obtenirLogoBoutique(boutiqueId: string): string {
  const ligne = unResultat<{ logo: string }>("SELECT logo FROM boutique_logo WHERE boutique_id = ?", [boutiqueId]);
  return ligne?.logo ?? "";
}

export function definirLogoBoutique(boutiqueId: string, logo: string): void {
  executer(
    `INSERT INTO boutique_logo (boutique_id, logo) VALUES (?, ?)
     ON CONFLICT(boutique_id) DO UPDATE SET logo = excluded.logo`,
    [boutiqueId, logo],
  );
  sauvegarder();
}

// --- Paramètres ---

export interface ParametreResume {
  id: string;
  cle: string;
  valeur: string;
}

export function listerParametres(boutiqueId: string): ParametreResume[] {
  return tousLesResultats<ParametreResume>(
    "SELECT id, cle, valeur FROM parametres WHERE boutique_id = ? AND supprime = 0 ORDER BY cle",
    [boutiqueId],
  );
}

/** Upsert respectant unique_together(boutique, cle) côté serveur (configuration.Parametre). */
export function definirParametre(boutiqueId: string, cle: string, valeur: string): void {
  if (!cle.trim()) throw new ErreurReglages("La clé du paramètre est obligatoire.");
  const maintenant = new Date().toISOString();

  const existant = unResultat<{ id: string }>(
    "SELECT id FROM parametres WHERE boutique_id = ? AND cle = ? AND supprime = 0",
    [boutiqueId, cle.trim()],
  );

  if (existant) {
    executer("UPDATE parametres SET valeur = ?, synchronise = 0, date_modification = ? WHERE id = ?", [
      valeur,
      maintenant,
      existant.id,
    ]);
  } else {
    executer(
      `INSERT INTO parametres (id, boutique_id, cle, valeur, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), boutiqueId, cle.trim(), valeur, maintenant, maintenant],
    );
  }
  sauvegarder();
}

export function supprimerParametre(id: string): void {
  const maintenant = new Date().toISOString();
  executer("UPDATE parametres SET supprime = 1, synchronise = 0, date_modification = ? WHERE id = ?", [
    maintenant,
    id,
  ]);
  sauvegarder();
}
