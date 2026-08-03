import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

export interface BoutiqueDetail {
  id: string;
  nom: string;
  adresse: string;
  telephone: string;
  email: string;
  devise: string;
}

export function obtenirBoutique(): Promise<ResultatEcriture<BoutiqueDetail>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/boutique/");
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}
