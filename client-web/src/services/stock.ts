import { ouvrirBaseDeDonnees } from "../db";
import { listerParIndex, maintenant, obtenirLigne, ecrireLigne, suiviSyncNeuf } from "../db/helpers";
import type { DepotLocal, MouvementStockLocal } from "../db/schema";

/**
 * Port navigateur de client-electron/electron/services/stock.ts, limité à ce
 * que client-web expose réellement (pas d'écran Mouvements/Transferts/
 * Inventaire côté web pour l'instant — seuls listerStock et les dépôts sont
 * consommés par des pages ici ; le reste du fichier Electron resterait du
 * code mort tant qu'aucun écran ne l'utilise).
 */

export class ErreurStock extends Error {}

type TypeMouvement = "entree" | "sortie" | "ajustement";

function deltaPour(type: TypeMouvement, quantite: number): number {
  if (type === "entree") return quantite;
  if (type === "sortie") return -quantite;
  return quantite; // ajustement : delta signé fourni tel quel
}

export interface ParametresMouvement {
  varianteId: string;
  depotId: string;
  type: TypeMouvement;
  quantite: number;
  motif?: string;
  utilisateurId?: string | null;
  referenceType?: string;
  referenceId?: string | null;
}

export async function appliquerMouvement(params: ParametresMouvement): Promise<string> {
  const {
    varianteId,
    depotId,
    type,
    quantite,
    motif = "",
    utilisateurId = null,
    referenceType = "",
    referenceId = null,
  } = params;

  const db = await ouvrirBaseDeDonnees();
  const stockExistant = await db.getFromIndex("stocks", "variante_depot", [varianteId, depotId]);

  const delta = deltaPour(type, quantite);
  const quantiteActuelle = stockExistant?.quantite ?? 0;
  const nouvelleQuantite = quantiteActuelle + delta;

  if (nouvelleQuantite < 0) {
    throw new ErreurStock("Stock insuffisant pour cette opération.");
  }

  const idStock = stockExistant?.id ?? crypto.randomUUID();
  await db.put("stocks", { id: idStock, variante_id: varianteId, depot_id: depotId, quantite: nouvelleQuantite });

  const mouvementId = crypto.randomUUID();
  const mouvement: MouvementStockLocal = {
    id: mouvementId,
    variante_id: varianteId,
    depot_id: depotId,
    type,
    quantite,
    motif,
    reference_type: referenceType,
    reference_id: referenceId,
    utilisateur_id: utilisateurId,
    ...suiviSyncNeuf(),
  };
  await db.put("mouvements_stock", mouvement);

  return mouvementId;
}

// --- Dépôts ---

export interface DepotResume {
  id: string;
  nom: string;
  adresse: string;
}

export async function listerDepotsDetail(boutiqueId: string): Promise<DepotResume[]> {
  const depots = (await listerParIndex("depots", "boutique_id", boutiqueId)).filter((d) => !d.supprime);
  return depots.map((d) => ({ id: d.id, nom: d.nom, adresse: d.adresse })).sort((a, b) => a.nom.localeCompare(b.nom));
}

export async function creerDepot(boutiqueId: string, nom: string, adresse = ""): Promise<string> {
  const id = crypto.randomUUID();
  const depot: DepotLocal = { id, boutique_id: boutiqueId, nom, adresse, ...suiviSyncNeuf() };
  await ecrireLigne("depots", depot);
  return id;
}

export async function modifierDepot(id: string, champs: Partial<{ nom: string; adresse: string }>): Promise<void> {
  const depot = await obtenirLigne("depots", id);
  if (!depot) throw new ErreurStock("Dépôt introuvable.");
  await ecrireLigne("depots", {
    ...depot,
    nom: champs.nom ?? depot.nom,
    adresse: champs.adresse ?? depot.adresse,
    date_modification: maintenant(),
    synchronise: 0,
  });
}

export async function supprimerDepot(id: string): Promise<void> {
  const depot = await obtenirLigne("depots", id);
  if (!depot) return;
  await ecrireLigne("depots", { ...depot, supprime: 1, synchronise: 0, date_modification: maintenant() });
}

// --- Consultation du stock ---

export interface LigneStock {
  id: string;
  varianteId: string;
  produitId: string;
  produitNom: string;
  reference: string;
  depotId: string;
  depotNom: string;
  quantite: number;
  seuilAlerte: number;
  enRupture: boolean;
}

export async function listerStock(boutiqueId: string, depotId?: string, terme = ""): Promise<LigneStock[]> {
  const db = await ouvrirBaseDeDonnees();
  const depots = (await db.getAllFromIndex("depots", "boutique_id", boutiqueId)).filter((d) => !d.supprime);
  const depotsParId = new Map(depots.map((d) => [d.id, d]));
  const motif = terme.trim().toLowerCase();

  const resultat: LigneStock[] = [];
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime);
  for (const produit of produits) {
    if (motif && !produit.nom.toLowerCase().includes(motif)) continue;
    const variantes = (await db.getAllFromIndex("variantes", "produit_id", produit.id)).filter((v) => !v.supprime);
    for (const variante of variantes) {
      const stocks = await db.getAllFromIndex(
        "stocks",
        "variante_depot",
        IDBKeyRange.bound([variante.id, ""], [variante.id, "￿"]),
      );
      for (const stock of stocks) {
        const depot = depotsParId.get(stock.depot_id);
        if (!depot) continue;
        if (depotId && depot.id !== depotId) continue;
        resultat.push({
          id: stock.id,
          varianteId: variante.id,
          produitId: produit.id,
          produitNom: produit.nom,
          reference: variante.reference,
          depotId: depot.id,
          depotNom: depot.nom,
          quantite: stock.quantite,
          seuilAlerte: variante.seuil_alerte,
          enRupture: stock.quantite <= variante.seuil_alerte,
        });
      }
    }
  }
  return resultat.sort((a, b) => a.produitNom.localeCompare(b.produitNom));
}
