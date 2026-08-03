import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

/**
 * Contrairement au client Electron (qui recalcule tout localement pour rester
 * consultable hors-ligne, miroir de rapports/services.py), le client web appelle
 * directement les routes Django — Django reste la seule source de vérité ici.
 * Chaque fonction traduit la réponse JSON snake_case de Django vers le camelCase
 * attendu par les pages (portées telles quelles depuis client-electron).
 */

export type Periode = "jour" | "semaine" | "mois" | "tout" | "personnalise";

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

/** Calcul de plage de dates, identique à celui du client Electron (electron/services/rapports.ts). */
export async function plageDates(periode: Periode = "jour", dateDebut?: string, dateFin?: string): Promise<PlageDates> {
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

async function obtenirJson<T>(chemin: string): Promise<T> {
  const reponse = await apiFetch(chemin);
  if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  return reponse.json();
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

export function syntheseVentes(debut: string, fin: string): Promise<ResultatEcriture<SyntheseVentes>> {
  return executerEnSecurite(async () => {
    const [donnees] = await obtenirJson<any[]>(`/rapports/ventes/synthese/?date_debut=${debut}&date_fin=${fin}`);
    return {
      totalBrut: Number(donnees.total_brut),
      totalRemises: Number(donnees.total_remises),
      totalNet: Number(donnees.total_net),
      nombreVentes: Number(donnees.nombre_ventes),
      panierMoyen: Number(donnees.panier_moyen),
      beneficeTotal: Number(donnees.benefice_total),
    };
  });
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
  debut: string,
  fin: string,
  limite = 10,
  ordre: "asc" | "desc" = "desc",
): Promise<ResultatEcriture<LigneTopProduit[]>> {
  return executerEnSecurite(async () => {
    const lignes = await obtenirJson<any[]>(
      `/rapports/produits/top/?date_debut=${debut}&date_fin=${fin}&limite=${limite}&ordre=${ordre}`,
    );
    return lignes.map((l) => ({
      varianteId: l.variante_id,
      produit: l.produit,
      reference: l.reference,
      quantiteVendue: Number(l.quantite_vendue),
      caGenere: Number(l.ca_genere),
    }));
  });
}

// --- Valeur du stock ---

export interface ValeurStock {
  valeurAchat: number;
  valeurVentePotentielle: number;
  nombreVariantes: number;
  nombreRuptures: number;
}

export function valeurStock(depotId?: string): Promise<ResultatEcriture<ValeurStock>> {
  return executerEnSecurite(async () => {
    const requete = depotId ? `/rapports/stock/valeur/?depot=${depotId}` : "/rapports/stock/valeur/";
    const [donnees] = await obtenirJson<any[]>(requete);
    return {
      valeurAchat: Number(donnees.valeur_achat),
      valeurVentePotentielle: Number(donnees.valeur_vente_potentielle),
      nombreVariantes: Number(donnees.nombre_variantes),
      nombreRuptures: Number(donnees.nombre_ruptures),
    };
  });
}

// --- Ventes par vendeur ---
// Contrairement au client Electron (qui n'a pas accès aux noms d'utilisateurs en
// local et doit se rabattre sur un identifiant tronqué), Django renvoie le vrai
// nom d'utilisateur : on l'affiche directement.

export interface LigneVentesVendeur {
  utilisateurId: string | null;
  utilisateur: string;
  nombreVentes: number;
  totalNet: number;
}

export function ventesParVendeur(debut: string, fin: string): Promise<ResultatEcriture<LigneVentesVendeur[]>> {
  return executerEnSecurite(async () => {
    const lignes = await obtenirJson<any[]>(`/rapports/ventes/par-vendeur/?date_debut=${debut}&date_fin=${fin}`);
    return lignes.map((l) => ({
      utilisateurId: l.utilisateur_id !== null ? String(l.utilisateur_id) : null,
      utilisateur: l.utilisateur ?? "",
      nombreVentes: Number(l.nombre_ventes),
      totalNet: Number(l.total_net),
    }));
  });
}

// --- Ventes par catégorie ---

export interface LigneVentesCategorie {
  categorieId: string | null;
  categorie: string;
  quantiteVendue: number;
  caGenere: number;
}

export function ventesParCategorie(debut: string, fin: string): Promise<ResultatEcriture<LigneVentesCategorie[]>> {
  return executerEnSecurite(async () => {
    const lignes = await obtenirJson<any[]>(`/rapports/ventes/par-categorie/?date_debut=${debut}&date_fin=${fin}`);
    return lignes.map((l) => ({
      categorieId: l.categorie_id !== null ? String(l.categorie_id) : null,
      categorie: l.categorie,
      quantiteVendue: Number(l.quantite_vendue),
      caGenere: Number(l.ca_genere),
    }));
  });
}

// --- Ventes par mode de paiement ---

export interface LigneVentesModePaiement {
  mode: string;
  total: number;
}

export function ventesParModePaiement(debut: string, fin: string): Promise<ResultatEcriture<LigneVentesModePaiement[]>> {
  return executerEnSecurite(async () => {
    const lignes = await obtenirJson<any[]>(`/rapports/ventes/par-mode-paiement/?date_debut=${debut}&date_fin=${fin}`);
    return lignes.map((l) => ({ mode: l.mode, total: Number(l.total) }));
  });
}

// --- Ventes par jour ---

export interface LigneVentesParJour {
  jour: string;
  totalNet: number;
}

export function ventesParJour(debut: string, fin: string): Promise<ResultatEcriture<LigneVentesParJour[]>> {
  return executerEnSecurite(async () => {
    const lignes = await obtenirJson<any[]>(`/rapports/ventes/par-jour/?date_debut=${debut}&date_fin=${fin}`);
    return lignes.map((l) => ({ jour: l.jour, totalNet: Number(l.total_net) }));
  });
}

// --- Top clients ---

export interface LigneTopClient {
  clientId: string;
  clientNom: string;
  nombreVentes: number;
  totalNet: number;
}

export function topClients(debut: string, fin: string, limite = 5): Promise<ResultatEcriture<LigneTopClient[]>> {
  return executerEnSecurite(async () => {
    const lignes = await obtenirJson<any[]>(
      `/rapports/clients/top/?date_debut=${debut}&date_fin=${fin}&limite=${limite}`,
    );
    return lignes.map((l) => ({
      clientId: l.client_id,
      clientNom: l.client_nom,
      nombreVentes: Number(l.nombre_ventes),
      totalNet: Number(l.total_net),
    }));
  });
}
