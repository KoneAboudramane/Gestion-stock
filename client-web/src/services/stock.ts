import { ouvrirBaseDeDonnees } from "../db";
import { listerParIndex, maintenant, obtenirLigne, ecrireLigne, suiviSyncNeuf } from "../db/helpers";
import type {
  DetaillageLocal,
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

function formaterNombreStock(valeur: number): string {
  return Math.round(Number(valeur) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Lignes de stock encore positives d'un dépôt, avec leur valeur au prix d'achat. */
async function stockRestantDepot(depotId: string): Promise<{ varianteId: string; quantite: number; valeur: number }[]> {
  const db = await ouvrirBaseDeDonnees();
  const resultat: { varianteId: string; quantite: number; valeur: number }[] = [];
  for (const s of await db.getAll("stocks")) {
    if (s.depot_id !== depotId || Number(s.quantite) <= 0) continue;
    const variante = await db.get("variantes", s.variante_id);
    resultat.push({ varianteId: s.variante_id, quantite: Number(s.quantite), valeur: Number(s.quantite) * Number(variante?.prix_achat ?? 0) });
  }
  return resultat;
}

/** Un dépôt qui contient encore de la marchandise ne se supprime pas : on transfère d'abord. */
export async function supprimerDepot(id: string): Promise<void> {
  const depot = await obtenirLigne("depots", id);
  if (!depot) return;
  const reste = await stockRestantDepot(id);
  if (reste.length > 0) {
    const devise = (await obtenirLigne("boutiques", depot.boutique_id))?.devise || "FCFA";
    const valeur = reste.reduce((t, l) => t + l.valeur, 0);
    throw new ErreurStock(
      `${reste.length} article(s) sont encore dans ce dépôt (${formaterNombreStock(valeur)} ${devise}) : ` +
        "transférez-les d'abord vers un autre dépôt.",
    );
  }
  await ecrireLigne("depots", { ...depot, supprime: 1, synchronise: 0, date_modification: maintenant() });
}


/** Dépôt supprimé qui contient encore du stock (à rapatrier). */
export interface DepotSupprimeAvecStock {
  id: string;
  nom: string;
  articles: number;
  valeur: number;
}

/** Transfère tout le stock d'un dépôt vers un autre (fermeture d'un dépôt, rapatriement). */
export async function transfererToutLeStock(
  depotSourceId: string,
  depotDestinationId: string,
  utilisateurId: string | null,
): Promise<number> {
  const lignes = await stockRestantDepot(depotSourceId);
  if (lignes.length === 0) throw new ErreurStock("Ce dépôt ne contient plus de marchandise.");
  for (const l of lignes) {
    await transfererStock({ varianteId: l.varianteId, depotSourceId, depotDestinationId, quantite: l.quantite, utilisateurId });
  }
  return lignes.length;
}

export async function depotsSupprimesAvecStock(boutiqueId: string): Promise<DepotSupprimeAvecStock[]> {
  const db = await ouvrirBaseDeDonnees();
  const resultat: DepotSupprimeAvecStock[] = [];
  for (const d of await db.getAllFromIndex("depots", "boutique_id", boutiqueId)) {
    if (!d.supprime) continue;
    const reste = await stockRestantDepot(d.id);
    if (reste.length > 0) resultat.push({ id: d.id, nom: d.nom, articles: reste.length, valeur: reste.reduce((t, l) => t + l.valeur, 0) });
  }
  return resultat;
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
  /** Article de gros : son article de détail et combien il en contient. */
  detailNom?: string | null;
  quantiteDetail?: number | null;
  /** Article de détail : son article de gros et le stock de gros dans ce dépôt. */
  grosNom?: string | null;
  grosStock?: number | null;
  /** Unités (carton, paquet…) pour « 12 cartons (= 288 paquets) ». */
  detailUnite?: string | null;
  grosUnite?: string | null;
  /** Article de détail : son article de gros (pour l'ouvrir depuis la ligne). */
  grosVarianteId?: string | null;
}

async function nomUniteProduit(produitId: string | undefined): Promise<string> {
  if (!produitId) return "";
  const produit = await obtenirLigne("produits", produitId);
  const unite = produit?.unite_id ? await obtenirLigne("unites", produit.unite_id) : undefined;
  return unite?.nom ?? "";
}

export async function listerStock(boutiqueId: string, depotId?: string, terme = ""): Promise<LigneStock[]> {
  const db = await ouvrirBaseDeDonnees();
  const depots = (await db.getAllFromIndex("depots", "boutique_id", boutiqueId)).filter((d) => !d.supprime);
  const depotsParId = new Map(depots.map((d) => [d.id, d]));
  const motif = terme.trim().toLowerCase();

  const resultat: LigneStock[] = [];
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime);
  // Article de détail → son article de gros (le plus ancien lien s'il y en a plusieurs).
  const nomsProduits = new Map(produits.map((p) => [p.id, p.nom]));
  const grosParDetail = new Map<string, { id: string; nom: string; unite: string }>();
  for (const g of (await db.getAll("variantes")).sort((a, b) => a.date_creation.localeCompare(b.date_creation))) {
    if (g.supprime || !g.variante_detail_id || grosParDetail.has(g.variante_detail_id)) continue;
    const nom = nomsProduits.get(g.produit_id);
    if (nom) grosParDetail.set(g.variante_detail_id, { id: g.id, nom, unite: await nomUniteProduit(g.produit_id) });
  }
  for (const produit of produits) {
    if (motif && !produit.nom.toLowerCase().includes(motif)) continue;
    const variantes = (await db.getAllFromIndex("variantes", "produit_id", produit.id)).filter((v) => !v.supprime);
    for (const variante of variantes) {
      const detail = variante.variante_detail_id ? await db.get("variantes", variante.variante_detail_id) : undefined;
      const produitDetail = detail && !detail.supprime ? await db.get("produits", detail.produit_id) : undefined;
      const gros = grosParDetail.get(variante.id);
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
          detailNom: produitDetail?.nom ?? null,
          quantiteDetail: produitDetail ? Number(variante.quantite_detail ?? 0) : null,
          grosNom: gros?.nom ?? null,
          grosStock: gros ? await stockVarianteDepot(gros.id, depot.id) : null,
          detailUnite: produitDetail ? await nomUniteProduit(produitDetail.id) : null,
          grosUnite: gros?.unite || null,
          grosVarianteId: gros?.id ?? null,
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
  /** Document à l'origine du mouvement (ex. « ventes.Vente ») ; vide pour une saisie manuelle. */
  referenceType: string;
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
      referenceType: m.reference_type ?? "",
    });
  }
  resultat.sort((a, b) => (a.dateCreation < b.dateCreation ? 1 : -1));
  return resultat.slice(0, limite);
}

// Historique produit (toutes variantes, tous dépôts) — port de
// client-electron/electron/services/stock.ts::listerMouvementsParProduit.
export async function listerMouvementsParProduit(produitId: string, limite = 100): Promise<MouvementResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const produit = await db.get("produits", produitId);
  if (!produit) return [];
  const variantes = new Map(
    (await db.getAllFromIndex("variantes", "produit_id", produitId)).map((v) => [v.id, v]),
  );
  const resultat: MouvementResume[] = [];
  for (const m of await db.getAll("mouvements_stock")) {
    const variante = variantes.get(m.variante_id);
    if (m.supprime || !variante) continue;
    const depot = await db.get("depots", m.depot_id);
    if (!depot) continue;
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
      referenceType: m.reference_type ?? "",
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
  depotId: string;
  depotNom: string;
  statut: string;
  dateCreation: string;
  dateValidation: string | null;
  utilisateurId: string | null;
  /** Articles comptés (lignes de l'inventaire). */
  nombreArticles: number;
  /** Articles trouvés en plus / en moins que le stock théorique. */
  ecartsPlus: number;
  ecartsMoins: number;
  /** Valeur de l'écart au coût d'achat (figé à la validation). */
  ecartValeur: number;
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

/** Perte saisie par erreur : remet la quantité en stock, la perte reste visible (annulée). */
export async function annulerPerte(id: string, utilisateurId: string | null): Promise<void> {
  const perte = await obtenirLigne("pertes_stock", id);
  if (!perte) throw new ErreurStock("Perte introuvable.");
  if (perte.annulee) throw new ErreurStock("Cette perte est déjà annulée.");
  await appliquerMouvement({
    varianteId: perte.variante_id,
    depotId: perte.depot_id,
    type: "entree",
    quantite: perte.quantite,
    motif: `Annulation perte : ${LIBELLES_MOTIF_PERTE[perte.motif as MotifPerte] ?? perte.motif}`,
    utilisateurId,
    referenceType: "stock.PerteStock",
    referenceId: id,
  });
  await ecrireLigne("pertes_stock", {
    ...perte,
    annulee: true,
    date_annulation: maintenant(),
    date_modification: maintenant(),
    synchronise: 0,
  });
}

/** Change le prix et/ou la date de fin d'un déstockage en cours, sans l'arrêter. */
export async function modifierDestockage(
  id: string,
  champs: { prixDestockage?: number; dateFin?: string | null },
): Promise<void> {
  const d = await obtenirLigne("destockages", id);
  if (!d || (await destockageActif(d.variante_id))?.id !== id) {
    throw new ErreurStock("Seul un déstockage en cours peut être modifié.");
  }
  const misAJour = { ...d };
  if (champs.prixDestockage !== undefined) {
    if (!(champs.prixDestockage > 0) || champs.prixDestockage >= d.prix_normal) {
      throw new ErreurStock("Le prix de déstockage doit être positif et inférieur au prix normal.");
    }
    misAJour.prix_destockage = champs.prixDestockage;
  }
  if (champs.dateFin !== undefined) {
    if (champs.dateFin && champs.dateFin < aujourdhui()) throw new ErreurStock("La date de fin est déjà passée.");
    misAJour.date_fin = champs.dateFin || null;
  }
  await ecrireLigne("destockages", { ...misAJour, date_modification: maintenant(), synchronise: 0 });
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
  /** Perte annulée (saisie par erreur) : visible mais hors des totaux. */
  annulee: boolean;
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
        annulee: !!p.annulee,
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

/** Article dont le code-barres est exactement `code` (douchette de l'inventaire). */
export async function trouverVarianteParCodeBarres(
  boutiqueId: string,
  code: string,
): Promise<{ id: string; produitNom: string } | undefined> {
  const db = await ouvrirBaseDeDonnees();
  for (const produit of (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime)) {
    for (const v of await db.getAllFromIndex("variantes", "produit_id", produit.id)) {
      if (!v.supprime && v.code_barres === code) return { id: v.id, produitNom: produit.nom };
    }
  }
  return undefined;
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
    const lignes = (await listerParIndex("lignes_inventaire", "inventaire_id", inv.id)).filter((l) => !l.supprime);
    let ecartValeur = 0;
    for (const l of lignes) {
      const prixAchat =
        inv.statut === "valide" ? l.prix_achat_fige : ((await obtenirLigne("variantes", l.variante_id))?.prix_achat ?? 0);
      ecartValeur += Math.round(l.ecart * prixAchat);
    }
    resultat.push({
      id: inv.id,
      depotId: inv.depot_id,
      depotNom: depot?.nom ?? "",
      statut: inv.statut,
      dateCreation: inv.date_creation,
      dateValidation: inv.date_validation ?? null,
      utilisateurId: inv.utilisateur_id ?? null,
      nombreArticles: lignes.length,
      ecartsPlus: lignes.filter((l) => l.ecart > 0).length,
      ecartsMoins: lignes.filter((l) => l.ecart < 0).length,
      ecartValeur,
    });
  }
  resultat.sort((a, b) => (a.dateCreation < b.dateCreation ? 1 : -1));
  return resultat;
}

/** aZero : « comptage à zéro » — chaque article part de 0, seul ce qui est compté compte. */
export async function demarrerInventaire(
  boutiqueId: string,
  depotId: string,
  utilisateurId: string | null,
  aZero = false,
): Promise<string> {
  const dejaEnCours = (await listerParIndex("inventaires", "boutique_id", boutiqueId)).some(
    (i) => !i.supprime && i.depot_id === depotId && i.statut === "en_cours",
  );
  if (dejaEnCours) throw new ErreurStock("Un inventaire est déjà en cours sur ce dépôt : terminez-le ou reprenez-le avant d'en démarrer un autre.");
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
      qte_physique: aZero ? 0 : s.quantite,
      ecart: aZero ? -s.quantite : 0,
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
  codeBarres: string;
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
      codeBarres: variante.code_barres ?? "",
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

/** Article trouvé sur place mais absent de la liste : ajouté pendant le comptage. */
export async function ajouterLigneInventaire(inventaireId: string, varianteId: string, qtePhysique = 0): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  const inventaire = await obtenirLigne("inventaires", inventaireId);
  if (!inventaire) throw new ErreurStock("Inventaire introuvable.");
  if (inventaire.statut === "valide") throw new ErreurStock("Cet inventaire est déjà validé.");
  const existantes = await db.getAll("lignes_inventaire");
  if (existantes.some((l) => !l.supprime && l.inventaire_id === inventaireId && l.variante_id === varianteId)) {
    throw new ErreurStock("Cet article est déjà dans l'inventaire.");
  }
  const theorique = (await db.getFromIndex("stocks", "variante_depot", [varianteId, inventaire.depot_id]))?.quantite ?? 0;
  const ligne: LigneInventaireLocale = {
    id: crypto.randomUUID(),
    inventaire_id: inventaireId,
    variante_id: varianteId,
    qte_theorique: theorique,
    qte_physique: qtePhysique,
    ecart: qtePhysique - theorique,
    prix_achat_fige: 0,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("lignes_inventaire", ligne);
  return ligne.id;
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

// --- Détailler / regrouper (miroir de client-electron/electron/services/stock.ts) ---

export type TypeDetaillage = "detailler" | "regrouper";

export interface ParametresDetaillage {
  varianteGrosId: string;
  depotId: string;
  nombre: number;
  type: TypeDetaillage;
  utilisateurId: string | null;
}

async function stockTotalVariante(varianteId: string): Promise<number> {
  const db = await ouvrirBaseDeDonnees();
  const lignes = await db.getAllFromIndex(
    "stocks",
    "variante_depot",
    IDBKeyRange.bound([varianteId, ""], [varianteId, "\uffff"]),
  );
  return lignes.reduce((t, l) => t + Number(l.quantite), 0);
}

async function stockVarianteDepot(varianteId: string, depotId: string): Promise<number> {
  const db = await ouvrirBaseDeDonnees();
  return Number((await db.getFromIndex("stocks", "variante_depot", [varianteId, depotId]))?.quantite ?? 0);
}

async function cumpApresEntree(varianteId: string, prixAchat: number, quantite: number, cout: number): Promise<number> {
  const total = await stockTotalVariante(varianteId);
  return total > 0 ? Math.round((total * prixAchat + quantite * cout) / (total + quantite)) : Math.round(cout);
}

async function cumpApresSortie(varianteId: string, prixAchat: number, quantite: number, cout: number): Promise<number> {
  const total = await stockTotalVariante(varianteId);
  const reste = total - quantite;
  if (reste > 0) {
    const nouveau = Math.round((total * prixAchat - quantite * cout) / reste);
    if (nouveau > 0) return nouveau;
  }
  return prixAchat;
}

async function nomVariante(varianteId: string): Promise<string> {
  const variante = await obtenirLigne("variantes", varianteId);
  const produit = variante ? await obtenirLigne("produits", variante.produit_id) : undefined;
  return produit?.nom ?? "Article";
}

async function majPrixAchat(varianteId: string, prixAchat: number): Promise<void> {
  const variante = await obtenirLigne("variantes", varianteId);
  if (!variante) return;
  await ecrireLigne("variantes", { ...variante, prix_achat: prixAchat, date_modification: maintenant(), synchronise: 0 });
}

/** « Détailler » des cartons en paquets, ou « regrouper » des paquets en cartons ; le coût suit. */
export async function detaillerOuRegrouper(params: ParametresDetaillage): Promise<string> {
  const { varianteGrosId, depotId, nombre, type, utilisateurId } = params;
  const gros = await obtenirLigne("variantes", varianteGrosId);
  if (!gros) throw new ErreurStock("Article introuvable.");
  const parGros = Number(gros.quantite_detail ?? 0);
  const detail = gros.variante_detail_id ? await obtenirLigne("variantes", gros.variante_detail_id) : undefined;
  if (!detail || !(parGros > 0)) throw new ErreurStock("Cet article n'a pas d'article de détail.");
  if (!Number.isInteger(nombre) || nombre <= 0) throw new ErreurStock("Indiquez un nombre entier supérieur à zéro.");

  const detailler = type === "detailler";
  const source = detailler ? gros : detail;
  const cible = detailler ? detail : gros;
  const nomSource = await nomVariante(source.id);
  const nomCible = await nomVariante(cible.id);
  const quantiteSource = detailler ? nombre : nombre * parGros;
  const quantiteCible = detailler ? nombre * parGros : nombre;
  const coutCible = detailler ? Number(gros.prix_achat) / parGros : Number(detail.prix_achat) * parGros;

  const disponible = await stockVarianteDepot(source.id, depotId);
  if (disponible < quantiteSource) {
    throw new ErreurStock(
      `Pas assez de « ${nomSource} » dans ce dépôt : ${formaterNombreStock(disponible)} disponible(s), ${formaterNombreStock(quantiteSource)} nécessaire(s).`,
    );
  }
  const nouveauCump = await cumpApresEntree(cible.id, Number(cible.prix_achat), quantiteCible, coutCible);
  if (Number(cible.prix_vente) < nouveauCump) {
    throw new ErreurStock(
      `Le prix de vente de « ${nomCible} » (${formaterNombreStock(Number(cible.prix_vente))}) est inférieur à son coût (${formaterNombreStock(nouveauCump)}) : corrigez le prix avant.`,
    );
  }

  const id = crypto.randomUUID();
  const operation: DetaillageLocal = {
    id,
    depot_id: depotId,
    type,
    variante_source_id: source.id,
    variante_cible_id: cible.id,
    quantite_source: quantiteSource,
    quantite_cible: quantiteCible,
    cout_unitaire_cible: Math.round(coutCible * 100) / 100,
    utilisateur_id: utilisateurId,
    annulee: 0,
    date_annulation: null,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("detaillages", operation);
  const motif = `${detailler ? "Déballage" : "Remballage"} : ${formaterNombreStock(quantiteSource)} ${nomSource} → ${formaterNombreStock(quantiteCible)} ${nomCible}`;
  await appliquerMouvement({
    varianteId: source.id,
    depotId,
    type: "sortie",
    quantite: quantiteSource,
    motif,
    utilisateurId,
    referenceType: "stock.Detaillage",
    referenceId: id,
  });
  await majPrixAchat(cible.id, nouveauCump);
  await appliquerMouvement({
    varianteId: cible.id,
    depotId,
    type: "entree",
    quantite: quantiteCible,
    motif,
    utilisateurId,
    referenceType: "stock.Detaillage",
    referenceId: id,
  });
  await terminerDestockageSiEpuise(source.id);
  return id;
}

/** Remet les choses comme avant, tant que ce qui a été obtenu est encore en stock. */
export async function annulerDetaillage(id: string, utilisateurId: string | null): Promise<void> {
  const operation = await obtenirLigne("detaillages", id);
  if (!operation) throw new ErreurStock("Opération introuvable.");
  if (operation.annulee) throw new ErreurStock("Cette opération est déjà annulée.");
  const source = await obtenirLigne("variantes", operation.variante_source_id);
  const cible = await obtenirLigne("variantes", operation.variante_cible_id);
  if (!source || !cible) throw new ErreurStock("Article introuvable.");
  const quantiteSource = Number(operation.quantite_source);
  const quantiteCible = Number(operation.quantite_cible);
  if ((await stockVarianteDepot(cible.id, operation.depot_id)) < quantiteCible) {
    throw new ErreurStock(
      `Les ${formaterNombreStock(quantiteCible)} « ${await nomVariante(cible.id)} » obtenus ne sont plus tous en stock : annulation impossible.`,
    );
  }
  const coutCible = Number(operation.cout_unitaire_cible);
  const coutSource = (coutCible * quantiteCible) / quantiteSource;
  await majPrixAchat(cible.id, await cumpApresSortie(cible.id, Number(cible.prix_achat), quantiteCible, coutCible));
  await majPrixAchat(source.id, await cumpApresEntree(source.id, Number(source.prix_achat), quantiteSource, coutSource));
  const motif = `Annulation ${operation.type === "detailler" ? "déballage" : "remballage"}`;
  await appliquerMouvement({
    varianteId: cible.id,
    depotId: operation.depot_id,
    type: "sortie",
    quantite: quantiteCible,
    motif,
    utilisateurId,
    referenceType: "stock.Detaillage",
    referenceId: id,
  });
  await appliquerMouvement({
    varianteId: source.id,
    depotId: operation.depot_id,
    type: "entree",
    quantite: quantiteSource,
    motif,
    utilisateurId,
    referenceType: "stock.Detaillage",
    referenceId: id,
  });
  await ecrireLigne("detaillages", {
    ...operation,
    annulee: true,
    date_annulation: maintenant(),
    date_modification: maintenant(),
    synchronise: 0,
  });
}

export interface DetaillageResume {
  id: string;
  dateCreation: string;
  type: TypeDetaillage;
  depotNom: string;
  varianteSourceId: string;
  varianteCibleId: string;
  sourceNom: string;
  cibleNom: string;
  quantiteSource: number;
  quantiteCible: number;
  coutUnitaireCible: number;
  utilisateurId: string | null;
  annulee: boolean;
}

/** Détaillages et regroupements de la boutique, les plus récents d'abord. */
export async function listerDetaillages(boutiqueId: string): Promise<DetaillageResume[]> {
  const depots = await listerParIndex("depots", "boutique_id", boutiqueId);
  const resultat: DetaillageResume[] = [];
  for (const depot of depots) {
    for (const o of await listerParIndex("detaillages", "depot_id", depot.id)) {
      if (o.supprime) continue;
      resultat.push({
        id: o.id,
        dateCreation: o.date_creation,
        type: o.type,
        varianteSourceId: o.variante_source_id,
        varianteCibleId: o.variante_cible_id,
        depotNom: depot.nom,
        sourceNom: await nomVariante(o.variante_source_id),
        cibleNom: await nomVariante(o.variante_cible_id),
        quantiteSource: Number(o.quantite_source),
        quantiteCible: Number(o.quantite_cible),
        coutUnitaireCible: Number(o.cout_unitaire_cible),
        utilisateurId: o.utilisateur_id != null ? String(o.utilisateur_id) : null,
        annulee: Boolean(o.annulee),
      });
    }
  }
  return resultat.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}

export interface ArticleDetaillable {
  varianteGrosId: string;
  grosNom: string;
  varianteDetailId: string;
  detailNom: string;
  /** Unités de détail dans un article de gros. */
  quantite: number;
  /** Stock (du dépôt demandé, sinon tous dépôts). */
  stockGros: number;
  stockDetail: number;
  /** Unités (Paramètres → Unités) : « carton », « paquet »… vides si non renseignées. */
  uniteGros: string;
  uniteDetail: string;
  prixAchatGros: number;
  prixAchatDetail: number;
  prixVenteDetail: number;
  /** Seuil d'alerte de l'article de détail (« à déballer » en dessous). */
  seuilDetail: number;
}

export interface GrosDisponible {
  varianteGrosId: string;
  grosNom: string;
  quantite: number;
  stockGros: number;
  uniteGros: string;
  uniteDetail: string;
}

async function stockDe(varianteId: string, depotId?: string): Promise<number> {
  return depotId ? stockVarianteDepot(varianteId, depotId) : stockTotalVariante(varianteId);
}

/** Articles de gros reliés à un article de détail, avec leurs stocks. */
export async function listerArticlesDetaillables(boutiqueId: string, depotId?: string): Promise<ArticleDetaillable[]> {
  const produits = new Map(
    (await listerParIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime).map((p) => [p.id, p]),
  );
  const resultat: ArticleDetaillable[] = [];
  const db = await ouvrirBaseDeDonnees();
  for (const v of await db.getAll("variantes")) {
    const produit = produits.get(v.produit_id);
    if (!produit || v.supprime || !v.variante_detail_id) continue;
    const detail = await obtenirLigne("variantes", v.variante_detail_id);
    const produitDetail = detail ? produits.get(detail.produit_id) : undefined;
    if (!detail || detail.supprime || !produitDetail) continue;
    resultat.push({
      varianteGrosId: v.id,
      grosNom: produit.nom,
      varianteDetailId: detail.id,
      detailNom: produitDetail.nom,
      quantite: Number(v.quantite_detail ?? 0),
      stockGros: await stockDe(v.id, depotId),
      stockDetail: await stockDe(detail.id, depotId),
      uniteGros: await nomUniteProduit(produit.id),
      uniteDetail: await nomUniteProduit(produitDetail.id),
      prixAchatGros: Number(v.prix_achat),
      prixAchatDetail: Number(detail.prix_achat),
      prixVenteDetail: Number(detail.prix_vente),
      seuilDetail: Number(detail.seuil_alerte),
    });
  }
  return resultat.sort((a, b) => a.grosNom.localeCompare(b.grosNom, "fr"));
}

/** Pour un article de détail en rupture : un article de gros à détailler, s'il en reste dans ce dépôt. */
export async function grosDisponiblePourDetail(varianteDetailId: string, depotId: string): Promise<GrosDisponible | null> {
  const db = await ouvrirBaseDeDonnees();
  let meilleur: GrosDisponible | null = null;
  for (const v of await db.getAll("variantes")) {
    if (v.variante_detail_id !== varianteDetailId || v.supprime) continue;
    const produit = await obtenirLigne("produits", v.produit_id);
    if (!produit || produit.supprime) continue;
    const stockGros = await stockVarianteDepot(v.id, depotId);
    if (stockGros >= 1 && (!meilleur || stockGros > meilleur.stockGros)) {
      const detail = await obtenirLigne("variantes", varianteDetailId);
      meilleur = {
        varianteGrosId: v.id,
        grosNom: produit.nom,
        quantite: Number(v.quantite_detail ?? 0),
        stockGros,
        uniteGros: await nomUniteProduit(produit.id),
        uniteDetail: await nomUniteProduit(detail?.produit_id),
      };
    }
  }
  return meilleur;
}

/** Tous les articles de la boutique (nom + référence), pour choisir un article de détail. */
export async function listerVariantesSimples(boutiqueId: string): Promise<{ id: string; nom: string }[]> {
  const produits = (await listerParIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime);
  const resultat: { id: string; nom: string }[] = [];
  for (const p of produits) {
    for (const v of await listerParIndex("variantes", "produit_id", p.id)) {
      if (v.supprime) continue;
      resultat.push({ id: v.id, nom: v.reference ? `${p.nom} (${v.reference})` : p.nom });
    }
  }
  return resultat.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}
