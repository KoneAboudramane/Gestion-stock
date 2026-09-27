import { ouvrirBaseDeDonnees } from "../db";
import { listerParIndex, maintenant, obtenirLigne, ecrireLigne, suiviSyncNeuf } from "../db/helpers";
import type {
  DepotLocal,
  DestockageLocal,
  OperationDestockageLocale,
  InventaireLocal,
  LigneInventaireLocale,
  MouvementStockLocal,
  PerteStockLocal,
  TransfertStockLocal,
} from "../db/schema";

/**
 * Port navigateur de client-electron/electron/services/stock.ts. Mouvements/
 * Transferts/Inventaire (ajoutés le 2026-08-21 pour la parité avec le client
 * Electron) suivent le même patron "itérer et filtrer en JS" que listerStock
 * ci-dessous plutôt que des requêtes indexées complexes — les stores
 * mouvements_stock/transferts_stock n'ont qu'un index composite
 * variante_depot, pas d'index par dépôt seul ou par boutique, et la volumétrie
 * d'une boutique reste petite.
 */

export class ErreurStock extends Error {}

/**
 * Réglage boutique "fabrication propre" (configuration.Parametre, clé
 * fabrication_propre = "1") : seules ces boutiques peuvent faire entrer du
 * stock hors réception d'achat (entrée manuelle, ajout depuis la fiche
 * produit, entrée de production). Les autres réapprovisionnent par les
 * Achats, qui tiennent le coût moyen (CUMP), la dette fournisseur et la
 * comptabilité à jour. Exception : le tout premier stock d'une variante
 * (stock initial à la création du produit) reste permis à tous.
 */
export const CLE_PARAMETRE_FABRICATION_PROPRE = "fabrication_propre";

export const MESSAGE_ENTREE_RESERVEE_FABRICATION =
  "Cette boutique réapprovisionne par les Achats : l'entrée de stock manuelle est réservée aux boutiques qui fabriquent leurs produits (Réglages → Informations boutique).";

export async function fabricationPropreActive(boutiqueId: string): Promise<boolean> {
  const parametres = await listerParIndex("parametres", "boutique_id", boutiqueId);
  return parametres.some((p) => !p.supprime && p.cle === CLE_PARAMETRE_FABRICATION_PROPRE && p.valeur === "1");
}

async function fabricationPropreActivePourDepot(depotId: string): Promise<boolean> {
  const depot = await obtenirLigne("depots", depotId);
  return depot ? fabricationPropreActive(depot.boutique_id) : false;
}

/** Entrée manuelle permise si la boutique fabrique, ou s'il s'agit du tout
 * premier stock de la variante (stock initial à la création du produit). */
async function verifierEntreeManuelle(varianteId: string, depotId: string): Promise<void> {
  if (await fabricationPropreActivePourDepot(depotId)) return;
  const db = await ouvrirBaseDeDonnees();
  const mouvements = await db.getAllFromIndex(
    "mouvements_stock",
    "variante_depot",
    IDBKeyRange.bound([varianteId, ""], [varianteId, "\uffff"]),
  );
  if (mouvements.some((m) => !m.supprime)) {
    throw new ErreurStock(MESSAGE_ENTREE_RESERVEE_FABRICATION);
  }
}

/**
 * Mouvement saisi à la main (écran Stock, fiche produit, stock initial) —
 * contrairement à appliquerMouvement, utilisé aussi par les ventes, achats,
 * transferts et inventaires, applique la règle "fabrication propre" ci-dessus.
 */
export async function creerMouvementManuel(params: ParametresMouvement): Promise<string> {
  if (params.type === "entree") await verifierEntreeManuelle(params.varianteId, params.depotId);
  return appliquerMouvement(params);
}

export type TypeMouvement = "entree" | "sortie" | "ajustement";

function deltaPour(type: TypeMouvement, quantite: number): number {
  if (type === "entree") return quantite;
  if (type === "sortie") return -quantite;
  return quantite; // ajustement : delta signé fourni tel quel
}

export interface ParametresMouvement {
  varianteId: string;
  depotId: string;
  type: TypeMouvement;
  quantite: number;
  motif?: string;
  utilisateurId?: string | null;
  referenceType?: string;
  referenceId?: string | null;
}

export async function appliquerMouvement(params: ParametresMouvement): Promise<string> {
  const {
    varianteId,
    depotId,
    type,
    quantite,
    motif = "",
    utilisateurId = null,
    referenceType = "",
    referenceId = null,
  } = params;

  const db = await ouvrirBaseDeDonnees();
  const stockExistant = await db.getFromIndex("stocks", "variante_depot", [varianteId, depotId]);

  const delta = deltaPour(type, quantite);
  const quantiteActuelle = stockExistant?.quantite ?? 0;
  const nouvelleQuantite = quantiteActuelle + delta;

  if (nouvelleQuantite < 0) {
    throw new ErreurStock("Stock insuffisant pour cette opération.");
  }

  const idStock = stockExistant?.id ?? crypto.randomUUID();
  await db.put("stocks", { id: idStock, variante_id: varianteId, depot_id: depotId, quantite: nouvelleQuantite });

  const mouvementId = crypto.randomUUID();
  const mouvement: MouvementStockLocal = {
    id: mouvementId,
    variante_id: varianteId,
    depot_id: depotId,
    type,
    quantite,
    motif,
    reference_type: referenceType,
    reference_id: referenceId,
    utilisateur_id: utilisateurId,
    ...suiviSyncNeuf(),
  };
  await db.put("mouvements_stock", mouvement);

  return mouvementId;
}

