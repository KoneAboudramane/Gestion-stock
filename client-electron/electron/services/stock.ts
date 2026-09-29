import { randomUUID } from "node:crypto";
import type { SqlValue } from "sql.js";

import { dansUneTransaction, executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";

/**
 * Miroir de stock/services.py::appliquer_mouvement (Django, Étape 3) : le
 * stock est toujours recalculé à partir des mouvements, jamais écrasé
 * directement ; le stock négatif est interdit par défaut.
 * NB : n'appelle pas sauvegarder() — à la charge de l'appelant (fin d'une
 * opération de plus haut niveau comme creerVente), pour éviter une écriture
 * disque par ligne.
 */

export type TypeMouvement = "entree" | "sortie" | "ajustement";

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

export function fabricationPropreActive(boutiqueId: string): boolean {
  const parametre = unResultat<{ valeur: string }>(
    "SELECT valeur FROM parametres WHERE boutique_id = ? AND cle = ? AND supprime = 0",
    [boutiqueId, CLE_PARAMETRE_FABRICATION_PROPRE],
  );
  return parametre?.valeur === "1";
}

function fabricationPropreActivePourDepot(depotId: string): boolean {
  const depot = unResultat<{ boutique_id: string }>("SELECT boutique_id FROM depots WHERE id = ?", [depotId]);
  return depot ? fabricationPropreActive(depot.boutique_id) : false;
}

/** Entrée manuelle permise si la boutique fabrique, ou s'il s'agit du tout
 * premier stock de la variante (stock initial à la création du produit). */
function verifierEntreeManuelle(varianteId: string, depotId: string): void {
  if (fabricationPropreActivePourDepot(depotId)) return;
  const dejaMouvementee = unResultat<{ n: number }>(
    "SELECT COUNT(*) as n FROM mouvements_stock WHERE variante_id = ? AND supprime = 0",
    [varianteId],
  );
  if (Number(dejaMouvementee?.n ?? 0) > 0) {
    throw new ErreurStock(MESSAGE_ENTREE_RESERVEE_FABRICATION);
  }
}

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

export function appliquerMouvement(params: ParametresMouvement): string {
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

  const stockExistant = unResultat<{ id: string; quantite: number }>(
    "SELECT id, quantite FROM stocks WHERE variante_id = ? AND depot_id = ?",
    [varianteId, depotId],
  );

  const delta = deltaPour(type, quantite);
  const quantiteActuelle = stockExistant ? Number(stockExistant.quantite) : 0;
  const nouvelleQuantite = quantiteActuelle + delta;

  if (nouvelleQuantite < 0) {
    throw new ErreurStock("Stock insuffisant pour cette opération.");
  }

  if (stockExistant) {
    executer("UPDATE stocks SET quantite = ? WHERE id = ?", [nouvelleQuantite, stockExistant.id]);
  } else {
    executer("INSERT INTO stocks (id, variante_id, depot_id, quantite) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      varianteId,
      depotId,
      nouvelleQuantite,
    ]);
  }

  const mouvementId = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    `INSERT INTO mouvements_stock
       (id, variante_id, depot_id, type, quantite, motif, reference_type, reference_id, utilisateur_id, date_creation, date_modification)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      mouvementId,
      varianteId,
      depotId,
      type,
      quantite,
      motif,
      referenceType,
      referenceId,
      utilisateurId,
      maintenant,
      maintenant,
    ],
  );

  return mouvementId;
}

/**
 * Pour un mouvement saisi manuellement depuis l'écran Stock (pas depuis une
 * vente/un transfert/un inventaire, qui appellent déjà sauvegarder() eux-mêmes
 * une fois toutes leurs écritures faites) : appliquerMouvement() ne persiste
 * pas seule, donc on l'entoure ici pour ne pas oublier l'écriture sur disque.
 */
export function creerMouvementManuel(params: ParametresMouvement): string {
  if (params.type === "entree") verifierEntreeManuelle(params.varianteId, params.depotId);
  const id = appliquerMouvement(params);
  sauvegarder();
  return id;
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
 * Entrée de stock pour une boutique sans fournisseur (fabrication propre) :
 * miroir de la partie CUMP de achats/services.py::receptionner_commande, mais
 * pour une production plutôt qu'une réception — même formule de coût unitaire
 * moyen pondéré, pour que la marge (prix_vente − prix_achat) reste juste.
 */
export function creerEntreeProduction(params: ParametresEntreeProduction): string {
  const { varianteId, depotId, quantite, prixAchat, prixVente, motif = "", utilisateurId = null } = params;
  if (!fabricationPropreActivePourDepot(depotId)) {
    throw new ErreurStock(MESSAGE_ENTREE_RESERVEE_FABRICATION);
  }

  const resultat = dansUneTransaction(() => {
    const variante = unResultat<{ prix_achat: number; prix_vente: number }>(
      "SELECT prix_achat, prix_vente FROM variantes WHERE id = ?",
      [varianteId],
    );
    if (!variante) throw new ErreurStock("Produit introuvable.");

    const stockActuel = Number(
      unResultat<{ total: number }>(
        "SELECT COALESCE(SUM(quantite), 0) as total FROM stocks WHERE variante_id = ?",
        [varianteId],
      )?.total ?? 0,
    );
    const ancienPrixAchat = Number(variante.prix_achat);
    const nouveauPrixAchat =
      stockActuel > 0
        ? Math.round((stockActuel * ancienPrixAchat + quantite * prixAchat) / (stockActuel + quantite))
        : prixAchat;
    const nouveauPrixVente = prixVente ?? Number(variante.prix_vente);

    if (nouveauPrixVente < nouveauPrixAchat) {
      throw new ErreurStock("Le prix de vente ne peut pas être inférieur au prix d'achat (CUMP).");
    }

    const maintenant = new Date().toISOString();
    executer(
      "UPDATE variantes SET prix_achat = ?, prix_vente = ?, synchronise = 0, date_modification = ? WHERE id = ?",
      [nouveauPrixAchat, nouveauPrixVente, maintenant, varianteId],
    );

    const motifComplet = `${motif} (Coût : ${ancienPrixAchat} → ${nouveauPrixAchat} FCFA [CUMP])`;
    return appliquerMouvement({ varianteId, depotId, type: "entree", quantite, motif: motifComplet, utilisateurId });
  });

  sauvegarder();
  return resultat;
}

/**
 * Miroir de synchronisation/services.py::recalculer_stock (Étape 8) : après un
 * pull qui ramène de nouveaux mouvements (créés par un autre appareil), le
 * stock est recalculé EN ENTIER depuis tout l'historique local — jamais de
 * conflit possible sur le stock lui-même (§9.3 du cahier des charges).
 */
export function recalculerStock(varianteId: string, depotId: string): void {
  const mouvements = tousLesResultats<{ type: TypeMouvement; quantite: number }>(
    "SELECT type, quantite FROM mouvements_stock WHERE variante_id = ? AND depot_id = ? AND supprime = 0",
    [varianteId, depotId],
  );

  const total = mouvements.reduce(
    (somme, m) => somme + deltaPour(m.type, Number(m.quantite)),
    0,
  );

  const stockExistant = unResultat<{ id: string }>(
    "SELECT id FROM stocks WHERE variante_id = ? AND depot_id = ?",
    [varianteId, depotId],
  );
  if (stockExistant) {
    executer("UPDATE stocks SET quantite = ? WHERE id = ?", [total, stockExistant.id]);
  } else {
    executer("INSERT INTO stocks (id, variante_id, depot_id, quantite) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      varianteId,
      depotId,
      total,
    ]);
  }
}

// --- Dépôts ---

export interface DepotResume {
  id: string;
  nom: string;
  adresse: string;
}

export function listerDepotsDetail(boutiqueId: string): DepotResume[] {
  return tousLesResultats<DepotResume>(
    "SELECT id, nom, adresse FROM depots WHERE boutique_id = ? AND supprime = 0 ORDER BY nom",
    [boutiqueId],
  );
}

/**
 * Formule Essentiel/Pro (voir comptes.Boutique.formule côté backend, même
 * plafond appliqué côté serveur en défense — stock/views.py::DepotViewSet) :
 * Essentiel plafonne à un seul dépôt. Vérifié ici (avant l'écriture locale,
 * pas seulement au push) puisque l'appli crée toujours en local d'abord.
 */
const LIMITE_DEPOTS_ESSENTIEL = 1;

function verifierLimiteDepots(boutiqueId: string): void {
  const boutique = unResultat<{ formule: string }>("SELECT formule FROM boutiques WHERE id = ?", [boutiqueId]);
  if (!boutique || boutique.formule !== "essentiel") return;
  const { n } = unResultat<{ n: number }>(
    "SELECT COUNT(*) as n FROM depots WHERE boutique_id = ? AND supprime = 0",
    [boutiqueId],
  )!;
  if (n >= LIMITE_DEPOTS_ESSENTIEL) {
    throw new ErreurStock(
      "La formule Essentiel est limitée à un seul dépôt. Passez à la formule Pro pour en ajouter d'autres.",
    );
  }
}

export function creerDepot(boutiqueId: string, nom: string, adresse = ""): string {
  verifierLimiteDepots(boutiqueId);
  const id = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    "INSERT INTO depots (id, boutique_id, nom, adresse, date_creation, date_modification) VALUES (?, ?, ?, ?, ?, ?)",
    [id, boutiqueId, nom, adresse, maintenant, maintenant],
  );
  sauvegarder();
  return id;
}

export function modifierDepot(id: string, champs: Partial<{ nom: string; adresse: string }>): void {
  const colonnes: string[] = [];
  const valeurs: SqlValue[] = [];
  for (const [cle, valeur] of Object.entries(champs)) {
    if (valeur === undefined) continue;
    colonnes.push(`${cle} = ?`);
    valeurs.push(valeur);
  }
  if (colonnes.length === 0) return;
  const maintenant = new Date().toISOString();
  colonnes.push("date_modification = ?", "synchronise = 0");
  valeurs.push(maintenant);
  executer(`UPDATE depots SET ${colonnes.join(", ")} WHERE id = ?`, [...valeurs, id]);
  sauvegarder();
}

function formaterNombreStock(valeur: number): string {
  return Math.round(Number(valeur) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Un dépôt qui contient encore de la marchandise ne se supprime pas : on transfère d'abord. */
export function supprimerDepot(id: string): void {
  const reste = unResultat<{ n: number; valeur: number; devise: string | null }>(
    `SELECT COUNT(*) as n, COALESCE(SUM(s.quantite * COALESCE(v.prix_achat, 0)), 0) as valeur,
            (SELECT b.devise FROM depots d JOIN boutiques b ON b.id = d.boutique_id WHERE d.id = ?) as devise
     FROM stocks s LEFT JOIN variantes v ON v.id = s.variante_id
     WHERE s.depot_id = ? AND s.quantite > 0`,
    [id, id],
  );
  if (reste && Number(reste.n) > 0) {
    throw new ErreurStock(
      `${reste.n} article(s) sont encore dans ce dépôt (${formaterNombreStock(reste.valeur)} ${reste.devise || "FCFA"}) : ` +
        "transférez-les d'abord vers un autre dépôt.",
    );
  }
  const maintenant = new Date().toISOString();
  executer("UPDATE depots SET supprime = 1, synchronise = 0, date_modification = ? WHERE id = ?", [
    maintenant,
    id,
  ]);
  sauvegarder();
}


/** Dépôt supprimé qui contient encore du stock (à rapatrier). */
export interface DepotSupprimeAvecStock {
  id: string;
  nom: string;
  articles: number;
  valeur: number;
}

/** Transfère tout le stock d'un dépôt vers un autre (fermeture d'un dépôt, rapatriement). */
export function transfererToutLeStock(depotSourceId: string, depotDestinationId: string, utilisateurId: string | null): number {
  const lignes = tousLesResultats<{ variante_id: string; quantite: number }>(
    "SELECT variante_id, quantite FROM stocks WHERE depot_id = ? AND quantite > 0",
    [depotSourceId],
  );
  if (lignes.length === 0) throw new ErreurStock("Ce dépôt ne contient plus de marchandise.");
  for (const l of lignes) {
    transfererStock({ varianteId: l.variante_id, depotSourceId, depotDestinationId, quantite: Number(l.quantite), utilisateurId });
  }
  return lignes.length;
}

export function depotsSupprimesAvecStock(boutiqueId: string): DepotSupprimeAvecStock[] {
  return tousLesResultats<DepotSupprimeAvecStock>(
    `SELECT d.id as id, d.nom as nom, COUNT(*) as articles, COALESCE(SUM(s.quantite * COALESCE(v.prix_achat, 0)), 0) as valeur
     FROM depots d
     JOIN stocks s ON s.depot_id = d.id AND s.quantite > 0
     LEFT JOIN variantes v ON v.id = s.variante_id
     WHERE d.boutique_id = ? AND d.supprime = 1
     GROUP BY d.id, d.nom`,
    [boutiqueId],
  ).map((d) => ({ ...d, articles: Number(d.articles), valeur: Number(d.valeur) }));
}

// --- Consultation du stock et des mouvements ---

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
  enRupture: number;
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

export function listerStock(boutiqueId: string, depotId?: string, terme = ""): LigneStock[] {
  const motif = `%${terme}%`;
  const conditions = ["d.boutique_id = ?", "p.supprime = 0", "v.supprime = 0", "p.nom LIKE ?"];
  const params: SqlValue[] = [boutiqueId, motif];
  if (depotId) {
    conditions.push("s.depot_id = ?");
    params.push(depotId);
  }
  return tousLesResultats<LigneStock>(
    `SELECT s.id as id, v.id as varianteId, p.id as produitId, p.nom as produitNom, v.reference as reference,
            d.id as depotId, d.nom as depotNom, s.quantite as quantite, v.seuil_alerte as seuilAlerte,
            v.prix_achat as prixAchat, v.prix_vente as prixVente,
            CASE WHEN s.quantite <= v.seuil_alerte THEN 1 ELSE 0 END as enRupture,
            pd.nom as detailNom, v.quantite_detail as quantiteDetail,
            (SELECT un.nom FROM unites un WHERE un.id = pd.unite_id) as detailUnite,
            (SELECT g.id FROM variantes g WHERE g.variante_detail_id = v.id AND g.supprime = 0
             ORDER BY g.date_creation LIMIT 1) as grosVarianteId,
            (SELECT un.nom FROM variantes g JOIN produits pg ON pg.id = g.produit_id JOIN unites un ON un.id = pg.unite_id
             WHERE g.variante_detail_id = v.id AND g.supprime = 0 ORDER BY g.date_creation LIMIT 1) as grosUnite,
            (SELECT pg.nom FROM variantes g JOIN produits pg ON pg.id = g.produit_id
             WHERE g.variante_detail_id = v.id AND g.supprime = 0 ORDER BY g.date_creation LIMIT 1) as grosNom,
            (SELECT COALESCE(SUM(sg.quantite), 0) FROM variantes g JOIN stocks sg ON sg.variante_id = g.id
             WHERE g.variante_detail_id = v.id AND g.supprime = 0 AND sg.depot_id = s.depot_id) as grosStock
     FROM stocks s
     JOIN variantes v ON v.id = s.variante_id
     JOIN produits p ON p.id = v.produit_id
     JOIN depots d ON d.id = s.depot_id
     LEFT JOIN variantes vd ON vd.id = v.variante_detail_id AND vd.supprime = 0
     LEFT JOIN produits pd ON pd.id = vd.produit_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY p.nom`,
    params,
  );
}

export function obtenirLigneStock(id: string): LigneStock | undefined {
  return unResultat<LigneStock>(
    `SELECT s.id as id, v.id as varianteId, p.id as produitId, p.nom as produitNom, v.reference as reference,
            d.id as depotId, d.nom as depotNom, s.quantite as quantite, v.seuil_alerte as seuilAlerte,
            v.prix_achat as prixAchat, v.prix_vente as prixVente,
            CASE WHEN s.quantite <= v.seuil_alerte THEN 1 ELSE 0 END as enRupture
     FROM stocks s
     JOIN variantes v ON v.id = s.variante_id
     JOIN produits p ON p.id = v.produit_id
     JOIN depots d ON d.id = s.depot_id
     WHERE s.id = ?`,
    [id],
  );
}

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

export function listerMouvements(boutiqueId: string, depotId?: string, limite = 100): MouvementResume[] {
  const conditions = ["d.boutique_id = ?", "m.supprime = 0"];
  const params: SqlValue[] = [boutiqueId];
  if (depotId) {
    conditions.push("m.depot_id = ?");
    params.push(depotId);
  }
  params.push(limite);
  return tousLesResultats<MouvementResume>(
    `SELECT m.id as id, p.nom as produitNom, v.reference as reference, d.nom as depotNom,
            m.type as type, m.quantite as quantite, m.motif as motif, m.date_creation as dateCreation,
            m.utilisateur_id as utilisateurId, COALESCE(m.reference_type, '') as referenceType
     FROM mouvements_stock m
     JOIN variantes v ON v.id = m.variante_id
     JOIN produits p ON p.id = v.produit_id
     JOIN depots d ON d.id = m.depot_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY m.date_creation DESC
     LIMIT ?`,
    params,
  );
}

// Historique produit (toutes variantes confondues, tous dépôts) — utilisé par
// la modale de détail produit en Produits.tsx.
export function listerMouvementsParProduit(produitId: string, limite = 100): MouvementResume[] {
  return tousLesResultats<MouvementResume>(
    `SELECT m.id as id, p.nom as produitNom, v.reference as reference, d.nom as depotNom,
            m.type as type, m.quantite as quantite, m.motif as motif, m.date_creation as dateCreation,
            m.utilisateur_id as utilisateurId, COALESCE(m.reference_type, '') as referenceType
     FROM mouvements_stock m
     JOIN variantes v ON v.id = m.variante_id
     JOIN produits p ON p.id = v.produit_id
     JOIN depots d ON d.id = m.depot_id
     WHERE v.produit_id = ? AND m.supprime = 0
     ORDER BY m.date_creation DESC
     LIMIT ?`,
    [produitId, limite],
  );
}

// --- Transferts (miroir de stock/services.py::transferer_stock) ---

export interface ParametresTransfert {
  varianteId: string;
  depotSourceId: string;
  depotDestinationId: string;
  quantite: number;
  utilisateurId: string | null;
}

export function transfererStock(params: ParametresTransfert): string {
  const { varianteId, depotSourceId, depotDestinationId, quantite, utilisateurId } = params;
  if (depotSourceId === depotDestinationId) {
    throw new ErreurStock("Le dépôt source et destination doivent être différents.");
  }
  if (quantite <= 0) {
    throw new ErreurStock("La quantité doit être strictement positive.");
  }

  const depotSource = unResultat<{ nom: string }>("SELECT nom FROM depots WHERE id = ?", [depotSourceId]);
  const depotDestination = unResultat<{ nom: string }>("SELECT nom FROM depots WHERE id = ?", [depotDestinationId]);

  const transfertId = dansUneTransaction(() => {
    const id = randomUUID();
    const maintenant = new Date().toISOString();
    executer(
      `INSERT INTO transferts_stock
         (id, variante_id, depot_source_id, depot_destination_id, quantite, utilisateur_id, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, varianteId, depotSourceId, depotDestinationId, quantite, utilisateurId, maintenant, maintenant],
    );

    appliquerMouvement({
      varianteId,
      depotId: depotSourceId,
      type: "sortie",
      quantite,
      motif: `Transfert vers ${depotDestination?.nom ?? ""}`,
      utilisateurId,
      referenceType: "stock.TransfertStock",
      referenceId: id,
    });
    appliquerMouvement({
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
  });

  sauvegarder();
  return transfertId;
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

