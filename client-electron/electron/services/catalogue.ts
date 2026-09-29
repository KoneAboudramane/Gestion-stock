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
  /** Article en déstockage : prixVente est alors le prix de déstockage, prixNormal l'ancien prix. */
  prixNormal: number | null;
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
  const d = new Date();
  const aujourdhui = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // Article en déstockage : la caisse vend au prix de déstockage (prixVente),
  // prixNormal garde l'ancien prix pour l'afficher barré.
  return tousLesResultats<VarianteCatalogue & { prixDestockage: number | null }>(
    `SELECT v.id as id, v.produit_id as produitId, p.nom as produitNom, v.reference as reference,
            v.code_barres as codeBarres, v.prix_vente as prixVente, v.prix_achat as prixAchat,
            v.seuil_alerte as seuilAlerte, c.nom as categorieNom,
            COALESCE(s.quantite, 0) as quantiteDisponible,
            (SELECT d.prix_destockage FROM destockages d
             WHERE d.variante_id = v.id AND d.statut = 'en_cours' AND d.supprime = 0
               AND (d.date_fin IS NULL OR d.date_fin = '' OR d.date_fin >= ?)
             ORDER BY d.date_creation DESC LIMIT 1) as prixDestockage
     FROM variantes v
     JOIN produits p ON p.id = v.produit_id
     LEFT JOIN stocks s ON s.variante_id = v.id AND s.depot_id = ?
     LEFT JOIN categories c ON c.id = p.categorie_id
     WHERE p.boutique_id = ? AND p.actif = 1 AND v.actif = 1
       AND p.supprime = 0 AND v.supprime = 0
       -- Article jamais stocké ici : visible quand même s'il est le détail
       -- d'un article de gros en stock (la caisse proposera de le détailler).
       AND (s.id IS NOT NULL OR EXISTS (
         SELECT 1 FROM variantes g JOIN stocks sg ON sg.variante_id = g.id AND sg.depot_id = ?
         WHERE g.variante_detail_id = v.id AND g.supprime = 0 AND sg.quantite > 0))
     ORDER BY (c.nom IS NULL), c.nom, p.nom`,
    [aujourdhui, depotId ?? null, boutiqueId, depotId ?? null],
  ).map(({ prixDestockage, ...v }) =>
    prixDestockage == null
      ? { ...v, prixNormal: null }
      : { ...v, prixVente: Number(prixDestockage), prixNormal: Number(v.prixVente) },
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

// Clients réguliers uniquement — les clients occasionnels (vente à crédit) ne
// doivent pas apparaître dans cette liste, voir electron/services/clients.ts.
export function listerClients(
  boutiqueId: string,
): { id: string; nom: string; telephone: string; adresse: string }[] {
  return tousLesResultats<{ id: string; nom: string; telephone: string; adresse: string }>(
    "SELECT id, nom, telephone, adresse FROM clients WHERE boutique_id = ? AND supprime = 0 AND est_permanent = 1",
    [boutiqueId],
  );
}
