import { randomUUID } from "node:crypto";

import { dansUneTransaction, executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";
import { prochainNumero } from "./numerotation";
import { deposerSurCompteClientSansTransaction, soldeCompteClient, type OperationCompte } from "./comptesTiers";
import { creerVente, type PaiementEntree, type VenteCreee } from "./ventes";

/**
 * Commandes clients (ventes.CommandeClient) : ce qu'un client a commandé,
 * enregistré avant la livraison. Le stock ne bouge qu'à la livraison, qui est
 * une vente normale rattachée à la commande (creerVente + commandeClientId) ;
 * d'ici là, le restant à livrer est « réservé » dans le dépôt de la commande
 * (affiché dans Stock, la caisse avertit sans bloquer). L'avance va dans le
 * porte-monnaie du client ; `avance` n'en garde que le total, pour l'affichage.
 */

export type StatutCommandeClient = "en_attente" | "prete" | "partielle" | "livree" | "annulee";

export class ErreurCommandeClient extends Error {}

export interface LigneCommandeClientEntree {
  varianteId: string;
  quantite: number;
  /** Prix promis au client, figé à la commande. */
  prixUnitaire: number;
}

export interface ParametresCommandeClient {
  boutiqueId: string;
  clientId: string;
  depotId: string;
  utilisateurId: string | null;
  /** AAAA-MM-JJ, ou null si non fixée. */
  dateLivraisonPrevue: string | null;
  note?: string;
  lignes: LigneCommandeClientEntree[];
}

const STATUTS_OUVERTS = "('en_attente', 'prete', 'partielle')";


function verifierLignes(lignes: LigneCommandeClientEntree[]): void {
  if (lignes.length === 0) throw new ErreurCommandeClient("Ajoutez au moins un article.");
  if (new Set(lignes.map((l) => l.varianteId)).size !== lignes.length) {
    throw new ErreurCommandeClient("Un même article apparaît deux fois.");
  }
  if (lignes.some((l) => !(l.quantite > 0))) throw new ErreurCommandeClient("Chaque quantité doit être supérieure à 0.");
  if (lignes.some((l) => !(l.prixUnitaire >= 0))) throw new ErreurCommandeClient("Indiquez le prix de chaque article.");
}

function sousTotal(l: LigneCommandeClientEntree): number {
  return Math.round(l.quantite * l.prixUnitaire);
}

function commandeOuverte(id: string): { numero: string; statut: StatutCommandeClient; client_id: string; depot_id: string; avance: number } {
  const commande = unResultat<{
    numero: string;
    statut: StatutCommandeClient;
    client_id: string;
    depot_id: string;
    avance: number;
  }>("SELECT numero, statut, client_id, depot_id, avance FROM commandes_client WHERE id = ? AND supprime = 0", [id]);
  if (!commande) throw new ErreurCommandeClient("Commande introuvable.");
  if (commande.statut === "livree") throw new ErreurCommandeClient("Cette commande est déjà entièrement livrée.");
  if (commande.statut === "annulee") throw new ErreurCommandeClient("Cette commande est annulée.");
  return commande;
}

export function creerCommandeClient(params: ParametresCommandeClient): { id: string; numero: string; total: number } {
  const { boutiqueId, clientId, depotId, utilisateurId, dateLivraisonPrevue, note = "", lignes } = params;
  if (!clientId) throw new ErreurCommandeClient("Choisissez le client.");
  if (!depotId) throw new ErreurCommandeClient("Choisissez le dépôt qui livrera.");
  verifierLignes(lignes);
  const total = lignes.reduce((t, l) => t + sousTotal(l), 0);

  const resultat = dansUneTransaction(() => {
    const id = randomUUID();
    const numero = prochainNumero("commandes_client", "CMC", boutiqueId, utilisateurId);
    const maintenant = new Date().toISOString();
    executer(
      `INSERT INTO commandes_client
         (id, boutique_id, client_id, depot_id, utilisateur_id, numero, statut, date_livraison_prevue, note, total, avance,
          date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, 'en_attente', ?, ?, ?, 0, ?, ?)`,
      [id, boutiqueId, clientId, depotId, utilisateurId, numero, dateLivraisonPrevue, note.trim(), total, maintenant, maintenant],
    );
    for (const l of lignes) {
      executer(
        `INSERT INTO lignes_commande_client
           (id, commande_id, variante_id, quantite, quantite_livree, prix_unitaire, sous_total, date_creation, date_modification)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [randomUUID(), id, l.varianteId, l.quantite, l.prixUnitaire, sousTotal(l), maintenant, maintenant],
      );
    }
    return { id, numero, total };
  });
  sauvegarder();
  return resultat;
}

export interface ModificationCommandeClient {
  clientId?: string;
  depotId?: string;
  dateLivraisonPrevue?: string | null;
  note?: string;
  lignes?: LigneCommandeClientEntree[];
}

/**
 * Modifiable tant qu'elle n'est ni livrée ni annulée. Une fois une partie
 * livrée : client et dépôt ne changent plus, une ligne déjà livrée en partie
 * reste (quantité au moins égale au livré, prix inchangé).
 */
export function modifierCommandeClient(id: string, champs: ModificationCommandeClient): void {
  const commande = commandeOuverte(id);
  const dejaLivree = commande.statut === "partielle";
  if (dejaLivree && champs.clientId && champs.clientId !== commande.client_id) {
    throw new ErreurCommandeClient("Une partie est déjà livrée : le client ne peut plus changer.");
  }
  if (dejaLivree && champs.depotId && champs.depotId !== commande.depot_id) {
    throw new ErreurCommandeClient("Une partie est déjà livrée : le dépôt ne peut plus changer.");
  }

  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    if (champs.lignes) {
      verifierLignes(champs.lignes);
      const existantes = tousLesResultats<{ id: string; variante_id: string; quantite_livree: number; prix_unitaire: number }>(
        "SELECT id, variante_id, quantite_livree, prix_unitaire FROM lignes_commande_client WHERE commande_id = ? AND supprime = 0",
        [id],
      );
      const nouvelles = new Map(champs.lignes.map((l) => [l.varianteId, l]));
      for (const ancienne of existantes) {
        const livree = Number(ancienne.quantite_livree);
        const nouvelle = nouvelles.get(ancienne.variante_id);
        if (!nouvelle) {
          if (livree > 0) throw new ErreurCommandeClient("Un article déjà livré en partie ne peut pas être retiré.");
          executer("UPDATE lignes_commande_client SET supprime = 1, synchronise = 0, date_modification = ? WHERE id = ?", [
            maintenant,
            ancienne.id,
          ]);
          continue;
        }
        if (nouvelle.quantite < livree) {
          throw new ErreurCommandeClient("La quantité ne peut pas être inférieure à ce qui est déjà livré.");
        }
        const prix = livree > 0 ? Number(ancienne.prix_unitaire) : nouvelle.prixUnitaire;
        executer(
          `UPDATE lignes_commande_client SET quantite = ?, prix_unitaire = ?, sous_total = ?, synchronise = 0, date_modification = ?
           WHERE id = ?`,
          [nouvelle.quantite, prix, sousTotal({ ...nouvelle, prixUnitaire: prix }), maintenant, ancienne.id],
        );
        nouvelles.delete(ancienne.variante_id);
      }
      for (const l of nouvelles.values()) {
        executer(
          `INSERT INTO lignes_commande_client
             (id, commande_id, variante_id, quantite, quantite_livree, prix_unitaire, sous_total, date_creation, date_modification)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
          [randomUUID(), id, l.varianteId, l.quantite, l.prixUnitaire, sousTotal(l), maintenant, maintenant],
        );
      }
      const total = Number(
        unResultat<{ t: number }>(
          "SELECT COALESCE(SUM(sous_total), 0) as t FROM lignes_commande_client WHERE commande_id = ? AND supprime = 0",
          [id],
        )?.t ?? 0,
      );
      // Toutes les quantités restantes ont pu être ramenées au livré : la commande est complète.
      const reste = Number(
        unResultat<{ r: number }>(
          "SELECT COALESCE(SUM(quantite - quantite_livree), 0) as r FROM lignes_commande_client WHERE commande_id = ? AND supprime = 0",
          [id],
        )?.r ?? 0,
      );
      executer(
        `UPDATE commandes_client SET total = ?, statut = CASE WHEN ? <= 0 AND statut = 'partielle' THEN 'livree' ELSE statut END,
           synchronise = 0, date_modification = ? WHERE id = ?`,
        [total, reste, maintenant, id],
      );
    }
    const colonnes: string[] = [];
    const valeurs: (string | null)[] = [];
    if (champs.clientId) {
      colonnes.push("client_id = ?");
      valeurs.push(champs.clientId);
    }
    if (champs.depotId) {
      colonnes.push("depot_id = ?");
      valeurs.push(champs.depotId);
    }
    if (champs.dateLivraisonPrevue !== undefined) {
      colonnes.push("date_livraison_prevue = ?");
      valeurs.push(champs.dateLivraisonPrevue);
    }
    if (champs.note !== undefined) {
      colonnes.push("note = ?");
      valeurs.push(champs.note.trim());
    }
    if (colonnes.length > 0) {
      executer(
        `UPDATE commandes_client SET ${colonnes.join(", ")}, synchronise = 0, date_modification = ? WHERE id = ?`,
        [...valeurs, maintenant, id],
      );
    }
  });
  sauvegarder();
}