export function listerTransferts(boutiqueId: string, limite = 100): TransfertResume[] {
  return tousLesResultats<TransfertResume>(
    `SELECT t.id as id, p.nom as produitNom, v.reference as reference,
            ds.nom as depotSourceNom, dd.nom as depotDestinationNom,
            t.quantite as quantite, t.date_creation as dateCreation, t.utilisateur_id as utilisateurId
     FROM transferts_stock t
     JOIN variantes v ON v.id = t.variante_id
     JOIN produits p ON p.id = v.produit_id
     JOIN depots ds ON ds.id = t.depot_source_id
     JOIN depots dd ON dd.id = t.depot_destination_id
     WHERE ds.boutique_id = ? AND t.supprime = 0
     ORDER BY t.date_creation DESC
     LIMIT ?`,
    [boutiqueId, limite],
  );
}

// --- Pertes (miroir de stock/services.py::declarer_perte) ---

export type MotifPerte = "perime" | "abime" | "vol" | "don" | "consommation" | "autre";

export const LIBELLES_MOTIF_PERTE: Record<MotifPerte, string> = {
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
 * CUMP courant de la variante et figée sur la perte, pour que le rapport des
 * pertes reste juste même si le prix d'achat évolue ensuite.
 */
export function declarerPerte(params: ParametresPerte): string {
  const { varianteId, depotId, quantite, motif, utilisateurId } = params;
  const detail = (params.detail ?? "").trim();
  if (!(quantite > 0)) throw new ErreurStock("La quantité doit être strictement positive.");
  if (!(motif in LIBELLES_MOTIF_PERTE)) throw new ErreurStock("Motif de perte inconnu.");
  if (motif === "autre" && !detail) throw new ErreurStock("Précisez la raison de la perte.");

  const variante = unResultat<{ prix_achat: number }>("SELECT prix_achat FROM variantes WHERE id = ?", [varianteId]);
  if (!variante) throw new ErreurStock("Produit introuvable.");

  const perteId = dansUneTransaction(() => {
    const id = randomUUID();
    const maintenant = new Date().toISOString();
    executer(
      `INSERT INTO pertes_stock
         (id, variante_id, depot_id, quantite, motif, detail, valeur, utilisateur_id, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        varianteId,
        depotId,
        quantite,
        motif,
        detail,
        Math.round(quantite * Number(variante.prix_achat)),
        utilisateurId,
        maintenant,
        maintenant,
      ],
    );
    appliquerMouvement({
      varianteId,
      depotId,
      type: "sortie",
      quantite,
      motif: `Perte : ${LIBELLES_MOTIF_PERTE[motif]}${detail ? ` (${detail})` : ""}`,
      utilisateurId,
      referenceType: "stock.PerteStock",
      referenceId: id,
    });
    terminerDestockageSiEpuise(varianteId);
    return id;
  });
  sauvegarder();
  return perteId;
}

/** Perte saisie par erreur : remet la quantité en stock, la perte reste visible (annulée). */
export function annulerPerte(id: string, utilisateurId: string | null): void {
  const perte = unResultat<{ variante_id: string; depot_id: string; quantite: number; motif: MotifPerte; annulee: number }>(
    "SELECT variante_id, depot_id, quantite, motif, annulee FROM pertes_stock WHERE id = ?",
    [id],
  );
  if (!perte) throw new ErreurStock("Perte introuvable.");
  if (Number(perte.annulee)) throw new ErreurStock("Cette perte est déjà annulée.");
  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    appliquerMouvement({
      varianteId: perte.variante_id,
      depotId: perte.depot_id,
      type: "entree",
      quantite: Number(perte.quantite),
      motif: `Annulation perte : ${LIBELLES_MOTIF_PERTE[perte.motif] ?? perte.motif}`,
      utilisateurId,
      referenceType: "stock.PerteStock",
      referenceId: id,
    });
    executer(
      "UPDATE pertes_stock SET annulee = 1, date_annulation = ?, synchronise = 0, date_modification = ? WHERE id = ?",
      [maintenant, maintenant, id],
    );
  });
  sauvegarder();
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
export function listerPertes(boutiqueId: string, debut?: string, fin?: string): PerteResume[] {
  const conditions = ["d.boutique_id = ?", "pe.supprime = 0"];
  const parametres: string[] = [boutiqueId];
  if (debut) {
    conditions.push("pe.date_creation >= ?");
    parametres.push(debut);
  }
  if (fin) {
    conditions.push("pe.date_creation <= ?");
    parametres.push(fin);
  }
  return tousLesResultats<PerteResume>(
    `SELECT pe.id as id, pe.date_creation as dateCreation, p.nom as produitNom, COALESCE(v.reference, '') as reference,
            d.nom as depotNom, pe.quantite as quantite, pe.motif as motif, COALESCE(pe.detail, '') as detail,
            pe.valeur as valeur, pe.utilisateur_id as utilisateurId, COALESCE(pe.annulee, 0) as annulee
     FROM pertes_stock pe
     JOIN variantes v ON v.id = pe.variante_id
     JOIN produits p ON p.id = v.produit_id
     JOIN depots d ON d.id = pe.depot_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY pe.date_creation DESC`,
    parametres,
  ).map((p) => ({ ...p, annulee: Boolean(p.annulee) }));
}

// --- Déstockage (miroir de stock/services.py) ---

function aujourdhui(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DestockageActif {
  id: string;
  prixNormal: number;
  prixDestockage: number;
}

/** Déstockage en cours et pas encore arrivé à sa date de fin, ou undefined. */
export function destockageActif(varianteId: string): DestockageActif | undefined {
  const ligne = unResultat<DestockageActif>(
    `SELECT id, prix_normal as prixNormal, prix_destockage as prixDestockage
     FROM destockages
     WHERE variante_id = ? AND statut = 'en_cours' AND supprime = 0 AND (date_fin IS NULL OR date_fin = '' OR date_fin >= ?)
     ORDER BY date_creation DESC LIMIT 1`,
    [varianteId, aujourdhui()],
  );
  return ligne ? { ...ligne, prixNormal: Number(ligne.prixNormal), prixDestockage: Number(ligne.prixDestockage) } : undefined;
}

function terminerDestockage(id: string, motif: "date" | "epuise" | "manuel"): void {
  const maintenant = new Date().toISOString();
  executer(
    `UPDATE destockages SET statut = 'termine', motif_fin = ?, date_arret = ?, synchronise = 0, date_modification = ?
     WHERE id = ?`,
    [motif, maintenant, maintenant, id],
  );
}

export interface ParametresDestockage {
  varianteId: string;
  prixDestockage: number;
  /** "AAAA-MM-JJ", optionnelle. */
  dateFin?: string | null;
  utilisateurId: string | null;
}

function verifierDestockage(varianteId: string, prixDestockage: number, dateFin: string | null): void {
  const variante = unResultat<{ prix_vente: number }>("SELECT prix_vente FROM variantes WHERE id = ?", [varianteId]);
  if (!variante) throw new ErreurStock("Produit introuvable.");
  if (!(prixDestockage > 0)) throw new ErreurStock("Le prix de déstockage doit être positif.");
  if (prixDestockage >= Number(variante.prix_vente)) {
    throw new ErreurStock("Le prix de déstockage doit être inférieur au prix de vente normal.");
  }
  if (dateFin && dateFin < aujourdhui()) throw new ErreurStock("La date de fin est déjà passée.");
  if (destockageActif(varianteId)) throw new ErreurStock("Cet article est déjà en déstockage.");
}

/** À appeler dans une transaction, après verifierDestockage. */
function insererDestockage(
  varianteId: string,
  prixDestockage: number,
  dateFin: string | null,
  utilisateurId: string | null,
  operationId: string | null,
): string {
  // Déstockages restés "en cours" mais dont la date de fin est passée : on les clôt.
  for (const ancien of tousLesResultats<{ id: string }>(
    "SELECT id FROM destockages WHERE variante_id = ? AND statut = 'en_cours' AND supprime = 0",
    [varianteId],
  )) {
    terminerDestockage(ancien.id, "date");
  }
  const variante = unResultat<{ prix_vente: number }>("SELECT prix_vente FROM variantes WHERE id = ?", [varianteId])!;
  const id = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    `INSERT INTO destockages
       (id, variante_id, prix_normal, prix_destockage, date_fin, statut, motif_fin, utilisateur_id, operation_id,
        date_creation, date_modification)
     VALUES (?, ?, ?, ?, ?, 'en_cours', '', ?, ?, ?, ?)`,
    [id, varianteId, Number(variante.prix_vente), prixDestockage, dateFin, utilisateurId, operationId, maintenant, maintenant],
  );
  return id;
}

/**
 * Met un article en déstockage : son prix de vente est remplacé en caisse par
 * prixDestockage (vente à perte permise — l'écran avertit). S'arrête à la date
 * de fin, quand le stock de l'article tombe à 0, ou à la main.
 */
export function demarrerDestockage(params: ParametresDestockage): string {
  const { varianteId, prixDestockage, utilisateurId } = params;
  const dateFin = params.dateFin || null;
  verifierDestockage(varianteId, prixDestockage, dateFin);
  const id = dansUneTransaction(() => insererDestockage(varianteId, prixDestockage, dateFin, utilisateurId, null));
  sauvegarder();
  return id;
}

export interface LigneOperationDestockage {
  varianteId: string;
  prixDestockage: number;
}

export interface ParametresOperationDestockage {
  boutiqueId: string;
  nom: string;
  lignes: LigneOperationDestockage[];
  dateFin?: string | null;
  utilisateurId: string | null;
}

/**
 * Déstocke plusieurs articles d'un coup sous un même nom (miroir de
 * stock/services.py::demarrer_operation_destockage). Tout ou rien : tout est
 * vérifié avant d'écrire, puis écrit dans une seule transaction.
 */
export function demarrerOperationDestockage(params: ParametresOperationDestockage): string {
  const { boutiqueId, lignes, utilisateurId } = params;
  const nom = params.nom.trim();
  const dateFin = params.dateFin || null;
  if (lignes.length === 0) throw new ErreurStock("Choisissez au moins un article.");
  if (!nom) throw new ErreurStock("Donnez un nom à l'opération de déstockage.");
  if (new Set(lignes.map((l) => l.varianteId)).size !== lignes.length) {
    throw new ErreurStock("Un même article apparaît deux fois.");
  }
  for (const ligne of lignes) {
    try {
      verifierDestockage(ligne.varianteId, ligne.prixDestockage, dateFin);
    } catch (erreur) {
      const article = unResultat<{ nom: string }>(
        "SELECT p.nom as nom FROM variantes v JOIN produits p ON p.id = v.produit_id WHERE v.id = ?",
        [ligne.varianteId],
      );
      throw new ErreurStock(`${article?.nom ?? "Article"} : ${(erreur as Error).message}`);
    }
  }

  const operationId = dansUneTransaction(() => {
    const id = randomUUID();
    const maintenant = new Date().toISOString();
    executer(
      `INSERT INTO operations_destockage (id, boutique_id, nom, date_fin, utilisateur_id, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, boutiqueId, nom, dateFin, utilisateurId, maintenant, maintenant],
    );
    for (const ligne of lignes) {
      insererDestockage(ligne.varianteId, ligne.prixDestockage, dateFin, utilisateurId, id);
    }
    return id;
  });
  sauvegarder();
  return operationId;
}

/** Arrête tous les déstockages encore en cours de l'opération. */
export function arreterOperationDestockage(id: string): void {
  const enCours = tousLesResultats<{ id: string }>(
    "SELECT id FROM destockages WHERE operation_id = ? AND statut = 'en_cours' AND supprime = 0",
    [id],
  );
  if (enCours.length === 0) throw new ErreurStock("Cette opération est déjà terminée.");
  dansUneTransaction(() => {
    for (const d of enCours) terminerDestockage(d.id, "manuel");
  });
  sauvegarder();
}

/** Change le prix et/ou la date de fin d'un déstockage en cours, sans l'arrêter. */
export function modifierDestockage(id: string, champs: { prixDestockage?: number; dateFin?: string | null }): void {
  const d = unResultat<{ variante_id: string; prix_normal: number }>(
    "SELECT variante_id, prix_normal FROM destockages WHERE id = ?",
    [id],
  );
  if (!d || destockageActif(d.variante_id)?.id !== id) throw new ErreurStock("Seul un déstockage en cours peut être modifié.");
  const colonnes: string[] = [];
  const valeurs: (string | number | null)[] = [];
  if (champs.prixDestockage !== undefined) {
    if (!(champs.prixDestockage > 0) || champs.prixDestockage >= Number(d.prix_normal)) {
      throw new ErreurStock("Le prix de déstockage doit être positif et inférieur au prix normal.");
    }
    colonnes.push("prix_destockage = ?");
    valeurs.push(champs.prixDestockage);
  }
  if (champs.dateFin !== undefined) {
    if (champs.dateFin && champs.dateFin < aujourdhui()) throw new ErreurStock("La date de fin est déjà passée.");
    colonnes.push("date_fin = ?");
    valeurs.push(champs.dateFin || null);
  }
  if (colonnes.length === 0) return;
  executer(
    `UPDATE destockages SET ${colonnes.join(", ")}, synchronise = 0, date_modification = ? WHERE id = ?`,
    [...valeurs, new Date().toISOString(), id],
  );
  sauvegarder();
}

export function arreterDestockage(id: string): void {
  const destockage = unResultat<{ statut: string }>("SELECT statut FROM destockages WHERE id = ?", [id]);
  if (!destockage) throw new ErreurStock("Déstockage introuvable.");
  if (destockage.statut === "termine") throw new ErreurStock("Ce déstockage est déjà terminé.");
  terminerDestockage(id, "manuel");
  sauvegarder();
}

/** Après une sortie de stock (vente, perte) : fin automatique quand l'article
 * n'a plus de stock, tous dépôts confondus. N'appelle pas sauvegarder(). */
export function terminerDestockageSiEpuise(varianteId: string): void {
  const destockage = destockageActif(varianteId);
  if (!destockage) return;
  const total = Number(
    unResultat<{ total: number }>("SELECT COALESCE(SUM(quantite), 0) as total FROM stocks WHERE variante_id = ?", [
      varianteId,
    ])?.total ?? 0,
  );
  if (total <= 0) terminerDestockage(destockage.id, "epuise");
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
export function listerDestockages(boutiqueId: string): DestockageResume[] {
  const lignes = tousLesResultats<
    Omit<DestockageResume, "statut" | "motifFin"> & { statut: string; motifFin: string }
  >(
    `SELECT d.id as id, d.variante_id as varianteId, p.nom as produitNom, COALESCE(v.reference, '') as reference,
            v.prix_achat as prixAchat, d.prix_normal as prixNormal, d.prix_destockage as prixDestockage,
            d.date_creation as dateCreation, NULLIF(d.date_fin, '') as dateFin, d.date_arret as dateArret,
            d.statut as statut, COALESCE(d.motif_fin, '') as motifFin,
            d.operation_id as operationId, o.nom as operationNom, d.utilisateur_id as utilisateurId,
            COALESCE(b.quantite, 0) as quantiteVendue, COALESCE(b.ca, 0) as chiffreAffaires,
            COALESCE(b.cout, 0) as cout, COALESCE(b.normal, 0) as normal,
            (SELECT COALESCE(SUM(s.quantite), 0) FROM stocks s WHERE s.variante_id = d.variante_id) as stockRestant
     FROM destockages d
     JOIN variantes v ON v.id = d.variante_id
     JOIN produits p ON p.id = v.produit_id
     LEFT JOIN operations_destockage o ON o.id = d.operation_id
     LEFT JOIN (
       SELECT lv.destockage_id as destockage_id, SUM(lv.quantite) as quantite, SUM(lv.sous_total) as ca,
              SUM(lv.quantite * lv.cout_unitaire) as cout, SUM(lv.quantite * COALESCE(lv.prix_normal, lv.prix_unitaire)) as normal
       FROM lignes_vente lv
       JOIN ventes ve ON ve.id = lv.vente_id
       WHERE lv.destockage_id IS NOT NULL AND lv.supprime = 0 AND ve.statut != 'annulee'
       GROUP BY lv.destockage_id
     ) b ON b.destockage_id = d.id
     WHERE p.boutique_id = ? AND d.supprime = 0
     ORDER BY d.date_creation DESC`,
    [boutiqueId],
  );
  const jour = aujourdhui();
  return lignes.map((l) => {
    const { cout, normal, ...reste } = l as typeof l & { cout: number; normal: number };
    const expire = l.statut === "en_cours" && !!l.dateFin && l.dateFin < jour;
    return {
      ...reste,
      prixAchat: Number(l.prixAchat),
      prixNormal: Number(l.prixNormal),
      prixDestockage: Number(l.prixDestockage),
      quantiteVendue: Number(l.quantiteVendue),
      chiffreAffaires: Number(l.chiffreAffaires),
      marge: Number(l.chiffreAffaires) - Number(cout),
      manqueAGagner: Number(normal) - Number(l.chiffreAffaires),
      stockRestant: Number(l.stockRestant),
      statut: expire ? "termine" : (l.statut as StatutDestockage),
      motifFin: (expire ? "date" : l.motifFin) as MotifFinDestockage,
    };
  });
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

export function listerInventaires(boutiqueId: string): InventaireResume[] {
  return tousLesResultats<InventaireResume>(
    `SELECT i.id as id, i.depot_id as depotId, d.nom as depotNom, i.statut as statut, i.date_creation as dateCreation,
            i.date_validation as dateValidation, i.utilisateur_id as utilisateurId,
            (SELECT COUNT(*) FROM lignes_inventaire li WHERE li.inventaire_id = i.id AND li.supprime = 0) as nombreArticles,
            (SELECT COUNT(*) FROM lignes_inventaire li
              WHERE li.inventaire_id = i.id AND li.supprime = 0 AND li.ecart > 0) as ecartsPlus,
            (SELECT COUNT(*) FROM lignes_inventaire li
              WHERE li.inventaire_id = i.id AND li.supprime = 0 AND li.ecart < 0) as ecartsMoins,
            COALESCE((SELECT SUM(ROUND(li.ecart * CASE WHEN i.statut = 'valide' THEN li.prix_achat_fige ELSE v.prix_achat END))
              FROM lignes_inventaire li JOIN variantes v ON v.id = li.variante_id
              WHERE li.inventaire_id = i.id AND li.supprime = 0), 0) as ecartValeur
     FROM inventaires i JOIN depots d ON d.id = i.depot_id
     WHERE i.boutique_id = ? AND i.supprime = 0
     ORDER BY i.date_creation DESC`,
    [boutiqueId],
  ).map((i) => ({
    ...i,
    nombreArticles: Number(i.nombreArticles),
    ecartsPlus: Number(i.ecartsPlus),
    ecartsMoins: Number(i.ecartsMoins),
    ecartValeur: Number(i.ecartValeur),
  }));
}

/** aZero : « comptage à zéro » — chaque article part de 0, seul ce qui est compté compte. */
export function demarrerInventaire(boutiqueId: string, depotId: string, utilisateurId: string | null, aZero = false): string {
  const dejaEnCours = unResultat<{ id: string }>(
    "SELECT id FROM inventaires WHERE depot_id = ? AND statut = 'en_cours' AND supprime = 0 LIMIT 1",
    [depotId],
  );
  if (dejaEnCours) throw new ErreurStock("Un inventaire est déjà en cours sur ce dépôt : terminez-le ou reprenez-le avant d'en démarrer un autre.");
  const inventaireId = dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    const id = randomUUID();
    executer(
      `INSERT INTO inventaires (id, boutique_id, depot_id, statut, utilisateur_id, date_creation, date_modification)
       VALUES (?, ?, ?, 'en_cours', ?, ?, ?)`,
      [id, boutiqueId, depotId, utilisateurId, maintenant, maintenant],
    );

    const stocksDuDepot = tousLesResultats<{ variante_id: string; quantite: number }>(
      "SELECT variante_id, quantite FROM stocks WHERE depot_id = ?",
      [depotId],
    );
    for (const s of stocksDuDepot) {
      executer(
        `INSERT INTO lignes_inventaire
           (id, inventaire_id, variante_id, qte_theorique, qte_physique, ecart, date_creation, date_modification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          id,
          s.variante_id,
          s.quantite,
          aZero ? 0 : s.quantite,
          aZero ? -Number(s.quantite) : 0,
          maintenant,
          maintenant,
        ],
      );
    }
    return id;
  });

  sauvegarder();
  return inventaireId;
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
function calculerCaParVariante(
  boutiqueId: string,
  depotId: string,
  depuis: string | null,
  jusqua: string,
): Map<string, number> {
  const conditions = [
    "v.boutique_id = ?",
    "v.depot_id = ?",
    "v.supprime = 0",
    "v.statut != 'annulee'",
    "lv.supprime = 0",
    "v.date_creation <= ?",
  ];
  const parametres: string[] = [boutiqueId, depotId, jusqua];
  if (depuis) {
    conditions.push("v.date_creation > ?");
    parametres.push(depuis);
  }
  const lignes = tousLesResultats<{ varianteId: string; ca: number }>(
    `SELECT lv.variante_id as varianteId, COALESCE(SUM(lv.sous_total), 0) as ca
     FROM lignes_vente lv JOIN ventes v ON v.id = lv.vente_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY lv.variante_id`,
    parametres,
  );
  return new Map(lignes.map((l) => [l.varianteId, Number(l.ca)]));
}

export function obtenirInventaire(id: string): InventaireDetail | undefined {
  const inventaire = unResultat<{
    id: string;
    boutiqueId: string;
    depotId: string;
    depotNom: string;
    statut: string;
    dateValidation: string | null;
  }>(
    `SELECT i.id as id, i.boutique_id as boutiqueId, i.depot_id as depotId, d.nom as depotNom,
            i.statut as statut, i.date_validation as dateValidation
     FROM inventaires i JOIN depots d ON d.id = i.depot_id WHERE i.id = ?`,
    [id],
  );
  if (!inventaire) return undefined;

  const lignesBrutes = tousLesResultats<{
    id: string;
    varianteId: string;
    produitNom: string;
    reference: string;
    codeBarres: string;
    qteTheorique: number;
    qtePhysique: number;
    ecart: number;
    prixAchat: number;
  }>(
    `SELECT li.id as id, v.id as varianteId, p.nom as produitNom, v.reference as reference,
            COALESCE(v.code_barres, '') as codeBarres,
            li.qte_theorique as qteTheorique, li.qte_physique as qtePhysique, li.ecart as ecart,
            CASE WHEN i.statut = 'valide' THEN li.prix_achat_fige ELSE v.prix_achat END as prixAchat
     FROM lignes_inventaire li
     JOIN variantes v ON v.id = li.variante_id
     JOIN produits p ON p.id = v.produit_id
     JOIN inventaires i ON i.id = li.inventaire_id
     WHERE li.inventaire_id = ? AND li.supprime = 0
     ORDER BY p.nom`,
    [id],
  );

  // CA depuis le précédent inventaire validé du même dépôt (ou depuis le début s'il n'y en a pas encore).
  const precedent = unResultat<{ dateValidation: string }>(
    `SELECT date_validation as dateValidation FROM inventaires
     WHERE depot_id = ? AND statut = 'valide' AND supprime = 0 AND id != ?
       AND date_validation IS NOT NULL AND (? IS NULL OR date_validation < ?)
     ORDER BY date_validation DESC LIMIT 1`,
    [inventaire.depotId, id, inventaire.dateValidation, inventaire.dateValidation],
  );
  const jusqua = inventaire.dateValidation ?? new Date().toISOString();
  const caParVariante = calculerCaParVariante(
    inventaire.boutiqueId,
    inventaire.depotId,
    precedent?.dateValidation ?? null,
    jusqua,
  );

  const lignes = lignesBrutes.map((l) => {
    const prixAchat = Number(l.prixAchat);
    return {
      ...l,
      valeurTheorique: Math.round(Number(l.qteTheorique) * prixAchat),
      valeurPhysique: Math.round(Number(l.qtePhysique) * prixAchat),
      valeurEcart: Math.round(Number(l.ecart) * prixAchat),
      caPeriode: Math.round(caParVariante.get(l.varianteId) ?? 0),
    };
  });
  const valeurTheorique = lignes.reduce((total, l) => total + l.valeurTheorique, 0);
  const valeurPhysique = lignes.reduce((total, l) => total + l.valeurPhysique, 0);
  const caPeriode = lignes.reduce((total, l) => total + l.caPeriode, 0);

  return {
    id: inventaire.id,
    depotId: inventaire.depotId,
    depotNom: inventaire.depotNom,
    statut: inventaire.statut,
    dateValidation: inventaire.dateValidation,
    lignes,
    valeurTheorique: Math.round(valeurTheorique),
    valeurPhysique: Math.round(valeurPhysique),
    ecartValeur: Math.round(valeurPhysique - valeurTheorique),
    caPeriode: Math.round(caPeriode),
  };
}

/** Article trouvé sur place mais absent de la liste : ajouté pendant le comptage. */
export function ajouterLigneInventaire(inventaireId: string, varianteId: string, qtePhysique = 0): string {
  const inventaire = unResultat<{ statut: string; depot_id: string }>("SELECT statut, depot_id FROM inventaires WHERE id = ?", [
    inventaireId,
  ]);
  if (!inventaire) throw new ErreurStock("Inventaire introuvable.");
  if (inventaire.statut === "valide") throw new ErreurStock("Cet inventaire est déjà validé.");
  const deja = unResultat<{ id: string }>(
    "SELECT id FROM lignes_inventaire WHERE inventaire_id = ? AND variante_id = ? AND supprime = 0",
    [inventaireId, varianteId],
  );
  if (deja) throw new ErreurStock("Cet article est déjà dans l'inventaire.");
  const theorique = Number(
    unResultat<{ quantite: number }>("SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?", [
      varianteId,
      inventaire.depot_id,
    ])?.quantite ?? 0,
  );
  const id = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    `INSERT INTO lignes_inventaire
       (id, inventaire_id, variante_id, qte_theorique, qte_physique, ecart, date_creation, date_modification)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, inventaireId, varianteId, theorique, qtePhysique, qtePhysique - theorique, maintenant, maintenant],
  );
  sauvegarder();
  return id;
}

export function modifierLigneInventaire(id: string, qtePhysique: number): void {
  const ligne = unResultat<{ inventaire_id: string; qte_theorique: number }>(
    "SELECT inventaire_id, qte_theorique FROM lignes_inventaire WHERE id = ?",
    [id],
  );
  if (!ligne) throw new ErreurStock("Ligne d'inventaire introuvable.");

  const inventaire = unResultat<{ statut: string }>("SELECT statut FROM inventaires WHERE id = ?", [
    ligne.inventaire_id,
  ]);
  if (inventaire?.statut === "valide") {
    throw new ErreurStock("Cet inventaire est déjà validé, il ne peut plus être modifié.");
  }

  const ecart = qtePhysique - Number(ligne.qte_theorique);
  const maintenant = new Date().toISOString();
  executer(
    "UPDATE lignes_inventaire SET qte_physique = ?, ecart = ?, synchronise = 0, date_modification = ? WHERE id = ?",
    [qtePhysique, ecart, maintenant, id],
  );
  sauvegarder();
}

export function validerInventaire(id: string, utilisateurId: string | null): void {
  const inventaire = unResultat<{ statut: string; depot_id: string }>(
    "SELECT statut, depot_id FROM inventaires WHERE id = ?",
    [id],
  );
  if (!inventaire) throw new ErreurStock("Inventaire introuvable.");
  if (inventaire.statut === "valide") throw new ErreurStock("Cet inventaire est déjà validé.");

  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    const lignes = tousLesResultats<{ id: string; variante_id: string; ecart: number }>(
      "SELECT id, variante_id, ecart FROM lignes_inventaire WHERE inventaire_id = ? AND supprime = 0",
      [id],
    );
    for (const ligne of lignes) {
      // On fige le CUMP courant sur la ligne : cet inventaire doit rester une photo
      // fidèle à sa date de validation, même si le CUMP de la variante évolue ensuite.
      const variante = unResultat<{ prix_achat: number }>("SELECT prix_achat FROM variantes WHERE id = ?", [
        ligne.variante_id,
      ]);
      executer("UPDATE lignes_inventaire SET prix_achat_fige = ? WHERE id = ?", [
        Number(variante?.prix_achat ?? 0),
        ligne.id,
      ]);

      if (Number(ligne.ecart) !== 0) {
        appliquerMouvement({
          varianteId: ligne.variante_id,
          depotId: inventaire.depot_id,
          type: "ajustement",
          quantite: Number(ligne.ecart),
          motif: "Correction d'inventaire",
          utilisateurId,
          referenceType: "stock.Inventaire",
          referenceId: id,
        });
      }
    }
    executer(
      "UPDATE inventaires SET statut = 'valide', date_validation = ?, synchronise = 0, date_modification = ? WHERE id = ?",
      [maintenant, maintenant, id],
    );
  });

  sauvegarder();
}

// --- Détailler / regrouper (miroir de stock/services.py::detailler_ou_regrouper) ---

export type TypeDetaillage = "detailler" | "regrouper";

export interface ParametresDetaillage {
  /** L'article de gros (ex. le carton), porteur du lien vers son article de détail. */
  varianteGrosId: string;
  depotId: string;
  /** Nombre d'articles de gros à détailler, ou à reconstituer. */
  nombre: number;
  type: TypeDetaillage;
  utilisateurId: string | null;
}

function stockTotalVariante(varianteId: string): number {
  return Number(
    unResultat<{ total: number }>("SELECT COALESCE(SUM(quantite), 0) as total FROM stocks WHERE variante_id = ?", [varianteId])
      ?.total ?? 0,
  );
}

function stockVarianteDepot(varianteId: string, depotId: string): number {
  return Number(
    unResultat<{ quantite: number }>("SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?", [varianteId, depotId])
      ?.quantite ?? 0,
  );
}

/** Coût moyen pondéré après l'entrée de `quantite` au coût `cout`. */
function cumpApresEntree(varianteId: string, prixAchat: number, quantite: number, cout: number): number {
  const total = stockTotalVariante(varianteId);
  return total > 0 ? Math.round((total * prixAchat + quantite * cout) / (total + quantite)) : Math.round(cout);
}

/** Coût moyen pondéré après le retrait de `quantite` entrée au coût `cout`. */
function cumpApresSortie(varianteId: string, prixAchat: number, quantite: number, cout: number): number {
  const reste = stockTotalVariante(varianteId) - quantite;
  if (reste > 0) {
    const nouveau = Math.round((stockTotalVariante(varianteId) * prixAchat - quantite * cout) / reste);
    if (nouveau > 0) return nouveau;
  }
  return prixAchat;
}

interface VarianteCout {
  id: string;
  nom: string;
  prix_achat: number;
  prix_vente: number;
  variante_detail_id: string | null;
  quantite_detail: number | null;
}

function varianteCout(id: string): VarianteCout | undefined {
  return unResultat<VarianteCout>(
    `SELECT v.id as id, p.nom as nom, v.prix_achat as prix_achat, v.prix_vente as prix_vente,
            v.variante_detail_id as variante_detail_id, v.quantite_detail as quantite_detail
     FROM variantes v JOIN produits p ON p.id = v.produit_id WHERE v.id = ?`,
    [id],
  );
}

function majPrixAchat(varianteId: string, prixAchat: number): void {
  executer("UPDATE variantes SET prix_achat = ?, synchronise = 0, date_modification = ? WHERE id = ?", [
    prixAchat,
    new Date().toISOString(),
    varianteId,
  ]);
}

/**
 * « Détailler » `nombre` cartons en paquets, ou « regrouper » des paquets en
 * `nombre` cartons, dans un même dépôt. Une sortie et une entrée de stock ; le
 * coût suit (carton à 9 600 → paquets à 400), si bien que la marge reste
 * juste. Ni vente ni perte : aucune écriture comptable.
 */
export function detaillerOuRegrouper(params: ParametresDetaillage): string {
  const { varianteGrosId, depotId, nombre, type, utilisateurId } = params;
  const gros = varianteCout(varianteGrosId);
  if (!gros) throw new ErreurStock("Article introuvable.");
  const parGros = Number(gros.quantite_detail ?? 0);
  const detail = gros.variante_detail_id ? varianteCout(gros.variante_detail_id) : undefined;
  if (!detail || !(parGros > 0)) throw new ErreurStock("Cet article n'a pas d'article de détail.");
  if (!Number.isInteger(nombre) || nombre <= 0) throw new ErreurStock("Indiquez un nombre entier supérieur à zéro.");

  const detailler = type === "detailler";
  const source = detailler ? gros : detail;
  const cible = detailler ? detail : gros;
  const quantiteSource = detailler ? nombre : nombre * parGros;
  const quantiteCible = detailler ? nombre * parGros : nombre;
  const coutCible = detailler ? Number(gros.prix_achat) / parGros : Number(detail.prix_achat) * parGros;

  const disponible = stockVarianteDepot(source.id, depotId);
  if (disponible < quantiteSource) {
    throw new ErreurStock(
      `Pas assez de « ${source.nom} » dans ce dépôt : ${formaterNombreStock(disponible)} disponible(s), ${formaterNombreStock(quantiteSource)} nécessaire(s).`,
    );
  }
  const nouveauCump = cumpApresEntree(cible.id, Number(cible.prix_achat), quantiteCible, coutCible);
  if (Number(cible.prix_vente) < nouveauCump) {
    throw new ErreurStock(
      `Le prix de vente de « ${cible.nom} » (${formaterNombreStock(Number(cible.prix_vente))}) est inférieur à son coût (${formaterNombreStock(nouveauCump)}) : corrigez le prix avant.`,
    );
  }

  const id = dansUneTransaction(() => {
    const operationId = randomUUID();
    const maintenant = new Date().toISOString();
    executer(
      `INSERT INTO detaillages
         (id, depot_id, type, variante_source_id, variante_cible_id, quantite_source, quantite_cible,
          cout_unitaire_cible, utilisateur_id, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        operationId,
        depotId,
        type,
        source.id,
        cible.id,
        quantiteSource,
        quantiteCible,
        Math.round(coutCible * 100) / 100,
        utilisateurId,
        maintenant,
        maintenant,
      ],
    );
    const motif = `${detailler ? "Déballage" : "Remballage"} : ${formaterNombreStock(quantiteSource)} ${source.nom} → ${formaterNombreStock(quantiteCible)} ${cible.nom}`;
    appliquerMouvement({
      varianteId: source.id,
      depotId,
      type: "sortie",
      quantite: quantiteSource,
      motif,
      utilisateurId,
      referenceType: "stock.Detaillage",
      referenceId: operationId,
    });
    majPrixAchat(cible.id, nouveauCump);
    appliquerMouvement({
      varianteId: cible.id,
      depotId,
      type: "entree",
      quantite: quantiteCible,
      motif,
      utilisateurId,
      referenceType: "stock.Detaillage",
      referenceId: operationId,
    });
    terminerDestockageSiEpuise(source.id);
    return operationId;
  });
  sauvegarder();
  return id;
}

/** Remet les choses comme avant, tant que ce qui a été obtenu est encore en stock. */
export function annulerDetaillage(id: string, utilisateurId: string | null): void {
  const operation = unResultat<{
    depot_id: string;
    type: TypeDetaillage;
    variante_source_id: string;
    variante_cible_id: string;
    quantite_source: number;
    quantite_cible: number;
    cout_unitaire_cible: number;
    annulee: number;
  }>("SELECT * FROM detaillages WHERE id = ?", [id]);
  if (!operation) throw new ErreurStock("Opération introuvable.");
  if (Number(operation.annulee)) throw new ErreurStock("Cette opération est déjà annulée.");
  const source = varianteCout(operation.variante_source_id);
  const cible = varianteCout(operation.variante_cible_id);
  if (!source || !cible) throw new ErreurStock("Article introuvable.");
  const quantiteSource = Number(operation.quantite_source);
  const quantiteCible = Number(operation.quantite_cible);
  if (stockVarianteDepot(cible.id, operation.depot_id) < quantiteCible) {
    throw new ErreurStock(
      `Les ${formaterNombreStock(quantiteCible)} « ${cible.nom} » obtenus ne sont plus tous en stock : annulation impossible.`,
    );
  }
  const coutCible = Number(operation.cout_unitaire_cible);
  const coutSource = (coutCible * quantiteCible) / quantiteSource;
  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    majPrixAchat(cible.id, cumpApresSortie(cible.id, Number(cible.prix_achat), quantiteCible, coutCible));
    majPrixAchat(source.id, cumpApresEntree(source.id, Number(source.prix_achat), quantiteSource, coutSource));
    const motif = `Annulation ${operation.type === "detailler" ? "déballage" : "remballage"}`;
    appliquerMouvement({
      varianteId: cible.id,
      depotId: operation.depot_id,
      type: "sortie",
      quantite: quantiteCible,
      motif,
      utilisateurId,
      referenceType: "stock.Detaillage",
      referenceId: id,
    });
    appliquerMouvement({
      varianteId: source.id,
      depotId: operation.depot_id,
      type: "entree",
      quantite: quantiteSource,
      motif,
      utilisateurId,
      referenceType: "stock.Detaillage",
      referenceId: id,
    });
    executer(
      "UPDATE detaillages SET annulee = 1, date_annulation = ?, synchronise = 0, date_modification = ? WHERE id = ?",
      [maintenant, maintenant, id],
    );
  });
  sauvegarder();
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
  depotId: string;
  uniteSource: string;
  uniteCible: string;
  dateAnnulation: string | null;
  /** Stock actuel de ce qui a été obtenu, dans ce dépôt (pour savoir si l'annulation est possible). */
  stockCibleActuel: number;
  annulee: boolean;
}

/** Détaillages et regroupements de la boutique, les plus récents d'abord. */
export function listerDetaillages(boutiqueId: string): DetaillageResume[] {
  return tousLesResultats<DetaillageResume>(
    `SELECT dt.id as id, dt.date_creation as dateCreation, dt.type as type, d.nom as depotNom,
            dt.variante_source_id as varianteSourceId, dt.variante_cible_id as varianteCibleId,
            ps.nom as sourceNom, pc.nom as cibleNom, dt.quantite_source as quantiteSource,
            dt.quantite_cible as quantiteCible, dt.cout_unitaire_cible as coutUnitaireCible,
            dt.utilisateur_id as utilisateurId, COALESCE(dt.annulee, 0) as annulee,
            dt.depot_id as depotId, dt.date_annulation as dateAnnulation,
            COALESCE((SELECT nom FROM unites WHERE id = ps.unite_id), '') as uniteSource,
            COALESCE((SELECT nom FROM unites WHERE id = pc.unite_id), '') as uniteCible,
            COALESCE((SELECT quantite FROM stocks s WHERE s.variante_id = dt.variante_cible_id AND s.depot_id = dt.depot_id), 0)
              as stockCibleActuel
     FROM detaillages dt
     JOIN depots d ON d.id = dt.depot_id
     JOIN variantes vs ON vs.id = dt.variante_source_id
     JOIN produits ps ON ps.id = vs.produit_id
     JOIN variantes vc ON vc.id = dt.variante_cible_id
     JOIN produits pc ON pc.id = vc.produit_id
     WHERE d.boutique_id = ? AND dt.supprime = 0
     ORDER BY dt.date_creation DESC`,
    [boutiqueId],
  ).map((o) => ({ ...o, annulee: Boolean(o.annulee), stockCibleActuel: Number(o.stockCibleActuel) }));
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

/** Articles de gros reliés à un article de détail, avec leurs stocks. */
export function listerArticlesDetaillables(boutiqueId: string, depotId?: string): ArticleDetaillable[] {
  const filtreDepot = depotId ? " AND depot_id = ?" : "";
  const parametres: string[] = depotId ? [depotId, depotId, boutiqueId] : [boutiqueId];
  return tousLesResultats<ArticleDetaillable>(
    `SELECT v.id as varianteGrosId, p.nom as grosNom, d.id as varianteDetailId, pd.nom as detailNom,
            v.quantite_detail as quantite, COALESCE(u.nom, '') as uniteGros, COALESCE(ud.nom, '') as uniteDetail,
            v.prix_achat as prixAchatGros, d.prix_achat as prixAchatDetail, d.prix_vente as prixVenteDetail, d.seuil_alerte as seuilDetail,
            COALESCE((SELECT SUM(quantite) FROM stocks WHERE variante_id = v.id${filtreDepot}), 0) as stockGros,
            COALESCE((SELECT SUM(quantite) FROM stocks WHERE variante_id = d.id${filtreDepot}), 0) as stockDetail
     FROM variantes v
     JOIN produits p ON p.id = v.produit_id
     JOIN variantes d ON d.id = v.variante_detail_id
     JOIN produits pd ON pd.id = d.produit_id
     LEFT JOIN unites u ON u.id = p.unite_id
     LEFT JOIN unites ud ON ud.id = pd.unite_id
     WHERE p.boutique_id = ? AND v.supprime = 0 AND p.supprime = 0 AND d.supprime = 0 AND pd.supprime = 0
     ORDER BY p.nom`,
    parametres,
  ).map((a) => ({
    ...a,
    quantite: Number(a.quantite),
    stockGros: Number(a.stockGros),
    stockDetail: Number(a.stockDetail),
    prixAchatGros: Number(a.prixAchatGros),
    prixAchatDetail: Number(a.prixAchatDetail),
    prixVenteDetail: Number(a.prixVenteDetail),
    seuilDetail: Number(a.seuilDetail),
  }));
}

/** Pour un article de détail en rupture : un article de gros à détailler, s'il en reste dans ce dépôt. */
export function grosDisponiblePourDetail(varianteDetailId: string, depotId: string): GrosDisponible | null {
  const gros = unResultat<GrosDisponible>(
    `SELECT v.id as varianteGrosId, p.nom as grosNom, v.quantite_detail as quantite, s.quantite as stockGros,
            COALESCE(u.nom, '') as uniteGros,
            COALESCE((SELECT ud.nom FROM variantes d JOIN produits pd ON pd.id = d.produit_id
                      JOIN unites ud ON ud.id = pd.unite_id WHERE d.id = v.variante_detail_id), '') as uniteDetail
     FROM variantes v
     JOIN produits p ON p.id = v.produit_id
     LEFT JOIN unites u ON u.id = p.unite_id
     JOIN stocks s ON s.variante_id = v.id AND s.depot_id = ?
     WHERE v.variante_detail_id = ? AND v.supprime = 0 AND p.supprime = 0 AND s.quantite >= 1
     ORDER BY s.quantite DESC LIMIT 1`,
    [depotId, varianteDetailId],
  );
  return gros ? { ...gros, quantite: Number(gros.quantite), stockGros: Number(gros.stockGros) } : null;
}

/** Tous les articles de la boutique (nom + référence), pour choisir un article de détail. */
export function listerVariantesSimples(boutiqueId: string): { id: string; nom: string }[] {
  return tousLesResultats<{ id: string; nom: string }>(
    `SELECT v.id as id,
            p.nom || CASE WHEN COALESCE(v.reference, '') <> '' THEN ' (' || v.reference || ')' ELSE '' END as nom
     FROM variantes v JOIN produits p ON p.id = v.produit_id
     WHERE p.boutique_id = ? AND v.supprime = 0 AND p.supprime = 0
     ORDER BY p.nom`,
    [boutiqueId],
  );
}
