import { ouvrirBaseDeDonnees } from "../db";
import { maintenant, suiviSyncNeuf } from "../db/helpers";
import type { CreditLocal, LigneVenteLocale, PaiementLocal, VenteLocale } from "../db/schema";
import { verifierAbonnementActif } from "./abonnement";
import { appliquerMouvement, destockageActif, terminerDestockageSiEpuise } from "./stock";
import { enregistrerMouvement } from "./tresorerie";

/**
 * Port navigateur de client-electron/electron/services/ventes.ts::creerVente
 * (lui-même miroir de ventes/services.py::creer_vente) : la vente est créée
 * entièrement en local (numéro, lignes, paiements, mouvement de stock,
 * créance éventuelle) — aucun appel réseau ici, la synchronisation
 * (client-web/src/sync) s'en charge séparément, en tâche de fond.
 */

export type StatutVente = "payee" | "credit" | "annulee";
export type ModePaiement = "especes" | "mobile_money" | "credit";
export type OperateurMobileMoney = "orange_money" | "mtn_money" | "moov_money" | "wave";

export class ErreurVente extends Error {}

export interface LigneVenteEntree {
  varianteId: string;
  quantite: number;
  prixUnitaire?: number;
  remise?: number;
}

export interface PaiementEntree {
  mode: ModePaiement;
  operateur?: OperateurMobileMoney | "";
  montant: number;
}

export interface ParametresVente {
  boutiqueId: string;
  depotId: string;
  utilisateurId: string | null;
  clientId?: string | null;
  statut: StatutVente;
  lignes: LigneVenteEntree[];
  paiements: PaiementEntree[];
  remiseGlobale?: number;
}

export interface VenteCreee {
  id: string;
  numero: string;
  totalBrut: number;
  totalNet: number;
}

async function genererNumero(boutiqueId: string): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  const isoJour = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const ventesDuJour = (await db.getAllFromIndex("ventes", "boutique_id", boutiqueId)).filter((v) =>
    v.date_creation.startsWith(isoJour),
  );
  const compteur = ventesDuJour.length + 1;
  return `VTE-${isoJour.replace(/-/g, "")}-${String(compteur).padStart(4, "0")}`;
}

