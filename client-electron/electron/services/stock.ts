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

export function creerDepot(boutiqueId: string, nom: string, adresse = ""): string {
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

export function supprimerDepot(id: string): void {
  const maintenant = new Date().toISOString();
  executer("UPDATE depots SET supprime = 1, synchronise = 0, date_modification = ? WHERE id = ?", [
    maintenant,
    id,
  ]);
  sauvegarder();
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
            CASE WHEN s.quantite <= v.seuil_alerte THEN 1 ELSE 0 END as enRupture
     FROM stocks s
     JOIN variantes v ON v.id = s.variante_id
     JOIN produits p ON p.id = v.produit_id
     JOIN depots d ON d.id = s.depot_id
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
            m.type as type, m.quantite as quantite, m.motif as motif, m.date_creation as dateCreation
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
            m.type as type, m.quantite as quantite, m.motif as motif, m.date_creation as dateCreation
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
}

export function listerTransferts(boutiqueId: string, limite = 100): TransfertResume[] {
  return tousLesResultats<TransfertResume>(
    `SELECT t.id as id, p.nom as produitNom, v.reference as reference,
            ds.nom as depotSourceNom, dd.nom as depotDestinationNom,
            t.quantite as quantite, t.date_creation as dateCreation
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

// --- Inventaire (miroir de demarrer_inventaire / valider_inventaire) ---

export interface InventaireResume {
  id: string;
  depotNom: string;
  statut: string;
  dateCreation: string;
}

export function listerInventaires(boutiqueId: string): InventaireResume[] {
  return tousLesResultats<InventaireResume>(
    `SELECT i.id as id, d.nom as depotNom, i.statut as statut, i.date_creation as dateCreation
     FROM inventaires i JOIN depots d ON d.id = i.depot_id
     WHERE i.boutique_id = ? AND i.supprime = 0
     ORDER BY i.date_creation DESC`,
    [boutiqueId],
  );
}

export function demarrerInventaire(boutiqueId: string, depotId: string, utilisateurId: string | null): string {
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
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [randomUUID(), id, s.variante_id, s.quantite, s.quantite, maintenant, maintenant],
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
    qteTheorique: number;
    qtePhysique: number;
    ecart: number;
    prixAchat: number;
  }>(
    `SELECT li.id as id, v.id as varianteId, p.nom as produitNom, v.reference as reference,
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
