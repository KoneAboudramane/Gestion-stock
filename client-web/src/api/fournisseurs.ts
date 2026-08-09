import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

export interface FournisseurResume {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  contact: string;
}

export function listerFournisseurs(): Promise<ResultatEcriture<FournisseurResume[]>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/fournisseurs/");
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function creerFournisseur(nom: string, telephone: string, adresse: string, contact: string): Promise<ResultatEcriture<FournisseurResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/fournisseurs/", { method: "POST", body: JSON.stringify({ nom, telephone, adresse, contact }) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export type StatutDette = "en_cours" | "solde";

export interface DetteResume {
  id: string;
  fournisseurId: string;
  fournisseurNom: string;
  commandeId: string | null;
  commandeNumero: string | null;
  montant: number;
  montantPaye: number;
  solde: number;
  statut: StatutDette;
  dateCreation: string;
}

interface DetteBrute {
  id: string;
  fournisseur: string;
  commande: string | null;
  montant: string;
  montant_paye: string;
  solde: string;
  statut: StatutDette;
  date_creation: string;
}

async function indexFournisseursEtCommandes(): Promise<{ fournisseurs: Map<string, string>; commandes: Map<string, string> }> {
  const [reponseFournisseurs, reponseCommandes] = await Promise.all([apiFetch("/fournisseurs/"), apiFetch("/commandes-achat/")]);
  const fournisseurs: { id: string; nom: string }[] = reponseFournisseurs.ok ? await reponseFournisseurs.json() : [];
  const commandes: { id: string; numero: string }[] = reponseCommandes.ok ? await reponseCommandes.json() : [];
  return {
    fournisseurs: new Map(fournisseurs.map((f) => [f.id, f.nom])),
    commandes: new Map(commandes.map((c) => [c.id, c.numero])),
  };
}

export function listerDettes(fournisseurId?: string, statut?: StatutDette): Promise<ResultatEcriture<DetteResume[]>> {
  return executerEnSecurite(async () => {
    const [reponse, { fournisseurs, commandes }] = await Promise.all([apiFetch("/dettes-fournisseur/"), indexFournisseursEtCommandes()]);
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brutes: DetteBrute[] = await reponse.json();
    let resumes = brutes.map((b) => ({
      id: b.id,
      fournisseurId: b.fournisseur,
      fournisseurNom: fournisseurs.get(b.fournisseur) ?? "",
      commandeId: b.commande,
      commandeNumero: b.commande ? (commandes.get(b.commande) ?? null) : null,
      montant: Number(b.montant),
      montantPaye: Number(b.montant_paye),
      solde: Number(b.solde),
      statut: b.statut,
      dateCreation: b.date_creation,
    }));
    if (fournisseurId) resumes = resumes.filter((d) => d.fournisseurId === fournisseurId);
    if (statut) resumes = resumes.filter((d) => d.statut === statut);
    return resumes;
  });
}

export function payerDette(id: string, montant: number): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/dettes-fournisseur/${id}/payer/`, { method: "POST", body: JSON.stringify({ montant }) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}
