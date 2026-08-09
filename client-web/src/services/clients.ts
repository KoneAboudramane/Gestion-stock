import { ouvrirBaseDeDonnees } from "../db";
import { suiviSyncNeuf } from "../db/helpers";
import type { ClientLocal } from "../db/schema";

/** Port navigateur (sous-ensemble Caisse) de client-electron/electron/services/clients.ts. */

export class ErreurClient extends Error {}

export async function creerClient(
  boutiqueId: string,
  nom: string,
  telephone = "",
  adresse = "",
  estPermanent = true,
): Promise<string> {
  if (!nom.trim()) throw new ErreurClient("Le nom du client est obligatoire.");
  const db = await ouvrirBaseDeDonnees();
  const id = crypto.randomUUID();
  const client: ClientLocal = {
    id,
    boutique_id: boutiqueId,
    nom: nom.trim(),
    telephone,
    adresse,
    est_permanent: estPermanent ? 1 : 0,
    ...suiviSyncNeuf(),
  };
  await db.put("clients", client);
  return id;
}
