import { ouvrirBaseDeDonnees } from "../db";
import { ecrireLigne, suiviSyncNeuf } from "../db/helpers";
import type { ReleveDormantsLocal, VenteLocale } from "../db/schema";
import { listerDestockages } from "./stock";

/**
 * Port navigateur de client-electron/electron/services/rapports.ts : aucune
 * écriture, uniquement des agrégations, recalculées ici depuis IndexedDB pour
 * rester consultables hors-ligne. Une vente annulée n'a jamais eu lieu du
 * point de vue des rapports (mêmes exclusions que côté serveur).
 */

export type Periode = "jour" | "semaine" | "mois" | "tout" | "personnalise";

// Borne de départ pour la période "tout" (toutes les dates) : antérieure à toute
// donnée plausible dans l'app, sans introduire de vraie notion d'"illimité".
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

async function ventesPeriode(boutiqueId: string, debut: string, fin: string): Promise<VenteLocale[]> {
  const db = await ouvrirBaseDeDonnees();
  const ventes = await db.getAllFromIndex("ventes", "boutique_id", boutiqueId);
  return ventes.filter(
    (v) => !v.supprime && v.statut !== "annulee" && v.date_creation >= debut && v.date_creation <= fin,
  );
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

export async function syntheseVentes(boutiqueId: string, debut: string, fin: string): Promise<SyntheseVentes> {
  const db = await ouvrirBaseDeDonnees();
  const ventes = await ventesPeriode(boutiqueId, debut, fin);

  const totalBrut = ventes.reduce((somme, v) => somme + v.total_brut, 0);
  const totalRemises = ventes.reduce((somme, v) => somme + v.remise, 0);
  const totalNet = ventes.reduce((somme, v) => somme + v.total_net, 0);
  const nombreVentes = ventes.length;
  const panierMoyen = nombreVentes > 0 ? Math.round(totalNet / nombreVentes) : 0;

  let beneficeTotal = 0;
  for (const vente of ventes) {
    const lignes = (await db.getAllFromIndex("lignes_vente", "vente_id", vente.id)).filter((l) => !l.supprime);
    for (const l of lignes) beneficeTotal += l.sous_total - l.cout_unitaire * l.quantite;
  }

  return { totalBrut, totalRemises, totalNet, nombreVentes, panierMoyen, beneficeTotal };
}

// --- Ventes par jour (tendance) ---

export interface LigneVentesParJour {
  jour: string;
  totalNet: number;
}

export async function ventesParJour(boutiqueId: string, debut: string, fin: string): Promise<LigneVentesParJour[]> {
  const ventes = await ventesPeriode(boutiqueId, debut, fin);
  const parJour = new Map<string, number>();
  for (const v of ventes) {
    const jour = v.date_creation.slice(0, 10);
    parJour.set(jour, (parJour.get(jour) ?? 0) + v.total_net);
  }
  return [...parJour.entries()].map(([jour, totalNet]) => ({ jour, totalNet })).sort((a, b) => a.jour.localeCompare(b.jour));
}

// --- Top clients ---

export interface LigneTopClient {
  clientId: string;
  clientNom: string;
  nombreVentes: number;
  totalNet: number;
}

export async function topClients(boutiqueId: string, debut: string, fin: string, limite = 5): Promise<LigneTopClient[]> {
  const db = await ouvrirBaseDeDonnees();
  const ventes = (await ventesPeriode(boutiqueId, debut, fin)).filter((v) => v.client_id);

  const parClient = new Map<string, { nombreVentes: number; totalNet: number }>();
  for (const v of ventes) {
    const cur = parClient.get(v.client_id as string) ?? { nombreVentes: 0, totalNet: 0 };
    cur.nombreVentes += 1;
    cur.totalNet += v.total_net;
    parClient.set(v.client_id as string, cur);
  }

  const resultat: LigneTopClient[] = [];
  for (const [clientId, agg] of parClient) {
    const client = await db.get("clients", clientId);
    resultat.push({ clientId, clientNom: client?.nom ?? "", nombreVentes: agg.nombreVentes, totalNet: agg.totalNet });
  }
  return resultat.sort((a, b) => b.totalNet - a.totalNet).slice(0, limite);
}

// --- Top produits ---

export interface LigneTopProduit {
  varianteId: string;
  produit: string;
  reference: string;
  quantiteVendue: number;
  caGenere: number;
}

export async function topProduits(
  boutiqueId: string,
  debut: string,
  fin: string,
  limite = 10,
  ordre: "asc" | "desc" = "desc",
): Promise<LigneTopProduit[]> {
  const db = await ouvrirBaseDeDonnees();
  const ventes = await ventesPeriode(boutiqueId, debut, fin);

  const parVariante = new Map<string, { quantiteVendue: number; caGenere: number }>();
  for (const v of ventes) {
    const lignes = (await db.getAllFromIndex("lignes_vente", "vente_id", v.id)).filter((l) => !l.supprime);
    for (const l of lignes) {
      const cur = parVariante.get(l.variante_id) ?? { quantiteVendue: 0, caGenere: 0 };
      cur.quantiteVendue += l.quantite;
      cur.caGenere += l.sous_total;
      parVariante.set(l.variante_id, cur);
    }
  }

  const resultat: LigneTopProduit[] = [];
  for (const [varianteId, agg] of parVariante) {
    const variante = await db.get("variantes", varianteId);
    const produit = variante ? await db.get("produits", variante.produit_id) : undefined;
    resultat.push({
      varianteId,
      produit: produit?.nom ?? "",
      reference: variante?.reference ?? "",
      quantiteVendue: agg.quantiteVendue,
      caGenere: agg.caGenere,
    });
  }
  resultat.sort((a, b) => (ordre === "asc" ? a.quantiteVendue - b.quantiteVendue : b.quantiteVendue - a.quantiteVendue));
  return resultat.slice(0, limite);
}

// --- Valeur du stock ---

export interface ValeurStock {
  valeurAchat: number;
  valeurVentePotentielle: number;
  nombreVariantes: number;
  nombreRuptures: number;
}

export async function valeurStock(boutiqueId: string, depotId?: string): Promise<ValeurStock> {
  const db = await ouvrirBaseDeDonnees();
  const depots = (await db.getAllFromIndex("depots", "boutique_id", boutiqueId)).filter((d) => !d.supprime);
  const depotIds = new Set(depots.map((d) => d.id));
  const stocks = (await db.getAll("stocks")).filter((s) => (depotId ? s.depot_id === depotId : depotIds.has(s.depot_id)));

  let valeurAchat = 0;
  let valeurVentePotentielle = 0;
  let nombreRuptures = 0;
  for (const s of stocks) {
    const variante = await db.get("variantes", s.variante_id);
    if (!variante) continue;
    valeurAchat += s.quantite * variante.prix_achat;
    valeurVentePotentielle += s.quantite * variante.prix_vente;
    if (s.quantite <= variante.seuil_alerte) nombreRuptures += 1;
  }

  return { valeurAchat, valeurVentePotentielle, nombreVariantes: stocks.length, nombreRuptures };
}

// --- Ventes par vendeur ---
// Note : comptes.Utilisateur n'est pas synchronisé localement (hérite
// d'AbstractUser, pas de ModeleBase) — on ne renvoie que l'id ; le libellé
// ("Vous" vs identifiant tronqué) est résolu côté UI (Rapports.tsx), comme
// pour le client Electron.

export interface LigneVentesVendeur {
  utilisateurId: string | null;
  nombreVentes: number;
  totalNet: number;
}

export async function ventesParVendeur(boutiqueId: string, debut: string, fin: string): Promise<LigneVentesVendeur[]> {
  const ventes = await ventesPeriode(boutiqueId, debut, fin);
  const parVendeur = new Map<string | null, { nombreVentes: number; totalNet: number }>();
  for (const v of ventes) {
    // utilisateur_id vient de comptes.Utilisateur (PK entière Django, cf. note
    // en tête de fichier) : DRF le sérialise en nombre, pas en UUID-string
    // comme les autres FK — on normalise explicitement en chaîne ici.
    const utilisateurId = v.utilisateur_id === null || v.utilisateur_id === undefined ? null : String(v.utilisateur_id);
    const cur = parVendeur.get(utilisateurId) ?? { nombreVentes: 0, totalNet: 0 };
    cur.nombreVentes += 1;
    cur.totalNet += v.total_net;
    parVendeur.set(utilisateurId, cur);
  }
  return [...parVendeur.entries()]
    .map(([utilisateurId, agg]) => ({ utilisateurId, ...agg }))
    .sort((a, b) => b.totalNet - a.totalNet);
}

// --- Ventes par catégorie ---

export interface LigneVentesCategorie {
  categorieId: string | null;
  categorie: string;
  quantiteVendue: number;
  caGenere: number;
}

export async function ventesParCategorie(boutiqueId: string, debut: string, fin: string): Promise<LigneVentesCategorie[]> {
  const db = await ouvrirBaseDeDonnees();
  const ventes = await ventesPeriode(boutiqueId, debut, fin);

  const parCategorie = new Map<string, LigneVentesCategorie>();
  for (const v of ventes) {
    const lignes = (await db.getAllFromIndex("lignes_vente", "vente_id", v.id)).filter((l) => !l.supprime);
    for (const l of lignes) {
      const variante = await db.get("variantes", l.variante_id);
      const produit = variante ? await db.get("produits", variante.produit_id) : undefined;
      const categorie = produit?.categorie_id ? await db.get("categories", produit.categorie_id) : undefined;
      const cle = categorie?.id ?? "__sans__";
      const cur = parCategorie.get(cle) ?? {
        categorieId: categorie?.id ?? null,
        categorie: categorie?.nom ?? "Sans catégorie",
        quantiteVendue: 0,
        caGenere: 0,
      };
      cur.quantiteVendue += l.quantite;
      cur.caGenere += l.sous_total;
      parCategorie.set(cle, cur);
    }
  }
  return [...parCategorie.values()].sort((a, b) => b.caGenere - a.caGenere);
}

// --- Ventes par mode de paiement ---

export interface LigneVentesModePaiement {
  mode: string;
  total: number;
}

export async function ventesParModePaiement(boutiqueId: string, debut: string, fin: string): Promise<LigneVentesModePaiement[]> {
  const db = await ouvrirBaseDeDonnees();
  const ventes = await ventesPeriode(boutiqueId, debut, fin);

  const parMode = new Map<string, number>();
  for (const v of ventes) {
    const paiements = (await db.getAllFromIndex("paiements", "vente_id", v.id)).filter((p) => !p.supprime);
    for (const p of paiements) {
      parMode.set(p.mode, (parMode.get(p.mode) ?? 0) + p.montant);
    }
  }
  return [...parMode.entries()].map(([mode, total]) => ({ mode, total })).sort((a, b) => b.total - a.total);
}

// --- Produits dormants (port de client-electron/electron/services/rapports.ts::produitsDormants) ---

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
export async function produitsDormants(boutiqueId: string, jours: number): Promise<LigneProduitDormant[]> {
  const db = await ouvrirBaseDeDonnees();
  const d = new Date();
  const aujourdhui = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Dernière vente (non annulée) par variante.
  const derniereVenteParVariante = new Map<string, string>();
  for (const vente of await db.getAllFromIndex("ventes", "boutique_id", boutiqueId)) {
    if (vente.supprime || vente.statut === "annulee") continue;
    for (const l of await db.getAllFromIndex("lignes_vente", "vente_id", vente.id)) {
      if (l.supprime) continue;
      const actuelle = derniereVenteParVariante.get(l.variante_id);
      if (!actuelle || vente.date_creation > actuelle) derniereVenteParVariante.set(l.variante_id, vente.date_creation);
    }
  }

  const maintenant = Date.now();
  const resultat: LigneProduitDormant[] = [];
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime);
  for (const produit of produits) {
    for (const v of await db.getAllFromIndex("variantes", "produit_id", produit.id)) {
      if (v.supprime) continue;
      const plage = IDBKeyRange.bound([v.id, ""], [v.id, "\uffff"]);
      const quantiteStock = (await db.getAllFromIndex("stocks", "variante_depot", plage)).reduce(
        (total, s) => total + s.quantite,
        0,
      );
      if (quantiteStock <= 0) continue;

      const derniereVente = derniereVenteParVariante.get(v.id) ?? null;
      let reference = derniereVente;
      if (!reference) {
        const entrees = (await db.getAllFromIndex("mouvements_stock", "variante_depot", plage))
          .filter((m) => !m.supprime && m.type === "entree")
          .map((m) => m.date_creation)
          .sort();
        reference = entrees[0] ?? v.date_creation ?? null;
      }
      const joursSansVente = reference ? Math.floor((maintenant - new Date(reference).getTime()) / 86_400_000) : 0;
      if (joursSansVente < jours) continue;

      const enDestockage = (await db.getAllFromIndex("destockages", "variante_id", v.id)).some(
        (ds) => !ds.supprime && ds.statut === "en_cours" && (!ds.date_fin || ds.date_fin >= aujourdhui),
      );
      resultat.push({
        varianteId: v.id,
        produitId: produit.id,
        produitNom: produit.nom,
        reference: v.reference ?? "",
        codeBarres: v.code_barres ?? "",
        prixVente: v.prix_vente,
        prixAchat: v.prix_achat,
        seuilAlerte: v.seuil_alerte,
        quantiteStock,
        derniereVente,
        joursSansVente,
        valeurImmobilisee: Math.round(quantiteStock * v.prix_achat),
        enDestockage,
      });
    }
  }
  return resultat.sort((a, b) => b.valeurImmobilisee - a.valeurImmobilisee);
}

