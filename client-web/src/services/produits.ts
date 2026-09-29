import { ouvrirBaseDeDonnees } from "../db";
import { ecrireLigne, listerParIndex, listerTout, maintenant, obtenirLigne, suiviSyncNeuf } from "../db/helpers";
import type {
  AttributLocal,
  CategorieLocale,
  ProduitLocal,
  UniteLocale,
  ValeurAttributLocal,
  VarianteLocale,
  VarianteValeurLocale,
} from "../db/schema";

/**
 * Port navigateur (local d'abord, IndexedDB) de
 * client-electron/electron/services/produits.ts : un produit simple a
 * toujours au moins une variante par défaut (CLAUDE.md règle 5). Écrit
 * contre la base locale ; la synchro (src/sync) pousse ensuite ces lignes
 * au serveur, sans code supplémentaire ici.
 */

export class ErreurProduit extends Error {}

// --- Référence automatique ---
// Générée seulement si le champ est laissé vide (voir FormulaireProduitsGroupe) :
// REF-000001, REF-000002, ... par boutique, comptée sur toutes les variantes déjà
// créées (y compris supprimées) pour rester unique.
async function genererReferenceProduit(boutiqueId: string): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  const produits = await db.getAllFromIndex("produits", "boutique_id", boutiqueId);
  let compteur = 0;
  for (const produit of produits) {
    compteur += (await db.getAllFromIndex("variantes", "produit_id", produit.id)).length;
  }
  return `REF-${String(compteur + 1).padStart(6, "0")}`;
}

/** Aperçu côté UI de la référence qui sera assignée au prochain produit créé, sans rien écrire. */
export async function prochaineReferenceProduit(boutiqueId: string): Promise<string> {
  return genererReferenceProduit(boutiqueId);
}

async function boutiqueIdDuProduit(produitId: string): Promise<string> {
  const produit = await obtenirLigne("produits", produitId);
  if (!produit) throw new ErreurProduit("Produit introuvable.");
  return produit.boutique_id;
}

// --- Produits ---

export interface ProduitResume {
  id: string;
  nom: string;
  reference: string;
  categorieNom: string;
  prixAchat: number | null;
  prixVente: number | null;
  enStock: boolean;
  actif: boolean;
  /** Toutes variantes et tous dépôts confondus. */
  quantiteStock: number;
  /** Seuil d'alerte de la variante par défaut. */
  seuilAlerte: number;
  /** Stock valorisé au prix d'achat de chaque variante. */
  valeurStock: number;
}

export async function listerProduits(boutiqueId: string, terme = ""): Promise<ProduitResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime);
  const categories = new Map((await listerParIndex("categories", "boutique_id", boutiqueId)).map((c) => [c.id, c.nom]));
  const stocks = await listerTout("stocks");

  const motif = terme.trim().toLowerCase();
  const resultat: ProduitResume[] = [];
  for (const produit of produits) {
    if (motif && !produit.nom.toLowerCase().includes(motif)) continue;
    const variantes = (await db.getAllFromIndex("variantes", "produit_id", produit.id)).filter((v) => !v.supprime);
    const varianteDefaut = variantes[0];
    const idsVariantes = new Set(variantes.map((v) => v.id));
    const enStock = stocks.some((s) => idsVariantes.has(s.variante_id) && s.quantite > 0);
    const prixAchatParVariante = new Map(variantes.map((v) => [v.id, v.prix_achat ?? 0]));
    const stocksProduit = stocks.filter((s) => idsVariantes.has(s.variante_id));
    resultat.push({
      id: produit.id,
      nom: produit.nom,
      reference: varianteDefaut?.reference ?? "",
      categorieNom: produit.categorie_id ? (categories.get(produit.categorie_id) ?? "") : "",
      prixAchat: varianteDefaut?.prix_achat ?? null,
      prixVente: varianteDefaut?.prix_vente ?? null,
      enStock,
      actif: !!produit.actif,
      quantiteStock: stocksProduit.reduce((t, s) => t + s.quantite, 0),
      seuilAlerte: varianteDefaut?.seuil_alerte ?? 0,
      valeurStock: stocksProduit.reduce((t, s) => t + s.quantite * (prixAchatParVariante.get(s.variante_id) ?? 0), 0),
    });
  }
  return resultat.sort((a, b) => a.nom.localeCompare(b.nom)).slice(0, 200);
}

