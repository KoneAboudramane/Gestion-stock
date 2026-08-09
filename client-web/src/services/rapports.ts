import { ouvrirBaseDeDonnees } from "../db";
import type { VenteLocale } from "../db/schema";

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