/** Pré-remplissage du bouton "Commander" depuis une ligne en rupture (Stock ou Notifications). */
export interface LigneAchatInitiale {
  varianteId: string;
  produitNom: string;
  prixAchat: number;
  prixVente: number;
  depotId: string;
  depotNom: string;
}

export interface ParametresEntreeProduction {
  varianteId: string;
  depotId: string;
  quantite: number;
  /** Coût de production de cette entrée (pas d'achat) : alimente prix_achat via CUMP. */
  prixAchat: number;
  prixVente?: number;
  motif?: string;
  utilisateurId?: string | null;
}

/**
 * Port de client-electron/electron/services/stock.ts::creerEntreeProduction :
 * entrée de stock pour une boutique sans fournisseur (fabrication propre) —
 * même formule de CUMP (coût unitaire moyen pondéré, tous dépôts confondus)
 * que la réception d'achat, pour que la marge (prix_vente − prix_achat) reste juste.
 */
export async function creerEntreeProduction(params: ParametresEntreeProduction): Promise<string> {
  const { varianteId, depotId, quantite, prixAchat, prixVente, motif = "", utilisateurId = null } = params;
  if (!(await fabricationPropreActivePourDepot(depotId))) {
    throw new ErreurStock(MESSAGE_ENTREE_RESERVEE_FABRICATION);
  }

  const variante = await obtenirLigne("variantes", varianteId);
  if (!variante) throw new ErreurStock("Produit introuvable.");

  const db = await ouvrirBaseDeDonnees();
  const stocksVariante = await db.getAllFromIndex(
    "stocks",
    "variante_depot",
    IDBKeyRange.bound([varianteId, ""], [varianteId, "￿"]),
  );
  const stockActuel = stocksVariante.reduce((total, s) => total + s.quantite, 0);

  const ancienPrixAchat = variante.prix_achat;
  const nouveauPrixAchat =
    stockActuel > 0
      ? Math.round((stockActuel * ancienPrixAchat + quantite * prixAchat) / (stockActuel + quantite))
      : prixAchat;
  const nouveauPrixVente = prixVente ?? variante.prix_vente;

  if (nouveauPrixVente < nouveauPrixAchat) {
    throw new ErreurStock("Le prix de vente ne peut pas être inférieur au prix d'achat (CUMP).");
  }

  await ecrireLigne("variantes", {
    ...variante,
    prix_achat: nouveauPrixAchat,
    prix_vente: nouveauPrixVente,
    date_modification: maintenant(),
    synchronise: 0,
  });

  const motifComplet = `${motif} (Coût : ${ancienPrixAchat} → ${nouveauPrixAchat} FCFA [CUMP])`;
  return appliquerMouvement({ varianteId, depotId, type: "entree", quantite, motif: motifComplet, utilisateurId });
}

// --- Dépôts ---

export interface DepotResume {
  id: string;
  nom: string;
  adresse: string;
}

export async function listerDepotsDetail(boutiqueId: string): Promise<DepotResume[]> {
  const depots = (await listerParIndex("depots", "boutique_id", boutiqueId)).filter((d) => !d.supprime);
  return depots.map((d) => ({ id: d.id, nom: d.nom, adresse: d.adresse })).sort((a, b) => a.nom.localeCompare(b.nom));
}

/**
 * Formule Essentiel/Pro (voir comptes.Boutique.formule côté backend, même
 * plafond appliqué côté serveur en défense — stock/views.py::DepotViewSet) :
 * Essentiel plafonne à un seul dépôt. Vérifié ici (avant l'écriture locale,
 * pas seulement au push) puisque l'appli crée toujours en local d'abord.
 */
const LIMITE_DEPOTS_ESSENTIEL = 1;

async function verifierLimiteDepots(boutiqueId: string): Promise<void> {
  const boutique = await obtenirLigne("boutiques", boutiqueId);
  if (!boutique || boutique.formule !== "essentiel") return;
  const depots = await listerDepotsDetail(boutiqueId);
  if (depots.length >= LIMITE_DEPOTS_ESSENTIEL) {
    throw new ErreurStock(
      "La formule Essentiel est limitée à un seul dépôt. Passez à la formule Pro pour en ajouter d'autres.",
    );
  }
}

export async function creerDepot(boutiqueId: string, nom: string, adresse = ""): Promise<string> {
  await verifierLimiteDepots(boutiqueId);
  const id = crypto.randomUUID();
  const depot: DepotLocal = { id, boutique_id: boutiqueId, nom, adresse, ...suiviSyncNeuf() };
  await ecrireLigne("depots", depot);
  return id;
}

export async function modifierDepot(id: string, champs: Partial<{ nom: string; adresse: string }>): Promise<void> {
  const depot = await obtenirLigne("depots", id);
  if (!depot) throw new ErreurStock("Dépôt introuvable.");
  await ecrireLigne("depots", {
    ...depot,
    nom: champs.nom ?? depot.nom,
    adresse: champs.adresse ?? depot.adresse,
    date_modification: maintenant(),
    synchronise: 0,
  });
}

export async function supprimerDepot(id: string): Promise<void> {
  const depot = await obtenirLigne("depots", id);
  if (!depot) return;
  await ecrireLigne("depots", { ...depot, supprime: 1, synchronise: 0, date_modification: maintenant() });
}

