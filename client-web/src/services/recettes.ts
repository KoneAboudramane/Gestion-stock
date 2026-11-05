import { ouvrirBaseDeDonnees } from "../db";
import { ecrireLigne, listerParIndex, maintenant, obtenirLigne, suiviSyncNeuf } from "../db/helpers";

/**
 * Port navigateur de client-electron/electron/services/recettes.ts : recettes
 * des articles fabriqués (lignes_recette + variantes.recette_quantite /
 * recette_frais), les ingrédients pour un lot de `quantiteLot` articles. À la
 * fabrication (stock.ts::entreeFabrication), les ingrédients sortent du stock
 * du dépôt et le coût de l'article est calculé. Pas de ligne = pas de recette.
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

export async function obtenirRecette(varianteId: string): Promise<Recette | null> {
  const lignes = (await listerParIndex("lignes_recette", "variante_id", varianteId)).filter((l) => !l.supprime);
  if (lignes.length === 0) return null;
  const variante = await obtenirLigne("variantes", varianteId);
  const ingredients: IngredientRecette[] = [];
  for (const l of lignes) {
    const ingredient = await obtenirLigne("variantes", l.ingredient_id);
    const produit = ingredient ? await obtenirLigne("produits", ingredient.produit_id) : undefined;
    const unite = produit?.unite_id ? await obtenirLigne("unites", produit.unite_id) : undefined;
    ingredients.push({
      ingredientId: l.ingredient_id,
      produitNom: produit?.nom ?? "Article",
      reference: ingredient?.reference ?? "",
      unite: unite?.abreviation ?? "",
      quantite: Number(l.quantite),
      coutUnitaire: Number(ingredient?.prix_achat ?? 0),
    });
  }
  return {
    varianteId,
    quantiteLot: Number(variante?.recette_quantite) > 0 ? Number(variante?.recette_quantite) : 1,
    fraisParUnite: Number(variante?.recette_frais ?? 0),
    lignes: ingredients.sort((a, b) => a.produitNom.localeCompare(b.produitNom, "fr")),
  };
}

/** Toutes les recettes de la boutique (modale Fabrication). */
export async function listerRecettes(boutiqueId: string): Promise<Recette[]> {
  const db = await ouvrirBaseDeDonnees();
  const produits = new Set(
    (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime).map((p) => p.id),
  );
  const varianteIds = new Set<string>();
  for (const l of await db.getAll("lignes_recette")) {
    if (l.supprime) continue;
    const variante = await obtenirLigne("variantes", l.variante_id);
    if (variante && produits.has(variante.produit_id)) varianteIds.add(l.variante_id);
  }
  const recettes: Recette[] = [];
  for (const id of varianteIds) {
    const recette = await obtenirRecette(id);
    if (recette) recettes.push(recette);
  }
  return recettes;
}

/**
 * Crée ou remplace la recette : les lignes inchangées sont gardées, les autres
 * modifiées, ajoutées ou supprimées (suppression douce, propagée par la synchro).
 */
export async function enregistrerRecette(params: ParametresRecette): Promise<void> {
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
    const sesIngredients = await listerParIndex("lignes_recette", "variante_id", l.ingredientId);
    if (sesIngredients.some((s) => !s.supprime && s.ingredient_id === varianteId)) {
      throw new ErreurRecette("Un ingrédient de cette recette se fabrique déjà avec cet article : recette circulaire.");
    }
  }
  const variante = await obtenirLigne("variantes", varianteId);
  if (!variante) throw new ErreurRecette("Article introuvable.");

  const date = maintenant();
  await ecrireLigne("variantes", {
    ...variante,
    recette_quantite: quantiteLot,
    recette_frais: fraisParUnite,
    synchronise: 0,
    date_modification: date,
  });
  const existantes = (await listerParIndex("lignes_recette", "variante_id", varianteId)).filter((l) => !l.supprime);
  for (const e of existantes) {
    const nouvelle = lignes.find((l) => l.ingredientId === e.ingredient_id);
    if (!nouvelle) {
      await ecrireLigne("lignes_recette", { ...e, supprime: 1, synchronise: 0, date_modification: date });
    } else if (Number(e.quantite) !== nouvelle.quantite) {
      await ecrireLigne("lignes_recette", { ...e, quantite: nouvelle.quantite, synchronise: 0, date_modification: date });
    }
  }
  for (const l of lignes.filter((l) => !existantes.some((e) => e.ingredient_id === l.ingredientId))) {
    await ecrireLigne("lignes_recette", {
      id: crypto.randomUUID(),
      variante_id: varianteId,
      ingredient_id: l.ingredientId,
      quantite: l.quantite,
      ...suiviSyncNeuf(),
    });
  }
}

export async function supprimerRecette(varianteId: string): Promise<void> {
  const date = maintenant();
  for (const l of await listerParIndex("lignes_recette", "variante_id", varianteId)) {
    if (!l.supprime) await ecrireLigne("lignes_recette", { ...l, supprime: 1, synchronise: 0, date_modification: date });
  }
}