export interface VarianteResume {
  id: string;
  produitId: string;
  reference: string;
  codeBarres: string;
  prixAchat: number | null;
  prixVente: number;
  seuilAlerte: number;
  actif: boolean;
  quantiteStock: number;
  valeurs: string[];
}

async function valeursDeVariante(varianteId: string): Promise<string[]> {
  const liaisons = (await listerParIndex("variante_valeurs", "variante_id", varianteId)).filter((l) => !l.supprime);
  const libelles: string[] = [];
  for (const liaison of liaisons) {
    const valeurAttribut = await obtenirLigne("valeurs_attribut", liaison.valeur_attribut_id);
    if (!valeurAttribut) continue;
    const attribut = await obtenirLigne("attributs", valeurAttribut.attribut_id);
    libelles.push(`${attribut?.nom ?? ""}: ${valeurAttribut.valeur}`);
  }
  return libelles;
}

export interface ProduitDetail {
  id: string;
  nom: string;
  categorieId: string | null;
  categorieNom: string;
  uniteId: string | null;
  uniteNom: string;
  description: string;
  actif: boolean;
  variantes: VarianteResume[];
}

export async function obtenirProduit(id: string): Promise<ProduitDetail | undefined> {
  const produit = await obtenirLigne("produits", id);
  if (!produit || produit.supprime) return undefined;

  const categorie = produit.categorie_id ? await obtenirLigne("categories", produit.categorie_id) : undefined;
  const unite = produit.unite_id ? await obtenirLigne("unites", produit.unite_id) : undefined;
  const variantesLocales = (await listerParIndex("variantes", "produit_id", id))
    .filter((v) => !v.supprime)
    .sort((a, b) => a.date_creation.localeCompare(b.date_creation));
  const stocks = await listerTout("stocks");

  const variantes: VarianteResume[] = [];
  for (const v of variantesLocales) {
    const quantiteStock = stocks.filter((s) => s.variante_id === v.id).reduce((somme, s) => somme + s.quantite, 0);
    variantes.push({
      id: v.id,
      produitId: v.produit_id,
      reference: v.reference,
      codeBarres: v.code_barres,
      prixAchat: v.prix_achat,
      prixVente: v.prix_vente,
      seuilAlerte: v.seuil_alerte,
      actif: !!v.actif,
      quantiteStock,
      valeurs: await valeursDeVariante(v.id),
    });
  }

  return {
    id: produit.id,
    nom: produit.nom,
    categorieId: produit.categorie_id,
    categorieNom: categorie?.nom ?? "",
    uniteId: produit.unite_id,
    uniteNom: unite?.nom ?? "",
    description: produit.description,
    actif: !!produit.actif,
    variantes,
  };
}

export interface CreerProduitEntree {
  boutiqueId: string;
  nom: string;
  categorieId?: string | null;
  uniteId?: string | null;
  description?: string;
  reference?: string;
  codeBarres?: string;
  prixAchat?: number;
  prixVente?: number;
  seuilAlerte?: number;
}

export interface ProduitCree {
  id: string;
  varianteId: string;
}