// --- Consultation du stock ---

export interface LigneStock {
  id: string;
  varianteId: string;
  produitId: string;
  produitNom: string;
  reference: string;
  depotId: string;
  depotNom: string;
  quantite: number;
  seuilAlerte: number;
  prixAchat: number;
  prixVente: number;
  enRupture: boolean;
}

export async function listerStock(boutiqueId: string, depotId?: string, terme = ""): Promise<LigneStock[]> {
  const db = await ouvrirBaseDeDonnees();
  const depots = (await db.getAllFromIndex("depots", "boutique_id", boutiqueId)).filter((d) => !d.supprime);
  const depotsParId = new Map(depots.map((d) => [d.id, d]));
  const motif = terme.trim().toLowerCase();

  const resultat: LigneStock[] = [];
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime);
  for (const produit of produits) {
    if (motif && !produit.nom.toLowerCase().includes(motif)) continue;
    const variantes = (await db.getAllFromIndex("variantes", "produit_id", produit.id)).filter((v) => !v.supprime);
    for (const variante of variantes) {
      const stocks = await db.getAllFromIndex(
        "stocks",
        "variante_depot",
        IDBKeyRange.bound([variante.id, ""], [variante.id, "￿"]),
      );
      for (const stock of stocks) {
        const depot = depotsParId.get(stock.depot_id);
        if (!depot) continue;
        if (depotId && depot.id !== depotId) continue;
        resultat.push({
          id: stock.id,
          varianteId: variante.id,
          produitId: produit.id,
          produitNom: produit.nom,
          reference: variante.reference,
          depotId: depot.id,
          depotNom: depot.nom,
          quantite: stock.quantite,
          seuilAlerte: variante.seuil_alerte,
          prixAchat: variante.prix_achat,
          prixVente: variante.prix_vente,
          enRupture: stock.quantite <= variante.seuil_alerte,
        });
      }
    }
  }
  return resultat.sort((a, b) => a.produitNom.localeCompare(b.produitNom));
}

// --- Mouvements ---

export interface MouvementResume {
  id: string;
  produitNom: string;
  reference: string;
  depotNom: string;
  type: TypeMouvement;
  quantite: number;
  motif: string;
  dateCreation: string;
  /** Qui a fait l'opération (voir hooks/useNomsUtilisateurs.ts). */
  utilisateurId: string | null;
}

export async function listerMouvements(boutiqueId: string, depotId?: string, limite = 100): Promise<MouvementResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const depots = (await db.getAllFromIndex("depots", "boutique_id", boutiqueId)).filter((d) => !d.supprime);
  const depotsParId = new Map(depots.map((d) => [d.id, d]));

  const tousMouvements = await db.getAll("mouvements_stock");
  const resultat: MouvementResume[] = [];
  for (const m of tousMouvements) {
    if (m.supprime) continue;
    const depot = depotsParId.get(m.depot_id);
    if (!depot) continue;
    if (depotId && depot.id !== depotId) continue;
    const variante = await db.get("variantes", m.variante_id);
    if (!variante) continue;
    const produit = await db.get("produits", variante.produit_id);
    if (!produit) continue;
    resultat.push({
      id: m.id,
      produitNom: produit.nom,
      reference: variante.reference,
      depotNom: depot.nom,
      type: m.type,
      quantite: m.quantite,
      motif: m.motif,
      dateCreation: m.date_creation,
      utilisateurId: m.utilisateur_id ?? null,
    });
  }
  resultat.sort((a, b) => (a.dateCreation < b.dateCreation ? 1 : -1));
  return resultat.slice(0, limite);
}

// --- Transferts (miroir de stock/services.py::transferer_stock) ---

export interface ParametresTransfert {
  varianteId: string;
  depotSourceId: string;
  depotDestinationId: string;
  quantite: number;
  utilisateurId: string | null;
}

