import { ouvrirBaseDeDonnees } from "../db";
import { maintenant, suiviSyncNeuf } from "../db/helpers";
import { DELAI_GRACE_JOURS, obtenirEtatAbonnement } from "./abonnement";
import { echeancesEnCours } from "./achats";
import { echeancesCreditsEnCours } from "./clients";
import type { NotificationLocale } from "../db/schema";
import { produitsDormants } from "./rapports";
import { listerDestockages } from "./stock";

/**
 * Port navigateur de client-electron/electron/services/notifications.ts :
 * alerte interne du système (rupture de stock), pas de canal ni d'envoi —
 * voir services/messages.ts pour les communications externes (rappel de
 * crédit, ticket WhatsApp).
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
    // Il reste du gros (cartons) dans ce dépôt : détailler plutôt que commander.
    let suggestion = "";
    for (const g of await db.getAll("variantes")) {
      if (g.supprime || g.variante_detail_id !== variante.id) continue;
      const stockGros = Number((await db.getFromIndex("stocks", "variante_depot", [g.id, depot.id]))?.quantite ?? 0);
      if (stockGros > 0) {
        const produitGros = await db.get("produits", g.produit_id);
        suggestion = ` — il reste ${stockGros} « ${produitGros?.nom ?? ""} » : déballez-en un plutôt que de commander.`;
        break;
      }
    }
    const message = `Rupture de stock : ${produit?.nom ?? ""} (${depot.nom}), ${s.quantite} restant(s)${suggestion}`;
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

// --- Alertes de déstockage (port de client-electron/electron/services/notifications.ts) ---

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

async function genererAlertesDestockageImpl(boutiqueId: string): Promise<string[]> {
  const db = await ouvrirBaseDeDonnees();
  const idsCrees: string[] = [];
  const devise = (await db.get("boutiques", boutiqueId))?.devise || "FCFA";
  const notifications = (await db.getAllFromIndex("notifications", "boutique_id", boutiqueId)).filter((n) => !n.supprime);

  async function inserer(type: TypeNotification, message: string, referenceType: string, referenceId: string | null) {
    const notification: NotificationLocale = {
      id: crypto.randomUUID(),
      boutique_id: boutiqueId,
      depot_id: null,
      type,
      message,
      reference_type: referenceType,
      reference_id: referenceId,
      lu: 0,
      ...suiviSyncNeuf(),
    };
    await db.put("notifications", notification);
    idsCrees.push(notification.id);
  }

  const seuilSemaine = new Date(Date.now() - FREQUENCE_ALERTE_DORMANTS_JOURS * 86_400_000).toISOString();
  if (!notifications.some((n) => n.type === "alerte_dormants" && n.date_creation >= seuilSemaine)) {
    const dormants = (await produitsDormants(boutiqueId, SEUIL_ALERTE_DORMANTS_JOURS)).filter((d) => !d.enDestockage);
    if (dormants.length > 0) {
      const valeur = dormants.reduce((somme, d) => somme + d.valeurImmobilisee, 0);
      await inserer(
        "alerte_dormants",
        `${dormants.length} produit${dormants.length > 1 ? "s" : ""} sans vente depuis ${SEUIL_ALERTE_DORMANTS_JOURS} jours : ` +
          `${formaterNombre(valeur)} ${devise} qui dorment. Pensez au déstockage (Stock → Produits dormants).`,
        "rapports.ProduitsDormants",
        null,
      );
    }
  }

  const aujourdhui = new Date();
  const limite = new Date(aujourdhui);
  limite.setDate(limite.getDate() + PREAVIS_FIN_DESTOCKAGE_JOURS);
  for (const d of await listerDestockages(boutiqueId)) {
    if (d.statut !== "en_cours" || !d.dateFin) continue;
    if (d.dateFin < jourLocal(aujourdhui) || d.dateFin > jourLocal(limite)) continue;
    if (notifications.some((n) => n.type === "fin_destockage" && n.reference_id === d.id)) continue;
    const fin = new Date(`${d.dateFin}T00:00:00`).toLocaleDateString("fr-FR");
    await inserer(
      "fin_destockage",
      `Le déstockage de ${d.produitNom} (${formaterNombre(d.prixDestockage)} ${devise}) se termine le ${fin}. ` +
        `Prolongez-le si besoin (Stock → Déstockage → Modifier).`,
      "stock.Destockage",
      d.id,
    );
  }

  // Échéances des dettes fournisseur : 3 jours avant, puis dès le lendemain si pas payée.
  const limiteEcheance = new Date(aujourdhui);
  limiteEcheance.setDate(limiteEcheance.getDate() + PREAVIS_ECHEANCE_JOURS);
  const dejaAlertees = new Set(
    notifications
      .filter((n) => n.type === "echeance_proche" || n.type === "echeance_retard")
      .map((n) => `${n.type}:${n.reference_id}`),
  );
  for (const e of await echeancesEnCours(boutiqueId)) {
    const date = new Date(`${e.dateEcheance}T00:00:00`).toLocaleDateString("fr-FR");
    const reste = `${formaterNombre(e.montant - e.couvert)} ${devise}`;
    const commande = e.commandeNumero ? ` (commande ${e.commandeNumero})` : "";
    if (e.statut === "en_retard" && !dejaAlertees.has(`echeance_retard:${e.id}`)) {
      await inserer(
        "echeance_retard",
        `Échéance en retard : ${reste} à payer à ${e.fournisseurNom}${commande} depuis le ${date}. Achats → Dettes.`,
        "fournisseurs.EcheanceDette",
        e.id,
      );
    } else if (
      e.statut !== "en_retard" &&
      e.dateEcheance <= jourLocal(limiteEcheance) &&
      !dejaAlertees.has(`echeance_proche:${e.id}`)
    ) {
      await inserer(
        "echeance_proche",
        `Échéance le ${date} : ${reste} à payer à ${e.fournisseurNom}${commande}. Achats → Dettes.`,
        "fournisseurs.EcheanceDette",
        e.id,
      );
    }
  }
  // Échéances des crédits clients : 3 jours avant, puis dès le lendemain si pas réglée.
  const creditsAlertes = new Set(
    notifications
      .filter((n) => n.type === "credit_proche" || n.type === "credit_retard")
      .map((n) => `${n.type}:${n.reference_id}`),
  );
  for (const e of await echeancesCreditsEnCours(boutiqueId)) {
    const date = new Date(`${e.dateEcheance}T00:00:00`).toLocaleDateString("fr-FR");
    const reste = `${formaterNombre(e.montant - e.couvert)} ${devise}`;
    const vente = e.venteNumero ? ` (vente ${e.venteNumero})` : "";
    if (e.statut === "en_retard" && !creditsAlertes.has(`credit_retard:${e.id}`)) {
      await inserer(
        
        "credit_retard",
        `Crédit en retard : ${e.clientNom} doit ${reste}${vente} depuis le ${date}. Clients → Crédits.`,
        "clients.EcheanceCredit",
        e.id,
      );
    } else if (
      e.statut !== "en_retard" &&
      e.dateEcheance <= jourLocal(limiteEcheance) &&
      !creditsAlertes.has(`credit_proche:${e.id}`)
    ) {
      await inserer(
        
        "credit_proche",
        `Échéance le ${date} : ${e.clientNom} doit régler ${reste}${vente}. Clients → Crédits.`,
        "clients.EcheanceCredit",
        e.id,
      );
    }
  }

  // Commandes clients : livraison prévue aujourd'hui ou demain, puis en retard.
  const commandesAlertees = new Set(
    notifications
      .filter((n) => n.type === "commande_proche" || n.type === "commande_retard")
      .map((n) => `${n.type}:${n.reference_id}`),
  );
  const jourAujourdhui = jourLocal(aujourdhui);
  const lendemain = new Date(aujourdhui);
  lendemain.setDate(lendemain.getDate() + 1);
  const dbCommandes = await ouvrirBaseDeDonnees();
  for (const c of await dbCommandes.getAllFromIndex("commandes_client", "boutique_id", boutiqueId)) {
    if (c.supprime || !["en_attente", "prete", "partielle"].includes(c.statut)) continue;
    if (!c.date_livraison_prevue || c.date_livraison_prevue > jourLocal(lendemain)) continue;
    const clientNom = (await dbCommandes.get("clients", c.client_id))?.nom ?? "";
    const date = new Date(`${c.date_livraison_prevue}T00:00:00`).toLocaleDateString("fr-FR");
    if (c.date_livraison_prevue < jourAujourdhui && !commandesAlertees.has(`commande_retard:${c.id}`)) {
      await inserer(
        "commande_retard",
        `Commande en retard : ${clientNom} attend sa commande ${c.numero} depuis le ${date}. Clients → Commandes clients.`,
        "ventes.CommandeClient",
        c.id,
      );
    } else if (c.date_livraison_prevue >= jourAujourdhui && !commandesAlertees.has(`commande_proche:${c.id}`)) {
      await inserer(
        "commande_proche",
        `Livraison ${c.date_livraison_prevue === jourAujourdhui ? "aujourd'hui" : "demain"} : commande ${c.numero} de ${clientNom}. Clients → Commandes clients.`,
        "ventes.CommandeClient",
        c.id,
      );
    }
  }
  return idsCrees;
}

let alertesDestockageEnCours: Promise<string[]> | null = null;

/** Appelé à l'ouverture de l'appli (Shell.tsx). Verrou : StrictMode double-invoque les effets. */
export function genererAlertesDestockage(boutiqueId: string): Promise<string[]> {
  if (alertesDestockageEnCours) return alertesDestockageEnCours;
  alertesDestockageEnCours = genererAlertesDestockageImpl(boutiqueId).finally(() => {
    alertesDestockageEnCours = null;
  });
  return alertesDestockageEnCours;
}