export async function creerProduit(entree: CreerProduitEntree): Promise<ProduitCree> {
  const {
    boutiqueId,
    nom,
    categorieId = null,
    uniteId = null,
    description = "",
    reference = "",
    codeBarres = "",
    prixAchat = 0,
    prixVente = 0,
    seuilAlerte = 0,
  } = entree;

  if (!nom.trim()) throw new ErreurProduit("Le nom du produit est requis.");

  const produitId = crypto.randomUUID();
  const produit: ProduitLocal = {
    id: produitId,
    boutique_id: boutiqueId,
    nom,
    categorie_id: categorieId,
    unite_id: uniteId,
    description,
    actif: 1,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("produits", produit);

  const varianteId = crypto.randomUUID();
  const referenceFinale = reference.trim() || (await genererReferenceProduit(boutiqueId));
  const variante: VarianteLocale = {
    id: varianteId,
    produit_id: produitId,
    reference: referenceFinale,
    code_barres: codeBarres,
    prix_achat: prixAchat,
    prix_vente: prixVente,
    seuil_alerte: seuilAlerte,
    actif: 1,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("variantes", variante);

  return { id: produitId, varianteId };
}

export interface ModifierProduitEntree {
  nom?: string;
  categorieId?: string | null;
  uniteId?: string | null;
  description?: string;
  actif?: boolean;
}

export async function modifierProduit(id: string, champs: ModifierProduitEntree): Promise<void> {
  const produit = await obtenirLigne("produits", id);
  if (!produit) throw new ErreurProduit("Produit introuvable.");
  await ecrireLigne("produits", {
    ...produit,
    nom: champs.nom ?? produit.nom,
    categorie_id: champs.categorieId !== undefined ? champs.categorieId : produit.categorie_id,
    unite_id: champs.uniteId !== undefined ? champs.uniteId : produit.unite_id,
    description: champs.description ?? produit.description,
    actif: champs.actif !== undefined ? (champs.actif ? 1 : 0) : produit.actif,
    date_modification: maintenant(),
    synchronise: 0,
  });
}

export async function supprimerProduit(id: string): Promise<void> {
  const produit = await obtenirLigne("produits", id);
  if (!produit) return;
  const heure = maintenant();
  await ecrireLigne("produits", { ...produit, supprime: 1, synchronise: 0, date_modification: heure });
  const variantes = await listerParIndex("variantes", "produit_id", id);
  for (const v of variantes) {
    if (v.supprime) continue;
    await ecrireLigne("variantes", { ...v, supprime: 1, synchronise: 0, date_modification: heure });
  }
}

// --- Variantes ---

async function remplacerValeursVariante(varianteId: string, valeurAttributIds: string[], heure: string): Promise<void> {
  const anciennes = (await listerParIndex("variante_valeurs", "variante_id", varianteId)).filter((l) => !l.supprime);
  for (const ancienne of anciennes) {
    await ecrireLigne("variante_valeurs", { ...ancienne, supprime: 1, synchronise: 0, date_modification: heure });
  }
  for (const valeurAttributId of valeurAttributIds) {
    const liaison: VarianteValeurLocale = {
      id: crypto.randomUUID(),
      variante_id: varianteId,
      valeur_attribut_id: valeurAttributId,
      ...suiviSyncNeuf(),
    };
    await ecrireLigne("variante_valeurs", liaison);
  }
}

export interface CreerVarianteEntree {
  produitId: string;
  reference?: string;
  codeBarres?: string;
  prixAchat?: number;
  prixVente?: number;
  seuilAlerte?: number;
  valeurAttributIds?: string[];
}

export async function creerVariante(entree: CreerVarianteEntree): Promise<string> {
  const {
    produitId,
    reference = "",
    codeBarres = "",
    prixAchat = 0,
    prixVente = 0,
    seuilAlerte = 0,
    valeurAttributIds = [],
  } = entree;

  const heure = maintenant();
  const id = crypto.randomUUID();
  const referenceFinale = reference.trim() || (await genererReferenceProduit(await boutiqueIdDuProduit(produitId)));
  const variante: VarianteLocale = {
    id,
    produit_id: produitId,
    reference: referenceFinale,
    code_barres: codeBarres,
    prix_achat: prixAchat,
    prix_vente: prixVente,
    seuil_alerte: seuilAlerte,
    actif: 1,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("variantes", variante);
  await remplacerValeursVariante(id, valeurAttributIds, heure);
  return id;
}

export interface ModifierVarianteEntree {
  reference?: string;
  codeBarres?: string;
  prixAchat?: number;
  prixVente?: number;
  seuilAlerte?: number;
  actif?: boolean;
  valeurAttributIds?: string[];
}

export async function modifierVariante(id: string, champs: ModifierVarianteEntree): Promise<void> {
  const variante = await obtenirLigne("variantes", id);
  if (!variante) throw new ErreurProduit("Variante introuvable.");
  const heure = maintenant();
  await ecrireLigne("variantes", {
    ...variante,
    reference: champs.reference ?? variante.reference,
    code_barres: champs.codeBarres ?? variante.code_barres,
    prix_achat: champs.prixAchat ?? variante.prix_achat,
    prix_vente: champs.prixVente ?? variante.prix_vente,
    seuil_alerte: champs.seuilAlerte ?? variante.seuil_alerte,
    actif: champs.actif !== undefined ? (champs.actif ? 1 : 0) : variante.actif,
    date_modification: heure,
    synchronise: 0,
  });
  if (champs.valeurAttributIds !== undefined) {
    await remplacerValeursVariante(id, champs.valeurAttributIds, heure);
  }
}

// --- Réglages catalogue : catégories, unités, attributs ---

export interface ReferenceNommee {
  id: string;
  nom: string;
}

export interface CategorieDetail {
  id: string;
  nom: string;
  /** Articles (produits non supprimés) rangés dans cette catégorie. */
  nombreArticles: number;
}

export interface ArticleCategorie {
  varianteId: string;
  produitId: string;
  produitNom: string;
  reference: string;
  prixVente: number;
  /** Stock total, tous dépôts confondus. */
  quantiteStock: number;
  /** Catégorie de l'article (null = sans catégorie). */
  categorieId: string | null;
  prixAchat: number;
  seuilAlerte: number;
}

/** Nom de catégorie comparable : sans accents, sans majuscules, sans espaces autour. */
function cleNomCategorie(nom: string): string {
  return nom
    .trim()
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export async function listerCategories(boutiqueId: string): Promise<ReferenceNommee[]> {
  const categories = (await listerParIndex("categories", "boutique_id", boutiqueId)).filter((c) => !c.supprime);
  return categories.map((c) => ({ id: c.id, nom: c.nom })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

async function produitsDeLaCategorie(boutiqueId: string, categorieId: string) {
  return (await listerParIndex("produits", "boutique_id", boutiqueId)).filter(
    (p) => !p.supprime && p.categorie_id === categorieId,
  );
}

export async function listerCategoriesDetail(boutiqueId: string): Promise<CategorieDetail[]> {
  const categories = await listerCategories(boutiqueId);
  const produits = (await listerParIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime);
  return categories.map((c) => ({
    ...c,
    nombreArticles: produits.filter((p) => p.categorie_id === c.id).length,
  }));
}

async function verifierNomCategorieLibre(boutiqueId: string, nom: string, saufId?: string): Promise<void> {
  if (!nom.trim()) throw new ErreurProduit("Le nom de la catégorie est requis.");
  const cle = cleNomCategorie(nom);
  if ((await listerCategories(boutiqueId)).some((c) => c.id !== saufId && cleNomCategorie(c.nom) === cle)) {
    throw new ErreurProduit(`La catégorie « ${nom.trim()} » existe déjà.`);
  }
}

export async function creerCategorie(boutiqueId: string, nom: string): Promise<string> {
  await verifierNomCategorieLibre(boutiqueId, nom);
  const id = crypto.randomUUID();
  const categorie: CategorieLocale = {
    id,
    boutique_id: boutiqueId,
    nom: nom.trim(),
    categorie_parent_id: null,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("categories", categorie);
  return id;
}

export async function modifierCategorie(id: string, nom: string): Promise<void> {
  const categorie = await obtenirLigne("categories", id);
  if (!categorie) throw new ErreurProduit("Catégorie introuvable.");
  await verifierNomCategorieLibre(categorie.boutique_id, nom, id);
  await ecrireLigne("categories", { ...categorie, nom: nom.trim(), date_modification: maintenant(), synchronise: 0 });
}

/**
 * Supprime une catégorie. Si des articles y sont encore rangés, il faut dire où
 * les déplacer : `remplacementId` (une autre catégorie, ou null = sans catégorie).
 * Sans ce choix, la suppression est refusée — pour ne pas laisser d'articles orphelins.
 */
export async function supprimerCategorie(id: string, remplacementId?: string | null): Promise<void> {
  const categorie = await obtenirLigne("categories", id);
  if (!categorie) return;
  const produits = await produitsDeLaCategorie(categorie.boutique_id, id);
  if (produits.length > 0 && remplacementId === undefined) {
    throw new ErreurProduit(
      `${produits.length} article(s) sont encore dans cette catégorie : choisissez où les déplacer avant de la supprimer.`,
    );
  }
  if (remplacementId === id) throw new ErreurProduit("Choisissez une autre catégorie.");
  const date = maintenant();
  for (const produit of produits) {
    await ecrireLigne("produits", { ...produit, categorie_id: remplacementId ?? null, date_modification: date, synchronise: 0 });
  }
  await ecrireLigne("categories", { ...categorie, supprime: 1, synchronise: 0, date_modification: date });
}

export async function listerArticlesCategorie(categorieId: string): Promise<ArticleCategorie[]> {
  const categorie = await obtenirLigne("categories", categorieId);
  if (!categorie) return [];
  return articlesDe(await produitsDeLaCategorie(categorie.boutique_id, categorieId));
}

/** Tous les articles de la boutique avec leur catégorie : chiffres par catégorie et « Sans catégorie ». */
export async function listerArticlesBoutique(boutiqueId: string): Promise<ArticleCategorie[]> {
  return articlesDe((await listerParIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime));
}

async function articlesDe(produits: ProduitLocal[]): Promise<ArticleCategorie[]> {
  const stocks = await listerTout("stocks");
  const resultat: ArticleCategorie[] = [];
  for (const produit of produits) {
    const variantes = (await listerParIndex("variantes", "produit_id", produit.id)).filter((v) => !v.supprime);
    for (const v of variantes) {
      resultat.push({
        varianteId: v.id,
        produitId: produit.id,
        produitNom: produit.nom,
        reference: v.reference,
        prixVente: Number(v.prix_vente),
        quantiteStock: stocks.filter((s) => s.variante_id === v.id).reduce((t, s) => t + Number(s.quantite), 0),
        categorieId: produit.categorie_id ?? null,
        prixAchat: Number(v.prix_achat ?? 0),
        seuilAlerte: Number(v.seuil_alerte ?? 0),
      });
    }
  }
  return resultat.sort(
    (a, b) => a.produitNom.localeCompare(b.produitNom, "fr") || a.reference.localeCompare(b.reference, "fr"),
  );
}

export interface UniteResume extends ReferenceNommee {
  abreviation: string;
}

export async function listerUnites(boutiqueId: string): Promise<UniteResume[]> {
  const unites = (await listerParIndex("unites", "boutique_id", boutiqueId)).filter((u) => !u.supprime);
  return unites.map((u) => ({ id: u.id, nom: u.nom, abreviation: u.abreviation })).sort((a, b) => a.nom.localeCompare(b.nom));
}

export async function creerUnite(boutiqueId: string, nom: string, abreviation = ""): Promise<string> {
  const id = crypto.randomUUID();
  const unite: UniteLocale = { id, boutique_id: boutiqueId, nom, abreviation, ...suiviSyncNeuf() };
  await ecrireLigne("unites", unite);
  return id;
}

export async function modifierUnite(id: string, champs: Partial<{ nom: string; abreviation: string }>): Promise<void> {
  const unite = await obtenirLigne("unites", id);
  if (!unite) throw new ErreurProduit("Unité introuvable.");
  await ecrireLigne("unites", {
    ...unite,
    nom: champs.nom ?? unite.nom,
    abreviation: champs.abreviation ?? unite.abreviation,
    date_modification: maintenant(),
    synchronise: 0,
  });
}

export async function supprimerUnite(id: string): Promise<void> {
  const unite = await obtenirLigne("unites", id);
  if (!unite) return;
  await ecrireLigne("unites", { ...unite, supprime: 1, synchronise: 0, date_modification: maintenant() });
}

export async function listerAttributs(boutiqueId: string): Promise<ReferenceNommee[]> {
  const attributs = (await listerParIndex("attributs", "boutique_id", boutiqueId)).filter((a) => !a.supprime);
  return attributs.map((a) => ({ id: a.id, nom: a.nom })).sort((a, b) => a.nom.localeCompare(b.nom));
}

export async function creerAttribut(boutiqueId: string, nom: string): Promise<string> {
  const id = crypto.randomUUID();
  const attribut: AttributLocal = { id, boutique_id: boutiqueId, nom, ...suiviSyncNeuf() };
  await ecrireLigne("attributs", attribut);
  return id;
}

export async function modifierAttribut(id: string, nom: string): Promise<void> {
  const attribut = await obtenirLigne("attributs", id);
  if (!attribut) throw new ErreurProduit("Attribut introuvable.");
  await ecrireLigne("attributs", { ...attribut, nom, date_modification: maintenant(), synchronise: 0 });
}

export async function supprimerAttribut(id: string): Promise<void> {
  const attribut = await obtenirLigne("attributs", id);
  if (!attribut) return;
  await ecrireLigne("attributs", { ...attribut, supprime: 1, synchronise: 0, date_modification: maintenant() });
}

export interface ValeurAttributResume {
  id: string;
  valeur: string;
  attributId: string;
}

export async function listerValeursAttribut(attributId: string): Promise<ValeurAttributResume[]> {
  const valeurs = (await listerParIndex("valeurs_attribut", "attribut_id", attributId)).filter((v) => !v.supprime);
  return valeurs
    .map((v) => ({ id: v.id, valeur: v.valeur, attributId: v.attribut_id }))
    .sort((a, b) => a.valeur.localeCompare(b.valeur));
}

export async function creerValeurAttribut(attributId: string, valeur: string): Promise<string> {
  const id = crypto.randomUUID();
  const valeurAttribut: ValeurAttributLocal = { id, attribut_id: attributId, valeur, ...suiviSyncNeuf() };
  await ecrireLigne("valeurs_attribut", valeurAttribut);
  return id;
}

export async function modifierValeurAttribut(id: string, valeur: string): Promise<void> {
  if (!valeur.trim()) throw new ErreurProduit("La valeur est requise.");
  const ligne = await obtenirLigne("valeurs_attribut", id);
  if (!ligne) throw new ErreurProduit("Valeur introuvable.");
  await ecrireLigne("valeurs_attribut", { ...ligne, valeur: valeur.trim(), synchronise: 0, date_modification: new Date().toISOString() });
}

/** Une valeur portée par des variantes d'articles ne se supprime pas (elle disparaîtrait des fiches). */
export async function supprimerValeurAttribut(id: string): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const produits = new Set<string>();
  for (const vv of await db.getAll("variante_valeurs")) {
    if (vv.supprime || vv.valeur_attribut_id !== id) continue;
    const variante = await db.get("variantes", vv.variante_id);
    if (!variante || variante.supprime) continue;
    const produit = await db.get("produits", variante.produit_id);
    if (produit && !produit.supprime) produits.add(produit.id);
  }
  if (produits.size > 0) {
    throw new ErreurProduit(`Cette valeur est utilisée par ${produits.size} article(s) : modifiez d'abord leurs variantes.`);
  }
  const ligne = await obtenirLigne("valeurs_attribut", id);
  if (!ligne) return;
  await ecrireLigne("valeurs_attribut", { ...ligne, supprime: 1, synchronise: 0, date_modification: new Date().toISOString() });
}

/** Nombre d'articles qui utilisent chaque unité / chaque attribut (Réglages → Paramètres). */
export interface UsagesCatalogue {
  unites: Record<string, number>;
  attributs: Record<string, number>;
}

export async function usagesCatalogue(boutiqueId: string): Promise<UsagesCatalogue> {
  const db = await ouvrirBaseDeDonnees();
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime);
  const unites: Record<string, number> = {};
  for (const p of produits) if (p.unite_id) unites[p.unite_id] = (unites[p.unite_id] ?? 0) + 1;
  const idsProduits = new Set(produits.map((p) => p.id));
  const variantes = new Map((await db.getAll("variantes")).filter((v) => !v.supprime && idsProduits.has(v.produit_id)).map((v) => [v.id, v]));
  const valeurs = new Map((await db.getAll("valeurs_attribut")).map((v) => [v.id, v]));
  const parAttribut = new Map<string, Set<string>>();
  for (const vv of await db.getAll("variante_valeurs")) {
    if (vv.supprime) continue;
    const variante = variantes.get(vv.variante_id);
    const valeur = valeurs.get(vv.valeur_attribut_id);
    if (!variante || !valeur) continue;
    const ensemble = parAttribut.get(valeur.attribut_id) ?? new Set<string>();
    ensemble.add(variante.produit_id);
    parAttribut.set(valeur.attribut_id, ensemble);
  }
  const attributs: Record<string, number> = {};
  for (const [id, ensemble] of parAttribut) attributs[id] = ensemble.size;
  return { unites, attributs };
}