export async function transfererStock(params: ParametresTransfert): Promise<string> {
  const { varianteId, depotSourceId, depotDestinationId, quantite, utilisateurId } = params;
  if (depotSourceId === depotDestinationId) {
    throw new ErreurStock("Le dépôt source et destination doivent être différents.");
  }
  if (quantite <= 0) {
    throw new ErreurStock("La quantité doit être strictement positive.");
  }

  const depotSource = await obtenirLigne("depots", depotSourceId);
  const depotDestination = await obtenirLigne("depots", depotDestinationId);

  const id = crypto.randomUUID();
  const transfert: TransfertStockLocal = {
    id,
    variante_id: varianteId,
    depot_source_id: depotSourceId,
    depot_destination_id: depotDestinationId,
    quantite,
    utilisateur_id: utilisateurId,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("transferts_stock", transfert);

  await appliquerMouvement({
    varianteId,
    depotId: depotSourceId,
    type: "sortie",
    quantite,
    motif: `Transfert vers ${depotDestination?.nom ?? ""}`,
    utilisateurId,
    referenceType: "stock.TransfertStock",
    referenceId: id,
  });
  await appliquerMouvement({
    varianteId,
    depotId: depotDestinationId,
    type: "entree",
    quantite,
    motif: `Transfert depuis ${depotSource?.nom ?? ""}`,
    utilisateurId,
    referenceType: "stock.TransfertStock",
    referenceId: id,
  });

  return id;
}

export interface TransfertResume {
  id: string;
  produitNom: string;
  reference: string;
  depotSourceNom: string;
  depotDestinationNom: string;
  quantite: number;
  dateCreation: string;
  /** Qui a fait l'opération (voir hooks/useNomsUtilisateurs.ts). */
  utilisateurId: string | null;
}

export async function listerTransferts(boutiqueId: string, limite = 100): Promise<TransfertResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const depots = (await db.getAllFromIndex("depots", "boutique_id", boutiqueId)).filter((d) => !d.supprime);
  const depotsParId = new Map(depots.map((d) => [d.id, d]));

  const tousTransferts = await db.getAll("transferts_stock");
  const resultat: TransfertResume[] = [];
  for (const t of tousTransferts) {
    if (t.supprime) continue;
    // Scope par boutique via le dépôt source, comme "ds.boutique_id = ?" côté Electron.
    const depotSource = depotsParId.get(t.depot_source_id);
    if (!depotSource) continue;
    const depotDestination = await obtenirLigne("depots", t.depot_destination_id);
    const variante = await db.get("variantes", t.variante_id);
    if (!variante) continue;
    const produit = await db.get("produits", variante.produit_id);
    if (!produit) continue;
    resultat.push({
      id: t.id,
      produitNom: produit.nom,
      reference: variante.reference,
      depotSourceNom: depotSource.nom,
      depotDestinationNom: depotDestination?.nom ?? "",
      quantite: t.quantite,
      dateCreation: t.date_creation,
      utilisateurId: t.utilisateur_id ?? null,
    });
  }
  resultat.sort((a, b) => (a.dateCreation < b.dateCreation ? 1 : -1));
  return resultat.slice(0, limite);
}

// --- Inventaire (miroir de demarrer_inventaire / valider_inventaire) ---

export interface InventaireResume {
  id: string;
  depotNom: string;
  statut: string;
  dateCreation: string;
}
// --- Pertes (port de client-electron/electron/services/stock.ts::declarerPerte) ---

export type MotifPerte = "perime" | "abime" | "vol" | "don" | "consommation" | "autre";

const LIBELLES_MOTIF_PERTE: Record<MotifPerte, string> = {
  perime: "Périmé",
  abime: "Abîmé / cassé",
  vol: "Vol / disparu",
  don: "Don",
  consommation: "Consommation interne",
  autre: "Autre",
};

export interface ParametresPerte {
  varianteId: string;
  depotId: string;
  quantite: number;
  motif: MotifPerte;
  detail?: string;
  utilisateurId: string | null;
}

/**
 * Sortie de stock sans vente : une vraie perte (périmé, casse, vol, don...),
 * à distinguer d'un ajustement qui corrige une erreur de saisie. Valorisée au
 * CUMP courant de la variante et figée sur la perte. Le stock est vérifié
 * AVANT d'écrire quoi que ce soit (IndexedDB n'a pas de transaction commune
 * ici) : une perte refusée ne laisse aucune trace.
 */
export async function declarerPerte(params: ParametresPerte): Promise<string> {
  const { varianteId, depotId, quantite, motif, utilisateurId } = params;
  const detail = (params.detail ?? "").trim();
  if (!(quantite > 0)) throw new ErreurStock("La quantité doit être strictement positive.");
  if (!(motif in LIBELLES_MOTIF_PERTE)) throw new ErreurStock("Motif de perte inconnu.");
  if (motif === "autre" && !detail) throw new ErreurStock("Précisez la raison de la perte.");

  const variante = await obtenirLigne("variantes", varianteId);
  if (!variante) throw new ErreurStock("Produit introuvable.");
  const db = await ouvrirBaseDeDonnees();
  const stock = await db.getFromIndex("stocks", "variante_depot", [varianteId, depotId]);
  if ((stock?.quantite ?? 0) < quantite) throw new ErreurStock("Stock insuffisant pour cette opération.");

  const id = crypto.randomUUID();
  const perte: PerteStockLocal = {
    id,
    variante_id: varianteId,
    depot_id: depotId,
    quantite,
    motif,
    detail,
    valeur: Math.round(quantite * variante.prix_achat),
    utilisateur_id: utilisateurId,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("pertes_stock", perte);
  await appliquerMouvement({
    varianteId,
    depotId,
    type: "sortie",
    quantite,
    motif: `Perte : ${LIBELLES_MOTIF_PERTE[motif]}${detail ? ` (${detail})` : ""}`,
    utilisateurId,
    referenceType: "stock.PerteStock",
    referenceId: id,
  });
  await terminerDestockageSiEpuise(varianteId);
  return id;
}

export interface PerteResume {
  id: string;
  dateCreation: string;
  produitNom: string;
  reference: string;
  depotNom: string;
  quantite: number;
  motif: MotifPerte;
  detail: string;
  valeur: number;
  /** Qui a fait l'opération (voir hooks/useNomsUtilisateurs.ts). */
  utilisateurId: string | null;
}

/** Pertes de la boutique, les plus récentes d'abord ; debut/fin (ISO) optionnels. */
export async function listerPertes(boutiqueId: string, debut?: string, fin?: string): Promise<PerteResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const depots = (await db.getAllFromIndex("depots", "boutique_id", boutiqueId)).filter((d) => !d.supprime);
  const resultat: PerteResume[] = [];
  for (const depot of depots) {
    for (const p of await db.getAllFromIndex("pertes_stock", "depot_id", depot.id)) {
      if (p.supprime) continue;
      if (debut && p.date_creation < debut) continue;
      if (fin && p.date_creation > fin) continue;
      const variante = await db.get("variantes", p.variante_id);
      const produit = variante ? await db.get("produits", variante.produit_id) : undefined;
      resultat.push({
        id: p.id,
        dateCreation: p.date_creation,
        produitNom: produit?.nom ?? "",
        reference: variante?.reference ?? "",
        depotNom: depot.nom,
        quantite: p.quantite,
        motif: p.motif as MotifPerte,
        detail: p.detail ?? "",
        valeur: p.valeur,
        utilisateurId: p.utilisateur_id ?? null,
      });
    }
  }
  return resultat.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}

