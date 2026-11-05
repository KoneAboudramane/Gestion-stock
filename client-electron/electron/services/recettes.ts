import { randomUUID } from "node:crypto";

import { dansUneTransaction, executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";

/**
 * Recettes des articles fabriqués (catalogue.LigneRecette + variantes.recette_quantite
 * / recette_frais) : les ingrédients pour un lot de `quantiteLot` articles. À la
 * fabrication (stock.ts::entreeFabrication), les ingrédients sortent du stock du
 * dépôt et le coût de l'article est calculé, jamais saisi. Pas de ligne = pas de recette.
 */

export class ErreurRecette extends Error {}

export interface IngredientRecette {
  ingredientId: string;
  produitNom: string;
  reference: string;
  unite: string;
  /** Quantité pour le lot entier. */
  quantite: number;
  /** Coût moyen actuel de l'ingrédient (CUMP). */
  coutUnitaire: number;
}

export interface Recette {
  varianteId: string;
  quantiteLot: number;
  fraisParUnite: number;
  lignes: IngredientRecette[];
}

export interface ParametresRecette {
  varianteId: string;
  quantiteLot: number;
  fraisParUnite: number;
  lignes: { ingredientId: string; quantite: number }[];
}

/** Coût de revient d'une unité : ingrédients au coût moyen ramenés à l'unité, plus les frais. */
export function coutUnitaireRecette(recette: Recette): number {
  const ingredients = recette.lignes.reduce((t, l) => t + l.quantite * l.coutUnitaire, 0);
  return Math.round(ingredients / recette.quantiteLot + recette.fraisParUnite);
}

/** Quantité de chaque ingrédient pour fabriquer `quantite` articles (règle de trois sur le lot). */
export function besoinsRecette(recette: Recette, quantite: number): Map<string, number> {
  const besoins = new Map<string, number>();
  for (const l of recette.lignes) besoins.set(l.ingredientId, (l.quantite * quantite) / recette.quantiteLot);
  return besoins;
}

function lignesDesRecettes(clause: string, valeurs: string[]): (IngredientRecette & { varianteId: string })[] {
  return tousLesResultats<IngredientRecette & { varianteId: string }>(
    `SELECT lr.variante_id as varianteId, lr.ingredient_id as ingredientId, lr.quantite as quantite,
            p.nom as produitNom, v.reference as reference, v.prix_achat as coutUnitaire,
            COALESCE(u.abreviation, '') as unite
     FROM lignes_recette lr
     JOIN variantes v ON v.id = lr.ingredient_id
     JOIN produits p ON p.id = v.produit_id
     LEFT JOIN unites u ON u.id = p.unite_id
     WHERE lr.supprime = 0 AND ${clause}
     ORDER BY p.nom`,
    valeurs,
  ).map((l) => ({ ...l, quantite: Number(l.quantite), coutUnitaire: Number(l.coutUnitaire) }));
}

function assembler(lignes: (IngredientRecette & { varianteId: string })[]): Recette[] {
  const parVariante = new Map<string, IngredientRecette[]>();
  for (const { varianteId, ...ligne } of lignes) {
    parVariante.set(varianteId, [...(parVariante.get(varianteId) ?? []), ligne]);
  }
  return [...parVariante].map(([varianteId, ingredients]) => {
    const v = unResultat<{ recette_quantite: number; recette_frais: number }>(
      "SELECT recette_quantite, recette_frais FROM variantes WHERE id = ?",
      [varianteId],
    );
    return {
      varianteId,
      quantiteLot: Number(v?.recette_quantite) > 0 ? Number(v?.recette_quantite) : 1,
      fraisParUnite: Number(v?.recette_frais ?? 0),
      lignes: ingredients,
    };
  });
}

export function obtenirRecette(varianteId: string): Recette | null {
  return assembler(lignesDesRecettes("lr.variante_id = ?", [varianteId]))[0] ?? null;
}

/** Toutes les recettes de la boutique (modale Fabrication). */
export function listerRecettes(boutiqueId: string): Recette[] {
  return assembler(
    lignesDesRecettes(
      "lr.variante_id IN (SELECT va.id FROM variantes va JOIN produits pr ON pr.id = va.produit_id WHERE pr.boutique_id = ?)",
      [boutiqueId],
    ),
  );
}

/**
 * Crée ou remplace la recette : les lignes inchangées sont gardées, les autres
 * modifiées, ajoutées ou supprimées (suppression douce, propagée par la synchro).
 */
export function enregistrerRecette(params: ParametresRecette): void {
  const { varianteId, quantiteLot, fraisParUnite, lignes } = params;
  if (!(quantiteLot > 0)) throw new ErreurRecette("Indiquez pour combien d'articles est la recette (lot supérieur à 0).");
  if (!(fraisParUnite >= 0)) throw new ErreurRecette("Les autres frais ne peuvent pas être négatifs.");
  if (lignes.length === 0) throw new ErreurRecette("Ajoutez au moins un ingrédient.");
  if (new Set(lignes.map((l) => l.ingredientId)).size !== lignes.length) {
    throw new ErreurRecette("Un même ingrédient apparaît deux fois.");
  }
  if (lignes.some((l) => l.ingredientId === varianteId)) {
    throw new ErreurRecette("Un article ne peut pas être un ingrédient de sa propre recette.");
  }
  if (lignes.some((l) => !(l.quantite > 0))) throw new ErreurRecette("Chaque quantité d'ingrédient doit être supérieure à 0.");
  for (const l of lignes) {
    // Un ingrédient qui se fabrique avec cet article : la boucle rendrait le coût incalculable.
    const boucle = unResultat<{ n: number }>(
      "SELECT COUNT(*) as n FROM lignes_recette WHERE variante_id = ? AND ingredient_id = ? AND supprime = 0",
      [l.ingredientId, varianteId],
    );
    if (Number(boucle?.n ?? 0) > 0) {
      throw new ErreurRecette("Un ingrédient de cette recette se fabrique déjà avec cet article : recette circulaire.");
    }
  }

  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    executer(
      "UPDATE variantes SET recette_quantite = ?, recette_frais = ?, synchronise = 0, date_modification = ? WHERE id = ?",
      [quantiteLot, fraisParUnite, maintenant, varianteId],
    );
    const existantes = tousLesResultats<{ id: string; ingredient_id: string; quantite: number }>(
      "SELECT id, ingredient_id, quantite FROM lignes_recette WHERE variante_id = ? AND supprime = 0",
      [varianteId],
    );
    for (const e of existantes) {
      const nouvelle = lignes.find((l) => l.ingredientId === e.ingredient_id);
      if (!nouvelle) {
        executer("UPDATE lignes_recette SET supprime = 1, synchronise = 0, date_modification = ? WHERE id = ?", [
          maintenant,
          e.id,
        ]);
      } else if (Number(e.quantite) !== nouvelle.quantite) {
        executer("UPDATE lignes_recette SET quantite = ?, synchronise = 0, date_modification = ? WHERE id = ?", [
          nouvelle.quantite,
          maintenant,
          e.id,
        ]);
      }
    }
    for (const l of lignes.filter((l) => !existantes.some((e) => e.ingredient_id === l.ingredientId))) {
      executer(
        `INSERT INTO lignes_recette (id, variante_id, ingredient_id, quantite, date_creation, date_modification, synchronise, supprime)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
        [randomUUID(), varianteId, l.ingredientId, l.quantite, maintenant, maintenant],
      );
    }
  });
  sauvegarder();
}

export function supprimerRecette(varianteId: string): void {
  executer(
    "UPDATE lignes_recette SET supprime = 1, synchronise = 0, date_modification = ? WHERE variante_id = ? AND supprime = 0",
    [new Date().toISOString(), varianteId],
  );
  sauvegarder();
}
