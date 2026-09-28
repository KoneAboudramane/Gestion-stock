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

  const boutique = await db.get("boutiques", boutiqueId);
  const tousMessages = await db.getAllFromIndex("messages", "boutique_id", boutiqueId);
  const idsCrees: string[] = [];
  for (const credit of credits) {
    const client = clientsParId.get(credit.client_id)!;
    const message = texteRappelCredit(client.nom, credit.solde, credit.echeance ?? null, boutique?.nom ?? "", boutique?.devise || "FCFA");
    // Un seul rappel en attente par crédit : mis à jour (montant dû actuel),
    // doublons accumulés retirés, au lieu d'en empiler un par jour.
    const enAttente = tousMessages
      .filter((m) => !m.supprime && m.type === "rappel_credit" && m.reference_id === credit.id && m.statut === "en_attente")
      .sort((a, b) => b.date_creation.localeCompare(a.date_creation));
    if (enAttente.length > 0) {
      for (const doublon of enAttente.slice(1)) {
        await db.put("messages", { ...doublon, supprime: 1, synchronise: 0, date_modification: maintenant() });
      }
      if (enAttente[0].message !== message) {
        await db.put("messages", {
          ...enAttente[0],
          message,
          destinataire: client.telephone ?? "",
          canal: client.telephone ? "whatsapp" : "interne",
          synchronise: 0,
          date_modification: maintenant(),
        });
      }
      continue;
    }
    if (await messageRecentExiste(boutiqueId, "rappel_credit", credit.id)) continue;
    const vente = credit.vente_id ? await db.get("ventes", credit.vente_id) : undefined;

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
  // Rappels encore en attente pour un crédit soldé ou supprimé : devenus sans objet.
  const idsEnCours = new Set(credits.map((c) => c.id));
  for (const m of tousMessages) {
    if (!m.supprime && m.type === "rappel_credit" && m.statut === "en_attente" && m.reference_id && !idsEnCours.has(m.reference_id)) {
      await db.put("messages", { ...m, supprime: 1, synchronise: 0, date_modification: maintenant() });
    }
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
  /** Client concerné (via le crédit ou la vente liés), pour la liste et l'envoi WhatsApp. */
  clientNom: string | null;
  clientTelephone: string | null;
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
    let clientId: string | null = null;
    if (m.reference_type === "clients.Credit" && m.reference_id) clientId = (await db.get("credits", m.reference_id))?.client_id ?? null;
    if (m.reference_type === "ventes.Vente" && m.reference_id) clientId = (await db.get("ventes", m.reference_id))?.client_id ?? null;
    const client = clientId ? await db.get("clients", clientId) : undefined;
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
      clientNom: client?.nom ?? null,
      clientTelephone: client?.telephone || null,
    });
  }
  return resultat.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}

/**
 * Marque le message envoyé (l'ouverture de WhatsApp se fait côté interface).
 * texte / destinataire : version corrigée juste avant l'envoi, le cas échéant.
 */
export async function envoyerMessage(id: string, texte?: string, destinataire?: string): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const message = await db.get("messages", id);
  if (!message) throw new ErreurMessage("Message introuvable.");
  const numero = destinataire ?? message.destinataire;
  await db.put("messages", {
    ...message,
    message: texte ?? message.message,
    destinataire: numero,
    canal: numero ? "whatsapp" : message.canal,
    statut: "envoyee",
    date_envoi: maintenant(),
    synchronise: 0,
    date_modification: maintenant(),
  });
}

/** Traité sans envoi (réglé autrement, appel téléphonique…) : sort de la file, canal « interne ». */
export async function marquerMessageTraite(id: string): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const message = await db.get("messages", id);
  if (!message) throw new ErreurMessage("Message introuvable.");
  await db.put("messages", {
    ...message,
    statut: "envoyee",
    canal: "interne",
    date_envoi: maintenant(),
    synchronise: 0,
    date_modification: maintenant(),
  });
}

function formaterNombre(valeur: number): string {
  return Math.round(Number(valeur) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Texte d'un rappel de crédit, adressé au client (envoyable tel quel par WhatsApp). */
export function texteRappelCredit(clientNom: string, solde: number, echeance: string | null, boutiqueNom: string, devise: string): string {
  let texte = `Bonjour ${clientNom}, petit rappel${boutiqueNom ? ` de ${boutiqueNom}` : ""} : il reste ${formaterNombre(solde)} ${devise} à régler`;
  if (echeance) texte += ` (échéance le ${echeance.slice(0, 10).split("-").reverse().join("/")})`;
  return `${texte}. Merci !`;
}

/**
 * Relance d'un crédit envoyée à la main (WhatsApp ouvert depuis la liste des
 * crédits) : laisse une trace « envoyée » dans Messages.
 */
export async function enregistrerRelanceCredit(
  creditId: string,
  destinataire: string,
  message: string,
  utilisateurId: string | null,
): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  const credit = await db.get("credits", creditId);
  if (!credit) throw new ErreurMessage("Crédit introuvable.");
  const client = await db.get("clients", credit.client_id);
  const vente = credit.vente_id ? await db.get("ventes", credit.vente_id) : undefined;
  const instant = maintenant();
  const messageLocal: MessageLocal = {
    id: crypto.randomUUID(),
    boutique_id: client?.boutique_id ?? "",
    depot_id: vente?.depot_id ?? null,
    utilisateur_id: utilisateurId,
    type: "rappel_credit",
    canal: "whatsapp",
    destinataire,
    message,
    reference_type: "clients.Credit",
    reference_id: creditId,
    statut: "envoyee",
    date_envoi: instant,
    ...suiviSyncNeuf(),
  };
  await db.put("messages", messageLocal);
  return messageLocal.id;
}
