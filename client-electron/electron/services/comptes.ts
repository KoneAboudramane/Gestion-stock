import { URL_BASE_API } from "../config";
import { appelerAvecDelai } from "./sync";
import type { Session } from "./auth";

/**
 * comptes.Utilisateur / comptes.Role sont explicitement hors synchro
 * (synchronisation/registre.py : Utilisateur hérite d'AbstractUser, PK
 * entière Django, pas UUID — incompatible avec le mécanisme générique).
 * Ces opérations appellent donc l'API Django en direct, contrairement à tout
 * le reste de ce client qui n'écrit que dans la base locale.
 */

export class ErreurComptes extends Error {}

async function extraireMessageErreur(reponse: Response): Promise<string> {
  try {
    const corps = await reponse.json();
    const premiereValeur = Object.values(corps as Record<string, unknown>)[0];
    const message = Array.isArray(premiereValeur) ? premiereValeur[0] : premiereValeur;
    if (typeof message === "string") return message;
  } catch {
    // corps non-JSON ou vide : on retombe sur le message générique ci-dessous
  }
  return `HTTP ${reponse.status}`;
}

function entetes(session: Session): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` };
}

// --- Rôles ---

export interface RoleResume {
  id: string;
  nom: string;
  permissions: Record<string, boolean>;
}

export async function listerRoles(session: Session): Promise<RoleResume[]> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}/roles/`, { headers: entetes(session) });
  if (!reponse.ok) throw new ErreurComptes(await extraireMessageErreur(reponse));
  return reponse.json();
}

export async function modifierRole(
  session: Session,
  id: string,
  permissions: Record<string, boolean>,
): Promise<RoleResume> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}/roles/${id}/`, {
    method: "PATCH",
    headers: entetes(session),
    body: JSON.stringify({ permissions }),
  });
  if (!reponse.ok) throw new ErreurComptes(await extraireMessageErreur(reponse));
  return reponse.json();
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

export async function listerUtilisateurs(session: Session): Promise<UtilisateurResume[]> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}/utilisateurs/`, { headers: entetes(session) });
  if (!reponse.ok) throw new ErreurComptes(await extraireMessageErreur(reponse));
  return reponse.json();
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

export async function creerUtilisateur(
  session: Session,
  params: ParametresCreationUtilisateur,
): Promise<UtilisateurResume> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}/utilisateurs/`, {
    method: "POST",
    headers: entetes(session),
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
  if (!reponse.ok) throw new ErreurComptes(await extraireMessageErreur(reponse));
  return reponse.json();
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

export async function modifierUtilisateur(
  session: Session,
  id: number,
  champs: ChampsUtilisateur,
): Promise<UtilisateurResume> {
  const corps: Record<string, unknown> = {};
  if (champs.roleId !== undefined) corps.role = champs.roleId;
  if (champs.depotId !== undefined) corps.depot = champs.depotId;
  if (champs.isActive !== undefined) corps.is_active = champs.isActive;
  if (champs.password) corps.password = champs.password;
  if (champs.firstName !== undefined) corps.first_name = champs.firstName;
  if (champs.lastName !== undefined) corps.last_name = champs.lastName;
  if (champs.email !== undefined) corps.email = champs.email;
  if (champs.telephone !== undefined) corps.telephone = champs.telephone;

  const reponse = await appelerAvecDelai(`${URL_BASE_API}/utilisateurs/${id}/`, {
    method: "PATCH",
    headers: entetes(session),
    body: JSON.stringify(corps),
  });
  if (!reponse.ok) throw new ErreurComptes(await extraireMessageErreur(reponse));
  return reponse.json();
}

export async function supprimerUtilisateur(session: Session, id: number): Promise<void> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}/utilisateurs/${id}/`, {
    method: "DELETE",
    headers: entetes(session),
  });
  if (!reponse.ok) throw new ErreurComptes(await extraireMessageErreur(reponse));
}