/** « Prête » (marchandise préparée) ou retour « en attente » ; sans effet sur une commande livrée en partie. */
export function marquerCommandePrete(id: string, prete: boolean): void {
  const commande = commandeOuverte(id);
  if (commande.statut === "partielle") return;
  executer("UPDATE commandes_client SET statut = ?, synchronise = 0, date_modification = ? WHERE id = ?", [
    prete ? "prete" : "en_attente",
    new Date().toISOString(),
    id,
  ]);
  sauvegarder();
}

/**
 * Annule le restant à livrer (les livraisons déjà faites restent des ventes).
 * L'avance reste dans le porte-monnaie du client, qu'on peut lui rendre.
 */
export function annulerCommandeClient(id: string): void {
  commandeOuverte(id);
  const maintenant = new Date().toISOString();
  executer(
    "UPDATE commandes_client SET statut = 'annulee', date_annulation = ?, synchronise = 0, date_modification = ? WHERE id = ?",
    [maintenant, maintenant, id],
  );
  sauvegarder();
}

/** Avance du client : déposée sur son porte-monnaie (caisse si espèces), cumulée sur la commande. */
export function verserAvanceCommande(id: string, op: OperationCompte): void {
  const commande = commandeOuverte(id);
  dansUneTransaction(() => {
    deposerSurCompteClientSansTransaction(commande.client_id, {
      ...op,
      depotId: op.depotId ?? commande.depot_id,
      motif: `Avance commande ${commande.numero}`,
    });
    executer("UPDATE commandes_client SET avance = avance + ?, synchronise = 0, date_modification = ? WHERE id = ?", [
      op.montant,
      new Date().toISOString(),
      id,
    ]);
  });
  sauvegarder();
}

