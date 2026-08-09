import { ouvrirBaseDeDonnees } from "../db";
import { maintenant, suiviSyncNeuf } from "../db/helpers";
import type { MessageLocal } from "../db/schema";

/**
 * Port navigateur de client-electron/electron/services/messages.ts : rappel
 * de crédit, envoi simulé (toujours "envoyee", pas de réseau — voir la note
 * en tête du fichier Electron : aucune clé d'API disponible). Contrairement à
 * l'Electron, le ticket WhatsApp généré à la vente (genererTicketWhatsapp)
 * n'est pas porté ici : aucun écran de client-web ne l'utilise pour l'instant
 * (voir Messages.tsx, qui envoie le ticket directement depuis la facture).
 */

export class ErreurMessage extends Error {}

export type TypeMessage = "rappel_credit" | "ticket_whatsapp";
export type CanalMessage = "sms" | "whatsapp" | "interne";
export type StatutMessage = "en_attente" | "envoyee" | "echouee";

const FENETRE_ANTI_DOUBLON_HEURES = 24;

async function messageRecentExiste(boutiqueId: string, type: TypeMessage, referenceId: string): Promise<boolean> {
  const db = await ouvrirBaseDeDonnees();
  const seuil = new Date(Date.now() - FENETRE_ANTI_DOUBLON_HEURES * 3600 * 1000).toISOString();
  const messages = await db.getAllFromIndex("messages", "boutique_id", boutiqueId);
  return messages.some((m) => !m.supprime && m.type === type && m.reference_id === referenceId && m.date_creation >= seuil);
}

async function genererRappelsCreditImpl(boutiqueId: string): Promise<string[]> {
  const db = await ouvrirBaseDeDonnees();
  const clients = await db.getAllFromIndex("clients", "boutique_id", boutiqueId);
  const clientsParId = new Map(clients.map((c) => [c.id, c]));
  const credits = (await db.getAll("credits")).filter(
    (cr) => !cr.supprime && cr.statut === "en_cours" && clientsParId.has(cr.client_id),
  );

  const idsCrees: string[] = [];
  for (const credit of credits) {
    if (await messageRecentExiste(boutiqueId, "rappel_credit", credit.id)) continue;
    const client = clientsParId.get(credit.client_id)!;
    const vente = credit.vente_id ? await db.get("ventes", credit.vente_id) : undefined;

    let message = `Rappel : ${client.nom} doit ${credit.solde} FCFA`;
    if (credit.echeance) message += ` (échéance ${credit.echeance})`;

    const id = crypto.randomUUID();
    const messageLocal: MessageLocal = {
      id,
      boutique_id: boutiqueId,
      depot_id: vente?.depot_id ?? null,
      utilisateur_id: null,
      type: "rappel_credit",
      canal: client.telephone ? "whatsapp" : "interne",
      destinataire: client.telephone ?? "",
      message,
      reference_type: "clients.Credit",
      reference_id: credit.id,
      statut: "en_attente",
      date_envoi: null,
      ...suiviSyncNeuf(),
    };
    await db.put("messages", messageLocal);
    idsCrees.push(id);
  }
  return idsCrees;
}

// Verrou au niveau du module : React StrictMode double-invoque les effets en
// dev, et deux appels concurrents peuvent tous les deux passer la fenêtre
// anti-doublon avant que l'un des deux n'ait eu le temps d'écrire — même
// pattern que l'ancien api/messages.ts.
let generationEnCours: Promise<string[]> | null = null;

export function genererRappelsCredit(boutiqueId: string): Promise<string[]> {
  if (generationEnCours) return generationEnCours;
  generationEnCours = genererRappelsCreditImpl(boutiqueId).finally(() => {
    generationEnCours = null;
  });
  return generationEnCours;
}

// --- Lecture et envoi ---

export interface MessageResume {
  id: string;
  type: TypeMessage;
  canal: CanalMessage;
  destinataire: string;
  message: string;
  statut: StatutMessage;
  dateEnvoi: string | null;
  dateCreation: string;
  depotId: string | null;
  depotNom: string | null;
  utilisateurId: string | null;
  referenceType: string;
  referenceId: string | null;
}

export interface FiltresMessages {
  statut?: StatutMessage;
  depotId?: string;
  utilisateurId?: string;
}

// utilisateur_id vient de comptes.Utilisateur (PK entière Django) : DRF le
// sérialise en nombre, pas en UUID-string comme les autres FK — on normalise
// explicitement en chaîne (même correctif que services/rapports.ts).
function normaliserUtilisateurId(valeur: unknown): string | null {
  return valeur === null || valeur === undefined ? null : String(valeur);
}

export async function listerMessages(boutiqueId: string, filtres: FiltresMessages = {}): Promise<MessageResume[]> {
  const db = await ouvrirBaseDeDonnees();
  let messages = (await db.getAllFromIndex("messages", "boutique_id", boutiqueId)).filter((m) => !m.supprime);
  if (filtres.statut) messages = messages.filter((m) => m.statut === filtres.statut);
  if (filtres.depotId) messages = messages.filter((m) => m.depot_id === filtres.depotId);
  if (filtres.utilisateurId) {
    messages = messages.filter((m) => normaliserUtilisateurId(m.utilisateur_id) === filtres.utilisateurId);
  }

  const resultat: MessageResume[] = [];
  for (const m of messages) {
    const depot = m.depot_id ? await db.get("depots", m.depot_id) : undefined;
    resultat.push({
      id: m.id,
      type: m.type as TypeMessage,
      canal: m.canal,
      destinataire: m.destinataire,
      message: m.message,
      statut: m.statut,
      dateEnvoi: m.date_envoi,
      dateCreation: m.date_creation,
      depotId: m.depot_id,
      depotNom: depot?.nom ?? null,
      utilisateurId: normaliserUtilisateurId(m.utilisateur_id),
      referenceType: m.reference_type,
      referenceId: m.reference_id,
    });
  }
  return resultat.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}

/** Simule l'envoi (WhatsApp/SMS/interne) : toujours "envoyee", pas de réseau. */
export async function envoyerMessage(id: string): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const message = await db.get("messages", id);
  if (!message) throw new ErreurMessage("Message introuvable.");
  await db.put("messages", {
    ...message,
    statut: "envoyee",
    date_envoi: maintenant(),
    synchronise: 0,
    date_modification: maintenant(),
  });
}