export async function creerVente(params: ParametresVente): Promise<VenteCreee> {
  const { boutiqueId, depotId, utilisateurId, clientId = null, statut, lignes, paiements, remiseGlobale = 0 } = params;

  await verifierAbonnementActif(boutiqueId);

  if (lignes.length === 0) {
    throw new ErreurVente("Une vente doit contenir au moins une ligne.");
  }
  if (statut === "credit" && !clientId) {
    throw new ErreurVente("Un client est requis pour une vente à crédit.");
  }

  const db = await ouvrirBaseDeDonnees();

  const lignesCalculees = [];
  for (const ligne of lignes) {
    const variante = await db.get("variantes", ligne.varianteId);
    if (!variante) throw new ErreurVente("Variante introuvable.");

    const destockage = await destockageActif(ligne.varianteId);
    const prixUnitaire = ligne.prixUnitaire ?? (destockage ? destockage.prixDestockage : variante.prix_vente);
    const remiseLigne = ligne.remise ?? 0;
    const sousTotal = Math.round(ligne.quantite * prixUnitaire - remiseLigne);
    if (sousTotal < 0) {
      throw new ErreurVente("Une remise de ligne ne peut pas rendre le sous-total négatif.");
    }
    lignesCalculees.push({
      varianteId: ligne.varianteId,
      quantite: ligne.quantite,
      prixUnitaire,
      coutUnitaire: variante.prix_achat,
      remise: remiseLigne,
      sousTotal,
      // Vendue pendant un déstockage : prix normal du moment + lien, pour son bilan.
      prixNormal: destockage ? destockage.prixNormal : null,
      destockageId: destockage ? destockage.id : null,
    });
  }

  const totalBrut = lignesCalculees.reduce((somme, l) => somme + l.sousTotal, 0);
  const totalNet = Math.round(totalBrut - remiseGlobale);
  if (totalNet < 0) {
    throw new ErreurVente("La remise globale ne peut pas rendre le total négatif.");
  }

  const totalPaiements = paiements.reduce((somme, p) => somme + p.montant, 0);
  if (totalPaiements !== totalNet) {
    throw new ErreurVente(`La somme des paiements (${totalPaiements}) doit être égale au total net (${totalNet}).`);
  }
  if (paiements.some((p) => p.mode === "mobile_money" && !p.operateur)) {
    throw new ErreurVente("Un opérateur est requis pour un paiement Mobile Money.");
  }

  // Un stock insuffisant sur une ligne (appliquerMouvement lève ErreurStock)
  // interrompt la fonction avant toute écriture de vente/ligne/paiement — pas
  // de transaction explicite (IndexedDB n'expose pas de rollback multi-store
  // aussi simplement que SQLite ici), mais aucune écriture n'a encore eu lieu
  // à ce stade puisque le calcul ci-dessus est fait avant la moindre écriture.
  const numero = await genererNumero(boutiqueId);
  const venteId = crypto.randomUUID();

  const vente: VenteLocale = {
    id: venteId,
    boutique_id: boutiqueId,
    depot_id: depotId,
    client_id: clientId,
    utilisateur_id: utilisateurId,
    numero,
    total_brut: totalBrut,
    remise: remiseGlobale,
    total_net: totalNet,
    statut,
    ...suiviSyncNeuf(),
  };
  await db.put("ventes", vente);

  for (const ligne of lignesCalculees) {
    const ligneVente: LigneVenteLocale = {
      id: crypto.randomUUID(),
      vente_id: venteId,
      variante_id: ligne.varianteId,
      quantite: ligne.quantite,
      prix_unitaire: ligne.prixUnitaire,
      cout_unitaire: ligne.coutUnitaire,
      remise: ligne.remise,
      sous_total: ligne.sousTotal,
      prix_normal: ligne.prixNormal,
      destockage_id: ligne.destockageId,
      ...suiviSyncNeuf(),
    };
    await db.put("lignes_vente", ligneVente);

    await appliquerMouvement({
      varianteId: ligne.varianteId,
      depotId,
      type: "sortie",
      quantite: ligne.quantite,
      motif: `Vente ${numero}`,
      utilisateurId,
      referenceType: "ventes.Vente",
      referenceId: venteId,
    });
    if (ligne.destockageId) await terminerDestockageSiEpuise(ligne.varianteId);
  }

  for (const paiement of paiements) {
    const paiementId = crypto.randomUUID();
    const paiementLocal: PaiementLocal = {
      id: paiementId,
      vente_id: venteId,
      mode: paiement.mode,
      operateur: paiement.operateur || "",
      montant: paiement.montant,
      ...suiviSyncNeuf(),
    };
    await db.put("paiements", paiementLocal);

    if (paiement.mode === "especes") {
      await enregistrerMouvement({
        depotId,
        type: "entree",
        categorie: "vente_especes",
        montant: paiement.montant,
        motif: `Vente ${numero}`,
        utilisateurId,
        referenceType: "ventes.Paiement",
        referenceId: paiementId,
      });
    }
  }

  if (statut === "credit") {
    const montantCredit = paiements.filter((p) => p.mode === "credit").reduce((somme, p) => somme + p.montant, 0);
    if (montantCredit > 0 && clientId) {
      const credit: CreditLocal = {
        id: crypto.randomUUID(),
        client_id: clientId,
        vente_id: venteId,
        montant: montantCredit,
        montant_paye: 0,
        solde: montantCredit,
        echeance: null,
        statut: "en_cours",
        ...suiviSyncNeuf(),
      };
      await db.put("credits", credit);
    }
  }

  return { id: venteId, numero, totalBrut, totalNet };
}

export interface LigneVenteDetail {
  id: string;
  produitNom: string;
  reference: string;
  quantite: number;
  prixUnitaire: number;
  remise: number;
  sousTotal: number;
  /** Renseigné si l'article a été vendu en déstockage (prix normal du moment). */
  prixNormal: number | null;
}

export interface PaiementDetail {
  id: string;
  mode: string;
  operateur: string;
  montant: number;
}

export interface VenteDetail {
  id: string;
  numero: string;
  dateCreation: string;
  depotNom: string;
  clientNom: string | null;
  clientTelephone: string | null;
  statut: StatutVente;
  totalBrut: number;
  remise: number;
  totalNet: number;
  utilisateurId: string | null;
  lignes: LigneVenteDetail[];
  paiements: PaiementDetail[];
}

