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

export interface ModifierBoutiqueEntree {
  nom?: string;
  adresse?: string;
  telephone?: string;
  email?: string;
  devise?: string;
}

/** Le logo (ImageField, upload multipart) n'est pas géré ici — hors périmètre de ce premier passage web. */
export function modifierBoutique(entree: ModifierBoutiqueEntree): Promise<ResultatEcriture<BoutiqueDetail>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/boutique/", { method: "PATCH", body: JSON.stringify(entree) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}
