import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

export interface ParametreResume {
  id: string;
  cle: string;
  valeur: string;
}

export function listerParametres(): Promise<ResultatEcriture<ParametreResume[]>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/parametres/");
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

/** Upsert par clé (POST /parametres/definir/) : évite le conflit unique_together(boutique, cle) d'un create() classique. */
export function definirParametre(cle: string, valeur: string): Promise<ResultatEcriture<ParametreResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/parametres/definir/", { method: "POST", body: JSON.stringify({ cle, valeur }) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function supprimerParametre(id: string): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/parametres/${id}/`, { method: "DELETE" });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}
