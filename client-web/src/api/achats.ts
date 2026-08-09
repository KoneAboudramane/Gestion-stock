import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

/**
 * Achats (commandes fournisseur + réceptions), en ligne uniquement — même
 * scoping que catalogue.ts/clients.ts (voir client-web/src/pages/Achats.tsx).
 * Accès réservé aux comptes ayant la permission gerer_produits_stock_achats
 * côté serveur (le Caissier n'a pas accès aux achats).
 */

export type StatutCommande = "brouillon" | "commandee" | "recue" | "annulee";

export interface VarianteAchat {
  id: string;
  produitId: string;
  produitNom: string;
  reference: string;
  prixAchat: number;
}

interface ProduitBruteAvecVariantes {
  id: string;
  nom: string;
  variantes: { id: string; produit: string; reference: string; prix_achat?: string; prix_vente: string; actif: boolean }[];
}

/** Index variante -> infos produit, utilisé pour enrichir lignes de commande/recherche d'article. */
async function indexVariantes(): Promise<Map<string, VarianteAchat>> {
  const reponse = await apiFetch("/produits/");
  if (!reponse.ok) return new Map();
  const produits: ProduitBruteAvecVariantes[] = await reponse.json();
  const index = new Map<string, VarianteAchat>();
  for (const p of produits) {
    for (const v of p.variantes) {
      index.set(v.id, {
        id: v.id,
        produitId: p.id,
        produitNom: p.nom,
        reference: v.reference,
        prixAchat: v.prix_achat === undefined ? 0 : Number(v.prix_achat),
      });
    }
  }
  return index;
}

export function rechercherVariantes(terme: string): Promise<ResultatEcriture<VarianteAchat[]>> {
  return executerEnSecurite(async () => {
    const index = await indexVariantes();
    const termeNormalise = terme.trim().toLowerCase();
    if (!termeNormalise) return [];
    return [...index.values()].filter((v) => v.produitNom.toLowerCase().includes(termeNormalise));
  });
}

export interface LigneAchatResume {
  id: string;
  varianteId: string;
  produitNom: string;
  reference: string;
  quantite: number;
  prixAchat: number;
  sousTotal: number;
}

export interface CommandeResume {
  id: string;
  numero: string;
  fournisseurId: string;
  fournisseurNom: string;
  statut: StatutCommande;
  total: number;
  dateCreation: string;
}

export interface CommandeDetail extends CommandeResume {
  lignes: LigneAchatResume[];
}

interface CommandeBrute {
  id: string;
  fournisseur: string;
  numero: string;
  statut: StatutCommande;
  total: string;
  date_creation: string;
  lignes: { id: string; variante: string; quantite: string; prix_achat: string; sous_total: string }[];
}

async function indexFournisseurs(): Promise<Map<string, string>> {
  const reponse = await apiFetch("/fournisseurs/");
  if (!reponse.ok) return new Map();
  const fournisseurs: { id: string; nom: string }[] = await reponse.json();
  return new Map(fournisseurs.map((f) => [f.id, f.nom]));
}

function versLigneAchat(b: CommandeBrute["lignes"][number], variantes: Map<string, VarianteAchat>): LigneAchatResume {
  const variante = variantes.get(b.variante);
  return {
    id: b.id,
    varianteId: b.variante,
    produitNom: variante?.produitNom ?? "",
    reference: variante?.reference ?? "",
    quantite: Number(b.quantite),
    prixAchat: Number(b.prix_achat),
    sousTotal: Number(b.sous_total),
  };
}

function versCommandeDetail(b: CommandeBrute, fournisseurNom: string, variantes: Map<string, VarianteAchat>): CommandeDetail {
  return {
    id: b.id,
    numero: b.numero,
    fournisseurId: b.fournisseur,
    fournisseurNom,
    statut: b.statut,
    total: Number(b.total),
    dateCreation: b.date_creation,
    lignes: b.lignes.map((l) => versLigneAchat(l, variantes)),
  };
}

export function listerCommandes(fournisseurId?: string, statut?: StatutCommande, terme?: string): Promise<ResultatEcriture<CommandeResume[]>> {
  return executerEnSecurite(async () => {
    const [reponse, fournisseurs] = await Promise.all([apiFetch("/commandes-achat/"), indexFournisseurs()]);
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brutes: CommandeBrute[] = await reponse.json();
    let resumes = brutes.map((b) => ({
      id: b.id,
      numero: b.numero,
      fournisseurId: b.fournisseur,
      fournisseurNom: fournisseurs.get(b.fournisseur) ?? "",
      statut: b.statut,
      total: Number(b.total),
      dateCreation: b.date_creation,
    }));
    if (fournisseurId) resumes = resumes.filter((c) => c.fournisseurId === fournisseurId);
    if (statut) resumes = resumes.filter((c) => c.statut === statut);
    if (terme?.trim()) {
      const t = terme.trim().toLowerCase();
      resumes = resumes.filter((c) => c.numero.toLowerCase().includes(t));
    }
    return resumes;
  });
}

export function obtenirCommande(id: string): Promise<ResultatEcriture<CommandeDetail>> {
  return executerEnSecurite(async () => {
    const [reponse, fournisseurs, variantes] = await Promise.all([apiFetch(`/commandes-achat/${id}/`), indexFournisseurs(), indexVariantes()]);
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brute: CommandeBrute = await reponse.json();
    return versCommandeDetail(brute, fournisseurs.get(brute.fournisseur) ?? "", variantes);
  });
}

export interface LigneAchatEntree {
  varianteId: string;
  quantite: number;
  prixAchat: number;
}

export interface CreerCommandeEntree {
  fournisseurId: string;
  statut: StatutCommande;
  lignes: LigneAchatEntree[];
}

export function creerCommande(entree: CreerCommandeEntree): Promise<ResultatEcriture<{ id: string }>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/commandes-achat/", {
      method: "POST",
      body: JSON.stringify({
        fournisseur: entree.fournisseurId,
        statut: entree.statut,
        lignes_saisie: entree.lignes.map((l) => ({ variante: l.varianteId, quantite: l.quantite, prix_achat: l.prixAchat })),
      }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brute = await reponse.json();
    return { id: brute.id };
  });
}

export interface ModifierCommandeEntree {
  fournisseurId?: string;
  statut?: StatutCommande;
}

export function modifierCommande(id: string, entree: ModifierCommandeEntree): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const payload: Record<string, unknown> = {};
    if (entree.fournisseurId !== undefined) payload.fournisseur = entree.fournisseurId;
    if (entree.statut !== undefined) payload.statut = entree.statut;
    const reponse = await apiFetch(`/commandes-achat/${id}/`, { method: "PATCH", body: JSON.stringify(payload) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

export interface ReceptionnerEntree {
  commandeId: string;
  depotId: string;
  montantDejaPaye: number;
  lignesPrix: { varianteId: string; prixVente: number }[];
}

export function receptionnerCommande(entree: ReceptionnerEntree): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/receptions/", {
      method: "POST",
      body: JSON.stringify({
        commande: entree.commandeId,
        depot: entree.depotId,
        montant_deja_paye: entree.montantDejaPaye,
        lignes_prix: entree.lignesPrix.map((l) => ({ variante: l.varianteId, prix_vente: l.prixVente })),
      }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}
