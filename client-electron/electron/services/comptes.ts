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

export async function creerRole(
  session: Session,
  nom: string,
  permissions: Record<string, boolean>,
): Promise<RoleResume> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}/roles/`, {
    method: "POST",
    headers: entetes(session),
    body: JSON.stringify({ nom, permissions }),
  });
  if (!reponse.ok) throw new ErreurComptes(await extraireMessageErreur(reponse));
  return reponse.json();
}

export async function renommerRole(session: Session, id: string, nom: string): Promise<RoleResume> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}/roles/${id}/`, {
    method: "PATCH",
    headers: entetes(session),
    body: JSON.stringify({ nom }),
  });
  if (!reponse.ok) throw new ErreurComptes(await extraireMessageErreur(reponse));
  return reponse.json();
}

export async function supprimerRole(session: Session, id: string): Promise<void> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}/roles/${id}/`, {
    method: "DELETE",
    headers: entetes(session),
  });
  if (!reponse.ok) throw new ErreurComptes(await extraireMessageErreur(reponse));
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

export async function abonnementBoutique(session: Session): Promise<AbonnementDetail> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}/boutique/abonnement/`, { headers: entetes(session) });
  if (!reponse.ok) throw new ErreurComptes(await extraireMessageErreur(reponse));
  return reponse.json();
}

export async function declarerPaiementAbonnement(
  session: Session,
  declaration: DeclarationPaiementAbonnement,
): Promise<void> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}/boutique/abonnement/demandes/`, {
    method: "POST",
    headers: entetes(session),
    body: JSON.stringify({
      formule: declaration.formule,
      duree_mois: declaration.dureeMois,
      montant: declaration.montant,
      mode: declaration.mode,
      reference: declaration.reference,
    }),
  });
  if (!reponse.ok) throw new ErreurComptes(await extraireMessageErreur(reponse));
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

export async function listerUtilisateurs(session: Session): Promise<UtilisateurResume[]> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}/utilisateurs/`, { headers: entetes(session) });
  if (!reponse.ok) throw new ErreurComptes(await extraireMessageErreur(reponse));
  return reponse.json();
}

/** Noms des comptes de la boutique (lisible par tout membre, voir comptes/views.py::annuaire). */
export async function annuaireUtilisateurs(session: Session): Promise<{ id: number; nom: string }[]> {
  const reponse = await appelerAvecDelai(`${URL_BASE_API}/utilisateurs/annuaire/`, { headers: entetes(session) });
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
  codeVendeur?: string;
}

export async function modifierUtilisateur(
  session: Session,
  id: number,
  champs: ChampsUtilisateur,
): Promise<UtilisateurResume> {
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
