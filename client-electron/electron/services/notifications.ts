import { randomUUID } from "node:crypto";

import { executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";
import { DELAI_GRACE_JOURS, obtenirEtatAbonnement } from "./abonnement";
import { echeancesEnCours } from "./achats";
import { echeancesCreditsEnCours } from "./clients";
import { produitsDormants } from "./rapports";

/**
 * Miroir de notifications/services.py::generer_alertes_rupture (Phase 2,
 * squelette) : alerte interne du système (rupture de stock), pas de canal ni
 * d'envoi — voir services/messages.ts pour les communications externes
 * (rappel de crédit, ticket WhatsApp).
 */

export type TypeNotification =
  | "alerte_rupture"
  | "alerte_dormants"
  | "fin_destockage"
  | "echeance_proche"
  | "echeance_retard"
  | "credit_proche"
  | "credit_retard"
  | "commande_proche"
  | "commande_retard"
  | "abonnement_proche"
  | "abonnement_expire";

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
  grosNom: string | null;
  grosStock: number | null;
}

export function genererAlertesRupture(boutiqueId: string): string[] {
  const stocksEnRupture = tousLesResultats<LigneStockEnRupture>(
    `SELECT s.id as id, p.nom as produitNom, d.id as depotId, d.nom as depotNom, s.quantite as quantite,
            (SELECT pg.nom FROM variantes g JOIN produits pg ON pg.id = g.produit_id
             WHERE g.variante_detail_id = va.id AND g.supprime = 0 ORDER BY g.date_creation LIMIT 1) as grosNom,
            (SELECT COALESCE(SUM(sg.quantite), 0) FROM variantes g JOIN stocks sg ON sg.variante_id = g.id
             WHERE g.variante_detail_id = va.id AND g.supprime = 0 AND sg.depot_id = s.depot_id) as grosStock
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
    const message =
      `Rupture de stock : ${stock.produitNom} (${stock.depotNom}), ${stock.quantite} restant(s)` +
      (stock.grosNom && Number(stock.grosStock) > 0
        ? ` — il reste ${Number(stock.grosStock)} « ${stock.grosNom} » : déballez-en un plutôt que de commander.`
        : "");
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

// --- Alertes de déstockage (produits dormants, fin prochaine d'un déstockage) ---
// Sans dépôt (depot_id NULL) : visibles par le Patron/Gérant, pas par un
// caissier limité à son dépôt.

const SEUIL_ALERTE_DORMANTS_JOURS = 60;
const FREQUENCE_ALERTE_DORMANTS_JOURS = 7;
const PREAVIS_FIN_DESTOCKAGE_JOURS = 2;
const PREAVIS_ECHEANCE_JOURS = 3;

function jourLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formaterNombre(valeur: number): string {
  return Math.round(valeur).toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " ");
}

function insererAlerte(boutiqueId: string, type: TypeNotification, message: string, referenceType: string, referenceId: string | null): string {
  const id = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    `INSERT INTO notifications
       (id, boutique_id, depot_id, type, message, reference_type, reference_id, date_creation, date_modification)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    [id, boutiqueId, type, message, referenceType, referenceId, maintenant, maintenant],
  );
  return id;
}

