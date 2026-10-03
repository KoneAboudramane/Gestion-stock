import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

// --- Rôles ---

export interface RoleResume {
  id: string;
  nom: string;
  permissions: Record<string, boolean>;
}

export function listerRoles(): Promise<ResultatEcriture<RoleResume[]>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/roles/");
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function modifierRole(id: string, permissions: Record<string, boolean>): Promise<ResultatEcriture<RoleResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/roles/${id}/`, {
      method: "PATCH",
      body: JSON.stringify({ permissions }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function creerRole(nom: string, permissions: Record<string, boolean>): Promise<ResultatEcriture<RoleResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/roles/", {
      method: "POST",
      body: JSON.stringify({ nom, permissions }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function renommerRole(id: string, nom: string): Promise<ResultatEcriture<RoleResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/roles/${id}/`, {
      method: "PATCH",
      body: JSON.stringify({ nom }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function supprimerRole(id: string): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/roles/${id}/`, { method: "DELETE" });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

/** Carte « Abonnement » : historique des périodes et où payer (GET /boutique/abonnement/). */
export interface AbonnementDetail {
  historique: {
    date: string;
    nature: string;
    nature_libelle: string;
    formule: string;
    date_debut: string;
    date_fin: string | null;
    montant: string;
    mode_libelle: string;
    reference: string;
  }[];
  demandes: {
    date: string;
    formule: string;
    duree_libelle: string;
    montant: string;
    mode_libelle: string;
    reference: string;
    statut: "en_attente" | "validee" | "rejetee";
    statut_libelle: string;
    motif_rejet: string;
  }[];
  /** Vide tant que l'administrateur n'a pas saisi ses prix. */
  tarifs: { formule: string; formule_libelle: string; duree_mois: number; prix: string; remise: string }[];
  renouvellement: { numeros: { operateur: string; numero: string }[]; whatsapp: string; instructions: string };
}

/** « J'ai payé » : paiement Mobile Money déclaré, à valider par l'administrateur. */
export interface DeclarationPaiementAbonnement {
  formule: string;
  dureeMois: number;
  montant: number;
  mode: string;
  reference: string;
}

export function abonnementBoutique(): Promise<ResultatEcriture<AbonnementDetail>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/boutique/abonnement/");
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function declarerPaiementAbonnement(declaration: DeclarationPaiementAbonnement): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/boutique/abonnement/demandes/", {
      method: "POST",
      body: JSON.stringify({
        formule: declaration.formule,
        duree_mois: declaration.dureeMois,
        montant: declaration.montant,
        mode: declaration.mode,
        reference: declaration.reference,
      }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}

// --- Utilisateurs ---

export interface UtilisateurResume {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  telephone: string;
  role: string | null;
  depot: string | null;
  /** Abréviation dans les numéros de ses documents (VTE-20261002-AKO-0001). */
  code_vendeur: string;
  is_active: boolean;
  date_joined: string;
}

export function listerUtilisateurs(): Promise<ResultatEcriture<UtilisateurResume[]>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/utilisateurs/");
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

/** Noms des comptes de la boutique (lisible par tout membre, voir comptes/views.py::annuaire). */
export function annuaireUtilisateurs(): Promise<ResultatEcriture<{ id: number; nom: string }[]>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/utilisateurs/annuaire/");
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export interface ParametresCreationUtilisateur {
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  telephone?: string;
  roleId?: string | null;
  depotId?: string | null;
}

export function creerUtilisateur(
  params: ParametresCreationUtilisateur,
): Promise<ResultatEcriture<UtilisateurResume>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch("/utilisateurs/", {
      method: "POST",
      body: JSON.stringify({
        username: params.username,
        password: params.password,
        first_name: params.firstName ?? "",
        last_name: params.lastName ?? "",
        email: params.email ?? "",
        telephone: params.telephone ?? "",
        role: params.roleId ?? null,
        depot: params.depotId ?? null,
      }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export interface ChampsUtilisateur {
  roleId?: string | null;
  depotId?: string | null;
  isActive?: boolean;
  password?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  telephone?: string;
  codeVendeur?: string;
}

export function modifierUtilisateur(
  id: number,
  champs: ChampsUtilisateur,
): Promise<ResultatEcriture<UtilisateurResume>> {
  return executerEnSecurite(async () => {
    const corps: Record<string, unknown> = {};
    if (champs.roleId !== undefined) corps.role = champs.roleId;
    if (champs.depotId !== undefined) corps.depot = champs.depotId;
    if (champs.codeVendeur !== undefined) corps.code_vendeur = champs.codeVendeur;
    if (champs.isActive !== undefined) corps.is_active = champs.isActive;
    if (champs.password) corps.password = champs.password;
    if (champs.firstName !== undefined) corps.first_name = champs.firstName;
    if (champs.lastName !== undefined) corps.last_name = champs.lastName;
    if (champs.email !== undefined) corps.email = champs.email;
    if (champs.telephone !== undefined) corps.telephone = champs.telephone;

    const reponse = await apiFetch(`/utilisateurs/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(corps),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return reponse.json();
  });
}

export function supprimerUtilisateur(id: number): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/utilisateurs/${id}/`, { method: "DELETE" });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}
