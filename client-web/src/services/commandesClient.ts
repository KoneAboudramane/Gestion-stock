import { ouvrirBaseDeDonnees } from "../db";
import { maintenant, suiviSyncNeuf } from "../db/helpers";
import type { CommandeClientLocale, LigneCommandeClientLocale } from "../db/schema";
import { deposerSurCompteClient, soldeCompteClient, type OperationCompte } from "./comptesTiers";
import { creerVente, type PaiementEntree, type VenteCreee } from "./ventes";
import { prochainNumero } from "./numerotation";

/**
 * Port navigateur de client-electron/electron/services/commandesClient.ts :
 * commandes clients (ventes.CommandeClient) enregistrées avant la livraison.
 * Le stock ne bouge qu'à la livraison (une vente rattachée à la commande) ;
 * d'ici là le restant à livrer est « réservé » dans le dépôt de la commande.
 * Pas de transaction IndexedDB multi-store ici : tout ce qui peut échouer est
 * vérifié avant la première écriture.
 */

export type StatutCommandeClient = "en_attente" | "prete" | "partielle" | "livree" | "annulee";

export class ErreurCommandeClient extends Error {}

export interface LigneCommandeClientEntree {
  varianteId: string;
  quantite: number;
  prixUnitaire: number;
}

export interface ParametresCommandeClient {
  boutiqueId: string;
  clientId: string;
  depotId: string;
  utilisateurId: string | null;
  dateLivraisonPrevue: string | null;
  note?: string;
  lignes: LigneCommandeClientEntree[];
}

const STATUTS_OUVERTS: StatutCommandeClient[] = ["en_attente", "prete", "partielle"];

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


async function commandeOuverte(id: string): Promise<CommandeClientLocale> {
  const db = await ouvrirBaseDeDonnees();
  const commande = await db.get("commandes_client", id);
  if (!commande || commande.supprime) throw new ErreurCommandeClient("Commande introuvable.");
  if (commande.statut === "livree") throw new ErreurCommandeClient("Cette commande est déjà entièrement livrée.");
  if (commande.statut === "annulee") throw new ErreurCommandeClient("Cette commande est annulée.");
  return commande;
}

async function lignesDe(commandeId: string): Promise<LigneCommandeClientLocale[]> {
  const db = await ouvrirBaseDeDonnees();
  return (await db.getAllFromIndex("lignes_commande_client", "commande_id", commandeId)).filter((l) => !l.supprime);
}

export async function creerCommandeClient(
  params: ParametresCommandeClient,
): Promise<{ id: string; numero: string; total: number }> {
  const { boutiqueId, clientId, depotId, utilisateurId, dateLivraisonPrevue, note = "", lignes } = params;
  if (!clientId) throw new ErreurCommandeClient("Choisissez le client.");
  if (!depotId) throw new ErreurCommandeClient("Choisissez le dépôt qui livrera.");
  verifierLignes(lignes);
  const total = lignes.reduce((t, l) => t + sousTotal(l), 0);
  const db = await ouvrirBaseDeDonnees();
  const id = crypto.randomUUID();
  const numero = await prochainNumero("commandes_client", "CMC", boutiqueId, utilisateurId);
  await db.put("commandes_client", {
    id,
    boutique_id: boutiqueId,
    client_id: clientId,
    depot_id: depotId,
    utilisateur_id: utilisateurId,
    numero,
    statut: "en_attente",
    date_livraison_prevue: dateLivraisonPrevue,
    note: note.trim(),
    total,
    avance: 0,
    date_annulation: null,
    ...suiviSyncNeuf(),
  });
  for (const l of lignes) {
    await db.put("lignes_commande_client", {
      id: crypto.randomUUID(),
      commande_id: id,
      variante_id: l.varianteId,
      quantite: l.quantite,
      quantite_livree: 0,
      prix_unitaire: l.prixUnitaire,
      sous_total: sousTotal(l),
      ...suiviSyncNeuf(),
    });
  }
  return { id, numero, total };
}

