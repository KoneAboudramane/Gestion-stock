import { ouvrirBaseDeDonnees } from "../db";
import { listerParIndex, maintenant, obtenirLigne, ecrireLigne, suiviSyncNeuf } from "../db/helpers";
import type { DepotLocal, InventaireLocal, LigneInventaireLocale, MouvementStockLocal, TransfertStockLocal } from "../db/schema";

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