export interface ParametresLivraison {
  commandeId: string;
  utilisateurId: string | null;
  /** Quantités livrées maintenant (au plus le restant de chaque ligne). */
  lignes: { varianteId: string; quantite: number }[];
  paiements: PaiementEntree[];
}

/** Livraison : une vente au prix figé de la commande, au client et depuis le dépôt de la commande. */
export function livrerCommandeClient(params: ParametresLivraison): VenteCreee {
  const commande = commandeOuverte(params.commandeId);
  const boutique = unResultat<{ boutique_id: string }>("SELECT boutique_id FROM commandes_client WHERE id = ?", [
    params.commandeId,
  ])!;
  const lignesCommande = new Map(
    tousLesResultats<{ variante_id: string; quantite: number; quantite_livree: number; prix_unitaire: number }>(
      `SELECT variante_id, quantite, quantite_livree, prix_unitaire FROM lignes_commande_client
       WHERE commande_id = ? AND supprime = 0`,
      [params.commandeId],
    ).map((l) => [l.variante_id, l]),
  );
  const aLivrer = params.lignes.filter((l) => l.quantite > 0);
  if (aLivrer.length === 0) throw new ErreurCommandeClient("Indiquez au moins une quantité à livrer.");
  const lignesVente = aLivrer.map((l) => {
    const ligne = lignesCommande.get(l.varianteId);
    if (!ligne) throw new ErreurCommandeClient("Cet article ne fait pas partie de la commande.");
    if (l.quantite > Number(ligne.quantite) - Number(ligne.quantite_livree) + 1e-9) {
      throw new ErreurCommandeClient("On ne peut pas livrer plus que le restant à livrer.");
    }
    return { varianteId: l.varianteId, quantite: l.quantite, prixUnitaire: Number(ligne.prix_unitaire) };
  });
  const aCredit = params.paiements.some((p) => p.mode === "credit" && p.montant > 0);
  return creerVente({
    boutiqueId: boutique.boutique_id,
    depotId: commande.depot_id,
    utilisateurId: params.utilisateurId,
    clientId: commande.client_id,
    statut: aCredit ? "credit" : "payee",
    lignes: lignesVente,
    paiements: params.paiements.filter((p) => p.montant > 0),
    commandeClientId: params.commandeId,
  });
}