// --- Déstockage (port de client-electron/electron/services/stock.ts) ---

function aujourdhui(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function estActif(d: DestockageLocal, jour = aujourdhui()): boolean {
  return !d.supprime && d.statut === "en_cours" && (!d.date_fin || d.date_fin >= jour);
}

export interface DestockageActif {
  id: string;
  prixNormal: number;
  prixDestockage: number;
}

/** Déstockage en cours et pas encore arrivé à sa date de fin, ou undefined. */
export async function destockageActif(varianteId: string): Promise<DestockageActif | undefined> {
  const db = await ouvrirBaseDeDonnees();
  const actifs = (await db.getAllFromIndex("destockages", "variante_id", varianteId))
    .filter((d) => estActif(d))
    .sort((a, b) => b.date_creation.localeCompare(a.date_creation));
  const d = actifs[0];
  return d ? { id: d.id, prixNormal: d.prix_normal, prixDestockage: d.prix_destockage } : undefined;
}

async function terminerDestockage(d: DestockageLocal, motif: "date" | "epuise" | "manuel"): Promise<void> {
  await ecrireLigne("destockages", {
    ...d,
    statut: "termine",
    motif_fin: motif,
    date_arret: maintenant(),
    date_modification: maintenant(),
    synchronise: 0,
  });
}

export interface ParametresDestockage {
  varianteId: string;
  prixDestockage: number;
  /** "AAAA-MM-JJ", optionnelle. */
  dateFin?: string | null;
  utilisateurId: string | null;
}

async function verifierDestockage(varianteId: string, prixDestockage: number, dateFin: string | null): Promise<void> {
  const variante = await obtenirLigne("variantes", varianteId);
  if (!variante) throw new ErreurStock("Produit introuvable.");
  if (!(prixDestockage > 0)) throw new ErreurStock("Le prix de déstockage doit être positif.");
  if (prixDestockage >= variante.prix_vente) {
    throw new ErreurStock("Le prix de déstockage doit être inférieur au prix de vente normal.");
  }
  if (dateFin && dateFin < aujourdhui()) throw new ErreurStock("La date de fin est déjà passée.");
  if (await destockageActif(varianteId)) throw new ErreurStock("Cet article est déjà en déstockage.");
}

/** À appeler après verifierDestockage. */
async function insererDestockage(
  varianteId: string,
  prixDestockage: number,
  dateFin: string | null,
  utilisateurId: string | null,
  operationId: string | null,
): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  // Déstockages restés "en cours" mais dont la date de fin est passée : on les clôt.
  for (const ancien of await db.getAllFromIndex("destockages", "variante_id", varianteId)) {
    if (!ancien.supprime && ancien.statut === "en_cours") await terminerDestockage(ancien, "date");
  }
  const variante = (await obtenirLigne("variantes", varianteId))!;
  const id = crypto.randomUUID();
  const destockage: DestockageLocal = {
    id,
    variante_id: varianteId,
    prix_normal: variante.prix_vente,
    prix_destockage: prixDestockage,
    date_fin: dateFin,
    statut: "en_cours",
    motif_fin: "",
    date_arret: null,
    utilisateur_id: utilisateurId,
    operation_id: operationId,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("destockages", destockage);
  return id;
}

export async function demarrerDestockage(params: ParametresDestockage): Promise<string> {
  const { varianteId, prixDestockage, utilisateurId } = params;
  const dateFin = params.dateFin || null;
  await verifierDestockage(varianteId, prixDestockage, dateFin);
  return insererDestockage(varianteId, prixDestockage, dateFin, utilisateurId, null);
}

export interface ParametresOperationDestockage {
  boutiqueId: string;
  nom: string;
  lignes: { varianteId: string; prixDestockage: number }[];
  dateFin?: string | null;
  utilisateurId: string | null;
}

/**
 * Déstocke plusieurs articles d'un coup sous un même nom (port de
 * demarrerOperationDestockage côté Electron). Tout ou rien : tout est vérifié
 * avant la moindre écriture.
 */
export async function demarrerOperationDestockage(params: ParametresOperationDestockage): Promise<string> {
  const { boutiqueId, lignes, utilisateurId } = params;
  const nom = params.nom.trim();
  const dateFin = params.dateFin || null;
  if (lignes.length === 0) throw new ErreurStock("Choisissez au moins un article.");
  if (!nom) throw new ErreurStock("Donnez un nom à l'opération de déstockage.");
  if (new Set(lignes.map((l) => l.varianteId)).size !== lignes.length) {
    throw new ErreurStock("Un même article apparaît deux fois.");
  }
  const db = await ouvrirBaseDeDonnees();
  for (const ligne of lignes) {
    try {
      await verifierDestockage(ligne.varianteId, ligne.prixDestockage, dateFin);
    } catch (erreur) {
      const variante = await db.get("variantes", ligne.varianteId);
      const produit = variante ? await db.get("produits", variante.produit_id) : undefined;
      throw new ErreurStock(`${produit?.nom ?? "Article"} : ${(erreur as Error).message}`);
    }
  }

  const operationId = crypto.randomUUID();
  const operation: OperationDestockageLocale = {
    id: operationId,
    boutique_id: boutiqueId,
    nom,
    date_fin: dateFin,
    utilisateur_id: utilisateurId,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("operations_destockage", operation);
  for (const ligne of lignes) {
    await insererDestockage(ligne.varianteId, ligne.prixDestockage, dateFin, utilisateurId, operationId);
  }
  return operationId;
}

/** Arrête tous les déstockages encore en cours de l'opération. */
export async function arreterOperationDestockage(id: string): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const enCours = (await db.getAllFromIndex("destockages", "operation_id", id)).filter(
    (d) => !d.supprime && d.statut === "en_cours",
  );
  if (enCours.length === 0) throw new ErreurStock("Cette opération est déjà terminée.");
  for (const d of enCours) await terminerDestockage(d, "manuel");
}

export async function arreterDestockage(id: string): Promise<void> {
  const destockage = await obtenirLigne("destockages", id);
  if (!destockage) throw new ErreurStock("Déstockage introuvable.");
  if (destockage.statut === "termine") throw new ErreurStock("Ce déstockage est déjà terminé.");
  await terminerDestockage(destockage, "manuel");
}

/** Après une sortie de stock (vente, perte) : fin automatique quand l'article
 * n'a plus de stock, tous dépôts confondus. */
export async function terminerDestockageSiEpuise(varianteId: string): Promise<void> {
  const actif = await destockageActif(varianteId);
  if (!actif) return;
  const db = await ouvrirBaseDeDonnees();
  const stocks = await db.getAllFromIndex(
    "stocks",
    "variante_depot",
    IDBKeyRange.bound([varianteId, ""], [varianteId, "\uffff"]),
  );
  if (stocks.reduce((total, s) => total + s.quantite, 0) <= 0) {
    const destockage = await obtenirLigne("destockages", actif.id);
    if (destockage) await terminerDestockage(destockage, "epuise");
  }
}

export interface VarianteDestockage {
  id: string;
  produitNom: string;
  reference: string;
  prixVente: number;
  prixAchat: number;
}

/** Recherche d'articles pour le formulaire de déstockage (nom, référence, code-barres). */
export async function rechercherVariantesDestockage(boutiqueId: string, terme: string): Promise<VarianteDestockage[]> {
  const t = terme.trim().toLowerCase();
  if (!t) return [];
  const db = await ouvrirBaseDeDonnees();
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime);
  const resultat: VarianteDestockage[] = [];
  for (const produit of produits) {
    for (const v of await db.getAllFromIndex("variantes", "produit_id", produit.id)) {
      if (v.supprime) continue;
      const texte = `${produit.nom} ${v.reference ?? ""} ${v.code_barres ?? ""}`.toLowerCase();
      if (!texte.includes(t)) continue;
      resultat.push({
        id: v.id,
        produitNom: produit.nom,
        reference: v.reference ?? "",
        prixVente: v.prix_vente,
        prixAchat: v.prix_achat,
      });
    }
  }
  return resultat.sort((a, b) => a.produitNom.localeCompare(b.produitNom)).slice(0, 20);
}

