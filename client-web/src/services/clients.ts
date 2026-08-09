import { ouvrirBaseDeDonnees } from "../db";
import { ecrireLigne, maintenant, obtenirLigne, suiviSyncNeuf } from "../db/helpers";
import type { ClientLocal, CreditLocal, PaiementCreditLocal } from "../db/schema";

/**
 * Port navigateur de client-electron/electron/services/clients.ts : un Credit
 * naît uniquement d'une vente à crédit (cf. services/ventes.ts::creerVente),
 * pas de création ici. Contrairement à fournisseurs.DetteFournisseur, chaque
 * remboursement laisse une trace (PaiementCredit), pas seulement une mutation
 * du solde.
 */

export class ErreurClient extends Error {}

export type StatutCredit = "en_cours" | "solde";

// --- Clients ---

export interface ClientDetailResume {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  estPermanent: boolean;
  soldeCredit: number;
}

async function soldeCreditClient(db: Awaited<ReturnType<typeof ouvrirBaseDeDonnees>>, clientId: string): Promise<number> {
  const credits = await db.getAllFromIndex("credits", "client_id", clientId);
  return credits.filter((c) => !c.supprime && c.statut === "en_cours").reduce((somme, c) => somme + c.solde, 0);
}

/**
 * Le répertoire clients n'affiche que les clients permanents — les clients
 * occasionnels (saisis à la volée pour une vente à crédit) n'y figurent
 * jamais, ils ne sont visibles que via le carnet de crédit (listerCredits)
 * tant que leur solde n'est pas soldé.
 */
export async function listerClientsDetail(boutiqueId: string, terme = ""): Promise<ClientDetailResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const clients = (await db.getAllFromIndex("clients", "boutique_id", boutiqueId)).filter(
    (c) => !c.supprime && c.est_permanent === 1,
  );
  const motif = terme.trim().toLowerCase();
  const filtres = motif
    ? clients.filter((c) => c.nom.toLowerCase().includes(motif) || c.telephone.toLowerCase().includes(motif))
    : clients;

  const resultat: ClientDetailResume[] = [];
  for (const c of filtres) {
    resultat.push({
      id: c.id,
      nom: c.nom,
      telephone: c.telephone,
      adresse: c.adresse,
      estPermanent: c.est_permanent === 1,
      soldeCredit: await soldeCreditClient(db, c.id),
    });
  }
  return resultat.sort((a, b) => a.nom.localeCompare(b.nom));
}

/**
 * Contrairement à listerClientsDetail, n'importe quel client (permanent ou
 * occasionnel) peut être récupéré ici — nécessaire pour afficher/modifier ses
 * informations depuis le carnet de crédit, où figurent aussi des clients de
 * passage absents du répertoire principal.
 */
export async function obtenirClient(id: string): Promise<ClientDetailResume | undefined> {
  const db = await ouvrirBaseDeDonnees();
  const c = await db.get("clients", id);
  if (!c || c.supprime) return undefined;
  return {
    id: c.id,
    nom: c.nom,
    telephone: c.telephone,
    adresse: c.adresse,
    estPermanent: c.est_permanent === 1,
    soldeCredit: await soldeCreditClient(db, c.id),
  };
}

export async function creerClient(
  boutiqueId: string,
  nom: string,
  telephone = "",
  adresse = "",
  estPermanent = true,
): Promise<string> {
  if (!nom.trim()) throw new ErreurClient("Le nom du client est obligatoire.");
  const id = crypto.randomUUID();
  const client: ClientLocal = {
    id,
    boutique_id: boutiqueId,
    nom: nom.trim(),
    telephone,
    adresse,
    est_permanent: estPermanent ? 1 : 0,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("clients", client);
  return id;
}

export async function modifierClient(
  id: string,
  champs: Partial<{ nom: string; telephone: string; adresse: string }>,
): Promise<void> {
  const client = await obtenirLigne("clients", id);
  if (!client) throw new ErreurClient("Client introuvable.");
  await ecrireLigne("clients", {
    ...client,
    nom: champs.nom ?? client.nom,
    telephone: champs.telephone ?? client.telephone,
    adresse: champs.adresse ?? client.adresse,
    date_modification: maintenant(),
    synchronise: 0,
  });
}

export async function supprimerClient(id: string): Promise<void> {
  const client = await obtenirLigne("clients", id);
  if (!client) return;
  await ecrireLigne("clients", { ...client, supprime: 1, synchronise: 0, date_modification: maintenant() });
}

// --- Crédits ---

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
  echeance: string | null;
  statut: StatutCredit;
  dateCreation: string;
}

