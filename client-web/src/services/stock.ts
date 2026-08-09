import { ouvrirBaseDeDonnees } from "../db";
import { suiviSyncNeuf } from "../db/helpers";
import type { MouvementStockLocal } from "../db/schema";

/**
 * Port navigateur de client-electron/electron/services/stock.ts::appliquerMouvement
 * (sous-ensemble utilisé par la Caisse : sortie de stock à la vente).
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
  const idStock = `${varianteId}::${depotId}`;
  const stockExistant = await db.get("stocks", idStock);

  const delta = deltaPour(type, quantite);
  const quantiteActuelle = stockExistant?.quantite ?? 0;
  const nouvelleQuantite = quantiteActuelle + delta;

  if (nouvelleQuantite < 0) {
    throw new ErreurStock("Stock insuffisant pour cette opération.");
  }

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
