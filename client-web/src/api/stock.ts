import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

export interface DepotResume {
  id: string;
  nom: string;
  adresse: string;
}

export function listerDepots(): Promise<ResultatEcriture<DepotResume[]>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/depots/");
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function creerDepot(nom: string, adresse: string): Promise<ResultatEcriture<DepotResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/depots/", { method: "POST", body: JSON.stringify({ nom, adresse }) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export interface ModifierDepotEntree {
  nom?: string;
  adresse?: string;
}

export function modifierDepot(id: string, entree: ModifierDepotEntree): Promise<ResultatEcriture<DepotResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/depots/${id}/`, { method: "PATCH", body: JSON.stringify(entree) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function supprimerDepot(id: string): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/depots/${id}/`, { method: "DELETE" });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

export interface LigneStock {
  id: string;
  varianteId: string;
  produitNom: string;
  reference: string;
  depotId: string;
  depotNom: string;
  quantite: number;
  seuilAlerte: number;
  enRupture: boolean;
}

interface LigneStockBrute {
  id: string;
  variante: string;
  depot: string;
  quantite: number;
  en_rupture: boolean;
  produit_nom: string;
  variante_reference: string;
  depot_nom: string;
  seuil_alerte: number;
}

function versLigneStock(brute: LigneStockBrute): LigneStock {
  return {
    id: brute.id,
    varianteId: brute.variante,
    produitNom: brute.produit_nom,
    reference: brute.variante_reference,
    depotId: brute.depot,
    depotNom: brute.depot_nom,
    quantite: Number(brute.quantite),
    seuilAlerte: Number(brute.seuil_alerte),
    enRupture: brute.en_rupture,
  };
}

export function listerStock(depotId?: string): Promise<ResultatEcriture<LigneStock[]>> {
  return executerEnSecurite(async () => {
    const requete = depotId ? `/stocks/?depot=${depotId}` : "/stocks/";
    const reponse = await apiFetch(requete);
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brutes: LigneStockBrute[] = await reponse.json();
    return brutes.map(versLigneStock);
  });
}
