import { randomUUID } from "node:crypto";

import { executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";

/**
 * Miroir de notifications/services.py::generer_alertes_rupture (Phase 2,
 * squelette) : alerte interne du système (rupture de stock), pas de canal ni
 * d'envoi — voir services/messages.ts pour les communications externes
 * (rappel de crédit, ticket WhatsApp).
 */

export type TypeNotification = "alerte_rupture";

const FENETRE_ANTI_DOUBLON_HEURES = 24;

function notificationRecenteExiste(boutiqueId: string, referenceId: string): boolean {
  const seuil = new Date(Date.now() - FENETRE_ANTI_DOUBLON_HEURES * 3600 * 1000).toISOString();
  const resultat = unResultat<{ n: number }>(
    `SELECT COUNT(*) as n FROM notifications
     WHERE boutique_id = ? AND reference_id = ? AND date_creation >= ? AND supprime = 0`,
    [boutiqueId, referenceId, seuil],
  );
  return (resultat ? Number(resultat.n) : 0) > 0;
}

interface LigneStockEnRupture {
  id: string;
  produitNom: string;
  depotId: string;
  depotNom: string;
  quantite: number;
}

export function genererAlertesRupture(boutiqueId: string): string[] {
  const stocksEnRupture = tousLesResultats<LigneStockEnRupture>(
    `SELECT s.id as id, p.nom as produitNom, d.id as depotId, d.nom as depotNom, s.quantite as quantite
     FROM stocks s
     JOIN depots d ON d.id = s.depot_id
     JOIN variantes va ON va.id = s.variante_id
     JOIN produits p ON p.id = va.produit_id
     WHERE d.boutique_id = ? AND s.quantite <= va.seuil_alerte`,
    [boutiqueId],
  );

  const idsCrees: string[] = [];
  const maintenant = new Date().toISOString();
  for (const stock of stocksEnRupture) {
    if (notificationRecenteExiste(boutiqueId, stock.id)) continue;
    const message = `Rupture de stock : ${stock.produitNom} (${stock.depotNom}), ${stock.quantite} restant(s)`;
    const id = randomUUID();
    executer(
      `INSERT INTO notifications
         (id, boutique_id, depot_id, type, message, reference_type, reference_id, date_creation, date_modification)
       VALUES (?, ?, ?, 'alerte_rupture', ?, 'stock.Stock', ?, ?, ?)`,
      [id, boutiqueId, stock.depotId, message, stock.id, maintenant, maintenant],
    );
    idsCrees.push(id);
  }
  if (idsCrees.length > 0) sauvegarder();
  return idsCrees;
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
  /**
   * Un caissier (verrouillé sur son dépôt, voir `session.depotId`) ne doit
   * voir que les notifications de son propre dépôt. Un Patron/Gérant (pas de
   * dépôt assigné) peut passer ce filtre volontairement pour restreindre
   * l'affichage, mais voit tout par défaut.
   */
  depotId?: string;
}

export function listerNotifications(boutiqueId: string, filtres: FiltresNotifications = {}): NotificationResume[] {
  const conditions = ["n.boutique_id = ?", "n.supprime = 0"];
  const parametres: string[] = [boutiqueId];
  if (filtres.depotId) {
    conditions.push("n.depot_id = ?");
    parametres.push(filtres.depotId);
  }
  return tousLesResultats<NotificationResume>(
    `SELECT n.id as id, n.type as type, n.message as message, n.date_creation as dateCreation,
            n.depot_id as depotId, d.nom as depotNom, n.reference_type as referenceType, n.reference_id as referenceId
     FROM notifications n
     LEFT JOIN depots d ON d.id = n.depot_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY n.date_creation DESC`,
    parametres,
  );
}

/** Un caissier ne doit voir que le compteur de son propre dépôt (badge de la cloche). */
export function compterNotificationsNonLues(boutiqueId: string, depotId?: string): number {
  const conditions = ["boutique_id = ?", "supprime = 0", "lu = 0"];
  const parametres: string[] = [boutiqueId];
  if (depotId) {
    conditions.push("depot_id = ?");
    parametres.push(depotId);
  }
  const resultat = unResultat<{ n: number }>(
    `SELECT COUNT(*) as n FROM notifications WHERE ${conditions.join(" AND ")}`,
    parametres,
  );
  return resultat ? Number(resultat.n) : 0;
}

/**
 * Appelé à l'ouverture de la page Notifications : éteint le badge de la
 * cloche pour ce qui a réellement été affiché (même filtre `depotId` que
 * `listerNotifications`) — pas toute la boutique, sinon un caissier qui
 * consulte son propre dépôt marquerait à tort comme lues les notifications
 * des autres dépôts chez le Patron/Gérant.
 */
export function marquerNotificationsLues(boutiqueId: string, depotId?: string): void {
  const conditions = ["boutique_id = ?", "lu = 0"];
  const parametres: string[] = [boutiqueId];
  if (depotId) {
    conditions.push("depot_id = ?");
    parametres.push(depotId);
  }
  executer(`UPDATE notifications SET lu = 1 WHERE ${conditions.join(" AND ")}`, parametres);
  sauvegarder();
}