// --- Lecture ---

export interface CommandeClientResume {
  id: string;
  numero: string;
  clientId: string;
  clientNom: string;
  clientTelephone: string;
  depotId: string;
  depotNom: string;
  statut: StatutCommandeClient;
  dateLivraisonPrevue: string | null;
  note: string;
  total: number;
  avance: number;
  /** Valeur restant à livrer (au prix de la commande). */
  resteALivrer: number;
  nombreArticles: number;
  dateCreation: string;
  utilisateurId: string | null;
}

export function listerCommandesClient(boutiqueId: string): CommandeClientResume[] {
  return tousLesResultats<CommandeClientResume>(
    `SELECT c.id as id, c.numero as numero, c.client_id as clientId, cl.nom as clientNom,
            COALESCE(cl.telephone, '') as clientTelephone, c.depot_id as depotId, d.nom as depotNom,
            c.statut as statut, c.date_livraison_prevue as dateLivraisonPrevue, c.note as note,
            c.total as total, c.avance as avance, c.date_creation as dateCreation, c.utilisateur_id as utilisateurId,
            (SELECT COALESCE(SUM(MAX(l.quantite - l.quantite_livree, 0) * l.prix_unitaire), 0)
               FROM lignes_commande_client l WHERE l.commande_id = c.id AND l.supprime = 0) as resteALivrer,
            (SELECT COUNT(*) FROM lignes_commande_client l WHERE l.commande_id = c.id AND l.supprime = 0) as nombreArticles
     FROM commandes_client c
     JOIN clients cl ON cl.id = c.client_id
     JOIN depots d ON d.id = c.depot_id
     WHERE c.boutique_id = ? AND c.supprime = 0
     ORDER BY c.date_creation DESC`,
    [boutiqueId],
  ).map((c) => ({ ...c, total: Number(c.total), avance: Number(c.avance), resteALivrer: Math.round(Number(c.resteALivrer)) }));
}

export interface LigneCommandeClientDetail {
  id: string;
  varianteId: string;
  produitNom: string;
  reference: string;
  quantite: number;
  quantiteLivree: number;
  prixUnitaire: number;
  sousTotal: number;
  /** Stock du dépôt de la commande. */
  stockDepot: number;
  /** Réservé pour les AUTRES commandes ouvertes, dans ce dépôt. */
  reserveAutres: number;
}

export interface LivraisonCommande {
  venteId: string;
  numero: string;
  dateCreation: string;
  totalNet: number;
  statut: string;
}

export interface CommandeClientDetail extends CommandeClientResume {
  lignes: LigneCommandeClientDetail[];
  livraisons: LivraisonCommande[];
  /** Ce que le client a sur son porte-monnaie (avances comprises). */
  soldeCompteClient: number;
}

