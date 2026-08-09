import { listerStock } from "./stock";
import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

/**
 * Catalogue (Produits/Catégories/Unités/Variantes), en ligne uniquement — contrairement
 * à la Caisse, la gestion du catalogue n'est pas jugée bloquante hors-ligne (voir
 * client-web/src/pages/Produits.tsx). Même esprit que stock.ts/rapports.ts : appels
 * REST directs vers les endpoints déjà utilisés par client-electron, pas de miroir IndexedDB.
 */

// --- Catégories ---

export interface CategorieResume {
  id: string;
  nom: string;
  categorieParentId: string | null;
}

interface CategorieBrute {
  id: string;
  nom: string;
  categorie_parent: string | null;
}

function versCategorie(b: CategorieBrute): CategorieResume {
  return { id: b.id, nom: b.nom, categorieParentId: b.categorie_parent };
}

export function listerCategories(): Promise<ResultatEcriture<CategorieResume[]>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/categories/");
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brutes: CategorieBrute[] = await reponse.json();
    return brutes.map(versCategorie);
  });
}

export function creerCategorie(nom: string): Promise<ResultatEcriture<CategorieResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/categories/", { method: "POST", body: JSON.stringify({ nom }) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return versCategorie(await reponse.json());
  });
}

export function modifierCategorie(id: string, nom: string): Promise<ResultatEcriture<CategorieResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/categories/${id}/`, { method: "PATCH", body: JSON.stringify({ nom }) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return versCategorie(await reponse.json());
  });
}

export function supprimerCategorie(id: string): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/categories/${id}/`, { method: "DELETE" });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

// --- Unités ---

export interface UniteResume {
  id: string;
  nom: string;
  abreviation: string;
}

export function listerUnites(): Promise<ResultatEcriture<UniteResume[]>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/unites/");
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function creerUnite(nom: string, abreviation: string): Promise<ResultatEcriture<UniteResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/unites/", { method: "POST", body: JSON.stringify({ nom, abreviation }) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export interface ModifierUniteEntree {
  nom?: string;
  abreviation?: string;
}

export function modifierUnite(id: string, entree: ModifierUniteEntree): Promise<ResultatEcriture<UniteResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/unites/${id}/`, { method: "PATCH", body: JSON.stringify(entree) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function supprimerUnite(id: string): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/unites/${id}/`, { method: "DELETE" });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

// --- Attributs ---

export interface AttributResume {
  id: string;
  nom: string;
}

export function listerAttributs(): Promise<ResultatEcriture<AttributResume[]>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/attributs/");
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function creerAttribut(nom: string): Promise<ResultatEcriture<AttributResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/attributs/", { method: "POST", body: JSON.stringify({ nom }) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function modifierAttribut(id: string, nom: string): Promise<ResultatEcriture<AttributResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/attributs/${id}/`, { method: "PATCH", body: JSON.stringify({ nom }) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function supprimerAttribut(id: string): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/attributs/${id}/`, { method: "DELETE" });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

// --- Variantes ---

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
}

interface VarianteBrute {
  id: string;
  produit: string;
  reference: string;
  code_barres: string;
  prix_achat?: string;
  prix_vente: string;
  seuil_alerte: string;
  actif: boolean;
}

function versVariante(b: VarianteBrute): VarianteResume {
  return {
    id: b.id,
    produitId: b.produit,
    reference: b.reference,
    codeBarres: b.code_barres,
    prixAchat: b.prix_achat === undefined ? null : Number(b.prix_achat),
    prixVente: Number(b.prix_vente),
    seuilAlerte: Number(b.seuil_alerte),
    actif: b.actif,
    quantiteStock: 0,
  };
}

export interface ModifierVarianteEntree {
  reference?: string;
  codeBarres?: string;
  prixAchat?: number;
  prixVente?: number;
  seuilAlerte?: number;
}

