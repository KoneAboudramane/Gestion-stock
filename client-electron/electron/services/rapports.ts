import { tousLesResultats, unResultat } from "../db/helpers";

/**
 * Miroir de rapports/services.py (Django, Étape 7) : aucune écriture,
 * uniquement des agrégations, recalculées ici sur la base locale pour rester
 * consultables hors-ligne. Une vente annulée n'a jamais eu lieu du point de
 * vue des rapports (mêmes exclusions que côté serveur).
 */

export type Periode = "jour" | "semaine" | "mois" | "tout" | "personnalise";

// Borne de départ pour la période "tout" (toutes les dates) : antérieure à toute
// donnée plausible dans l'app, sans introduire de vraie notion d'"illimité" en SQL.
const DEBUT_PERIODE_TOUT = "2000-01-01T00:00:00.000Z";

export interface PlageDates {
  debut: string;
  fin: string;
}

function formatJour(date: Date): string {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${annee}-${mois}-${jour}`;
}

export function calculerPlageDates(periode: Periode = "jour", dateDebut?: string, dateFin?: string): PlageDates {
  if (periode === "personnalise" && dateDebut && dateFin) {
    return { debut: `${dateDebut}T00:00:00.000Z`, fin: `${dateFin}T23:59:59.999Z` };
  }

  const maintenant = new Date();

  if (periode === "tout") {
    return { debut: DEBUT_PERIODE_TOUT, fin: `${formatJour(maintenant)}T23:59:59.999Z` };
  }

  let debutDate: Date;
  let finDate: Date;

  if (periode === "semaine") {
    const jourSemaine = maintenant.getDay();
    const decalage = jourSemaine === 0 ? 6 : jourSemaine - 1;
    debutDate = new Date(maintenant);
    debutDate.setDate(maintenant.getDate() - decalage);
    finDate = new Date(debutDate);
    finDate.setDate(debutDate.getDate() + 6);
  } else if (periode === "mois") {
    debutDate = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
    finDate = new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 0);
  } else {
    debutDate = maintenant;
    finDate = maintenant;
  }

  return { debut: `${formatJour(debutDate)}T00:00:00.000Z`, fin: `${formatJour(finDate)}T23:59:59.999Z` };
}

// --- Synthèse des ventes ---

export interface SyntheseVentes {
  totalBrut: number;
  totalRemises: number;
  totalNet: number;
  nombreVentes: number;
  panierMoyen: number;
  beneficeTotal: number;
}

export function syntheseVentes(boutiqueId: string, debut: string, fin: string): SyntheseVentes {
  const agrege = unResultat<{
    totalBrut: number;
    totalRemises: number;
    totalNet: number;
    nombreVentes: number;
  }>(
    `SELECT COALESCE(SUM(total_brut), 0) as totalBrut, COALESCE(SUM(remise), 0) as totalRemises,
            COALESCE(SUM(total_net), 0) as totalNet, COUNT(*) as nombreVentes
     FROM ventes
     WHERE boutique_id = ? AND supprime = 0 AND statut != 'annulee' AND date_creation BETWEEN ? AND ?`,
    [boutiqueId, debut, fin],
  )!;

  const benefice = unResultat<{ beneficeTotal: number }>(
    `SELECT COALESCE(SUM(lv.sous_total - lv.cout_unitaire * lv.quantite), 0) as beneficeTotal
     FROM lignes_vente lv
     JOIN ventes v ON v.id = lv.vente_id
     WHERE v.boutique_id = ? AND v.supprime = 0 AND v.statut != 'annulee'
       AND v.date_creation BETWEEN ? AND ? AND lv.supprime = 0`,
    [boutiqueId, debut, fin],
  )!;

  const nombreVentes = Number(agrege.nombreVentes);
  const totalNet = Number(agrege.totalNet);
  const panierMoyen = nombreVentes > 0 ? Math.round(totalNet / nombreVentes) : 0;

  return {
    totalBrut: Number(agrege.totalBrut),
    totalRemises: Number(agrege.totalRemises),
    totalNet,
    nombreVentes,
    panierMoyen,
    beneficeTotal: Number(benefice.beneficeTotal),
  };
}

// --- Ventes par jour (tendance) ---

export interface LigneVentesParJour {
  jour: string;
  totalNet: number;
}

export function ventesParJour(boutiqueId: string, debut: string, fin: string): LigneVentesParJour[] {
  return tousLesResultats<LigneVentesParJour>(
    `SELECT substr(date_creation, 1, 10) as jour, COALESCE(SUM(total_net), 0) as totalNet
     FROM ventes
     WHERE boutique_id = ? AND supprime = 0 AND statut != 'annulee' AND date_creation BETWEEN ? AND ?
     GROUP BY jour
     ORDER BY jour ASC`,
    [boutiqueId, debut, fin],
  );
}

// --- Top clients ---

export interface LigneTopClient {
  clientId: string;
  clientNom: string;
  nombreVentes: number;
  totalNet: number;
}

export function topClients(boutiqueId: string, debut: string, fin: string, limite = 5): LigneTopClient[] {
  return tousLesResultats<LigneTopClient>(
    `SELECT cl.id as clientId, cl.nom as clientNom,
            COUNT(*) as nombreVentes, COALESCE(SUM(v.total_net), 0) as totalNet
     FROM ventes v
     JOIN clients cl ON cl.id = v.client_id
     WHERE v.boutique_id = ? AND v.supprime = 0 AND v.statut != 'annulee' AND v.date_creation BETWEEN ? AND ?
     GROUP BY cl.id, cl.nom
     ORDER BY totalNet DESC
     LIMIT ?`,
    [boutiqueId, debut, fin, limite],
  );
}

// --- Top produits ---

export interface LigneTopProduit {
  varianteId: string;
  produit: string;
  reference: string;
  quantiteVendue: number;
  caGenere: number;
}

export function topProduits(
  boutiqueId: string,
  debut: string,
  fin: string,
  limite = 10,
  ordre: "asc" | "desc" = "desc",
): LigneTopProduit[] {
  const direction = ordre === "asc" ? "ASC" : "DESC";
  return tousLesResultats<LigneTopProduit>(
    `SELECT lv.variante_id as varianteId, p.nom as produit, va.reference as reference,
            COALESCE(SUM(lv.quantite), 0) as quantiteVendue, COALESCE(SUM(lv.sous_total), 0) as caGenere
     FROM lignes_vente lv
     JOIN ventes v ON v.id = lv.vente_id
     JOIN variantes va ON va.id = lv.variante_id
     JOIN produits p ON p.id = va.produit_id
     WHERE v.boutique_id = ? AND v.supprime = 0 AND v.statut != 'annulee'
       AND v.date_creation BETWEEN ? AND ? AND lv.supprime = 0
     GROUP BY lv.variante_id, p.nom, va.reference
     ORDER BY quantiteVendue ${direction}
     LIMIT ?`,
    [boutiqueId, debut, fin, limite],
  );
}

// --- Valeur du stock ---

export interface ValeurStock {
  valeurAchat: number;
  valeurVentePotentielle: number;
  nombreVariantes: number;
  nombreRuptures: number;
}

export function valeurStock(boutiqueId: string, depotId?: string): ValeurStock {
  const conditions = ["d.boutique_id = ?"];
  const parametres: string[] = [boutiqueId];
  if (depotId) {
    conditions.push("s.depot_id = ?");
    parametres.push(depotId);
  }
  const clause = conditions.join(" AND ");

  const agrege = unResultat<{ valeurAchat: number; valeurVentePotentielle: number; nombreVariantes: number }>(
    `SELECT COALESCE(SUM(s.quantite * va.prix_achat), 0) as valeurAchat,
            COALESCE(SUM(s.quantite * va.prix_vente), 0) as valeurVentePotentielle,
            COUNT(*) as nombreVariantes
     FROM stocks s
     JOIN depots d ON d.id = s.depot_id
     JOIN variantes va ON va.id = s.variante_id
     WHERE ${clause}`,
    parametres,
  )!;

  const ruptures = unResultat<{ n: number }>(
    `SELECT COUNT(*) as n
     FROM stocks s
     JOIN depots d ON d.id = s.depot_id
     JOIN variantes va ON va.id = s.variante_id
     WHERE ${clause} AND s.quantite <= va.seuil_alerte`,
    parametres,
  )!;

  return {
    valeurAchat: Number(agrege.valeurAchat),
    valeurVentePotentielle: Number(agrege.valeurVentePotentielle),
    nombreVariantes: Number(agrege.nombreVariantes),
    nombreRuptures: Number(ruptures.n),
  };
}

// --- Ventes par vendeur ---
// Note : comptes.Utilisateur n'est pas synchronisé localement (hérite
// d'AbstractUser, pas de ModeleBase) — on ne renvoie que l'id ; le libellé
// ("Vous" vs identifiant tronqué) est résolu côté UI (Rapports.tsx).

export interface LigneVentesVendeur {
  utilisateurId: string | null;
  nombreVentes: number;
  totalNet: number;
}

export function ventesParVendeur(boutiqueId: string, debut: string, fin: string): LigneVentesVendeur[] {
  return tousLesResultats<LigneVentesVendeur>(
    `SELECT utilisateur_id as utilisateurId, COUNT(*) as nombreVentes, COALESCE(SUM(total_net), 0) as totalNet
     FROM ventes
     WHERE boutique_id = ? AND supprime = 0 AND statut != 'annulee' AND date_creation BETWEEN ? AND ?
     GROUP BY utilisateur_id
     ORDER BY totalNet DESC`,
    [boutiqueId, debut, fin],
  );
}

// --- Ventes par catégorie ---

export interface LigneVentesCategorie {
  categorieId: string | null;
  categorie: string;
  quantiteVendue: number;
  caGenere: number;
}

export function ventesParCategorie(boutiqueId: string, debut: string, fin: string): LigneVentesCategorie[] {
  return tousLesResultats<LigneVentesCategorie>(
    `SELECT c.id as categorieId, COALESCE(c.nom, 'Sans catégorie') as categorie,
            COALESCE(SUM(lv.quantite), 0) as quantiteVendue, COALESCE(SUM(lv.sous_total), 0) as caGenere
     FROM lignes_vente lv
     JOIN ventes v ON v.id = lv.vente_id
     JOIN variantes va ON va.id = lv.variante_id
     JOIN produits p ON p.id = va.produit_id
     LEFT JOIN categories c ON c.id = p.categorie_id
     WHERE v.boutique_id = ? AND v.supprime = 0 AND v.statut != 'annulee'
       AND v.date_creation BETWEEN ? AND ? AND lv.supprime = 0
     GROUP BY c.id, c.nom
     ORDER BY caGenere DESC`,
    [boutiqueId, debut, fin],
  );
}

// --- Ventes par mode de paiement ---

export interface LigneVentesModePaiement {
  mode: string;
  total: number;
}

export function ventesParModePaiement(boutiqueId: string, debut: string, fin: string): LigneVentesModePaiement[] {
  return tousLesResultats<LigneVentesModePaiement>(
    `SELECT p.mode as mode, COALESCE(SUM(p.montant), 0) as total
     FROM paiements p
     JOIN ventes v ON v.id = p.vente_id
     WHERE v.boutique_id = ? AND v.supprime = 0 AND v.statut != 'annulee'
       AND v.date_creation BETWEEN ? AND ? AND p.supprime = 0
     GROUP BY p.mode
     ORDER BY total DESC`,
    [boutiqueId, debut, fin],
  );
}
