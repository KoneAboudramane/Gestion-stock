import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

/**
 * Clients et carnet de crédit, en ligne uniquement — même scoping que catalogue.ts
 * (voir client-web/src/pages/Clients.tsx) : la gestion clients/crédit n'est pas
 * jugée bloquante hors-ligne, seule la Caisse (création de vente) l'est.
 */

// --- Clients ---

export interface ClientResume {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  estPermanent: boolean;
  soldeCredit: number;
}

interface ClientBrute {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  est_permanent: boolean;
}

function versClientResume(b: ClientBrute, soldeCredit: number): ClientResume {
  return { id: b.id, nom: b.nom, telephone: b.telephone, adresse: b.adresse, estPermanent: b.est_permanent, soldeCredit };
}

async function soldesCreditParClient(): Promise<Record<string, number>> {
  const resultat = await listerCredits();
  if (!resultat.succes) return {};
  const soldes: Record<string, number> = {};
  for (const c of resultat.resultat) {
    if (c.statut !== "en_cours") continue;
    soldes[c.clientId] = (soldes[c.clientId] ?? 0) + c.solde;
  }
  return soldes;
}

export function listerClients(): Promise<ResultatEcriture<ClientResume[]>> {
  return executerEnSecurite(async () => {
    const [reponse, soldes] = await Promise.all([apiFetch("/clients/"), soldesCreditParClient()]);
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brutes: ClientBrute[] = await reponse.json();
    return brutes.map((b) => versClientResume(b, soldes[b.id] ?? 0));
  });
}

export function creerClient(nom: string, telephone: string, adresse: string): Promise<ResultatEcriture<ClientResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/clients/", { method: "POST", body: JSON.stringify({ nom, telephone, adresse }) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return versClientResume(await reponse.json(), 0);
  });
}

export interface ModifierClientEntree {
  nom?: string;
  telephone?: string;
  adresse?: string;
}

export function modifierClient(id: string, entree: ModifierClientEntree): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/clients/${id}/`, { method: "PATCH", body: JSON.stringify(entree) });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

export function supprimerClient(id: string): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/clients/${id}/`, { method: "DELETE" });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

// --- Crédits ---

export type StatutCredit = "en_cours" | "solde";

export interface PaiementCreditResume {
  id: string;
  montant: number;
  mode: string;
  dateCreation: string;
}

export interface CreditResume {
  id: string;
  clientId: string;
  clientNom: string;
  clientEstPermanent: boolean;
  venteId: string | null;
  venteNumero: string | null;
  montant: number;
  montantPaye: number;
  solde: number;
  statut: StatutCredit;
  dateCreation: string;
}

export interface CreditDetail extends CreditResume {
  paiements: PaiementCreditResume[];
}

interface CreditBrute {
  id: string;
  client: string;
  vente: string | null;
  montant: string;
  montant_paye: string;
  solde: string;
  statut: StatutCredit;
  date_creation: string;
  paiements: { id: string; montant: string; mode: string; date_creation: string }[];
}

function versCreditDetail(b: CreditBrute, clientNom: string, clientEstPermanent: boolean, venteNumero: string | null): CreditDetail {
  return {
    id: b.id,
    clientId: b.client,
    clientNom,
    clientEstPermanent,
    venteId: b.vente,
    venteNumero,
    montant: Number(b.montant),
    montantPaye: Number(b.montant_paye),
    solde: Number(b.solde),
    statut: b.statut,
    dateCreation: b.date_creation,
    paiements: b.paiements.map((p) => ({ id: p.id, montant: Number(p.montant), mode: p.mode, dateCreation: p.date_creation })),
  };
}

async function indexClientsEtVentes(): Promise<{
  clients: Map<string, ClientBrute>;
  ventesNumeros: Map<string, string>;
}> {
  const [reponseClients, reponseVentes] = await Promise.all([apiFetch("/clients/"), apiFetch("/ventes/")]);
  const clientsBrutes: ClientBrute[] = reponseClients.ok ? await reponseClients.json() : [];
  const ventesBrutes: { id: string; numero: string }[] = reponseVentes.ok ? await reponseVentes.json() : [];
  return {
    clients: new Map(clientsBrutes.map((c) => [c.id, c])),
    ventesNumeros: new Map(ventesBrutes.map((v) => [v.id, v.numero])),
  };
}

export function listerCredits(clientId?: string, statut?: StatutCredit): Promise<ResultatEcriture<CreditResume[]>> {
  return executerEnSecurite(async () => {
    const chemin = clientId ? `/credits/?client=${clientId}` : "/credits/";
    const [reponse, { clients, ventesNumeros }] = await Promise.all([apiFetch(chemin), indexClientsEtVentes()]);
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brutes: CreditBrute[] = await reponse.json();
    const resumes = brutes.map((b) => {
      const client = clients.get(b.client);
      return versCreditDetail(b, client?.nom ?? "", client?.est_permanent ?? false, b.vente ? (ventesNumeros.get(b.vente) ?? null) : null);
    });
    return statut ? resumes.filter((c) => c.statut === statut) : resumes;
  });
}

export function obtenirCredit(id: string): Promise<ResultatEcriture<CreditDetail>> {
  return executerEnSecurite(async () => {
    const [reponse, { clients, ventesNumeros }] = await Promise.all([apiFetch(`/credits/${id}/`), indexClientsEtVentes()]);
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brute: CreditBrute = await reponse.json();
    const client = clients.get(brute.client);
    return versCreditDetail(brute, client?.nom ?? "", client?.est_permanent ?? false, brute.vente ? (ventesNumeros.get(brute.vente) ?? null) : null);
  });
}

export function rembourserCredit(id: string, montant: number, mode: string): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/credits/${id}/rembourser/`, {
      method: "POST",
      body: JSON.stringify({ montant, mode }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}