export async function listerCredits(boutiqueId: string, clientId?: string, statut?: StatutCredit): Promise<CreditResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const clients = await db.getAllFromIndex("clients", "boutique_id", boutiqueId);
  const clientsParId = new Map(clients.map((c) => [c.id, c]));

  let credits: CreditLocal[];
  if (clientId) {
    credits = await db.getAllFromIndex("credits", "client_id", clientId);
  } else {
    credits = (await db.getAll("credits")).filter((cr) => clientsParId.has(cr.client_id));
  }
  credits = credits.filter((cr) => !cr.supprime);
  if (statut) credits = credits.filter((cr) => cr.statut === statut);

  const resultat: CreditResume[] = [];
  for (const cr of credits) {
    const client = clientsParId.get(cr.client_id);
    const vente = cr.vente_id ? await db.get("ventes", cr.vente_id) : undefined;
    resultat.push({
      id: cr.id,
      clientId: cr.client_id,
      clientNom: client?.nom ?? "",
      clientEstPermanent: client?.est_permanent === 1,
      venteId: cr.vente_id,
      venteNumero: vente?.numero ?? null,
      montant: cr.montant,
      montantPaye: cr.montant_paye,
      solde: cr.solde,
      echeance: cr.echeance,
      statut: cr.statut,
      dateCreation: cr.date_creation,
    });
  }
  return resultat.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}

export interface PaiementCreditDetail {
  id: string;
  montant: number;
  mode: string;
  dateCreation: string;
}

export interface CreditDetail extends CreditResume {
  paiements: PaiementCreditDetail[];
}

export async function obtenirCredit(id: string): Promise<CreditDetail | undefined> {
  const db = await ouvrirBaseDeDonnees();
  const cr = await db.get("credits", id);
  if (!cr || cr.supprime) return undefined;
  const client = await db.get("clients", cr.client_id);
  const vente = cr.vente_id ? await db.get("ventes", cr.vente_id) : undefined;
  const paiements = (await db.getAllFromIndex("paiements_credit", "credit_id", id)).filter((p) => !p.supprime);

  return {
    id: cr.id,
    clientId: cr.client_id,
    clientNom: client?.nom ?? "",
    clientEstPermanent: client?.est_permanent === 1,
    venteId: cr.vente_id,
    venteNumero: vente?.numero ?? null,
    montant: cr.montant,
    montantPaye: cr.montant_paye,
    solde: cr.solde,
    echeance: cr.echeance,
    statut: cr.statut,
    dateCreation: cr.date_creation,
    paiements: paiements
      .map((p) => ({ id: p.id, montant: p.montant, mode: p.mode, dateCreation: p.date_creation }))
      .sort((a, b) => b.dateCreation.localeCompare(a.dateCreation)),
  };
}

/** Miroir exact de clients/services.py::rembourser_credit. */
export async function rembourserCredit(creditId: string, montant: number, mode = ""): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const credit = await db.get("credits", creditId);
  if (!credit) throw new ErreurClient("Crédit introuvable.");
  if (montant <= 0) {
    throw new ErreurClient("Le montant remboursé doit être strictement positif.");
  }
  if (montant > credit.solde) {
    throw new ErreurClient("Le montant remboursé ne peut pas dépasser le solde restant.");
  }

  const paiement: PaiementCreditLocal = {
    id: crypto.randomUUID(),
    credit_id: creditId,
    montant,
    mode,
    ...suiviSyncNeuf(),
  };
  await db.put("paiements_credit", paiement);

  const nouveauMontantPaye = credit.montant_paye + montant;
  const nouveauSolde = credit.solde - montant;
  await db.put("credits", {
    ...credit,
    montant_paye: nouveauMontantPaye,
    solde: nouveauSolde,
    statut: nouveauSolde === 0 ? "solde" : "en_cours",
    synchronise: 0,
    date_modification: maintenant(),
  });
}