export interface ModificationCommandeClient {
  clientId?: string;
  depotId?: string;
  dateLivraisonPrevue?: string | null;
  note?: string;
  lignes?: LigneCommandeClientEntree[];
}

export async function modifierCommandeClient(id: string, champs: ModificationCommandeClient): Promise<void> {
  const commande = await commandeOuverte(id);
  const dejaLivree = commande.statut === "partielle";
  if (dejaLivree && champs.clientId && champs.clientId !== commande.client_id) {
    throw new ErreurCommandeClient("Une partie est déjà livrée : le client ne peut plus changer.");
  }
  if (dejaLivree && champs.depotId && champs.depotId !== commande.depot_id) {
    throw new ErreurCommandeClient("Une partie est déjà livrée : le dépôt ne peut plus changer.");
  }
  const db = await ouvrirBaseDeDonnees();
  const maintenantIso = maintenant();
  const mise: CommandeClientLocale = { ...commande, synchronise: 0, date_modification: maintenantIso };

  if (champs.lignes) {
    verifierLignes(champs.lignes);
    const existantes = await lignesDe(id);
    const nouvelles = new Map(champs.lignes.map((l) => [l.varianteId, l]));
    // Contrôles d'abord (rien n'est écrit si une ligne est refusée).
    for (const ancienne of existantes) {
      const nouvelle = nouvelles.get(ancienne.variante_id);
      if (!nouvelle && ancienne.quantite_livree > 0) {
        throw new ErreurCommandeClient("Un article déjà livré en partie ne peut pas être retiré.");
      }
      if (nouvelle && nouvelle.quantite < ancienne.quantite_livree) {
        throw new ErreurCommandeClient("La quantité ne peut pas être inférieure à ce qui est déjà livré.");
      }
    }
    const resultat: LigneCommandeClientLocale[] = [];
    for (const ancienne of existantes) {
      const nouvelle = nouvelles.get(ancienne.variante_id);
      if (!nouvelle) {
        await db.put("lignes_commande_client", { ...ancienne, supprime: 1, synchronise: 0, date_modification: maintenantIso });
        continue;
      }
      const prix = ancienne.quantite_livree > 0 ? ancienne.prix_unitaire : nouvelle.prixUnitaire;
      const ligne = {
        ...ancienne,
        quantite: nouvelle.quantite,
        prix_unitaire: prix,
        sous_total: sousTotal({ ...nouvelle, prixUnitaire: prix }),
        synchronise: 0 as const,
        date_modification: maintenantIso,
      };
      await db.put("lignes_commande_client", ligne);
      resultat.push(ligne);
      nouvelles.delete(ancienne.variante_id);
    }
    for (const l of nouvelles.values()) {
      const ligne: LigneCommandeClientLocale = {
        id: crypto.randomUUID(),
        commande_id: id,
        variante_id: l.varianteId,
        quantite: l.quantite,
        quantite_livree: 0,
        prix_unitaire: l.prixUnitaire,
        sous_total: sousTotal(l),
        ...suiviSyncNeuf(),
      };
      await db.put("lignes_commande_client", ligne);
      resultat.push(ligne);
    }
    mise.total = resultat.reduce((t, l) => t + l.sous_total, 0);
    const reste = resultat.reduce((t, l) => t + (l.quantite - l.quantite_livree), 0);
    if (reste <= 0 && mise.statut === "partielle") mise.statut = "livree";
  }
  if (champs.clientId) mise.client_id = champs.clientId;
  if (champs.depotId) mise.depot_id = champs.depotId;
  if (champs.dateLivraisonPrevue !== undefined) mise.date_livraison_prevue = champs.dateLivraisonPrevue;
  if (champs.note !== undefined) mise.note = champs.note.trim();
  await db.put("commandes_client", mise);
}