export type StatutDestockage = "en_cours" | "termine";
export type MotifFinDestockage = "" | "date" | "epuise" | "manuel";

export interface DestockageResume {
  id: string;
  varianteId: string;
  produitNom: string;
  reference: string;
  prixAchat: number;
  prixNormal: number;
  prixDestockage: number;
  dateCreation: string;
  dateFin: string | null;
  dateArret: string | null;
  /** Statut réel : un déstockage "en cours" dont la date de fin est passée est terminé ("date"). */
  statut: StatutDestockage;
  motifFin: MotifFinDestockage;
  /** Opération de déstockage (groupe nommé) à laquelle l'article appartient. */
  operationId: string | null;
  operationNom: string | null;
  quantiteVendue: number;
  chiffreAffaires: number;
  marge: number;
  manqueAGagner: number;
  stockRestant: number;
  /** Qui a fait l'opération (voir hooks/useNomsUtilisateurs.ts). */
  utilisateurId: string | null;
}

/** Tous les déstockages de la boutique avec leur bilan (ventes non annulées). */
export async function listerDestockages(boutiqueId: string): Promise<DestockageResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const jour = aujourdhui();
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime);
  const nomsOperations = new Map(
    (await db.getAllFromIndex("operations_destockage", "boutique_id", boutiqueId)).map((o) => [o.id, o.nom]),
  );

  // Bilan des ventes par déstockage (lignes liées, ventes non annulées de la boutique).
  const bilans = new Map<string, { quantite: number; ca: number; cout: number; normal: number }>();
  for (const vente of await db.getAllFromIndex("ventes", "boutique_id", boutiqueId)) {
    if (vente.supprime || vente.statut === "annulee") continue;
    for (const l of await db.getAllFromIndex("lignes_vente", "vente_id", vente.id)) {
      if (l.supprime || !l.destockage_id) continue;
      const b = bilans.get(l.destockage_id) ?? { quantite: 0, ca: 0, cout: 0, normal: 0 };
      b.quantite += l.quantite;
      b.ca += l.sous_total;
      b.cout += l.quantite * l.cout_unitaire;
      b.normal += l.quantite * (l.prix_normal ?? l.prix_unitaire);
      bilans.set(l.destockage_id, b);
    }
  }

  const resultat: DestockageResume[] = [];
  for (const produit of produits) {
    for (const v of await db.getAllFromIndex("variantes", "produit_id", produit.id)) {
      const destockages = (await db.getAllFromIndex("destockages", "variante_id", v.id)).filter((d) => !d.supprime);
      if (destockages.length === 0) continue;
      const stocks = await db.getAllFromIndex(
        "stocks",
        "variante_depot",
        IDBKeyRange.bound([v.id, ""], [v.id, "\uffff"]),
      );
      const stockRestant = stocks.reduce((total, s) => total + s.quantite, 0);
      for (const d of destockages) {
        const b = bilans.get(d.id) ?? { quantite: 0, ca: 0, cout: 0, normal: 0 };
        const expire = d.statut === "en_cours" && !!d.date_fin && d.date_fin < jour;
        resultat.push({
          id: d.id,
          varianteId: v.id,
          produitNom: produit.nom,
          reference: v.reference ?? "",
          prixAchat: v.prix_achat,
          prixNormal: d.prix_normal,
          prixDestockage: d.prix_destockage,
          dateCreation: d.date_creation,
          dateFin: d.date_fin || null,
          dateArret: d.date_arret,
          statut: expire ? "termine" : d.statut,
          motifFin: expire ? "date" : d.motif_fin,
          operationId: d.operation_id ?? null,
          utilisateurId: d.utilisateur_id ?? null,
          operationNom: d.operation_id ? (nomsOperations.get(d.operation_id) ?? null) : null,
          quantiteVendue: b.quantite,
          chiffreAffaires: b.ca,
          marge: b.ca - b.cout,
          manqueAGagner: b.normal - b.ca,
          stockRestant,
        });
      }
    }
  }
  return resultat.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}


