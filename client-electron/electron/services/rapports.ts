import { randomUUID } from "node:crypto";

import { executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";
import { listerDestockages } from "./stock";

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

// --- Produits dormants : du stock qui ne se vend plus ---

export interface LigneProduitDormant {
  varianteId: string;
  produitId: string;
  produitNom: string;
  reference: string;
  codeBarres: string;
  prixVente: number;
  prixAchat: number;
  seuilAlerte: number;
  quantiteStock: number;
  /** Date de la dernière vente (non annulée), null si jamais vendu. */
  derniereVente: string | null;
  joursSansVente: number;
  /** Argent qui dort : quantité en stock × coût d'achat moyen (CUMP). */
  valeurImmobilisee: number;
  enDestockage: boolean;
}

/**
 * Articles qui ont du stock (tous dépôts confondus) mais ne se sont pas vendus
 * depuis au moins `jours` jours. Un article jamais vendu compte à partir de sa
 * première entrée en stock. Triés du plus d'argent immobilisé au moins.
 */
export function produitsDormants(boutiqueId: string, jours: number): LigneProduitDormant[] {
  const d = new Date();
  const aujourdhui = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const lignes = tousLesResultats<
    Omit<LigneProduitDormant, "joursSansVente" | "valeurImmobilisee" | "enDestockage"> & {
      premiereEntree: string | null;
      dateCreation: string | null;
      enDestockage: number;
    }
  >(
    `SELECT v.id as varianteId, p.id as produitId, p.nom as produitNom, COALESCE(v.reference, '') as reference,
            COALESCE(v.code_barres, '') as codeBarres, v.prix_vente as prixVente, v.prix_achat as prixAchat,
            v.seuil_alerte as seuilAlerte, st.total as quantiteStock,
            (SELECT MAX(ve.date_creation) FROM lignes_vente lv JOIN ventes ve ON ve.id = lv.vente_id
             WHERE lv.variante_id = v.id AND lv.supprime = 0 AND ve.statut != 'annulee') as derniereVente,
            (SELECT MIN(m.date_creation) FROM mouvements_stock m
             WHERE m.variante_id = v.id AND m.type = 'entree' AND m.supprime = 0) as premiereEntree,
            v.date_creation as dateCreation,
            EXISTS (SELECT 1 FROM destockages ds
                    WHERE ds.variante_id = v.id AND ds.statut = 'en_cours' AND ds.supprime = 0
                      AND (ds.date_fin IS NULL OR ds.date_fin = '' OR ds.date_fin >= ?)) as enDestockage
     FROM variantes v
     JOIN produits p ON p.id = v.produit_id
     JOIN (SELECT variante_id, SUM(quantite) as total FROM stocks GROUP BY variante_id) st ON st.variante_id = v.id
     WHERE p.boutique_id = ? AND p.supprime = 0 AND v.supprime = 0 AND st.total > 0`,
    [aujourdhui, boutiqueId],
  );

  const maintenant = Date.now();
  const resultat: LigneProduitDormant[] = [];
  for (const { premiereEntree, dateCreation, enDestockage, ...l } of lignes) {
    const reference = l.derniereVente ?? premiereEntree ?? dateCreation;
    const joursSansVente = reference ? Math.floor((maintenant - new Date(reference).getTime()) / 86_400_000) : 0;
    if (joursSansVente < jours) continue;
    resultat.push({
      ...l,
      prixVente: Number(l.prixVente),
      prixAchat: Number(l.prixAchat),
      seuilAlerte: Number(l.seuilAlerte),
      quantiteStock: Number(l.quantiteStock),
      joursSansVente,
      valeurImmobilisee: Math.round(Number(l.quantiteStock) * Number(l.prixAchat)),
      enDestockage: Boolean(enDestockage),
    });
  }
  return resultat.sort((a, b) => b.valeurImmobilisee - a.valeurImmobilisee);
}

// --- Historique de la dormance : relevés quotidiens et « ce qu'on en a fait » ---

const SEUIL_RELEVE_DORMANTS = 60;

function jourLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Photo du jour des produits dormants (sans vente depuis 60 jours) : prise une
 * fois par jour et par appareil, à l'ouverture de l'appli (voir Shell.tsx).
 * Ne fait rien si un relevé existe déjà aujourd'hui sur cet appareil ou reçu
 * par la synchro.
 */
export function enregistrerReleveDormants(boutiqueId: string): void {
  const aujourdhui = jourLocal(new Date());
  const existe = unResultat<{ n: number }>(
    "SELECT COUNT(*) as n FROM releves_dormants WHERE boutique_id = ? AND date = ? AND supprime = 0",
    [boutiqueId, aujourdhui],
  );
  if (Number(existe?.n ?? 0) > 0) return;
  const dormants = produitsDormants(boutiqueId, SEUIL_RELEVE_DORMANTS);
  const maintenant = new Date().toISOString();
  executer(
    `INSERT INTO releves_dormants
       (id, boutique_id, date, jours_seuil, nombre_articles, valeur_immobilisee, date_creation, date_modification)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      boutiqueId,
      aujourdhui,
      SEUIL_RELEVE_DORMANTS,
      dormants.length,
      dormants.reduce((somme, d) => somme + d.valeurImmobilisee, 0),
      maintenant,
      maintenant,
    ],
  );
  sauvegarder();
}

export interface ReleveDormants {
  date: string;
  nombreArticles: number;
  valeurImmobilisee: number;
}

/** Un relevé par jour (le plus récent si plusieurs appareils en ont pris un), du plus ancien au plus récent. */
export function listerRelevesDormants(boutiqueId: string): ReleveDormants[] {
  const lignes = tousLesResultats<ReleveDormants & { dateCreation: string }>(
    `SELECT date, nombre_articles as nombreArticles, valeur_immobilisee as valeurImmobilisee, date_creation as dateCreation
     FROM releves_dormants WHERE boutique_id = ? AND supprime = 0
     ORDER BY date ASC, date_creation ASC`,
    [boutiqueId],
  );
  const parJour = new Map<string, ReleveDormants>();
  for (const l of lignes) {
    parJour.set(l.date, {
      date: l.date,
      nombreArticles: Number(l.nombreArticles),
      valeurImmobilisee: Number(l.valeurImmobilisee),
    });
  }
  return [...parJour.values()];
}

export type ActionSortieDormance = "revendu" | "perte" | "destockage";

export interface SortieDormance {
  id: string;
  date: string;
  varianteId: string;
  produitNom: string;
  reference: string;
  /** Jours sans vente au moment de l'action. */
  joursSansVente: number;
  action: ActionSortieDormance;
  /** Perte : motif ; déstockage : statut ; revente : "". */
  motif: string;
  detail: string;
  quantite: number;
  /** Revente : montant encaissé ; perte : valeur perdue ; déstockage : argent récupéré. */
  montant: number;
}

interface EvenementDormance {
  date: string;
  type: "vente" | ActionSortieDormance;
  sortie?: Omit<SortieDormance, "joursSansVente" | "produitNom" | "reference">;
  enDestockage?: boolean;
}

/**
 * « Ce qu'on a fait » des articles restés au moins `seuil` jours sans vente :
 * revendus au prix normal, déclarés en perte, ou mis en déstockage. Calculé
 * à partir des ventes, pertes et déstockages déjà enregistrés (aucune table
 * dédiée) : pour chaque article, on parcourt ses événements dans l'ordre et on
 * mesure le temps écoulé depuis sa dernière vente (ou sa première entrée en
 * stock). Les ventes faites pendant un déstockage ne comptent pas comme une
 * revente : elles sont déjà dans le bilan du déstockage.
 */
export function sortiesDormance(boutiqueId: string, seuil: number): SortieDormance[] {
  const articles = tousLesResultats<{ id: string; produitNom: string; reference: string; premiereEntree: string | null; dateCreation: string | null }>(
    `SELECT v.id as id, p.nom as produitNom, COALESCE(v.reference, '') as reference,
            (SELECT MIN(m.date_creation) FROM mouvements_stock m
             WHERE m.variante_id = v.id AND m.type = 'entree' AND m.supprime = 0) as premiereEntree,
            v.date_creation as dateCreation
     FROM variantes v JOIN produits p ON p.id = v.produit_id
     WHERE p.boutique_id = ? AND p.supprime = 0 AND v.supprime = 0`,
    [boutiqueId],
  );
  const evenements = new Map<string, EvenementDormance[]>();
  const ajouter = (varianteId: string, e: EvenementDormance) =>
    evenements.set(varianteId, [...(evenements.get(varianteId) ?? []), e]);

  for (const v of tousLesResultats<{ id: string; varianteId: string; date: string; quantite: number; montant: number; destockageId: string | null }>(
    `SELECT lv.id as id, lv.variante_id as varianteId, ve.date_creation as date, lv.quantite as quantite,
            lv.sous_total as montant, lv.destockage_id as destockageId
     FROM lignes_vente lv JOIN ventes ve ON ve.id = lv.vente_id
     WHERE ve.boutique_id = ? AND ve.statut != 'annulee' AND lv.supprime = 0`,
    [boutiqueId],
  )) {
    ajouter(v.varianteId, {
      date: v.date,
      type: "vente",
      enDestockage: !!v.destockageId,
      sortie: {
        id: `vente-${v.id}`,
        date: v.date,
        varianteId: v.varianteId,
        action: "revendu",
        motif: "",
        detail: "Vendu au prix normal",
        quantite: Number(v.quantite),
        montant: Number(v.montant),
      },
    });
  }
  for (const p of tousLesResultats<{ id: string; varianteId: string; date: string; motif: string; detail: string; quantite: number; valeur: number }>(
    `SELECT pe.id as id, pe.variante_id as varianteId, pe.date_creation as date, pe.motif as motif,
            COALESCE(pe.detail, '') as detail, pe.quantite as quantite, pe.valeur as valeur
     FROM pertes_stock pe JOIN depots d ON d.id = pe.depot_id
     WHERE d.boutique_id = ? AND pe.supprime = 0`,
    [boutiqueId],
  )) {
    ajouter(p.varianteId, {
      date: p.date,
      type: "perte",
      sortie: {
        id: `perte-${p.id}`,
        date: p.date,
        varianteId: p.varianteId,
        action: "perte",
        motif: p.motif,
        detail: p.detail,
        quantite: Number(p.quantite),
        montant: Number(p.valeur),
      },
    });
  }
  for (const d of listerDestockages(boutiqueId)) {
    ajouter(d.varianteId, {
      date: d.dateCreation,
      type: "destockage",
      sortie: {
        id: `destockage-${d.id}`,
        date: d.dateCreation,
        varianteId: d.varianteId,
        action: "destockage",
        motif: d.statut === "en_cours" ? "en_cours" : d.motifFin,
        detail: `${d.prixNormal} → ${d.prixDestockage}${d.operationNom ? ` · ${d.operationNom}` : ""}`,
        quantite: d.quantiteVendue,
        montant: d.chiffreAffaires,
      },
    });
  }

  const JOUR_MS = 86_400_000;
  const resultat: SortieDormance[] = [];
  for (const article of articles) {
    const liste = (evenements.get(article.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    let derniereActivite = article.premiereEntree ?? article.dateCreation;
    for (const e of liste) {
      const jours = derniereActivite
        ? Math.floor((new Date(e.date).getTime() - new Date(derniereActivite).getTime()) / JOUR_MS)
        : 0;
      const estSortie = e.type !== "vente" || !e.enDestockage;
      if (estSortie && jours >= seuil && e.sortie) {
        resultat.push({ ...e.sortie, produitNom: article.produitNom, reference: article.reference, joursSansVente: jours });
      }
      if (e.type === "vente") derniereActivite = e.date;
    }
  }
  return resultat.sort((a, b) => b.date.localeCompare(a.date));
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