export function obtenirCommandeClient(id: string): CommandeClientDetail | undefined {
  const boutique = unResultat<{ boutique_id: string }>("SELECT boutique_id FROM commandes_client WHERE id = ?", [id]);
  if (!boutique) return undefined;
  const resume = listerCommandesClient(boutique.boutique_id).find((c) => c.id === id);
  if (!resume) return undefined;
  const lignes = tousLesResultats<LigneCommandeClientDetail>(
    `SELECT l.id as id, l.variante_id as varianteId, p.nom as produitNom, COALESCE(v.reference, '') as reference,
            l.quantite as quantite, l.quantite_livree as quantiteLivree, l.prix_unitaire as prixUnitaire,
            l.sous_total as sousTotal,
            COALESCE((SELECT s.quantite FROM stocks s WHERE s.variante_id = l.variante_id AND s.depot_id = ?), 0) as stockDepot,
            COALESCE((SELECT SUM(MAX(l2.quantite - l2.quantite_livree, 0))
               FROM lignes_commande_client l2 JOIN commandes_client c2 ON c2.id = l2.commande_id
               WHERE l2.variante_id = l.variante_id AND l2.supprime = 0 AND c2.supprime = 0
                 AND c2.depot_id = ? AND c2.id <> ? AND c2.statut IN ${STATUTS_OUVERTS}), 0) as reserveAutres
     FROM lignes_commande_client l
     JOIN variantes v ON v.id = l.variante_id
     JOIN produits p ON p.id = v.produit_id
     WHERE l.commande_id = ? AND l.supprime = 0
     ORDER BY p.nom`,
    [resume.depotId, resume.depotId, id, id],
  ).map((l) => ({
    ...l,
    quantite: Number(l.quantite),
    quantiteLivree: Number(l.quantiteLivree),
    prixUnitaire: Number(l.prixUnitaire),
    sousTotal: Number(l.sousTotal),
    stockDepot: Number(l.stockDepot),
    reserveAutres: Number(l.reserveAutres),
  }));
  const livraisons = tousLesResultats<LivraisonCommande>(
    `SELECT id as venteId, numero, date_creation as dateCreation, total_net as totalNet, statut
     FROM ventes WHERE commande_client_id = ? AND supprime = 0 ORDER BY date_creation`,
    [id],
  ).map((v) => ({ ...v, totalNet: Number(v.totalNet) }));
  return { ...resume, lignes, livraisons, soldeCompteClient: soldeCompteClient(resume.clientId) };
}

export interface Reservation {
  varianteId: string;
  depotId: string;
  quantite: number;
  /** Les commandes concernées, pour l'avertissement en caisse. */
  commandes: { numero: string; clientNom: string; quantite: number }[];
}

/** Restant à livrer des commandes ouvertes, par article et dépôt (un dépôt précis si donné). */
export function reservations(boutiqueId: string, depotId?: string): Reservation[] {
  const lignes = tousLesResultats<{
    variante_id: string;
    depot_id: string;
    numero: string;
    client_nom: string;
    reste: number;
  }>(
    `SELECT l.variante_id, c.depot_id, c.numero, cl.nom as client_nom, (l.quantite - l.quantite_livree) as reste
     FROM lignes_commande_client l
     JOIN commandes_client c ON c.id = l.commande_id
     JOIN clients cl ON cl.id = c.client_id
     WHERE c.boutique_id = ? AND c.supprime = 0 AND l.supprime = 0 AND c.statut IN ${STATUTS_OUVERTS}
       AND l.quantite > l.quantite_livree ${depotId ? "AND c.depot_id = ?" : ""}
     ORDER BY c.date_livraison_prevue IS NULL, c.date_livraison_prevue, c.date_creation`,
    depotId ? [boutiqueId, depotId] : [boutiqueId],
  );
  const parCle = new Map<string, Reservation>();
  for (const l of lignes) {
    const cle = `${l.variante_id}|${l.depot_id}`;
    const reservation = parCle.get(cle) ?? { varianteId: l.variante_id, depotId: l.depot_id, quantite: 0, commandes: [] };
    reservation.quantite += Number(l.reste);
    reservation.commandes.push({ numero: l.numero, clientNom: l.client_nom, quantite: Number(l.reste) });
    parCle.set(cle, reservation);
  }
  return [...parCle.values()];
}
