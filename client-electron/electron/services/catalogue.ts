import { tousLesResultats } from "../db/helpers";

export interface VarianteRecherchee {
  id: string;
  produitId: string;
  produitNom: string;
  reference: string;
  codeBarres: string;
  prixVente: number;
  prixAchat: number;
  seuilAlerte: number;
}

export function rechercherVariantes(boutiqueId: string, terme: string): VarianteRecherchee[] {
  const motif = `%${terme}%`;
  return tousLesResultats<VarianteRecherchee>(
    `SELECT v.id as id, v.produit_id as produitId, p.nom as produitNom, v.reference as reference,
            v.code_barres as codeBarres, v.prix_vente as prixVente, v.prix_achat as prixAchat,
            v.seuil_alerte as seuilAlerte
     FROM variantes v
     JOIN produits p ON p.id = v.produit_id
     WHERE p.boutique_id = ? AND p.actif = 1 AND v.actif = 1
       AND p.supprime = 0 AND v.supprime = 0
       AND (p.nom LIKE ? OR v.code_barres = ? OR v.reference LIKE ?)
     ORDER BY p.nom
     LIMIT 50`,
    [boutiqueId, motif, terme, motif],
  );
}

export interface VarianteCatalogue extends VarianteRecherchee {
  categorieNom: string | null;
  quantiteDisponible: number;
}

/**
 * Catalogue affiché en Caisse : les catégories triées alphabétiquement, "Sans
 * catégorie" en dernier, produits triés à l'intérieur de chaque catégorie.
 * `depotId` est requis en pratique : seules les variantes ayant déjà une
 * ligne de stock dans ce dépôt apparaissent (jointure stricte sur `stocks`),
 * même à quantité 0 (rupture) — un produit jamais stocké dans ce dépôt
 * n'est pas vendable et ne doit pas y figurer. Sans dépôt, liste vide.
 */
export function listerVariantesCatalogue(boutiqueId: string, depotId?: string): VarianteCatalogue[] {
  return tousLesResultats<VarianteCatalogue>(
    `SELECT v.id as id, v.produit_id as produitId, p.nom as produitNom, v.reference as reference,
            v.code_barres as codeBarres, v.prix_vente as prixVente, v.prix_achat as prixAchat,
            v.seuil_alerte as seuilAlerte, c.nom as categorieNom,
            s.quantite as quantiteDisponible
     FROM stocks s
     JOIN variantes v ON v.id = s.variante_id
     JOIN produits p ON p.id = v.produit_id
     LEFT JOIN categories c ON c.id = p.categorie_id
     WHERE s.depot_id = ? AND p.boutique_id = ? AND p.actif = 1 AND v.actif = 1
       AND p.supprime = 0 AND v.supprime = 0
     ORDER BY (c.nom IS NULL), c.nom, p.nom`,
    [depotId ?? null, boutiqueId],
  );
}

export function obtenirStock(varianteId: string, depotId: string): number {
  const resultats = tousLesResultats<{ quantite: number }>(
    "SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?",
    [varianteId, depotId],
  );
  return resultats[0] ? Number(resultats[0].quantite) : 0;
}

export function listerDepots(boutiqueId: string): { id: string; nom: string }[] {
  return tousLesResultats<{ id: string; nom: string }>(
    "SELECT id, nom FROM depots WHERE boutique_id = ? AND supprime = 0",
    [boutiqueId],
  );
}

export function listerClients(boutiqueId: string): { id: string; nom: string; telephone: string }[] {
  return tousLesResultats<{ id: string; nom: string; telephone: string }>(
    "SELECT id, nom, telephone FROM clients WHERE boutique_id = ? AND supprime = 0",
    [boutiqueId],
  );
}