export interface VenteResumeLocale {
  id: string;
  depotId: string;
  clientId: string | null;
  numero: string;
  dateCreation: string;
  depotNom: string;
  clientNom: string | null;
  statut: StatutVente;
  totalNet: number;
  utilisateurId: string | null;
  /** Quantité totale d'articles vendus. */
  nombreArticles: number;
  /** Part de la vente payée à crédit. */
  montantCredit: number;
}

/** Liste l'historique des ventes depuis IndexedDB (données déjà synchronisées ou créées localement). */
export async function listerVentesLocales(
  boutiqueId: string,
  depotId?: string,
  statut?: StatutVente,
  terme?: string,
  clientId?: string,
): Promise<VenteResumeLocale[]> {
  const db = await ouvrirBaseDeDonnees();
  const ventes = (await db.getAllFromIndex("ventes", "boutique_id", boutiqueId)).filter((v) => !v.supprime);

  const resumes: VenteResumeLocale[] = [];
  for (const v of ventes) {
    const depot = await db.get("depots", v.depot_id);
    const client = v.client_id ? await db.get("clients", v.client_id) : undefined;
    const lignes = (await db.getAllFromIndex("lignes_vente", "vente_id", v.id)).filter((l) => !l.supprime);
    const paiements = (await db.getAllFromIndex("paiements", "vente_id", v.id)).filter((p) => !p.supprime);
    resumes.push({
      id: v.id,
      depotId: v.depot_id,
      clientId: v.client_id,
      numero: v.numero,
      dateCreation: v.date_creation,
      depotNom: depot?.nom ?? "",
      clientNom: client?.nom ?? null,
      statut: v.statut,
      totalNet: v.total_net,
      utilisateurId: v.utilisateur_id != null ? String(v.utilisateur_id) : null,
      nombreArticles: lignes.reduce((t, l) => t + l.quantite, 0),
      montantCredit: paiements.filter((p) => p.mode === "credit").reduce((t, p) => t + p.montant, 0),
    });
  }

  let filtres = resumes;
  if (depotId) filtres = filtres.filter((v) => v.depotId === depotId);
  if (clientId) filtres = filtres.filter((v) => v.clientId === clientId);
  if (statut) filtres = filtres.filter((v) => v.statut === statut);
  if (terme?.trim()) {
    const t = terme.trim().toLowerCase();
    filtres = filtres.filter((v) => v.numero.toLowerCase().includes(t) || (v.clientNom ?? "").toLowerCase().includes(t));
  }
  return filtres.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}

/**
 * Miroir de ventes/services.py::annuler_vente (client-electron/electron/services/ventes.ts::annulerVente) :
 * recrée le stock consommé par chaque ligne, solde toute créance liée, passe
 * la vente à "annulee". Refuse si déjà annulée.
 */
export async function annulerVente(venteId: string, utilisateurId: string | null): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const vente = await db.get("ventes", venteId);
  if (!vente) throw new ErreurVente("Vente introuvable.");
  if (vente.statut === "annulee") {
    throw new ErreurVente("Cette vente est déjà annulée.");
  }

  const lignes = await db.getAllFromIndex("lignes_vente", "vente_id", venteId);
  for (const ligne of lignes) {
    await appliquerMouvement({
      varianteId: ligne.variante_id,
      depotId: vente.depot_id,
      type: "entree",
      quantite: ligne.quantite,
      motif: `Annulation vente ${vente.numero}`,
      utilisateurId,
      referenceType: "ventes.Vente",
      referenceId: venteId,
    });
  }

  const paiementsEspeces = (await db.getAllFromIndex("paiements", "vente_id", venteId)).filter(
    (p) => !p.supprime && p.mode === "especes",
  );
  // Seul l'argent réellement entré en caisse en ressort : une vente
  // antérieure à la Trésorerie n'a pas d'entrée, rien à retirer.
  const entreesCaisse = (await db.getAllFromIndex("mouvements_caisse", "depot_id", vente.depot_id)).filter(
    (m) => !m.supprime && m.type === "entree" && m.reference_type === "ventes.Paiement",
  );
  for (const paiement of paiementsEspeces) {
    if (!entreesCaisse.some((m) => m.reference_id === paiement.id)) continue;
    await enregistrerMouvement({
      depotId: vente.depot_id,
      type: "sortie",
      categorie: "vente_especes",
      montant: paiement.montant,
      motif: `Annulation vente ${vente.numero}`,
      utilisateurId,
      referenceType: "ventes.Vente",
      referenceId: venteId,
    });
  }

  const maintenantIso = maintenant();
  const credits = (await db.getAll("credits")).filter((c) => c.vente_id === venteId);
  for (const credit of credits) {
    await db.put("credits", { ...credit, montant_paye: credit.montant, solde: 0, statut: "solde", synchronise: 0, date_modification: maintenantIso });
  }

  await db.put("ventes", { ...vente, statut: "annulee", synchronise: 0, date_modification: maintenantIso });
}

