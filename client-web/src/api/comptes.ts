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
}

export function modifierUtilisateur(
  id: number,
  champs: ChampsUtilisateur,
): Promise<ResultatEcriture<UtilisateurResume>> {
  return executerEnSecurite(async () => {
    const corps: Record<string, unknown> = {};
    if (champs.roleId !== undefined) corps.role = champs.roleId;
    if (champs.depotId !== undefined) corps.depot = champs.depotId;
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