// --- Fin d'abonnement (port de client-electron/electron/services/notifications.ts) ---

/**
 * Une alerte à J-7, une à J-3 et une à l'expiration — jamais deux fois pour la
 * même étape, même si l'appli est ouverte plusieurs fois ou sur plusieurs postes.
 */
async function genererAlertesAbonnementImpl(boutiqueId: string): Promise<string[]> {
  const etat = await obtenirEtatAbonnement(boutiqueId);
  if (!etat.dateExpiration || etat.niveau === "ok") return [];
  const db = await ouvrirBaseDeDonnees();
  const expiration = new Date(etat.dateExpiration).getTime();
  const date = (iso: string | number) => new Date(iso).toLocaleDateString("fr-FR");
  const expire = etat.niveau === "grace" || etat.niveau === "bloque";
  const type: TypeNotification = expire ? "abonnement_expire" : "abonnement_proche";
  const debutEtape = new Date(expiration - (expire ? 0 : (etat.joursRestants ?? 0) <= 3 ? 3 : 7) * 86_400_000).toISOString();
  const dejaAlertee = (await db.getAllFromIndex("notifications", "boutique_id", boutiqueId)).some(
    (n) => !n.supprime && n.type === type && n.date_creation >= debutEtape,
  );
  if (dejaAlertee) return [];

  const jours = etat.joursRestants ?? 0;
  const quand = jours <= 0 ? "aujourd'hui" : jours === 1 ? "demain" : `dans ${jours} jours`;
  const message = expire
    ? `Abonnement expiré le ${date(expiration)}. ` +
      (etat.niveau === "grace"
        ? `La vente reste possible jusqu'au ${date(etat.finGrace!)} (délai de grâce de ${DELAI_GRACE_JOURS} jours), puis elle sera bloquée.`
        : "La vente est bloquée ; vos données restent consultables.") +
      " Renouvelez l'abonnement."
    : `L'abonnement de la boutique se termine le ${date(expiration)} (${quand}). Pensez à le renouveler pour continuer à vendre sans interruption.`;
  const notification: NotificationLocale = {
    id: crypto.randomUUID(),
    boutique_id: boutiqueId,
    depot_id: null,
    type,
    message,
    reference_type: "comptes.Boutique",
    reference_id: boutiqueId,
    lu: 0,
    ...suiviSyncNeuf(),
  };
  await db.put("notifications", notification);
  return [notification.id];
}

