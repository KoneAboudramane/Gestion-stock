import { randomUUID } from "node:crypto";

import { executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";

/**
 * Miroir de notifications/services.py::generer_rappels_credit /
 * generer_ticket_whatsapp / envoyer_message (Phase 2, squelette) :
 * communications sortantes vers un client (WhatsApp/SMS) — rappel de crédit,
 * ticket de vente, envoi simulé. Voir services/notifications.ts pour les
 * alertes internes (rupture de stock).
 */

export class ErreurMessage extends Error {}

export type TypeMessage = "rappel_credit" | "ticket_whatsapp";
export type CanalMessage = "sms" | "whatsapp" | "interne";
export type StatutMessage = "en_attente" | "envoyee" | "echouee";

const FENETRE_ANTI_DOUBLON_HEURES = 24;

function messageRecentExiste(boutiqueId: string, type: TypeMessage, referenceId: string): boolean {
  const seuil = new Date(Date.now() - FENETRE_ANTI_DOUBLON_HEURES * 3600 * 1000).toISOString();
  const resultat = unResultat<{ n: number }>(
    `SELECT COUNT(*) as n FROM messages
     WHERE boutique_id = ? AND type = ? AND reference_id = ? AND date_creation >= ? AND supprime = 0`,
    [boutiqueId, type, referenceId, seuil],
  );
  return (resultat ? Number(resultat.n) : 0) > 0;
}

// --- Génération ---

interface LigneCreditPourRappel {
  id: string;
  solde: number;
  echeance: string | null;
  clientNom: string;
  clientTelephone: string;
  depotId: string | null;
}

export function genererRappelsCredit(boutiqueId: string): string[] {
  const creditsEnCours = tousLesResultats<LigneCreditPourRappel>(
    `SELECT cr.id as id, cr.solde as solde, cr.echeance as echeance,
            cl.nom as clientNom, cl.telephone as clientTelephone, v.depot_id as depotId
     FROM credits cr
     JOIN clients cl ON cl.id = cr.client_id
     LEFT JOIN ventes v ON v.id = cr.vente_id
     WHERE cl.boutique_id = ? AND cr.statut = 'en_cours' AND cr.supprime = 0`,
    [boutiqueId],
  );

  const boutique = unResultat<{ nom: string; devise: string }>("SELECT nom, devise FROM boutiques WHERE id = ?", [boutiqueId]);
  const idsCrees: string[] = [];
  const maintenant = new Date().toISOString();
  let modifie = false;
  for (const credit of creditsEnCours) {
    const message = texteRappelCredit(credit.clientNom, credit.solde, credit.echeance, boutique?.nom ?? "", boutique?.devise || "FCFA");
    // Un seul rappel en attente par crédit : on le met à jour (montant dû actuel)
    // et on retire les doublons accumulés, au lieu d'en empiler un par jour.
    const enAttente = tousLesResultats<{ id: string; message: string }>(
      `SELECT id, message FROM messages
       WHERE boutique_id = ? AND type = 'rappel_credit' AND reference_id = ? AND statut = 'en_attente' AND supprime = 0
       ORDER BY date_creation DESC`,
      [boutiqueId, credit.id],
    );
    if (enAttente.length > 0) {
      for (const doublon of enAttente.slice(1)) {
        executer("UPDATE messages SET supprime = 1, synchronise = 0, date_modification = ? WHERE id = ?", [maintenant, doublon.id]);
        modifie = true;
      }
      if (enAttente[0].message !== message) {
        executer(
          "UPDATE messages SET message = ?, destinataire = ?, canal = ?, synchronise = 0, date_modification = ? WHERE id = ?",
          [message, credit.clientTelephone ?? "", credit.clientTelephone ? "whatsapp" : "interne", maintenant, enAttente[0].id],
        );
        modifie = true;
      }
      continue;
    }
    if (messageRecentExiste(boutiqueId, "rappel_credit", credit.id)) continue;
    const id = randomUUID();
    executer(
      `INSERT INTO messages
         (id, boutique_id, depot_id, type, canal, destinataire, message, reference_type, reference_id, statut,
          date_creation, date_modification)
       VALUES (?, ?, ?, 'rappel_credit', ?, ?, ?, 'clients.Credit', ?, 'en_attente', ?, ?)`,
      [
        id,
        boutiqueId,
        credit.depotId ?? null,
        credit.clientTelephone ? "whatsapp" : "interne",
        credit.clientTelephone ?? "",
        message,
        credit.id,
        maintenant,
        maintenant,
      ],
    );
    idsCrees.push(id);
  }
  // Rappels encore en attente pour un crédit soldé ou supprimé : devenus sans objet.
  const obsoletes = tousLesResultats<{ id: string }>(
    `SELECT m.id as id FROM messages m
     LEFT JOIN credits cr ON cr.id = m.reference_id
     WHERE m.boutique_id = ? AND m.type = 'rappel_credit' AND m.statut = 'en_attente' AND m.supprime = 0
       AND (cr.id IS NULL OR cr.supprime = 1 OR cr.statut != 'en_cours')`,
    [boutiqueId],
  );
  for (const o of obsoletes) {
    executer("UPDATE messages SET supprime = 1, synchronise = 0, date_modification = ? WHERE id = ?", [maintenant, o.id]);
    modifie = true;
  }
  if (idsCrees.length > 0 || modifie) sauvegarder();
  return idsCrees;
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

export function genererTicketWhatsapp(venteId: string): string {
  const vente = unResultat<{
    boutiqueId: string;
    depotId: string;
    utilisateurId: string | null;
    numero: string;
    totalNet: number;
    clientTelephone: string | null;
  }>(
    `SELECT v.boutique_id as boutiqueId, v.depot_id as depotId, v.utilisateur_id as utilisateurId,
            v.numero as numero, v.total_net as totalNet, c.telephone as clientTelephone
     FROM ventes v
     LEFT JOIN clients c ON c.id = v.client_id
     WHERE v.id = ?`,
    [venteId],
  );
  if (!vente) throw new ErreurMessage("Vente introuvable.");
  const devise = unResultat<{ devise: string }>("SELECT devise FROM boutiques WHERE id = ?", [vente.boutiqueId])?.devise || "FCFA";

  const lignes = tousLesResultats<{ produitNom: string; quantite: number; sousTotal: number }>(
    `SELECT p.nom as produitNom, lv.quantite as quantite, lv.sous_total as sousTotal
     FROM lignes_vente lv
     JOIN variantes va ON va.id = lv.variante_id
     JOIN produits p ON p.id = va.produit_id
     WHERE lv.vente_id = ?`,
    [venteId],
  );
  const lignesTexte = lignes.map((l) => `- ${l.produitNom} x${l.quantite} = ${formaterNombre(l.sousTotal)} ${devise}`).join("\n");
  const message = `Ticket ${vente.numero}\n${lignesTexte}\nTotal : ${formaterNombre(vente.totalNet)} ${devise}`;
  const destinataire = vente.clientTelephone ?? "";

  const id = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    `INSERT INTO messages
       (id, boutique_id, depot_id, utilisateur_id, type, canal, destinataire, message, reference_type,
        reference_id, statut, date_creation, date_modification)
     VALUES (?, ?, ?, ?, 'ticket_whatsapp', ?, ?, ?, 'ventes.Vente', ?, 'en_attente', ?, ?)`,
    [
      id,
      vente.boutiqueId,
      vente.depotId,
      vente.utilisateurId,
      destinataire ? "whatsapp" : "interne",
      destinataire,
      message,
      venteId,
      maintenant,
      maintenant,
    ],
  );
  sauvegarder();
  return id;
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

export function listerMessages(boutiqueId: string, filtres: FiltresMessages = {}): MessageResume[] {
  const conditions = ["m.boutique_id = ?", "m.supprime = 0"];
  const parametres: string[] = [boutiqueId];
  if (filtres.statut) {
    conditions.push("m.statut = ?");
    parametres.push(filtres.statut);
  }
  if (filtres.depotId) {
    conditions.push("m.depot_id = ?");
    parametres.push(filtres.depotId);
  }
  if (filtres.utilisateurId) {
    conditions.push("m.utilisateur_id = ?");
    parametres.push(filtres.utilisateurId);
  }
  return tousLesResultats<MessageResume>(
    `SELECT m.id as id, m.type as type, m.canal as canal, m.destinataire as destinataire, m.message as message,
            m.statut as statut, m.date_envoi as dateEnvoi, m.date_creation as dateCreation,
            m.depot_id as depotId, d.nom as depotNom, m.utilisateur_id as utilisateurId,
            m.reference_type as referenceType, m.reference_id as referenceId,
            cl.nom as clientNom, cl.telephone as clientTelephone
     FROM messages m
     LEFT JOIN depots d ON d.id = m.depot_id
     LEFT JOIN credits cr ON m.reference_type = 'clients.Credit' AND cr.id = m.reference_id
     LEFT JOIN ventes vr ON m.reference_type = 'ventes.Vente' AND vr.id = m.reference_id
     LEFT JOIN clients cl ON cl.id = COALESCE(cr.client_id, vr.client_id)
     WHERE ${conditions.join(" AND ")}
     ORDER BY m.date_creation DESC`,
    parametres,
  );
}

/**
 * Marque le message envoyé (l'ouverture de WhatsApp se fait côté interface).
 * texte / destinataire : version corrigée juste avant l'envoi, le cas échéant.
 */
export function envoyerMessage(id: string, texte?: string, destinataire?: string): void {
  const message = unResultat<{ canal: CanalMessage; message: string; destinataire: string }>(
    "SELECT canal, message, destinataire FROM messages WHERE id = ?",
    [id],
  );
  if (!message) throw new ErreurMessage("Message introuvable.");

  const maintenant = new Date().toISOString();
  const numero = destinataire ?? message.destinataire;
  executer(
    `UPDATE messages SET statut = 'envoyee', date_envoi = ?, message = ?, destinataire = ?, canal = ?,
            synchronise = 0, date_modification = ? WHERE id = ?`,
    [maintenant, texte ?? message.message, numero, numero ? "whatsapp" : message.canal, maintenant, id],
  );
  sauvegarder();
}

/** Traité sans envoi (réglé autrement, appel téléphonique…) : sort de la file, canal « interne ». */
export function marquerMessageTraite(id: string): void {
  if (!unResultat("SELECT id FROM messages WHERE id = ?", [id])) throw new ErreurMessage("Message introuvable.");
  const maintenant = new Date().toISOString();
  executer(
    "UPDATE messages SET statut = 'envoyee', canal = 'interne', date_envoi = ?, synchronise = 0, date_modification = ? WHERE id = ?",
    [maintenant, maintenant, id],
  );
  sauvegarder();
}

/**
 * Relance d'un crédit envoyée à la main (WhatsApp ouvert depuis la liste des
 * crédits) : laisse une trace « envoyée » dans Messages.
 */
export function enregistrerRelanceCredit(
  creditId: string,
  destinataire: string,
  message: string,
  utilisateurId: string | null,
): string {
  const credit = unResultat<{ boutiqueId: string; depotId: string | null }>(
    `SELECT cl.boutique_id as boutiqueId, v.depot_id as depotId
     FROM credits cr JOIN clients cl ON cl.id = cr.client_id LEFT JOIN ventes v ON v.id = cr.vente_id
     WHERE cr.id = ?`,
    [creditId],
  );
  if (!credit) throw new ErreurMessage("Crédit introuvable.");
  const id = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    `INSERT INTO messages
       (id, boutique_id, depot_id, utilisateur_id, type, canal, destinataire, message, reference_type, reference_id,
        statut, date_envoi, date_creation, date_modification)
     VALUES (?, ?, ?, ?, 'rappel_credit', 'whatsapp', ?, ?, 'clients.Credit', ?, 'envoyee', ?, ?, ?)`,
    [id, credit.boutiqueId, credit.depotId ?? null, utilisateurId, destinataire, message, creditId, maintenant, maintenant, maintenant],
  );
  sauvegarder();
  return id;
}
