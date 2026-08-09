import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

/**
 * Lecture seule des ventes déjà synchronisées (historique) — la création d'une
 * vente passe uniquement par le moteur hors-ligne (voir services/ventes.ts et
 * sync/index.ts), jamais par cet endpoint REST côté client-web.
 */
export interface VenteResume {
  id: string;
  numero: string;
  dateCreation: string;
  statut: "payee" | "credit" | "annulee";
  totalNet: number;
  clientId: string | null;
}

interface VenteBrute {
  id: string;
  numero: string;
  date_creation: string;
  statut: "payee" | "credit" | "annulee";
  total_net: string;
  client: string | null;
}

function versVenteResume(b: VenteBrute): VenteResume {
  return {
    id: b.id,
    numero: b.numero,
    dateCreation: b.date_creation,
    statut: b.statut,
    totalNet: Number(b.total_net),
    clientId: b.client,
  };
}

export function listerVentes(): Promise<ResultatEcriture<VenteResume[]>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/ventes/");
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brutes: VenteBrute[] = await reponse.json();
    return brutes.map(versVenteResume);
  });
}

/**
 * Annulation d'une vente : logique métier (recréditer le stock, inverser un
 * crédit éventuel) uniquement côté serveur (ventes/services.py::annuler_vente),
 * pas de miroir local — on synchronise juste après pour rapatrier le résultat.
 */
export function annulerVente(id: string): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/ventes/${id}/annuler/`, { method: "POST" });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}