export function modifierVariante(id: string, entree: ModifierVarianteEntree): Promise<ResultatEcriture<VarianteResume>> {
  return executerEnSecurite(async () => {
    const payload: Record<string, unknown> = {};
    if (entree.reference !== undefined) payload.reference = entree.reference;
    if (entree.codeBarres !== undefined) payload.code_barres = entree.codeBarres;
    if (entree.prixAchat !== undefined) payload.prix_achat = entree.prixAchat;
    if (entree.prixVente !== undefined) payload.prix_vente = entree.prixVente;
    if (entree.seuilAlerte !== undefined) payload.seuil_alerte = entree.seuilAlerte;
    const reponse = await apiFetch(`/variantes/${id}/`, { method: "PATCH", body: JSON.stringify(payload) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return versVariante(await reponse.json());
  });
}

// --- Mouvements de stock (entrée manuelle depuis la fiche produit) ---

export interface CreerMouvementEntree {
  varianteId: string;
  depotId: string;
  quantite: number;
  motif: string;
}

export function creerMouvementEntree(entree: CreerMouvementEntree): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/mouvements/", {
      method: "POST",
      body: JSON.stringify({
        variante: entree.varianteId,
        depot: entree.depotId,
        type: "entree",
        quantite: entree.quantite,
        motif: entree.motif,
      }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
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

interface ProduitBrute {
  id: string;
  nom: string;
  categorie: string | null;
  unite: string | null;
  description: string;
  actif: boolean;
  variantes: VarianteBrute[];
}

async function quantitesParVariante(): Promise<Record<string, number>> {
  const resultat = await listerStock();
  if (!resultat.succes) return {};
  const quantites: Record<string, number> = {};
  for (const ligne of resultat.resultat) {
    quantites[ligne.varianteId] = (quantites[ligne.varianteId] ?? 0) + ligne.quantite;
  }
  return quantites;
}

function versProduitDetail(b: ProduitBrute, categorieNom: string, uniteNom: string, quantites: Record<string, number>): ProduitDetail {
  return {
    id: b.id,
    nom: b.nom,
    categorieId: b.categorie,
    categorieNom,
    uniteId: b.unite,
    uniteNom,
    description: b.description,
    actif: b.actif,
    variantes: b.variantes.map((v) => ({ ...versVariante(v), quantiteStock: quantites[v.id] ?? 0 })),
  };
}

async function listerCategoriesEtUnitesIndexees(): Promise<{
  categories: Map<string, string>;
  unites: Map<string, string>;
}> {
  const [resCategories, resUnites] = await Promise.all([listerCategories(), listerUnites()]);
  return {
    categories: new Map((resCategories.succes ? resCategories.resultat : []).map((c) => [c.id, c.nom])),
    unites: new Map((resUnites.succes ? resUnites.resultat : []).map((u) => [u.id, u.nom])),
  };
}

export function listerProduits(): Promise<ResultatEcriture<ProduitResume[]>> {
  return executerEnSecurite(async () => {
    const [reponse, { categories }, quantites] = await Promise.all([
      apiFetch("/produits/"),
      listerCategoriesEtUnitesIndexees(),
      quantitesParVariante(),
    ]);
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brutes: ProduitBrute[] = await reponse.json();
    return brutes.map((b) => {
      const varianteDefaut = b.variantes[0];
      const totalStock = b.variantes.reduce((s, v) => s + (quantites[v.id] ?? 0), 0);
      return {
        id: b.id,
        nom: b.nom,
        reference: varianteDefaut?.reference ?? "",
        categorieNom: b.categorie ? (categories.get(b.categorie) ?? "") : "",
        prixAchat: varianteDefaut?.prix_achat === undefined ? null : Number(varianteDefaut.prix_achat),
        prixVente: varianteDefaut ? Number(varianteDefaut.prix_vente) : null,
        enStock: totalStock > 0,
        actif: b.actif,
      };
    });
  });
}

export function obtenirProduit(id: string): Promise<ResultatEcriture<ProduitDetail>> {
  return executerEnSecurite(async () => {
    const [reponse, { categories, unites }, quantites] = await Promise.all([
      apiFetch(`/produits/${id}/`),
      listerCategoriesEtUnitesIndexees(),
      quantitesParVariante(),
    ]);
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brute: ProduitBrute = await reponse.json();
    return versProduitDetail(
      brute,
      brute.categorie ? (categories.get(brute.categorie) ?? "") : "",
      brute.unite ? (unites.get(brute.unite) ?? "") : "",
      quantites,
    );
  });
}

export interface CreerProduitEntree {
  nom: string;
  categorieId: string | null;
  uniteId: string | null;
  reference: string;
  codeBarres: string;
  prixAchat: number;
  prixVente: number;
  seuilAlerte: number;
}

export interface ProduitCree {
  id: string;
  varianteId: string;
}

export function creerProduit(entree: CreerProduitEntree): Promise<ResultatEcriture<ProduitCree>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/produits/", {
      method: "POST",
      body: JSON.stringify({
        nom: entree.nom,
        categorie: entree.categorieId,
        unite: entree.uniteId,
        reference: entree.reference,
        code_barres: entree.codeBarres,
        prix_achat: entree.prixAchat,
        prix_vente: entree.prixVente,
        seuil_alerte: entree.seuilAlerte,
      }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brute: ProduitBrute = await reponse.json();
    return { id: brute.id, varianteId: brute.variantes[0]?.id ?? "" };
  });
}

export interface ModifierProduitEntree {
  nom?: string;
  categorieId?: string | null;
  uniteId?: string | null;
  description?: string;
  actif?: boolean;
}

export function modifierProduit(id: string, entree: ModifierProduitEntree): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const payload: Record<string, unknown> = {};
    if (entree.nom !== undefined) payload.nom = entree.nom;
    if (entree.categorieId !== undefined) payload.categorie = entree.categorieId;
    if (entree.uniteId !== undefined) payload.unite = entree.uniteId;
    if (entree.description !== undefined) payload.description = entree.description;
    if (entree.actif !== undefined) payload.actif = entree.actif;
    const reponse = await apiFetch(`/produits/${id}/`, { method: "PATCH", body: JSON.stringify(payload) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

export function supprimerProduit(id: string): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/produits/${id}/`, { method: "DELETE" });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}