/** Appelé à l'ouverture de l'appli (Shell.tsx), comme le relevé des dormants. */
export function genererAlertesDestockage(boutiqueId: string): string[] {
  const idsCrees: string[] = [];
  const devise = unResultat<{ devise: string }>("SELECT devise FROM boutiques WHERE id = ?", [boutiqueId])?.devise || "FCFA";

  // 1. Produits dormants : au plus une alerte par semaine, seulement s'il y en a.
  const seuilSemaine = new Date(Date.now() - FREQUENCE_ALERTE_DORMANTS_JOURS * 86_400_000).toISOString();
  const recente = unResultat<{ n: number }>(
    "SELECT COUNT(*) as n FROM notifications WHERE boutique_id = ? AND type = 'alerte_dormants' AND date_creation >= ? AND supprime = 0",
    [boutiqueId, seuilSemaine],
  );
  if (Number(recente?.n ?? 0) === 0) {
    const dormants = produitsDormants(boutiqueId, SEUIL_ALERTE_DORMANTS_JOURS).filter((d) => !d.enDestockage);
    if (dormants.length > 0) {
      const valeur = dormants.reduce((somme, d) => somme + d.valeurImmobilisee, 0);
      idsCrees.push(
        insererAlerte(
          boutiqueId,
          "alerte_dormants",
          `${dormants.length} produit${dormants.length > 1 ? "s" : ""} sans vente depuis ${SEUIL_ALERTE_DORMANTS_JOURS} jours : ` +
            `${formaterNombre(valeur)} ${devise} qui dorment. Pensez au déstockage (Stock → Produits dormants).`,
          "rapports.ProduitsDormants",
          null,
        ),
      );
    }
  }

  // 2. Déstockages qui se terminent dans 2 jours ou moins : une alerte chacun.
  const aujourdhui = new Date();
  const limite = new Date(aujourdhui);
  limite.setDate(limite.getDate() + PREAVIS_FIN_DESTOCKAGE_JOURS);
  for (const d of tousLesResultats<{ id: string; produitNom: string; dateFin: string; prixDestockage: number }>(
    `SELECT d.id as id, p.nom as produitNom, d.date_fin as dateFin, d.prix_destockage as prixDestockage
     FROM destockages d
     JOIN variantes v ON v.id = d.variante_id
     JOIN produits p ON p.id = v.produit_id
     WHERE p.boutique_id = ? AND d.statut = 'en_cours' AND d.supprime = 0
       AND d.date_fin IS NOT NULL AND d.date_fin != '' AND d.date_fin >= ? AND d.date_fin <= ?
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.reference_id = d.id AND n.type = 'fin_destockage' AND n.supprime = 0)`,
    [boutiqueId, jourLocal(aujourdhui), jourLocal(limite)],
  )) {
    const fin = new Date(`${d.dateFin}T00:00:00`).toLocaleDateString("fr-FR");
    idsCrees.push(
      insererAlerte(
        boutiqueId,
        "fin_destockage",
        `Le déstockage de ${d.produitNom} (${formaterNombre(Number(d.prixDestockage))} ${devise}) se termine le ${fin}. ` +
          `Prolongez-le si besoin (Stock → Déstockage → Modifier).`,
        "stock.Destockage",
        d.id,
      ),
    );
  }

  // 3. Échéances des dettes fournisseur : 3 jours avant, puis dès le lendemain si pas payée.
  const limiteEcheance = new Date(aujourdhui);
  limiteEcheance.setDate(limiteEcheance.getDate() + PREAVIS_ECHEANCE_JOURS);
  const dejaAlertees = new Set(
    tousLesResultats<{ cle: string }>(
      `SELECT type || ':' || reference_id as cle FROM notifications
       WHERE boutique_id = ? AND type IN ('echeance_proche', 'echeance_retard') AND supprime = 0`,
      [boutiqueId],
    ).map((n) => n.cle),
  );
  for (const e of echeancesEnCours(boutiqueId)) {
    const date = new Date(`${e.dateEcheance}T00:00:00`).toLocaleDateString("fr-FR");
    const reste = `${formaterNombre(e.montant - e.couvert)} ${devise}`;
    const commande = e.commandeNumero ? ` (commande ${e.commandeNumero})` : "";
    if (e.statut === "en_retard" && !dejaAlertees.has(`echeance_retard:${e.id}`)) {
      idsCrees.push(
        insererAlerte(
          boutiqueId,
          "echeance_retard",
          `Échéance en retard : ${reste} à payer à ${e.fournisseurNom}${commande} depuis le ${date}. Achats → Dettes.`,
          "fournisseurs.EcheanceDette",
          e.id,
        ),
      );
    } else if (
      e.statut !== "en_retard" &&
      e.dateEcheance <= jourLocal(limiteEcheance) &&
      !dejaAlertees.has(`echeance_proche:${e.id}`)
    ) {
      idsCrees.push(
        insererAlerte(
          boutiqueId,
          "echeance_proche",
          `Échéance le ${date} : ${reste} à payer à ${e.fournisseurNom}${commande}. Achats → Dettes.`,
          "fournisseurs.EcheanceDette",
          e.id,
        ),
      );
    }
  }

  // Échéances des crédits clients : 3 jours avant, puis dès le lendemain si pas réglée.
  const creditsAlertes = new Set(
    tousLesResultats<{ cle: string }>(
      `SELECT type || ':' || reference_id as cle FROM notifications
       WHERE boutique_id = ? AND type IN ('credit_proche', 'credit_retard') AND supprime = 0`,
      [boutiqueId],
    ).map((n) => n.cle),
  );
  for (const e of echeancesCreditsEnCours(boutiqueId)) {
    const date = new Date(`${e.dateEcheance}T00:00:00`).toLocaleDateString("fr-FR");
    const reste = `${formaterNombre(e.montant - e.couvert)} ${devise}`;
    const vente = e.venteNumero ? ` (vente ${e.venteNumero})` : "";
    if (e.statut === "en_retard" && !creditsAlertes.has(`credit_retard:${e.id}`)) {
      idsCrees.push(
        insererAlerte(
        boutiqueId,
        "credit_retard",
        `Crédit en retard : ${e.clientNom} doit ${reste}${vente} depuis le ${date}. Clients → Crédits.`,
        "clients.EcheanceCredit",
        e.id,
      ),
      );
    } else if (
      e.statut !== "en_retard" &&
      e.dateEcheance <= jourLocal(limiteEcheance) &&
      !creditsAlertes.has(`credit_proche:${e.id}`)
    ) {
      idsCrees.push(
        insererAlerte(
        boutiqueId,
        "credit_proche",
        `Échéance le ${date} : ${e.clientNom} doit régler ${reste}${vente}. Clients → Crédits.`,
        "clients.EcheanceCredit",
        e.id,
      ),
      );
    }
  }
  // Commandes clients : livraison prévue aujourd'hui ou demain, puis en retard.
  const commandesAlertees = new Set(
    tousLesResultats<{ cle: string }>(
      `SELECT type || ':' || reference_id as cle FROM notifications
       WHERE boutique_id = ? AND type IN ('commande_proche', 'commande_retard') AND supprime = 0`,
      [boutiqueId],
    ).map((n) => n.cle),
  );
  const jourAujourdhui = jourLocal(aujourdhui);
  const lendemain = new Date(aujourdhui);
  lendemain.setDate(lendemain.getDate() + 1);
  for (const c of tousLesResultats<{ id: string; numero: string; clientNom: string; date: string }>(
    `SELECT c.id as id, c.numero as numero, cl.nom as clientNom, c.date_livraison_prevue as date
     FROM commandes_client c JOIN clients cl ON cl.id = c.client_id
     WHERE c.boutique_id = ? AND c.supprime = 0 AND c.statut IN ('en_attente', 'prete', 'partielle')
       AND c.date_livraison_prevue IS NOT NULL AND c.date_livraison_prevue != '' AND c.date_livraison_prevue <= ?`,
    [boutiqueId, jourLocal(lendemain)],
  )) {
    const date = new Date(`${c.date}T00:00:00`).toLocaleDateString("fr-FR");
    if (c.date < jourAujourdhui && !commandesAlertees.has(`commande_retard:${c.id}`)) {
      idsCrees.push(
        insererAlerte(
          boutiqueId,
          "commande_retard",
          `Commande en retard : ${c.clientNom} attend sa commande ${c.numero} depuis le ${date}. Clients → Commandes clients.`,
          "ventes.CommandeClient",
          c.id,
        ),
      );
    } else if (c.date >= jourAujourdhui && !commandesAlertees.has(`commande_proche:${c.id}`)) {
      idsCrees.push(
        insererAlerte(
          boutiqueId,
          "commande_proche",
          `Livraison ${c.date === jourAujourdhui ? "aujourd'hui" : "demain"} : commande ${c.numero} de ${c.clientNom}. Clients → Commandes clients.`,
          "ventes.CommandeClient",
          c.id,
        ),
      );
    }
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
  /** Déjà vue (la page Notifications marque tout comme lu à l'ouverture). */
  lu: boolean;
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
            n.depot_id as depotId, d.nom as depotNom, n.reference_type as referenceType, n.reference_id as referenceId,
            n.lu as lu
     FROM notifications n
     LEFT JOIN depots d ON d.id = n.depot_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY n.date_creation DESC`,
    parametres,
  ).map((n) => ({ ...n, lu: !!Number(n.lu) }));
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

/**
 * Fin d'abonnement (voir abonnement.ts) : une alerte à J-7, une à J-3 et une à
 * l'expiration — jamais deux fois pour la même étape, même si l'appli est
 * ouverte plusieurs fois ou sur plusieurs postes (les alertes se synchronisent).
 */
export function genererAlertesAbonnement(boutiqueId: string): string[] {
  const etat = obtenirEtatAbonnement(boutiqueId);
  if (!etat.dateExpiration || etat.niveau === "ok") return [];
  const expiration = new Date(etat.dateExpiration).getTime();
  const date = (iso: string | number) => new Date(iso).toLocaleDateString("fr-FR");
  const expire = etat.niveau === "grace" || etat.niveau === "bloque";
  const type: TypeNotification = expire ? "abonnement_expire" : "abonnement_proche";
  const debutEtape = new Date(expiration - (expire ? 0 : (etat.joursRestants ?? 0) <= 3 ? 3 : 7) * 86_400_000).toISOString();
  const dejaAlertee = unResultat<{ n: number }>(
    "SELECT COUNT(*) as n FROM notifications WHERE boutique_id = ? AND type = ? AND date_creation >= ? AND supprime = 0",
    [boutiqueId, type, debutEtape],
  );
  if (Number(dejaAlertee?.n ?? 0) > 0) return [];

  const jours = etat.joursRestants ?? 0;
  const quand = jours <= 0 ? "aujourd'hui" : jours === 1 ? "demain" : `dans ${jours} jours`;
  const message = expire
    ? `Abonnement expiré le ${date(expiration)}. ` +
      (etat.niveau === "grace"
        ? `La vente reste possible jusqu'au ${date(etat.finGrace!)} (délai de grâce de ${DELAI_GRACE_JOURS} jours), puis elle sera bloquée.`
        : "La vente est bloquée ; vos données restent consultables.") +
      " Renouvelez l'abonnement."
    : `L'abonnement de la boutique se termine le ${date(expiration)} (${quand}). Pensez à le renouveler pour continuer à vendre sans interruption.`;
  const id = insererAlerte(boutiqueId, type, message, "comptes.Boutique", boutiqueId);
  sauvegarder();
  return [id];
}