export async function marquerCommandePrete(id: string, prete: boolean): Promise<void> {
  const commande = await commandeOuverte(id);
  if (commande.statut === "partielle") return;
  const db = await ouvrirBaseDeDonnees();
  await db.put("commandes_client", {
    ...commande,
    statut: prete ? "prete" : "en_attente",
    synchronise: 0,
    date_modification: maintenant(),
  });
}

export async function annulerCommandeClient(id: string): Promise<void> {
  const commande = await commandeOuverte(id);
  const db = await ouvrirBaseDeDonnees();
  const maintenantIso = maintenant();
  await db.put("commandes_client", {
    ...commande,
    statut: "annulee",
    date_annulation: maintenantIso,
    synchronise: 0,
    date_modification: maintenantIso,
  });
}

export async function verserAvanceCommande(id: string, op: OperationCompte): Promise<void> {
  const commande = await commandeOuverte(id);
  await deposerSurCompteClient(commande.client_id, {
    ...op,
    depotId: op.depotId ?? commande.depot_id,
    motif: `Avance commande ${commande.numero}`,
  });
  const db = await ouvrirBaseDeDonnees();
  await db.put("commandes_client", {
    ...commande,
    avance: commande.avance + op.montant,
    synchronise: 0,
    date_modification: maintenant(),
  });
}

export interface ParametresLivraison {
  commandeId: string;
  utilisateurId: string | null;
  lignes: { varianteId: string; quantite: number }[];
  paiements: PaiementEntree[];
}