// --- Historique de la dormance (port de client-electron/electron/services/rapports.ts) ---

const SEUIL_RELEVE_DORMANTS = 60;

function jourLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Photo du jour des produits dormants (60 jours), une fois par jour, à l'ouverture de l'appli. */
export async function enregistrerReleveDormants(boutiqueId: string): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const aujourdhui = jourLocal(new Date());
  const existants = await db.getAllFromIndex("releves_dormants", "boutique_id", boutiqueId);
  if (existants.some((r) => !r.supprime && r.date === aujourdhui)) return;
  const dormants = await produitsDormants(boutiqueId, SEUIL_RELEVE_DORMANTS);
  const releve: ReleveDormantsLocal = {
    id: crypto.randomUUID(),
    boutique_id: boutiqueId,
    date: aujourdhui,
    jours_seuil: SEUIL_RELEVE_DORMANTS,
    nombre_articles: dormants.length,
    valeur_immobilisee: dormants.reduce((somme, d) => somme + d.valeurImmobilisee, 0),
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("releves_dormants", releve);
}

export interface ReleveDormants {
  date: string;
  nombreArticles: number;
  valeurImmobilisee: number;
}

/** Un relevé par jour (le plus récent si plusieurs appareils en ont pris un), du plus ancien au plus récent. */
export async function listerRelevesDormants(boutiqueId: string): Promise<ReleveDormants[]> {
  const db = await ouvrirBaseDeDonnees();
  const lignes = (await db.getAllFromIndex("releves_dormants", "boutique_id", boutiqueId))
    .filter((r) => !r.supprime)
    .sort((a, b) => a.date.localeCompare(b.date) || a.date_creation.localeCompare(b.date_creation));
  const parJour = new Map<string, ReleveDormants>();
  for (const r of lignes) {
    parJour.set(r.date, { date: r.date, nombreArticles: r.nombre_articles, valeurImmobilisee: r.valeur_immobilisee });
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
  joursSansVente: number;
  action: ActionSortieDormance;
  motif: string;
  detail: string;
  quantite: number;
  montant: number;
}

interface EvenementDormance {
  date: string;
  type: "vente" | ActionSortieDormance;
  enDestockage?: boolean;
  sortie: Omit<SortieDormance, "joursSansVente" | "produitNom" | "reference">;
}

/**
 * « Ce qu'on a fait » des articles restés au moins `seuil` jours sans vente :
 * revendus au prix normal, déclarés en perte ou mis en déstockage (voir la
 * version Electron pour le détail du calcul).
 */
export async function sortiesDormance(boutiqueId: string, seuil: number): Promise<SortieDormance[]> {
  const db = await ouvrirBaseDeDonnees();
  const evenements = new Map<string, EvenementDormance[]>();
  const ajouter = (varianteId: string, e: EvenementDormance) =>
    evenements.set(varianteId, [...(evenements.get(varianteId) ?? []), e]);

  for (const vente of await db.getAllFromIndex("ventes", "boutique_id", boutiqueId)) {
    if (vente.supprime || vente.statut === "annulee") continue;
    for (const l of await db.getAllFromIndex("lignes_vente", "vente_id", vente.id)) {
      if (l.supprime) continue;
      ajouter(l.variante_id, {
        date: vente.date_creation,
        type: "vente",
        enDestockage: !!l.destockage_id,
        sortie: {
          id: `vente-${l.id}`,
          date: vente.date_creation,
          varianteId: l.variante_id,
          action: "revendu",
          motif: "",
          detail: "Vendu au prix normal",
          quantite: l.quantite,
          montant: l.sous_total,
        },
      });
    }
  }
  for (const depot of await db.getAllFromIndex("depots", "boutique_id", boutiqueId)) {
    for (const p of await db.getAllFromIndex("pertes_stock", "depot_id", depot.id)) {
      if (p.supprime || p.annulee) continue;
      ajouter(p.variante_id, {
        date: p.date_creation,
        type: "perte",
        sortie: {
          id: `perte-${p.id}`,
          date: p.date_creation,
          varianteId: p.variante_id,
          action: "perte",
          motif: p.motif,
          detail: p.detail ?? "",
          quantite: p.quantite,
          montant: p.valeur,
        },
      });
    }
  }
  for (const d of await listerDestockages(boutiqueId)) {
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
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter((p) => !p.supprime);
  for (const produit of produits) {
    for (const v of await db.getAllFromIndex("variantes", "produit_id", produit.id)) {
      if (v.supprime) continue;
      const liste = (evenements.get(v.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      if (liste.length === 0) continue;
      const plage = IDBKeyRange.bound([v.id, ""], [v.id, "\uffff"]);
      const entrees = (await db.getAllFromIndex("mouvements_stock", "variante_depot", plage))
        .filter((m) => !m.supprime && m.type === "entree")
        .map((m) => m.date_creation)
        .sort();
      let derniereActivite: string | null = entrees[0] ?? v.date_creation ?? null;
      for (const e of liste) {
        const jours = derniereActivite
          ? Math.floor((new Date(e.date).getTime() - new Date(derniereActivite).getTime()) / JOUR_MS)
          : 0;
        const estSortie = e.type !== "vente" || !e.enDestockage;
        if (estSortie && jours >= seuil) {
          resultat.push({ ...e.sortie, produitNom: produit.nom, reference: v.reference ?? "", joursSansVente: jours });
        }
        if (e.type === "vente") derniereActivite = e.date;
      }
    }
  }
  return resultat.sort((a, b) => b.date.localeCompare(a.date));
}
