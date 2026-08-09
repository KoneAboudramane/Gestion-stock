import { ouvrirBaseDeDonnees } from "../db";
import { maintenant, suiviSyncNeuf } from "../db/helpers";
import type { NotificationLocale } from "../db/schema";

/**
 * Port navigateur de client-electron/electron/services/notifications.ts :
 * alerte interne du système (rupture de stock), pas de canal ni d'envoi —
 * voir services/messages.ts pour les communications externes (rappel de
 * crédit, ticket WhatsApp). Pas de "marquer comme lue"/compteur ici : pas de
 * cloche de notifications dans l'en-tête de client-web (voir Notifications.tsx).
 */

export type TypeNotification = "alerte_rupture";

const FENETRE_ANTI_DOUBLON_HEURES = 24;

async function notificationRecenteExiste(boutiqueId: string, referenceId: string): Promise<boolean> {
  const db = await ouvrirBaseDeDonnees();
  const seuil = new Date(Date.now() - FENETRE_ANTI_DOUBLON_HEURES * 3600 * 1000).toISOString();
  const notifications = await db.getAllFromIndex("notifications", "boutique_id", boutiqueId);
  return notifications.some((n) => !n.supprime && n.reference_id === referenceId && n.date_creation >= seuil);
}

async function genererAlertesRuptureImpl(boutiqueId: string): Promise<string[]> {
  const db = await ouvrirBaseDeDonnees();
  const depots = (await db.getAllFromIndex("depots", "boutique_id", boutiqueId)).filter((d) => !d.supprime);
  const depotsParId = new Map(depots.map((d) => [d.id, d]));
  const stocks = await db.getAll("stocks");

  const idsCrees: string[] = [];
  for (const s of stocks) {
    const depot = depotsParId.get(s.depot_id);
    if (!depot) continue;
    const variante = await db.get("variantes", s.variante_id);
    if (!variante || variante.supprime || s.quantite > variante.seuil_alerte) continue;
    if (await notificationRecenteExiste(boutiqueId, s.id)) continue;

    const produit = await db.get("produits", variante.produit_id);
    const message = `Rupture de stock : ${produit?.nom ?? ""} (${depot.nom}), ${s.quantite} restant(s)`;
    const id = crypto.randomUUID();
    const notification: NotificationLocale = {
      id,
      boutique_id: boutiqueId,
      depot_id: depot.id,
      type: "alerte_rupture",
      message,
      reference_type: "stock.Stock",
      reference_id: s.id,
      lu: 0,
      ...suiviSyncNeuf(),
    };
    await db.put("notifications", notification);
    idsCrees.push(id);
  }
  return idsCrees;
}

// Verrou au niveau du module : React StrictMode double-invoque les effets en
// dev, et deux appels concurrents peuvent tous les deux passer la fenêtre
// anti-doublon (vérification puis écriture, non atomique) avant que l'un des
// deux n'ait eu le temps d'écrire — même pattern que l'ancien api/notifications.ts.
let generationEnCours: Promise<string[]> | null = null;

export function genererAlertesRupture(boutiqueId: string): Promise<string[]> {
  if (generationEnCours) return generationEnCours;
  generationEnCours = genererAlertesRuptureImpl(boutiqueId).finally(() => {
    generationEnCours = null;
  });
  return generationEnCours;
}

// --- Lecture ---

export interface NotificationResume {
  id: string;
  type: TypeNotification;
  message: string;
  dateCreation: string;
  depotId: string | null;
  depotNom: string | null;
  referenceType: string;
  referenceId: string | null;
}

export interface FiltresNotifications {
  depotId?: string;
}

export async function listerNotifications(boutiqueId: string, filtres: FiltresNotifications = {}): Promise<NotificationResume[]> {
  const db = await ouvrirBaseDeDonnees();
  let notifications = (await db.getAllFromIndex("notifications", "boutique_id", boutiqueId)).filter((n) => !n.supprime);
  if (filtres.depotId) notifications = notifications.filter((n) => n.depot_id === filtres.depotId);

  const resultat: NotificationResume[] = [];
  for (const n of notifications) {
    const depot = n.depot_id ? await db.get("depots", n.depot_id) : undefined;
    resultat.push({
      id: n.id,
      type: n.type as TypeNotification,
      message: n.message,
      dateCreation: n.date_creation,
      depotId: n.depot_id,
      depotNom: depot?.nom ?? null,
      referenceType: n.reference_type,
      referenceId: n.reference_id,
    });
  }
  return resultat.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}