let alertesAbonnementEnCours: Promise<string[]> | null = null;

/** Appelé à l'ouverture de l'appli (Shell.tsx). Verrou : StrictMode double-invoque les effets. */
export function genererAlertesAbonnement(boutiqueId: string): Promise<string[]> {
  if (alertesAbonnementEnCours) return alertesAbonnementEnCours;
  alertesAbonnementEnCours = genererAlertesAbonnementImpl(boutiqueId).finally(() => {
    alertesAbonnementEnCours = null;
  });
  return alertesAbonnementEnCours;
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
      lu: !!n.lu,
    });
  }
  return resultat.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}

// --- Cloche de l'en-tête (compteur + "marquer comme lues") ---

export async function compterNotificationsNonLues(boutiqueId: string, depotId?: string): Promise<number> {
  const db = await ouvrirBaseDeDonnees();
  const notifications = (await db.getAllFromIndex("notifications", "boutique_id", boutiqueId)).filter(
    (n) => !n.supprime && !n.lu && (!depotId || n.depot_id === depotId),
  );
  return notifications.length;
}

/** Appelé à l'ouverture de la page Notifications : éteint le badge de la cloche pour ce qui a été effectivement affiché (même dépôt). */
export async function marquerNotificationsLues(boutiqueId: string, depotId?: string): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const notifications = (await db.getAllFromIndex("notifications", "boutique_id", boutiqueId)).filter(
    (n) => !n.lu && (!depotId || n.depot_id === depotId),
  );
  for (const n of notifications) {
    await db.put("notifications", { ...n, lu: 1, date_modification: maintenant(), synchronise: 0 });
  }
}
