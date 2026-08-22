import { randomUUID } from "node:crypto";

import { dansUneTransaction, executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";
import { verifierAbonnementActif } from "./abonnement";
import { appliquerMouvement } from "./stock";
import { enregistrerMouvement } from "./tresorerie";

/**
 * Miroir de ventes/services.py::creer_vente (Django, Étape 4) : coût figé au
 * moment de la vente, montants arrondis à l'unité FCFA, somme des paiements
 * = total net, sortie de stock par ligne, créance si vente à crédit.
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

function genererNumero(boutiqueId: string): string {
  const isoJour = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const resultat = unResultat<{ n: number }>(
    "SELECT COUNT(*) as n FROM ventes WHERE boutique_id = ? AND date_creation BETWEEN ? AND ?",
    [boutiqueId, `${isoJour}T00:00:00.000Z`, `${isoJour}T23:59:59.999Z`],
  );
  const compteur = (resultat ? Number(resultat.n) : 0) + 1;
  return `VTE-${isoJour.replace(/-/g, "")}-${String(compteur).padStart(4, "0")}`;
}

export function creerVente(params: ParametresVente): VenteCreee {
  const {
    boutiqueId,
    depotId,
    utilisateurId,
    clientId = null,
    statut,
    lignes,
    paiements,
    remiseGlobale = 0,
  } = params;

  verifierAbonnementActif(boutiqueId);

  if (lignes.length === 0) {
    throw new ErreurVente("Une vente doit contenir au moins une ligne.");
  }
  if (statut === "credit" && !clientId) {
    throw new ErreurVente("Un client est requis pour une vente à crédit.");
  }

  const lignesCalculees = lignes.map((ligne) => {
    const variante = unResultat<{ prix_vente: number; prix_achat: number }>(
      "SELECT prix_vente, prix_achat FROM variantes WHERE id = ?",
      [ligne.varianteId],
    );
    if (!variante) throw new ErreurVente("Variante introuvable.");

    const prixUnitaire = ligne.prixUnitaire ?? Number(variante.prix_vente);
    const remiseLigne = ligne.remise ?? 0;
    const sousTotal = Math.round(ligne.quantite * prixUnitaire - remiseLigne);
    if (sousTotal < 0) {
      throw new ErreurVente("Une remise de ligne ne peut pas rendre le sous-total négatif.");
    }
    return {
      varianteId: ligne.varianteId,
      quantite: ligne.quantite,
      prixUnitaire,
      coutUnitaire: Number(variante.prix_achat),
      remise: remiseLigne,
      sousTotal,
    };
  });

  const totalBrut = lignesCalculees.reduce((somme, l) => somme + l.sousTotal, 0);
  const totalNet = Math.round(totalBrut - remiseGlobale);
  if (totalNet < 0) {
    throw new ErreurVente("La remise globale ne peut pas rendre le total négatif.");
  }

  const totalPaiements = paiements.reduce((somme, p) => somme + p.montant, 0);
  if (totalPaiements !== totalNet) {
    throw new ErreurVente(
      `La somme des paiements (${totalPaiements}) doit être égale au total net (${totalNet}).`,
    );
  }
  if (paiements.some((p) => p.mode === "mobile_money" && !p.operateur)) {
    throw new ErreurVente("Un opérateur est requis pour un paiement Mobile Money.");
  }

  // Tout ce qui suit écrit en base : enveloppé dans une transaction (comme
  // @transaction.atomic côté Django) pour qu'un stock insuffisant sur une
  // ligne annule TOUTE la vente, pas seulement cette ligne.
  const resultat = dansUneTransaction(() => {
    const numero = genererNumero(boutiqueId);
    const venteId = randomUUID();
    const maintenant = new Date().toISOString();

    executer(
      `INSERT INTO ventes
         (id, boutique_id, depot_id, client_id, utilisateur_id, numero, total_brut, remise, total_net, statut, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        venteId,
        boutiqueId,
        depotId,
        clientId,
        utilisateurId,
        numero,
        totalBrut,
        remiseGlobale,
        totalNet,
        statut,
        maintenant,
        maintenant,
      ],
    );

    for (const ligne of lignesCalculees) {
      executer(
        `INSERT INTO lignes_vente
           (id, vente_id, variante_id, quantite, prix_unitaire, cout_unitaire, remise, sous_total, date_creation, date_modification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          venteId,
          ligne.varianteId,
          ligne.quantite,
          ligne.prixUnitaire,
          ligne.coutUnitaire,
          ligne.remise,
          ligne.sousTotal,
          maintenant,
          maintenant,
        ],
      );
      appliquerMouvement({
        varianteId: ligne.varianteId,
        depotId,
        type: "sortie",
        quantite: ligne.quantite,
        motif: `Vente ${numero}`,
        utilisateurId,
        referenceType: "ventes.Vente",
        referenceId: venteId,
      });
    }

    for (const paiement of paiements) {
      const paiementId = randomUUID();
      executer(
        "INSERT INTO paiements (id, vente_id, mode, operateur, montant, date_creation, date_modification) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [paiementId, venteId, paiement.mode, paiement.operateur || "", paiement.montant, maintenant, maintenant],
      );
      if (paiement.mode === "especes") {
        enregistrerMouvement({
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
      const montantCredit = paiements
        .filter((p) => p.mode === "credit")
        .reduce((somme, p) => somme + p.montant, 0);
      if (montantCredit > 0) {
        executer(
          `INSERT INTO credits
             (id, client_id, vente_id, montant, montant_paye, solde, statut, date_creation, date_modification)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), clientId, venteId, montantCredit, 0, montantCredit, "en_cours", maintenant, maintenant],
        );
      }
    }

    return { id: venteId, numero, totalBrut, totalNet };
  });

  sauvegarder();
  return resultat;
}

export interface VenteResume {
  id: string;
  numero: string;
  dateCreation: string;
  depotNom: string;
  clientNom: string | null;
  statut: StatutVente;
  totalNet: number;
}

export function listerVentes(
  boutiqueId: string,
  depotId?: string,
  statut?: StatutVente,
  terme = "",
  limite = 100,
  clientId?: string,
): VenteResume[] {
  const conditions = ["v.boutique_id = ?", "v.supprime = 0"];
  const parametres: (string | number)[] = [boutiqueId];
  if (depotId) {
    conditions.push("v.depot_id = ?");
    parametres.push(depotId);
  }
  if (statut) {
    conditions.push("v.statut = ?");
    parametres.push(statut);
  }
  if (terme.trim()) {
    conditions.push("(v.numero LIKE ? OR c.nom LIKE ?)");
    const motif = `%${terme.trim()}%`;
    parametres.push(motif, motif);
  }
  if (clientId) {
    conditions.push("v.client_id = ?");
    parametres.push(clientId);
  }
  parametres.push(limite);

  return tousLesResultats<VenteResume>(
    `SELECT v.id as id, v.numero as numero, v.date_creation as dateCreation,
            d.nom as depotNom, c.nom as clientNom, v.statut as statut, v.total_net as totalNet
     FROM ventes v
     JOIN depots d ON d.id = v.depot_id
     LEFT JOIN clients c ON c.id = v.client_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY v.date_creation DESC
     LIMIT ?`,
    parametres,
  );
}

export interface LigneVenteDetail {
  id: string;
  produitNom: string;
  reference: string;
  quantite: number;
  prixUnitaire: number;
  remise: number;
  sousTotal: number;
}

export interface PaiementDetail {
  id: string;
  mode: ModePaiement;
  montant: number;
}

export interface VenteDetail {
  id: string;
  numero: string;
  dateCreation: string;
  depotNom: string;
  clientNom: string | null;
  statut: StatutVente;
  totalBrut: number;
  remise: number;
  totalNet: number;
  lignes: LigneVenteDetail[];
  paiements: PaiementDetail[];
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

// Historique produit (toutes variantes confondues) — utilisé par la modale de
// détail produit en Produits.tsx.
export function listerVentesParProduit(produitId: string, limite = 100): LigneVenteHistorique[] {
  return tousLesResultats<LigneVenteHistorique>(
    `SELECT v.id as venteId, v.numero as venteNumero, v.date_creation as dateCreation,
            c.nom as clientNom, v.statut as statut,
            lv.quantite as quantite, lv.prix_unitaire as prixUnitaire, lv.sous_total as sousTotal
     FROM lignes_vente lv
     JOIN variantes va ON va.id = lv.variante_id
     JOIN ventes v ON v.id = lv.vente_id
     LEFT JOIN clients c ON c.id = v.client_id
     WHERE va.produit_id = ? AND lv.supprime = 0 AND v.supprime = 0
     ORDER BY v.date_creation DESC
     LIMIT ?`,
    [produitId, limite],
  );
}

export function obtenirVente(id: string): VenteDetail | undefined {
  const vente = unResultat<Omit<VenteDetail, "lignes" | "paiements">>(
    `SELECT v.id as id, v.numero as numero, v.date_creation as dateCreation,
            d.nom as depotNom, c.nom as clientNom, c.telephone as clientTelephone, v.statut as statut,
            v.total_brut as totalBrut, v.remise as remise, v.total_net as totalNet,
            v.utilisateur_id as utilisateurId
     FROM ventes v
     JOIN depots d ON d.id = v.depot_id
     LEFT JOIN clients c ON c.id = v.client_id
     WHERE v.id = ? AND v.supprime = 0`,
    [id],
  );
  if (!vente) return undefined;

  const lignes = tousLesResultats<LigneVenteDetail>(
    `SELECT lv.id as id, p.nom as produitNom, va.reference as reference,
            lv.quantite as quantite, lv.prix_unitaire as prixUnitaire,
            lv.remise as remise, lv.sous_total as sousTotal
     FROM lignes_vente lv
     JOIN variantes va ON va.id = lv.variante_id
     JOIN produits p ON p.id = va.produit_id
     WHERE lv.vente_id = ? AND lv.supprime = 0`,
    [id],
  );

  const paiements = tousLesResultats<PaiementDetail>(
    "SELECT id, mode, montant FROM paiements WHERE vente_id = ? AND supprime = 0",
    [id],
  );

  return { ...vente, lignes, paiements };
}

/**
 * Miroir de ventes/services.py::annuler_vente : recrée le stock consommé par
 * chaque ligne, solde toute créance liée, passe la vente à "annulee". Refuse
 * si déjà annulée.
 */
export function annulerVente(venteId: string, utilisateurId: string | null): void {
  const vente = unResultat<{ numero: string; statut: string; depot_id: string }>(
    "SELECT numero, statut, depot_id FROM ventes WHERE id = ?",
    [venteId],
  );
  if (!vente) throw new ErreurVente("Vente introuvable.");
  if (vente.statut === "annulee") {
    throw new ErreurVente("Cette vente est déjà annulée.");
  }

  dansUneTransaction(() => {
    const lignes = tousLesResultats<{ variante_id: string; quantite: number }>(
      "SELECT variante_id, quantite FROM lignes_vente WHERE vente_id = ?",
      [venteId],
    );
    for (const ligne of lignes) {
      appliquerMouvement({
        varianteId: ligne.variante_id,
        depotId: vente.depot_id,
        type: "entree",
        quantite: Number(ligne.quantite),
        motif: `Annulation vente ${vente.numero}`,
        utilisateurId,
        referenceType: "ventes.Vente",
        referenceId: venteId,
      });
    }

    const paiementsEspeces = tousLesResultats<{ montant: number }>(
      "SELECT montant FROM paiements WHERE vente_id = ? AND mode = 'especes' AND supprime = 0",
      [venteId],
    );
    for (const paiement of paiementsEspeces) {
      enregistrerMouvement({
        depotId: vente.depot_id,
        type: "sortie",
        categorie: "vente_especes",
        montant: Number(paiement.montant),
        motif: `Annulation vente ${vente.numero}`,
        utilisateurId,
        referenceType: "ventes.Vente",
        referenceId: venteId,
      });
    }

    const maintenant = new Date().toISOString();
    executer(
      `UPDATE credits SET montant_paye = montant, solde = 0, statut = 'solde',
         synchronise = 0, date_modification = ? WHERE vente_id = ?`,
      [maintenant, venteId],
    );
    executer(
      "UPDATE ventes SET statut = 'annulee', synchronise = 0, date_modification = ? WHERE id = ?",
      [maintenant, venteId],
    );
  });

  sauvegarder();
}