export async function livrerCommandeClient(params: ParametresLivraison): Promise<VenteCreee> {
  const commande = await commandeOuverte(params.commandeId);
  const lignesCommande = new Map((await lignesDe(params.commandeId)).map((l) => [l.variante_id, l]));
  const aLivrer = params.lignes.filter((l) => l.quantite > 0);
  if (aLivrer.length === 0) throw new ErreurCommandeClient("Indiquez au moins une quantité à livrer.");
  const db = await ouvrirBaseDeDonnees();
  const lignesVente = [];
  for (const l of aLivrer) {
    const ligne = lignesCommande.get(l.varianteId);
    if (!ligne) throw new ErreurCommandeClient("Cet article ne fait pas partie de la commande.");
    if (l.quantite > ligne.quantite - ligne.quantite_livree + 1e-9) {
      throw new ErreurCommandeClient("On ne peut pas livrer plus que le restant à livrer.");
    }
    const stock = await db.getFromIndex("stocks", "variante_depot", [l.varianteId, commande.depot_id]);
    if ((stock?.quantite ?? 0) < l.quantite) throw new ErreurCommandeClient("Stock insuffisant dans le dépôt pour cette livraison.");
    lignesVente.push({ varianteId: l.varianteId, quantite: l.quantite, prixUnitaire: ligne.prix_unitaire });
  }
  const aCredit = params.paiements.some((p) => p.mode === "credit" && p.montant > 0);
  return creerVente({
    boutiqueId: commande.boutique_id,
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
  resteALivrer: number;
  nombreArticles: number;
  dateCreation: string;
  utilisateurId: string | null;
}

async function resume(c: CommandeClientLocale): Promise<CommandeClientResume> {
  const db = await ouvrirBaseDeDonnees();
  const [client, depot, lignes] = await Promise.all([
    db.get("clients", c.client_id),
    db.get("depots", c.depot_id),
    lignesDe(c.id),
  ]);
  return {
    id: c.id,
    numero: c.numero,
    clientId: c.client_id,
    clientNom: client?.nom ?? "",
    clientTelephone: client?.telephone ?? "",
    depotId: c.depot_id,
    depotNom: depot?.nom ?? "",
    statut: c.statut,
    dateLivraisonPrevue: c.date_livraison_prevue,
    note: c.note,
    total: c.total,
    avance: c.avance,
    resteALivrer: Math.round(lignes.reduce((t, l) => t + Math.max(0, l.quantite - l.quantite_livree) * l.prix_unitaire, 0)),
    nombreArticles: lignes.length,
    dateCreation: c.date_creation,
    utilisateurId: c.utilisateur_id,
  };
}

export async function listerCommandesClient(boutiqueId: string): Promise<CommandeClientResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const commandes = (await db.getAllFromIndex("commandes_client", "boutique_id", boutiqueId)).filter((c) => !c.supprime);
  const resumes = await Promise.all(commandes.map(resume));
  return resumes.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
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
  stockDepot: number;
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
  soldeCompteClient: number;
}

export async function obtenirCommandeClient(id: string): Promise<CommandeClientDetail | undefined> {
  const db = await ouvrirBaseDeDonnees();
  const commande = await db.get("commandes_client", id);
  if (!commande || commande.supprime) return undefined;
  const base = await resume(commande);
  const reservees = await reservations(commande.boutique_id, commande.depot_id);
  const lignes: LigneCommandeClientDetail[] = [];
  for (const l of await lignesDe(id)) {
    const variante = await db.get("variantes", l.variante_id);
    const produit = variante ? await db.get("produits", variante.produit_id) : undefined;
    const stock = await db.getFromIndex("stocks", "variante_depot", [l.variante_id, commande.depot_id]);
    const reserveTotal = reservees.find((r) => r.varianteId === l.variante_id)?.quantite ?? 0;
    const reservePropre = STATUTS_OUVERTS.includes(commande.statut) ? Math.max(0, l.quantite - l.quantite_livree) : 0;
    lignes.push({
      id: l.id,
      varianteId: l.variante_id,
      produitNom: produit?.nom ?? "",
      reference: variante?.reference ?? "",
      quantite: l.quantite,
      quantiteLivree: l.quantite_livree,
      prixUnitaire: l.prix_unitaire,
      sousTotal: l.sous_total,
      stockDepot: stock?.quantite ?? 0,
      reserveAutres: Math.max(0, reserveTotal - reservePropre),
    });
  }
  lignes.sort((a, b) => a.produitNom.localeCompare(b.produitNom, "fr"));
  const livraisons = (await db.getAllFromIndex("ventes", "boutique_id", commande.boutique_id))
    .filter((v) => !v.supprime && v.commande_client_id === id)
    .sort((a, b) => a.date_creation.localeCompare(b.date_creation))
    .map((v) => ({ venteId: v.id, numero: v.numero, dateCreation: v.date_creation, totalNet: v.total_net, statut: v.statut }));
  return { ...base, lignes, livraisons, soldeCompteClient: await soldeCompteClient(commande.client_id) };
}

export interface Reservation {
  varianteId: string;
  depotId: string;
  quantite: number;
  commandes: { numero: string; clientNom: string; quantite: number }[];
}

export async function reservations(boutiqueId: string, depotId?: string): Promise<Reservation[]> {
  const db = await ouvrirBaseDeDonnees();
  const commandes = (await db.getAllFromIndex("commandes_client", "boutique_id", boutiqueId))
    .filter((c) => !c.supprime && STATUTS_OUVERTS.includes(c.statut) && (!depotId || c.depot_id === depotId))
    .sort((a, b) =>
      (a.date_livraison_prevue ?? "9999").localeCompare(b.date_livraison_prevue ?? "9999") ||
      a.date_creation.localeCompare(b.date_creation),
    );
  const parCle = new Map<string, Reservation>();
  for (const c of commandes) {
    const client = await db.get("clients", c.client_id);
    for (const l of await lignesDe(c.id)) {
      const reste = l.quantite - l.quantite_livree;
      if (reste <= 0) continue;
      const cle = `${l.variante_id}|${c.depot_id}`;
      const reservation = parCle.get(cle) ?? { varianteId: l.variante_id, depotId: c.depot_id, quantite: 0, commandes: [] };
      reservation.quantite += reste;
      reservation.commandes.push({ numero: c.numero, clientNom: client?.nom ?? "", quantite: reste });
      parCle.set(cle, reservation);
    }
  }
  return [...parCle.values()];
}
