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

  const idsCrees: string[] = [];
  const maintenant = new Date().toISOString();
  for (const credit of creditsEnCours) {
    if (messageRecentExiste(boutiqueId, "rappel_credit", credit.id)) continue;
    let message = `Rappel : ${credit.clientNom} doit ${credit.solde} FCFA`;
    if (credit.echeance) message += ` (échéance ${credit.echeance})`;
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
  if (idsCrees.length > 0) sauvegarder();
  return idsCrees;
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

  const lignes = tousLesResultats<{ produitNom: string; quantite: number; sousTotal: number }>(
    `SELECT p.nom as produitNom, lv.quantite as quantite, lv.sous_total as sousTotal
     FROM lignes_vente lv
     JOIN variantes va ON va.id = lv.variante_id
     JOIN produits p ON p.id = va.produit_id
     WHERE lv.vente_id = ?`,
    [venteId],
  );
  const lignesTexte = lignes.map((l) => `- ${l.produitNom} x${l.quantite} = ${l.sousTotal} FCFA`).join("\n");
  const message = `Ticket ${vente.numero}\n${lignesTexte}\nTotal : ${vente.totalNet} FCFA`;
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
            m.reference_type as referenceType, m.reference_id as referenceId
     FROM messages m
     LEFT JOIN depots d ON d.id = m.depot_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY m.date_creation DESC`,
    parametres,
  );
}

/** Simule l'envoi (WhatsApp/SMS/interne) : toujours "envoyee", pas de réseau. */
export function envoyerMessage(id: string): void {
  const message = unResultat<{ canal: CanalMessage }>("SELECT canal FROM messages WHERE id = ?", [id]);
  if (!message) throw new ErreurMessage("Message introuvable.");

  const maintenant = new Date().toISOString();
  executer(
    "UPDATE messages SET statut = 'envoyee', date_envoi = ?, synchronise = 0, date_modification = ? WHERE id = ?",
    [maintenant, maintenant, id],
  );
  sauvegarder();
}