export async function listerInventaires(boutiqueId: string): Promise<InventaireResume[]> {
  const inventaires = (await listerParIndex("inventaires", "boutique_id", boutiqueId)).filter((i) => !i.supprime);
  const resultat: InventaireResume[] = [];
  for (const inv of inventaires) {
    const depot = await obtenirLigne("depots", inv.depot_id);
    resultat.push({ id: inv.id, depotNom: depot?.nom ?? "", statut: inv.statut, dateCreation: inv.date_creation });
  }
  resultat.sort((a, b) => (a.dateCreation < b.dateCreation ? 1 : -1));
  return resultat;
}

export async function demarrerInventaire(boutiqueId: string, depotId: string, utilisateurId: string | null): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  const id = crypto.randomUUID();
  const inventaire: InventaireLocal = {
    id,
    boutique_id: boutiqueId,
    depot_id: depotId,
    statut: "en_cours",
    utilisateur_id: utilisateurId,
    date_validation: null,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("inventaires", inventaire);

  const tousLesStocks = await db.getAll("stocks");
  for (const s of tousLesStocks) {
    if (s.depot_id !== depotId) continue;
    const ligne: LigneInventaireLocale = {
      id: crypto.randomUUID(),
      inventaire_id: id,
      variante_id: s.variante_id,
      qte_theorique: s.quantite,
      qte_physique: s.quantite,
      ecart: 0,
      prix_achat_fige: 0,
      ...suiviSyncNeuf(),
    };
    await ecrireLigne("lignes_inventaire", ligne);
  }

  return id;
}

export interface LigneInventaireDetail {
  id: string;
  varianteId: string;
  produitNom: string;
  reference: string;
  qteTheorique: number;
  qtePhysique: number;
  ecart: number;
  prixAchat: number;
  valeurTheorique: number;
  valeurPhysique: number;
  valeurEcart: number;
  caPeriode: number;
}

export interface InventaireDetail {
  id: string;
  depotId: string;
  depotNom: string;
  statut: string;
  dateValidation: string | null;
  lignes: LigneInventaireDetail[];
  valeurTheorique: number;
  valeurPhysique: number;
  ecartValeur: number;
  caPeriode: number;
}

/** CA (ventes non annulées) par variante du dépôt entre deux dates. `depuis` à null = depuis le tout début. */
async function calculerCaParVariante(
  boutiqueId: string,
  depotId: string,
  depuis: string | null,
  jusqua: string,
): Promise<Map<string, number>> {
  const db = await ouvrirBaseDeDonnees();
  const ventes = (await db.getAllFromIndex("ventes", "boutique_id", boutiqueId)).filter(
    (v) =>
      !v.supprime &&
      v.depot_id === depotId &&
      v.statut !== "annulee" &&
      v.date_creation <= jusqua &&
      (!depuis || v.date_creation > depuis),
  );

  const carte = new Map<string, number>();
  for (const vente of ventes) {
    const lignes = (await listerParIndex("lignes_vente", "vente_id", vente.id)).filter((l) => !l.supprime);
    for (const ligne of lignes) {
      carte.set(ligne.variante_id, (carte.get(ligne.variante_id) ?? 0) + ligne.sous_total);
    }
  }
  return carte;
}