/** Assemble le détail complet d'une vente depuis IndexedDB — utilisé par FactureVente. */
export async function obtenirVenteDetail(venteId: string): Promise<VenteDetail | undefined> {
  const db = await ouvrirBaseDeDonnees();
  const vente = await db.get("ventes", venteId);
  if (!vente) return undefined;

  const client = vente.client_id ? await db.get("clients", vente.client_id) : undefined;
  const depot = await db.get("depots", vente.depot_id);

  const lignes = await db.getAllFromIndex("lignes_vente", "vente_id", venteId);
  const lignesDetail: LigneVenteDetail[] = [];
  for (const ligne of lignes) {
    const variante = await db.get("variantes", ligne.variante_id);
    const produit = variante ? await db.get("produits", variante.produit_id) : undefined;
    lignesDetail.push({
      id: ligne.id,
      produitNom: produit?.nom ?? "",
      reference: variante?.reference ?? "",
      quantite: ligne.quantite,
      prixUnitaire: ligne.prix_unitaire,
      remise: ligne.remise,
      sousTotal: ligne.sous_total,
      prixNormal: ligne.prix_normal ?? null,
    });
  }

  const paiements = await db.getAllFromIndex("paiements", "vente_id", venteId);

  return {
    id: vente.id,
    numero: vente.numero,
    dateCreation: vente.date_creation,
    depotNom: depot?.nom ?? "",
    clientNom: client?.nom ?? null,
    clientTelephone: client?.telephone ?? null,
    statut: vente.statut,
    totalBrut: vente.total_brut,
    remise: vente.remise,
    totalNet: vente.total_net,
    utilisateurId: vente.utilisateur_id != null ? String(vente.utilisateur_id) : null,
    lignes: lignesDetail,
    paiements: paiements.map((p) => ({ id: p.id, mode: p.mode, operateur: p.operateur, montant: p.montant })),
  };
}

export interface LigneVenteHistorique {
  venteId: string;
  venteNumero: string;
  dateCreation: string;
  clientNom: string | null;
  statut: StatutVente;
  quantite: number;
  prixUnitaire: number;
  sousTotal: number;
}

// Historique produit (toutes variantes confondues) — port de
// client-electron/electron/services/ventes.ts::listerVentesParProduit.
export async function listerVentesParProduit(produitId: string, limite = 100): Promise<LigneVenteHistorique[]> {
  const db = await ouvrirBaseDeDonnees();
  const idsVariantes = new Set((await db.getAllFromIndex("variantes", "produit_id", produitId)).map((v) => v.id));
  const resultat: LigneVenteHistorique[] = [];
  for (const lv of await db.getAll("lignes_vente")) {
    if (lv.supprime || !idsVariantes.has(lv.variante_id)) continue;
    const vente = await db.get("ventes", lv.vente_id);
    if (!vente || vente.supprime) continue;
    const client = vente.client_id ? await db.get("clients", vente.client_id) : undefined;
    resultat.push({
      venteId: vente.id,
      venteNumero: vente.numero,
      dateCreation: vente.date_creation,
      clientNom: client?.nom ?? null,
      statut: vente.statut,
      quantite: lv.quantite,
      prixUnitaire: lv.prix_unitaire,
      sousTotal: lv.sous_total,
    });
  }
  resultat.sort((a, b) => (a.dateCreation < b.dateCreation ? 1 : -1));
  return resultat.slice(0, limite);
}
