import { ouvrirBaseDeDonnees } from "../db";
import { obtenirQuantiteStock } from "../db/helpers";
import { destockageActif } from "./stock";

/**
 * Port navigateur (lecture locale IndexedDB) de client-electron/electron/services/catalogue.ts,
 * limité à ce dont la Caisse a besoin. Simplification assumée pour ce premier
 * passage : pas de tri par catégorie (categories n'est pas répliqué en local
 * — voir le registre restreint de src/db/registre.ts) ; tri par nom de produit.
 */

export interface VarianteCatalogue {
  id: string;
  produitId: string;
  produitNom: string;
  reference: string;
  codeBarres: string;
  prixVente: number;
  prixAchat: number;
  seuilAlerte: number;
  categorieNom: string | null;
  quantiteDisponible: number;
  /** Article en déstockage : prixVente est alors le prix de déstockage, prixNormal l'ancien prix. */
  prixNormal: number | null;
}

export async function listerVariantesCatalogue(boutiqueId: string, depotId?: string): Promise<VarianteCatalogue[]> {
  if (!depotId) return [];
  const db = await ouvrirBaseDeDonnees();
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter(
    (p) => p.actif && !p.supprime,
  );
  const produitsParId = new Map(produits.map((p) => [p.id, p]));

  const resultat: VarianteCatalogue[] = [];
  for (const produit of produits) {
    const variantes = (await db.getAllFromIndex("variantes", "produit_id", produit.id)).filter(
      (v) => v.actif && !v.supprime,
    );
    for (const variante of variantes) {
      const quantiteDisponible = await obtenirQuantiteStock(variante.id, depotId);
      const destockage = await destockageActif(variante.id);
      resultat.push({
        id: variante.id,
        produitId: variante.produit_id,
        produitNom: produitsParId.get(variante.produit_id)?.nom ?? "",
        reference: variante.reference,
        codeBarres: variante.code_barres,
        prixVente: destockage ? destockage.prixDestockage : variante.prix_vente,
        prixAchat: variante.prix_achat,
        seuilAlerte: variante.seuil_alerte,
        categorieNom: null,
        quantiteDisponible,
        prixNormal: destockage ? variante.prix_vente : null,
      });
    }
  }
  return resultat.sort((a, b) => a.produitNom.localeCompare(b.produitNom));
}

export interface DepotResume {
  id: string;
  nom: string;
}

export async function listerDepots(boutiqueId: string): Promise<DepotResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const depots = await db.getAllFromIndex("depots", "boutique_id", boutiqueId);
  return depots.filter((d) => !d.supprime).map((d) => ({ id: d.id, nom: d.nom }));
}

export interface ClientBoutique {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
}

/** Clients réguliers uniquement — les occasionnels n'apparaissent jamais ici, voir services/clients.ts. */
export async function listerClients(boutiqueId: string): Promise<ClientBoutique[]> {
  const db = await ouvrirBaseDeDonnees();
  const clients = await db.getAllFromIndex("clients", "boutique_id", boutiqueId);
  return clients
    .filter((c) => !c.supprime && c.est_permanent)
    .map((c) => ({ id: c.id, nom: c.nom, telephone: c.telephone, adresse: c.adresse }));
}

export interface VarianteActive {
  id: string;
  produitId: string;
  produitNom: string;
  reference: string;
  codeBarres: string;
  prixAchat: number;
  prixVente: number;
  categorieNom: string | null;
}

/** Tous les articles actifs, sans limite (bouton « ☰ Tous les articles » des entrées de stock). */
export async function listerVariantesActives(boutiqueId: string): Promise<VarianteActive[]> {
  const db = await ouvrirBaseDeDonnees();
  const categories = new Map(
    (await db.getAllFromIndex("categories", "boutique_id", boutiqueId)).filter((c) => !c.supprime).map((c) => [c.id, c.nom]),
  );
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime && p.actif);
  const resultat: VarianteActive[] = [];
  for (const p of produits) {
    for (const v of await db.getAllFromIndex("variantes", "produit_id", p.id)) {
      if (v.supprime || !v.actif) continue;
      resultat.push({
        id: v.id,
        produitId: p.id,
        produitNom: p.nom,
        reference: v.reference,
        codeBarres: v.code_barres ?? "",
        prixAchat: v.prix_achat,
        prixVente: v.prix_vente,
        categorieNom: (p.categorie_id && categories.get(p.categorie_id)) || null,
      });
    }
  }
  return resultat.sort((a, b) => a.produitNom.localeCompare(b.produitNom, "fr"));
}