export async function obtenirInventaire(id: string): Promise<InventaireDetail | undefined> {
  const inventaire = await obtenirLigne("inventaires", id);
  if (!inventaire) return undefined;
  const depot = await obtenirLigne("depots", inventaire.depot_id);

  const lignesBrutes = (await listerParIndex("lignes_inventaire", "inventaire_id", id)).filter((l) => !l.supprime);

  // CA depuis le précédent inventaire validé du même dépôt (ou depuis le début s'il n'y en a pas encore).
  const inventairesMemeDepot = (await listerParIndex("inventaires", "boutique_id", inventaire.boutique_id)).filter(
    (i) => i.depot_id === inventaire.depot_id && i.statut === "valide" && !i.supprime && i.id !== id && i.date_validation,
  );
  const dateReference = inventaire.date_validation;
  const precedents = inventairesMemeDepot
    .filter((i) => !dateReference || (i.date_validation as string) < dateReference)
    .sort((a, b) => ((b.date_validation as string) < (a.date_validation as string) ? -1 : 1));
  const precedent = precedents[0];

  const jusqua = inventaire.date_validation ?? maintenant();
  const caParVariante = await calculerCaParVariante(
    inventaire.boutique_id,
    inventaire.depot_id,
    precedent?.date_validation ?? null,
    jusqua,
  );

  const lignes: LigneInventaireDetail[] = [];
  for (const l of lignesBrutes) {
    const variante = await obtenirLigne("variantes", l.variante_id);
    if (!variante) continue;
    const produit = await obtenirLigne("produits", variante.produit_id);
    const prixAchat = inventaire.statut === "valide" ? l.prix_achat_fige : variante.prix_achat;
    lignes.push({
      id: l.id,
      varianteId: l.variante_id,
      produitNom: produit?.nom ?? "",
      reference: variante.reference,
      qteTheorique: l.qte_theorique,
      qtePhysique: l.qte_physique,
      ecart: l.ecart,
      prixAchat,
      valeurTheorique: Math.round(l.qte_theorique * prixAchat),
      valeurPhysique: Math.round(l.qte_physique * prixAchat),
      valeurEcart: Math.round(l.ecart * prixAchat),
      caPeriode: Math.round(caParVariante.get(l.variante_id) ?? 0),
    });
  }
  lignes.sort((a, b) => a.produitNom.localeCompare(b.produitNom));

  const valeurTheorique = lignes.reduce((total, l) => total + l.valeurTheorique, 0);
  const valeurPhysique = lignes.reduce((total, l) => total + l.valeurPhysique, 0);
  const caPeriode = lignes.reduce((total, l) => total + l.caPeriode, 0);

  return {
    id: inventaire.id,
    depotId: inventaire.depot_id,
    depotNom: depot?.nom ?? "",
    statut: inventaire.statut,
    dateValidation: inventaire.date_validation,
    lignes,
    valeurTheorique: Math.round(valeurTheorique),
    valeurPhysique: Math.round(valeurPhysique),
    ecartValeur: Math.round(valeurPhysique - valeurTheorique),
    caPeriode: Math.round(caPeriode),
  };
}

export async function modifierLigneInventaire(id: string, qtePhysique: number): Promise<void> {
  const ligne = await obtenirLigne("lignes_inventaire", id);
  if (!ligne) throw new ErreurStock("Ligne d'inventaire introuvable.");
  const inventaire = await obtenirLigne("inventaires", ligne.inventaire_id);
  if (inventaire?.statut === "valide") {
    throw new ErreurStock("Cet inventaire est déjà validé, il ne peut plus être modifié.");
  }

  const ecart = qtePhysique - ligne.qte_theorique;
  await ecrireLigne("lignes_inventaire", {
    ...ligne,
    qte_physique: qtePhysique,
    ecart,
    date_modification: maintenant(),
    synchronise: 0,
  });
}

export async function validerInventaire(id: string, utilisateurId: string | null): Promise<void> {
  const inventaire = await obtenirLigne("inventaires", id);
  if (!inventaire) throw new ErreurStock("Inventaire introuvable.");
  if (inventaire.statut === "valide") throw new ErreurStock("Cet inventaire est déjà validé.");

  const lignes = (await listerParIndex("lignes_inventaire", "inventaire_id", id)).filter((l) => !l.supprime);
  for (const ligne of lignes) {
    // On fige le CUMP courant sur la ligne : cet inventaire doit rester une photo
    // fidèle à sa date de validation, même si le CUMP de la variante évolue ensuite.
    const variante = await obtenirLigne("variantes", ligne.variante_id);
    await ecrireLigne("lignes_inventaire", {
      ...ligne,
      prix_achat_fige: variante?.prix_achat ?? 0,
      date_modification: maintenant(),
      synchronise: 0,
    });

    if (ligne.ecart !== 0) {
      await appliquerMouvement({
        varianteId: ligne.variante_id,
        depotId: inventaire.depot_id,
        type: "ajustement",
        quantite: ligne.ecart,
        motif: "Correction d'inventaire",
        utilisateurId,
        referenceType: "stock.Inventaire",
        referenceId: id,
      });
    }
  }

  await ecrireLigne("inventaires", {
    ...inventaire,
    statut: "valide",
    date_validation: maintenant(),
    date_modification: maintenant(),
    synchronise: 0,
  });
}
